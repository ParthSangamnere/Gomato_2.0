// ============================================================
// authService.js — Port of AuthClient.kt (PKCE + Zomato OAuth2)
// Uses tough-cookie to persist session cookies across redirects!
// ============================================================
const axios  = require('axios')
const crypto = require('crypto')
const { wrapper } = require('axios-cookiejar-support')
const { CookieJar } = require('tough-cookie')

// In-memory store: phone → { codeVerifier, loginChallenge, jar, state }
const pendingLogins = new Map()

const CLIENT_ID   = '5276d7f1-910b-4243-92ea-d27e758ad02b'
const REDIRECT_URI = 'https://accounts.zomato.com/zoauth/callback'

/**
 * Generate PKCE code_verifier + code_challenge (SHA-256, base64url)
 */
function generatePKCE() {
  const verifier  = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function generateState(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

/**
 * Create a new Axios client with an attached CookieJar.
 * This is CRITICAL because Zomato does 302 redirects that set CSRF cookies!
 */
function createClient(jar) {
  return wrapper(axios.create({ jar }))
}

/**
 * STEP 1 + STEP 2: Initiate OTP
 */
async function initiateOtp(phone, otpMethod, headers) {
  const { verifier, challenge } = generatePKCE()
  const state = generateState()

  // Initialize a fresh CookieJar for this user's session
  const jar = new CookieJar()
  const client = createClient(jar)

  // Seed the manual cookies required by Zomato
  const domain = 'https://accounts.zomato.com'
  jar.setCookieSync(`zxcv=${verifier}; Path=/; Domain=.zomato.com`, domain)
  jar.setCookieSync(`cid=${CLIENT_ID}; Path=/; Domain=.zomato.com`, domain)
  jar.setCookieSync(`rurl=${REDIRECT_URI}; Path=/; Domain=.zomato.com`, domain)

  // Step 1: GET /oauth2/auth → follow redirects, land on login_challenge page
  const authUrl = new URL('https://accounts.zomato.com/oauth2/auth')
  authUrl.searchParams.set('approval_prompt', 'auto')
  authUrl.searchParams.set('scope', 'offline openid')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('code_challenge', challenge)

  let loginChallenge

  try {
    const authResp = await client.get(authUrl.toString(), {
      headers,
      validateStatus: () => true,
    })

    const finalUrl = new URL(authResp.request?.res?.responseUrl || authResp.config.url)
    loginChallenge = finalUrl.searchParams.get('login_challenge')

    if (!loginChallenge) {
      throw new Error(`login_challenge not found in URL: ${finalUrl.toString()}`)
    }
  } catch (err) {
    throw new Error(`Step 1 (oauth2/auth) failed: ${err.message}`)
  }

  // Step 2: POST /login/phone (type=initiate)
  const formData = new URLSearchParams({
    number:            phone,
    country_id:        '1',
    lc:                loginChallenge,
    type:              'initiate',
    verification_type: otpMethod,
    package_name:      'com.application.zomato',
    message_uuid:      '',
  })

  try {
    const otpResp = await client.post('https://accounts.zomato.com/login/phone', formData.toString(), {
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      validateStatus: () => true,
    })

    const body = otpResp.data
    if (!body?.status) {
      throw new Error(body?.message || 'OTP initiation failed')
    }
  } catch (err) {
    throw new Error(`Step 2 (send OTP) failed: ${err.message}`)
  }

  // Stash state for Step 3
  pendingLogins.set(phone, { verifier, loginChallenge, jar, state })
  return true
}

/**
 * STEPS 3–6: Verify OTP and exchange for tokens
 */
async function verifyOtp(phone, otp, headers) {
  const pending = pendingLogins.get(phone)
  if (!pending) throw new Error('No pending login for this number. Please request OTP first.')

  const { verifier, loginChallenge, state, jar } = pending
  const client = createClient(jar)

  // Step 3: POST /login/phone (type=verify)
  const verifyForm = new URLSearchParams({
    number:           phone,
    otp:              otp,
    country_id:       '1',
    lc:               loginChallenge,
    type:             'verify',
    trust_this_device:'true',
    device_token:     '',
  })

  let redirectUrl1
  try {
    // Crucial: we don't follow redirect automatically here because Axios might drop POST bodies
    // But since Zomato redirects with 302 GET, Axios actually handles it.
    // However, to perfectly mirror Kotlin we'll just let the cookiejar handle it internally.
    const verifyResp = await client.post('https://accounts.zomato.com/login/phone', verifyForm.toString(), {
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      maxRedirects: 0,
      validateStatus: () => true, // We want to catch the 302
    })

    const body = verifyResp.data
    if (body?.status === false) throw new Error(body?.message || 'Invalid OTP')
    
    // Sometimes it's a 200 with JSON, sometimes it's a 302
    if (body?.redirect_to) {
      redirectUrl1 = body.redirect_to
    } else if (verifyResp.status === 302 && verifyResp.headers.location) {
      redirectUrl1 = verifyResp.headers.location
    } else {
      throw new Error('No redirect_to found in OTP verify response')
    }
  } catch (err) {
    throw new Error(`Step 3 (verify OTP) failed: ${err.message}`)
  }

  // Step 4: Follow redirect to get consent_challenge
  let consentChallenge
  try {
    const consentPageResp = await client.get(redirectUrl1, {
      headers,
      maxRedirects: 10,
      validateStatus: () => true,
    })

    const finalUrl = new URL(consentPageResp.request?.res?.responseUrl || redirectUrl1)
    consentChallenge = finalUrl.searchParams.get('consent_challenge')
    if (!consentChallenge) throw new Error(`consent_challenge not found in ${finalUrl}\nURL Params: ${finalUrl.search}`)
  } catch (err) {
    throw new Error(`Step 4 (consent page) failed: ${err.message}`)
  }

  // Step 5: POST /consent
  let redirectUrl2
  try {
    const consentForm = new URLSearchParams({ cc: consentChallenge })
    const consentResp = await client.post('https://accounts.zomato.com/consent', consentForm.toString(), {
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      validateStatus: () => true,
    })

    const body = consentResp.data
    if (body?.status === false) throw new Error(body?.message || 'Consent failed')
    
    if (body?.redirect_to) {
      redirectUrl2 = body.redirect_to
    } else if (consentResp.status === 302 && consentResp.headers.location) {
      redirectUrl2 = consentResp.headers.location
    } else {
      throw new Error('No redirect_to in consent response')
    }
  } catch (err) {
    throw new Error(`Step 5 (consent) failed: ${err.message}`)
  }

  // Step 6: Follow final redirect → extract authorization code → exchange for tokens
  let code, scope
  try {
    const finalResp = await client.get(redirectUrl2, {
      headers,
      maxRedirects: 10,
      validateStatus: () => true,
    })

    const finalUrl = new URL(finalResp.request?.res?.responseUrl || redirectUrl2)
    code  = finalUrl.searchParams.get('code')
    scope = finalUrl.searchParams.get('scope')

    if (!code) throw new Error(`Authorization code not found in ${finalUrl}`)
  } catch (err) {
    throw new Error(`Step 5b (final redirect) failed: ${err.message}`)
  }

  // Step 6b: Exchange code for tokens
  const tokenForm = new URLSearchParams({
    grant_type:    'authorization_code',
    code:          code,
    state:         state,
    code_verifier: verifier,
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
  })
  if (scope) tokenForm.set('scope', scope)

  try {
    const tokenResp = await client.post('https://accounts.zomato.com/token', tokenForm.toString(), {
      headers: {
        ...headers,
        'Accept':       'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      validateStatus: () => true,
    })

    const body = tokenResp.data
    if (!body?.status) throw new Error(body?.message || 'Token exchange failed')

    const tokenData = body.token
    pendingLogins.delete(phone)

    return {
      accessToken:  tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
    }
  } catch (err) {
    throw new Error(`Step 6 (token exchange) failed: ${err.message}`)
  }
}

module.exports = { initiateOtp, verifyOtp }

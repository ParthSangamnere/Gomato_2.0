// ============================================================
// zomatoHeaders.js — Exact replica of ApiBase.kt commonHeaders
// All header values are taken verbatim from the Jomato source
// ============================================================
const { randomUUID } = require('crypto')

function makeRandomHex(len) {
  return [...Array(len)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
}

function buildCommonHeaders() {
  const sessionUuid          = randomUUID()
  const appSessionId         = randomUUID()
  const accessUuid           = randomUUID()
  const androidId            = makeRandomHex(16)
  const firebaseInstanceId   = makeRandomHex(32)
  const jumboSessionId       = `${randomUUID()}${Date.now()}`
  const appsflyerUid         = `${Date.now()}-${Math.floor(Math.random() * 9e18 + 1e18)}`

  return {
    'Accept':                              'image/webp',
    'Connection':                          'Keep-Alive',

    // Zomato core
    'X-Zomato-API-Key':                   '7749b19667964b87a3efc739e254ada2',
    'X-Zomato-App-Version':               '931',
    'X-Zomato-App-Version-Code':          '1710019310',
    'X-Zomato-Client-Id':                 '5276d7f1-910b-4243-92ea-d27e758ad02b',
    'X-Zomato-UUID':                      sessionUuid,
    'X-Client-Id':                        'zomato_android_v2',

    // Device fingerprint
    'User-Agent':                         '&source=android_market&version=10&device_manufacturer=Google&device_brand=google&device_model=Android+SDK+built+for+x86_64&api_version=931&app_version=v19.3.1',
    'X-Android-Id':                       androidId,
    'X-Device-Height':                    '2208',
    'X-Device-Width':                     '1080',
    'X-Device-Pixel-Ratio':               '2.75',
    'X-Device-Language':                  'en',

    // App state
    'X-APP-APPEARANCE':                   'LIGHT',
    'X-APP-THEME':                        'default',
    'X-SYSTEM-APPEARANCE':                'UNSPECIFIED',
    'X-App-Language':                     '&lang=en&android_language=en&android_country=',
    'X-App-Session-Id':                   appSessionId,

    // Session & tracking
    'X-Access-UUID':                      accessUuid,
    'X-Request-Id':                       randomUUID(),
    'X-Jumbo-Session-Id':                 jumboSessionId,
    'X-Appsflyer-UID':                    appsflyerUid,
    'X-FIREBASE-INSTANCE-ID':             firebaseInstanceId,
    'X-Installer-Package-Name':           'cm.aptoide.pt',

    // Location defaults
    'X-City-Id':                          '-1',
    'X-O2-City-Id':                       '-1',
    'X-Present-Lat':                      '0.0',
    'X-Present-Long':                     '0.0',
    'X-Present-Horizontal-Accuracy':      '-1',
    'X-User-Defined-Lat':                 '0.0',
    'X-User-Defined-Long':                '0.0',

    // Network & device state
    'X-Network-Type':                     'mobile_UNKNOWN',
    'X-Bluetooth-On':                     'false',
    'X-VPN-Active':                       '1',

    // Accessibility
    'X-Accessibility-Dynamic-Text-Scale-Factor': '1.0',
    'X-Accessibility-Voice-Over-Enabled': '0',

    // Feature flags
    'X-BLINKIT-INSTALLED':                'false',
    'X-DISTRICT-INSTALLED':               'false',
    'X-RIDER-INSTALLED':                  'false',

    // Akamai CDN
    'is-akamai-video-optimisation-enabled': '0',
    'pragma':                             'akamai-x-get-request-id,akamai-x-cache-on, akamai-x-check-cacheable',

    // Priority
    'USER-BUCKET':                        '0',
    'USER-HIGH-PRIORITY':                 '0',
    'x-perf-class':                       'PERFORMANCE_AVERAGE',
  }
}

// Build once per process start (static session IDs)
const COMMON_HEADERS = buildCommonHeaders()

/**
 * Returns headers with optional access token added.
 * @param {string} [accessToken]
 * @returns {object}
 */
function getHeaders(accessToken) {
  const headers = { ...COMMON_HEADERS }
  if (accessToken) {
    headers['X-Zomato-Access-Token'] = accessToken
  }
  return headers
}

module.exports = { getHeaders, COMMON_HEADERS }

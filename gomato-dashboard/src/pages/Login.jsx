import { useState, useEffect, useRef } from 'react'
import './Login.css'

/* ── SVG Icons (inline — no extra deps) ── */
const IconSms = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
)

const IconWhatsapp = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
)

const IconCall = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.99 1.18 2 2 0 013 .01h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/>
  </svg>
)

const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)

/* ── OTP Method Chip Component ── */
function OtpChip({ selected, label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      className={`otp-chip${selected ? ' selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <Icon />
      {label}
    </button>
  )
}

/* ── Resend Timer Component ── */
function ResendTimer({ onResend }) {
  const [seconds, setSeconds] = useState(30)
  const intervalRef = useRef(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) { clearInterval(intervalRef.current); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [])

  const handleResend = () => {
    setSeconds(30)
    intervalRef.current = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) { clearInterval(intervalRef.current); return 0 }
        return s - 1
      })
    }, 1000)
    onResend()
  }

  return (
    <div className="resend-row">
      {seconds > 0 ? (
        <>Resend OTP in <span className="resend-timer">{seconds}s</span></>
      ) : (
        <>Didn't receive it?{' '}
          <button className="resend-btn" onClick={handleResend}>Resend OTP</button>
        </>
      )}
    </div>
  )
}

/* ── Main Login Page ── */
export default function Login({ onLoginSuccess }) {
  const [phase, setPhase] = useState('phone')   // 'phone' | 'otp'
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpMethod, setOtpMethod] = useState('sms')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [animKey, setAnimKey] = useState(0)
  const [initChecking, setInitChecking] = useState(true)

  // Auto-login check on mount
  useEffect(() => {
    async function checkExistingSession() {
      try {
        const res = await fetch('/api/auth/me')
        const data = await res.json()
        if (data.loggedIn) {
          onLoginSuccess?.(data.user)
        }
      } catch (err) {
        console.error("Auto-login check failed", err)
      } finally {
        setInitChecking(false)
      }
    }
    checkExistingSession()
  }, [onLoginSuccess])

  const phoneValid = phone.replace(/\D/g, '').length === 10
  const otpValid = otp.replace(/\D/g, '').length >= 4

  function handlePhoneChange(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
    setPhone(digits)
    setError('')
  }

  function handleOtpChange(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
    setOtp(digits)
    setError('')
  }

  async function handleGetOtp(e) {
    e.preventDefault()
    if (!phoneValid) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, method: otpMethod }),
      })
      const data = await res.json()
      if (data.success) {
        setAnimKey(k => k + 1)
        setPhase('otp')
      } else {
        setError(data.message || 'Failed to send OTP. Please try again.')
      }
    } catch {
      setError('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault()
    if (!otpValid) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      })
      const data = await res.json()
      if (data.success) {
        onLoginSuccess?.(data.user)
      } else {
        setError(data.message || 'Invalid OTP. Please try again.')
      }
    } catch {
      setError('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResendOtp() {
    try {
      await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, method: otpMethod }),
      })
    } catch { /* silent */ }
  }

  if (initChecking) {
    return (
      <div className="login-root">
        <div className="loading-overlay" role="status" style={{ background: 'var(--bg-main)' }}>
          <span className="spinner" />
        </div>
      </div>
    )
  }

  return (
    <div className="login-root">
      {/* Top logo bar */}
      <header className="login-topbar">
        <div className="login-logo-icon" aria-hidden="true">🍱</div>
        <span className="login-logo-text">Gomato</span>
      </header>

      <main className="login-card-wrapper">
        {/* Animated heading */}
        <div className="login-heading" key={`heading-${phase}`}>
          {phase === 'phone' ? (
            <>
              <h1>Log in to Zomato</h1>
              <p className="subtitle">Monitor Food Rescue deals in your area</p>
            </>
          ) : (
            <>
              <h1 className="otp-title">Verification</h1>
              <div className="otp-subtitle-row">
                <span>Enter the OTP sent to</span>
                <span className="phone-highlight">+91 {phone}</span>
                <button
                  className="otp-edit-btn"
                  onClick={() => { setPhase('phone'); setOtp(''); setError('') }}
                  aria-label="Edit phone number"
                >
                  <IconEdit /> Edit
                </button>
              </div>
            </>
          )}
        </div>

        {/* Animated form area */}
        <div key={`form-${animKey}`} className="slide-enter">
          {phase === 'phone' ? (
            <form onSubmit={handleGetOtp} noValidate>
              {/* Phone number input */}
              <div className="field-group">
                <label className="field-label" htmlFor="phone-input">Mobile Number</label>
                <div className="input-wrapper">
                  <div className="input-prefix">
                    <span className="flag" aria-hidden="true">🇮🇳</span>
                    <span className="country-code">+91</span>
                    <div className="input-prefix-divider" aria-hidden="true" />
                  </div>
                  <input
                    id="phone-input"
                    className="input-field"
                    type="tel"
                    inputMode="numeric"
                    placeholder="Phone Number"
                    value={phone}
                    onChange={handlePhoneChange}
                    autoFocus
                    autoComplete="tel-national"
                    aria-label="10-digit mobile number"
                  />
                </div>
              </div>

              {/* OTP method selector */}
              <div className="field-group">
                <p className="otp-method-label">Receive OTP via</p>
                <div className="otp-method-chips" role="group" aria-label="OTP delivery method">
                  <OtpChip selected={otpMethod === 'sms'} label="SMS" icon={IconSms} onClick={() => setOtpMethod('sms')} />
                  <OtpChip selected={otpMethod === 'whatsapp'} label="WhatsApp" icon={IconWhatsapp} onClick={() => setOtpMethod('whatsapp')} />
                  <OtpChip selected={otpMethod === 'call'} label="Call" icon={IconCall} onClick={() => setOtpMethod('call')} />
                </div>
              </div>

              {error && (
                <div className="error-toast" role="alert">
                  <span>⚠️</span> {error}
                </div>
              )}

              <button
                id="get-otp-btn"
                type="submit"
                className="btn-primary"
                disabled={!phoneValid || loading}
              >
                {loading ? <><span className="spinner" />Sending OTP…</> : 'Get OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} noValidate>
              {/* OTP input */}
              <div className="field-group">
                <label className="field-label" htmlFor="otp-input">One-Time Password</label>
                <div className="input-wrapper">
                  <input
                    id="otp-input"
                    className="input-field"
                    type="tel"
                    inputMode="numeric"
                    placeholder="Enter 6-digit OTP"
                    value={otp}
                    onChange={handleOtpChange}
                    autoFocus
                    autoComplete="one-time-code"
                    aria-label="6-digit OTP"
                    style={{ paddingLeft: '16px' }}
                  />
                  {loading && (
                    <div className="input-trailing">
                      <span className="spinner sm" aria-hidden="true" />
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="error-toast" role="alert">
                  <span>⚠️</span> {error}
                </div>
              )}

              <button
                id="verify-otp-btn"
                type="submit"
                className="btn-primary"
                disabled={!otpValid || loading}
              >
                {loading ? <><span className="spinner" />Verifying…</> : 'Access Account'}
              </button>

              <ResendTimer onResend={handleResendOtp} />
            </form>
          )}
        </div>
      </main>

      {/* Disclaimer — matching Jomato's "unofficial client" note */}
      <footer>
        <p className="login-disclaimer">
          This is an unofficial client. Not affiliated with or endorsed by Zomato / Eternal Ltd.
        </p>
      </footer>

      {/* Full-screen loading overlay */}
      {loading && (
        <div className="loading-overlay" role="status" aria-label="Loading">
          <span className="spinner" />
        </div>
      )}
    </div>
  )
}

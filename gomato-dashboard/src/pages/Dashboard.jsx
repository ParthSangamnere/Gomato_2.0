import { useState, useEffect } from 'react'
import './Dashboard.css'

export default function Dashboard({ user: initialUser, onLogout }) {
  const [user, setUser] = useState(initialUser)
  const [rescues, setRescues] = useState([])
  const [stats, setStats] = useState({ totalRescues: 0, totalRescueValue: 0, avgDiscount: 0 })
  const [loading, setLoading] = useState(true)

  // Fetch data initially and poll every 30s
  useEffect(() => {
    fetchData()
    fetchUserData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchUserData() {
    try {
      const res = await fetch('/api/auth/me')
      const data = await res.json()
      if (data.loggedIn) {
        setUser(data.user)
      }
    } catch (err) {
      console.error("Failed to fetch user data", err)
    }
  }

  async function fetchData() {
    try {
      const [rescuesRes, statsRes] = await Promise.all([
        fetch('/api/rescues'),
        fetch('/api/stats')
      ])
      const rescuesData = await rescuesRes.json()
      const statsData = await statsRes.json()
      
      if (rescuesData.success) setRescues(rescuesData.rescues)
      if (statsData.success) setStats(statsData.stats)
    } catch (e) {
      console.error("Failed to fetch dashboard data:", e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dashboard-root">
      {/* ── Header ── */}
      <header className="dash-header">
        <div className="header-top">
          <div className="logo-area">
            <span className="logo-icon">🍱</span>
            <span className="logo-text">Gomato</span>
          </div>
          <div className="user-area">
            <div className="location-info">
              <div className="loc-title-row">
                <span className="loc-icon">📍</span>
                <div className="select-wrapper">
                  <select 
                    className="location-select-bold"
                    value={user?.activeAddressId || ''}
                    onChange={async (e) => {
                      const addressId = e.target.value;
                      try {
                        await fetch('/api/auth/location', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ addressId })
                        });
                        window.location.reload(); 
                      } catch (err) {
                        console.error("Failed to switch location", err);
                      }
                    }}
                  >
                    {user?.locations && user.locations.length > 0 ? (
                      user.locations.map(loc => (
                        <option key={loc.addressId} value={loc.addressId}>
                          {loc.name}
                        </option>
                      ))
                    ) : (
                      <option value={user?.activeAddressId}>
                        {user?.location || 'Home'}
                      </option>
                    )}
                  </select>
                  <span className="chevron-down">⌄</span>
                </div>
              </div>
              <div className="loc-subtitle" title={user?.fullAddress}>
                {user?.fullAddress || 'Fetching address...'}
              </div>
            </div>
            
            <div className="profile-circle" onClick={onLogout} title="Click to logout">
              {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
          </div>
        </div>
      </header>

      {/* ── Stats Row ── */}
      <section className="stats-container">
        <div className="stat-card brand">
          <span className="stat-value">{stats?.totalRescues || 0}</span>
          <span className="stat-label">Total Rescues</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">₹{stats?.totalRescueValue || 0}</span>
          <span className="stat-label">Value Tracked</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats?.avgDiscount || 0}%</span>
          <span className="stat-label">Avg. Discount</span>
        </div>
      </section>

      {/* ── Rescues List ── */}
      <main className="rescues-main">
        <h2 className="section-title">Recent Missed Rescues</h2>
        
        {loading ? (
          <div className="loading-state">
            <span className="spinner brand-spinner"></span>
            <p>Syncing with Zomato Hedwig...</p>
          </div>
        ) : rescues.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🍽️</div>
            <h3>No rescues yet!</h3>
            <p>We are actively monitoring the MQTT stream. When an order is canceled near you, it will appear here instantly.</p>
          </div>
        ) : (
          <div className="rescues-grid">
            {rescues.map(rescue => (
              <RescueCard key={rescue._id} rescue={rescue} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function RescueCard({ rescue }) {
  const isExpired = rescue.expiresAt && new Date(rescue.expiresAt) < new Date()
  const timeFormatted = new Date(rescue.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  
  return (
    <div className={`rescue-card ${isExpired ? 'expired' : ''}`}>
      <div className="rc-header">
        <div className="rc-time">{timeFormatted}</div>
        {rescue.viewersCount > 0 && (
          <div className="rc-viewers">🔥 {rescue.viewersCount} people viewing</div>
        )}
      </div>

      <div className="rc-body">
        <h3 className="rc-restaurant">{rescue.restaurantName}</h3>
        <p className="rc-items">
          {rescue.items?.length > 0 
            ? rescue.items.map(i => `${i.quantity}x ${i.name}`).join(', ')
            : 'Hidden Items (SDUI masked)'}
        </p>

        <div className="rc-pricing">
          {rescue.originalPrice && (
            <span className="price-strikethrough">₹{rescue.originalPrice}</span>
          )}
          <span className="price-rescue">₹{rescue.rescuePrice}</span>
          {rescue.discountPercent && (
            <span className="discount-tag">{rescue.discountPercent}% OFF</span>
          )}
        </div>
      </div>

      <div className="rc-footer">
        {rescue.wasClaimed ? (
          <span className="status claimed">Claimed by someone else</span>
        ) : isExpired ? (
          <span className="status expired">Offer Expired</span>
        ) : (
          <span className="status active">⚡ Available Now</span>
        )}
      </div>
    </div>
  )
}

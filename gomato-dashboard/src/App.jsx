import { useState } from 'react'
import Login from './pages/Login.jsx'
import './index.css'

import Dashboard from './pages/Dashboard.jsx'

export default function App() {
  const [user, setUser] = useState(null)

  function handleLoginSuccess(userData) {
    setUser(userData)
  }

  function handleLogout() {
    setUser(null)
  }

  if (user) {
    return <Dashboard user={user} onLogout={handleLogout} />
  }

  return <Login onLoginSuccess={handleLoginSuccess} />
}

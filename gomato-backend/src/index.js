// ============================================================
// index.js — Express server entry point
// ============================================================
require('dotenv').config()
const express   = require('express')
const cors      = require('cors')
const mongoose  = require('mongoose')
const path      = require('path')
const apiRouter = require('./routes/api')
const { startMqttService } = require('./mqttService')

const app  = express()
const PORT = process.env.PORT || 3001

// ── Middleware ──
app.use(cors({ origin: '*' }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ── API Routes ──
app.use('/api', apiRouter)

// ── Serve frontend build (for production on Render) ──
const frontendDist = path.join(__dirname, '../../gomato-dashboard/dist')
app.use(express.static(frontendDist))
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'))
})

// ── MongoDB Connection & Server Start ──
async function main() {
  const mongoUri = process.env.MONGODB_URI

  if (!mongoUri) {
    console.warn('[Startup] MONGODB_URI not set — running without database (dev mode)')
    console.warn('[Startup] Rescue logging and session persistence will not work.')
    app.listen(PORT, () => console.log(`[Server] Listening on http://localhost:${PORT}`))
    return
  }

  try {
    await mongoose.connect(mongoUri)
    console.log('[MongoDB] Connected successfully')

    // Auto-start MQTT service (multi-tenant)
    startMqttService()
    console.log('[Startup] MQTT service initialized.')

    app.listen(PORT, () => console.log(`[Server] Listening on http://localhost:${PORT}`))

  } catch (err) {
    console.error('[MongoDB] Connection failed:', err.message)
    process.exit(1)
  }
}

main()

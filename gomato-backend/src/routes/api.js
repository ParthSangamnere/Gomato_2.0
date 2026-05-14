// ============================================================
// routes/api.js — All REST routes for the Gomato backend
// ============================================================
const express = require('express')
const router  = express.Router()
const { getHeaders } = require('../zomatoHeaders')
const { initiateOtp, verifyOtp } = require('../authService')
const { getUserInfo, getUserLocations, getTabbedHomeEssentials } = require('../zomatoApi')
const Session = require('../models/Session')
const Rescue  = require('../models/Rescue')
const { startMqttService, getMqttStatus } = require('../mqttService')

// ── Health / UptimeRobot ping ─────────────────────────────────
router.get('/ping', (req, res) => res.send('OK'))

// ── Auth: Step 1 — Send OTP ───────────────────────────────────
router.post('/auth/send-otp', async (req, res) => {
  const { phone, method = 'sms' } = req.body
  if (!phone || !/^\d{10}$/.test(phone.trim())) {
    return res.status(400).json({ success: false, message: 'Invalid phone number. Must be 10 digits.' })
  }
  try {
    await initiateOtp(phone.trim(), method, getHeaders())
    res.json({ success: true, message: 'OTP sent!' })
  } catch (err) {
    console.error('[/auth/send-otp]', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── Auth: Step 2 — Verify OTP & save session ─────────────────
router.post('/auth/verify-otp', async (req, res) => {
  const { phone, otp } = req.body
  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: 'Phone and OTP are required.' })
  }
  try {
    const { accessToken, refreshToken } = await verifyOtp(phone.trim(), otp.trim(), getHeaders())

    // Fetch user profile
    const userInfo = await getUserInfo(accessToken)
    if (!userInfo) throw new Error('Failed to fetch user profile after login')

    // Fetch saved addresses to pre-populate location
    const locations = await getUserLocations(accessToken)
    const firstLoc  = locations[0] ?? null

    // Fetch MQTT credentials for the first address
    let mqttData = {}
    let cityId   = 0
    if (firstLoc?.cellId && firstLoc?.addressId) {
      try {
        const essentials = await getTabbedHomeEssentials(accessToken, firstLoc.cellId, firstLoc.addressId)
        cityId  = essentials.cityId
        if (essentials.foodRescue) {
          mqttData = {
            mqttChannel:    essentials.foodRescue.channelName,
            mqttUsername:   essentials.foodRescue.username,
            mqttPassword:   essentials.foodRescue.password,
            mqttQos:        essentials.foodRescue.qos,
            mqttValidUntil: essentials.foodRescue.validUntil,
          }
        }
      } catch (e) {
        console.warn('[/auth/verify-otp] Failed to fetch tabbed-home:', e.message)
      }
    }

    // Upsert session in DB
    const session = await Session.findOneAndUpdate(
      { phone: phone.trim() },
      {
        $set: {
          phone:        phone.trim(),
          userName:     userInfo.name ?? 'Unknown',
          userId:       String(userInfo.id ?? ''),
          accessToken,
          refreshToken,
          cityId,
          location:     firstLoc ? {
            addressId:   firstLoc.addressId,
            cellId:      firstLoc.cellId,
            lat:         firstLoc.lat,
            lng:         firstLoc.lng,
            entityId:    firstLoc.entityId,
            placeId:     firstLoc.placeId,
            cityId,
            name:        firstLoc.name,
            fullAddress: firstLoc.fullAddress,
          } : undefined,
          locations:    locations,
          ...mqttData,
        }
      },
      { upsert: true, new: true }
    )

    // Kick-start the MQTT monitor
    startMqttService()

    res.json({
      success: true,
      user: {
        name:     userInfo.name,
        id:       userInfo.id,
        phone:    userInfo.mobile ?? phone,
        location: firstLoc?.name ?? 'Unknown',
        fullAddress: firstLoc?.fullAddress ?? '',
        locations: locations,
        activeAddressId: firstLoc?.addressId
      }
    })

  } catch (err) {
    console.error('[/auth/verify-otp]', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── Session: Change active location ───────────────────────────
router.post('/auth/location', async (req, res) => {
  const { addressId } = req.body
  const session = await Session.findOne({}).sort({ updatedAt: -1 })
  if (!session) return res.status(401).json({ success: false })

  const newLoc = session.locations?.find(l => l.addressId == addressId)
  if (!newLoc) return res.status(400).json({ success: false, message: 'Address not found' })

  try {
    const essentials = await getTabbedHomeEssentials(session.accessToken, newLoc.cellId, newLoc.addressId)
    const mqttData = essentials.foodRescue ? {
      mqttChannel:    essentials.foodRescue.channelName,
      mqttUsername:   essentials.foodRescue.username,
      mqttPassword:   essentials.foodRescue.password,
      mqttQos:        essentials.foodRescue.qos,
      mqttValidUntil: essentials.foodRescue.validUntil,
    } : {}

    await Session.findByIdAndUpdate(session._id, {
      $set: { location: newLoc, cityId: essentials.cityId, ...mqttData }
    })
    
    // Restart MQTT monitor
    const { stopMqttService } = require('../mqttService')
    stopMqttService()
    setTimeout(startMqttService, 1000)

    res.json({ success: true, location: newLoc.name })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── Session: Get current logged-in user ───────────────────────
router.get('/auth/me', async (req, res) => {
  const session = await Session.findOne({}).sort({ updatedAt: -1 }).lean()
  if (!session) return res.json({ loggedIn: false })
  res.json({
    loggedIn: true,
    user: {
      name:     session.userName,
      phone:    session.phone,
      location: session.location?.name ?? 'Unknown',
      fullAddress: session.location?.fullAddress ?? '',
      locations: session.locations || [],
      activeAddressId: session.location?.addressId
    }
  })
})

// ── Rescues: Get all logged rescues ───────────────────────────
router.get('/rescues', async (req, res) => {
  try {
    const session = await Session.findOne({}).sort({ updatedAt: -1 }).lean()
    if (!session) return res.json({ success: true, rescues: [], total: 0 })

    const page  = Math.max(1, parseInt(req.query.page  ?? '1', 10))
    const limit = Math.min(50, parseInt(req.query.limit ?? '20', 10))
    const skip  = (page - 1) * limit

    const [rescues, total] = await Promise.all([
      Rescue.find({ phone: session.phone })
        .sort({ receivedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Rescue.countDocuments({ phone: session.phone }),
    ])

    res.json({ success: true, rescues, total, page, limit })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── Stats: Aggregate stats for dashboard header ───────────────
router.get('/stats', async (req, res) => {
  try {
    const session = await Session.findOne({}).sort({ updatedAt: -1 }).lean()
    if (!session) return res.json({ success: true, stats: { totalRescues: 0, totalSavings: 0, avgDiscount: 0, claimedCount: 0, totalRescueValue: 0 } })
    const [agg] = await Rescue.aggregate([
      { $match: { phone: session.phone } },
      {
        $group: {
          _id:               null,
          totalRescues:      { $sum: 1 },
          totalSavings:      { $sum: { $ifNull: ['$savingsAmount', 0] } },
          avgDiscount:       { $avg: { $ifNull: ['$discountPercent', 0] } },
          claimedCount:      { $sum: { $cond: ['$wasClaimed', 1, 0] } },
          totalRescueValue:  { $sum: { $ifNull: ['$rescuePrice', 0] } },
        }
      }
    ])

    res.json({
      success: true,
      stats: agg ? {
        totalRescues:     agg.totalRescues,
        totalSavings:     Math.round(agg.totalSavings),
        avgDiscount:      Math.round(agg.avgDiscount),
        claimedCount:     agg.claimedCount,
        totalRescueValue: Math.round(agg.totalRescueValue),
      } : {
        totalRescues: 0, totalSavings: 0, avgDiscount: 0,
        claimedCount: 0, totalRescueValue: 0,
      }
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── MQTT: Status ─────────────────────────────────────────────
router.get('/mqtt/status', (req, res) => {
  res.json({ success: true, ...getMqttStatus() })
})

module.exports = router

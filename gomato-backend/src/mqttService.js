// ============================================================
// mqttService.js — Port of RescueService.kt to Node.js
// Connects to ssl://hedwig.zomato.com:443 via MQTT over TLS
// Handles: order_cancelled, order_claimed events
// Implements: staleness check, dedup, cooldown, reconnect loop
// ============================================================
const mqtt   = require('mqtt')
const Session = require('./models/Session')
const Rescue  = require('./models/Rescue')
const { getTabbedHomeEssentials, getFoodRescueCart, getRestaurantMeta } = require('./zomatoApi')

// ── Constants (mirrored from RescueService.kt) ──
const MESSAGE_STALE_MS      = 120_000    // 2 minutes
const RECONNECT_INTERVAL_MS = 20 * 60 * 1000  // 20 minutes
const HEARTBEAT_INTERVAL_MS = 30_000     // 30 seconds

// ── Module state ──
const clients         = new Map()    // Map<phone, { mqttClient, lastConnectedAt }>
let isRunning         = false
let reliabilityTimer  = null
const processedMsgIds = new Set()    // In-memory dedup (global for now)

// ── Helpers ──
function log(tag, msg) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [${tag}] ${msg}`)
}

// ── MQTT Connection ──
async function connectMqtt(phone, session) {
  const { mqttChannel, mqttUsername, mqttPassword, mqttQos } = session
  
  // Cleanly disconnect previous client for THIS phone
  if (clients.has(phone)) {
    try { clients.get(phone).mqttClient.end(true) } catch { /* ignore */ }
    clients.delete(phone)
  }

  const clientId = `user${Date.now()}_${phone.slice(-4)}`
  log('MQTT', `[${phone}] Connecting as ${clientId} to ${mqttChannel}`)

  const client = mqtt.connect('mqtts://hedwig.zomato.com:443', {
    clientId,
    username: mqttUsername,
    password: mqttPassword,
    clean:             true,
    keepalive:         30,
    reconnectPeriod:   0,
    connectTimeout:    30_000,
    rejectUnauthorized: true,
  })

  const clientState = { mqttClient: client, lastConnectedAt: 0 }
  clients.set(phone, clientState)

  client.on('connect', () => {
    clientState.lastConnectedAt = Date.now()
    log('MQTT', `[${phone}] Connected! Subscribing to: ${mqttChannel}`)
    client.subscribe(mqttChannel, { qos: mqttQos ?? 0 }, (err) => {
      if (err) log('MQTT', `[${phone}] Subscribe error: ${err.message}`)
      else log('MQTT', `[${phone}] Subscribed successfully!`)
    })
  })

  client.on('message', (topic, payload) => {
    handleMqttMessage(phone, payload.toString()).catch(err =>
      log('Logic', `[${phone}] Error handling message: ${err.message}`)
    )
  })

  client.on('error', (err) => {
    log('MQTT', `[${phone}] Error: ${err.message}`)
  })

  client.on('close', () => {
    log('MQTT', `[${phone}] Connection closed`)
  })
}

// ── Message Handler ──
async function handleMqttMessage(phone, payloadStr) {
  let root
  try {
    root = JSON.parse(payloadStr)
  } catch {
    log('Logic', `[${phone}] Failed to parse MQTT payload`)
    return
  }

  const eventType = root?.data?.event_type
  const msgId     = root?.id
  const timestamp = root?.timestamp

  if (eventType === 'order_cancelled' && timestamp != null) {
    const now         = Date.now()
    const eventTimeMs = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
    if (now - eventTimeMs > MESSAGE_STALE_MS) return
  }

  if (msgId) {
    if (processedMsgIds.has(msgId)) return
    processedMsgIds.add(msgId)
    if (processedMsgIds.size > 1000) {
      const first = processedMsgIds.values().next().value
      processedMsgIds.delete(first)
    }
  }

  if (eventType === 'order_cancelled') {
    await handleOrderCancelled(phone, msgId)
  } else if (eventType === 'order_claimed') {
    await handleOrderClaimed(phone, root)
  }
}

// ── order_cancelled handler ──
async function handleOrderCancelled(phone, msgId) {
  log('Logic', `[${phone}] >>> NEW FRESH ORDER CANCELLED (${msgId}) <<<`)

  const session = await Session.findOne({ phone }).lean()
  if (!session) return

  try {
    const cartInfo = await getFoodRescueCart(
      session.accessToken,
      session.location,
      session.cityId || session.location?.cityId
    )

    if (!cartInfo) {
      log('Logic', `[${phone}] Cart already claimed or expired`)
      return
    }

    let restaurantName = 'Unknown Restaurant'
    let restaurantLat  = null
    let restaurantLng  = null

    if (cartInfo.resId) {
      const meta = await getRestaurantMeta(session.accessToken, cartInfo.resId)
      if (meta) {
        restaurantName = meta.name
        restaurantLat  = meta.lat
        restaurantLng  = meta.lng
      }
    }

    const originalPrice   = cartInfo.catalogTotalCost ?? null
    const rescuePrice     = cartInfo.cartFinalCost
    const savingsAmount   = originalPrice != null ? originalPrice - rescuePrice : null
    const discountPercent = (originalPrice && originalPrice > 0)
      ? Math.round((savingsAmount / originalPrice) * 100)
      : null

    await Rescue.findOneAndUpdate(
      { msgId: msgId || `unknown-${Date.now()}` },
      {
        $setOnInsert: {
          msgId:          msgId || `unknown-${Date.now()}`,
          phone:          phone, // Link rescue to the user who discovered it
          receivedAt:     new Date(),
          rescuePrice,
          originalPrice,
          savingsAmount,
          discountPercent,
          viewersCount:   cartInfo.viewersCount,
          expiresAt:      cartInfo.cartExpiryTimestamp ? new Date(cartInfo.cartExpiryTimestamp * 1000) : null,
          resId:          cartInfo.resId,
          restaurantName,
          restaurantLat,
          restaurantLng,
          rawCartData:    cartInfo,
        }
      },
      { upsert: true }
    )

    log('DB', `[${phone}] Rescue logged: ${restaurantName} — ₹${rescuePrice}`)

  } catch (err) {
    log('Logic', `[${phone}] handleOrderCancelled error: ${err.message}`)
  }
}

// ── order_claimed handler ──
async function handleOrderClaimed(phone, root) {
  const identifier = root?.data?.success_actions?.[0]
    ?.food_rescue_order_claimed?.identifier

  if (!identifier) return

  await Rescue.findOneAndUpdate(
    { resId: identifier },
    { $set: { wasClaimed: true, claimedAt: new Date() } }
  )
  log('DB', `[${phone}] Marked rescue ${identifier} as CLAIMED`)
}

// ── Credentials Refresh ──
async function refreshMqttCredentials(session) {
  if (!session?.location?.cellId) return null
  const phone = session.phone

  log('MQTT', `[${phone}] Refreshing credentials...`)
  try {
    const essentials = await getTabbedHomeEssentials(
      session.accessToken,
      session.location.cellId,
      session.location.addressId
    )

    if (!essentials.foodRescue) return null

    const updated = await Session.findByIdAndUpdate(session._id, {
      $set: {
        mqttChannel:   essentials.foodRescue.channelName,
        mqttUsername:  essentials.foodRescue.username,
        mqttPassword:  essentials.foodRescue.password,
        mqttQos:       essentials.foodRescue.qos,
        mqttValidUntil: essentials.foodRescue.validUntil,
        cityId:        essentials.cityId,
      }
    }, { new: true }).lean()

    return updated
  } catch (err) {
    log('MQTT', `[${phone}] Refresh failed: ${err.message}`)
    return null
  }
}

// ── Reliability Loop ──
async function reliabilityLoop() {
  const sessions = await Session.find({}).lean()
  const now = Date.now()

  for (const session of sessions) {
    const phone = session.phone
    const state = clients.get(phone)
    
    const isConnected = state?.mqttClient?.connected ?? false
    const shouldReconnect = !isConnected || (state?.lastConnectedAt > 0 && (now - state.lastConnectedAt) >= RECONNECT_INTERVAL_MS)

    if (shouldReconnect) {
      const credValid = session.mqttValidUntil && (session.mqttValidUntil * 1000 > now)
      
      let targetSession = session
      if (!session.mqttChannel || !credValid) {
        const refreshed = await refreshMqttCredentials(session)
        if (!refreshed) {
          log('Service', `[${phone}] Skipping — could not get credentials`)
          continue
        }
        targetSession = refreshed
      }

      await connectMqtt(phone, targetSession)
    }
  }

  // Cleanup clients for sessions that no longer exist
  const sessionPhones = new Set(sessions.map(s => s.phone))
  for (const phone of clients.keys()) {
    if (!sessionPhones.has(phone)) {
      log('Service', `[${phone}] Session removed. Stopping monitor.`)
      try { clients.get(phone).mqttClient.end(true) } catch {}
      clients.delete(phone)
    }
  }
}

// ── Public API ──
function startMqttService() {
  if (isRunning) return
  isRunning = true
  log('Service', 'Starting multi-tenant MQTT service...')
  reliabilityLoop()
  reliabilityTimer = setInterval(reliabilityLoop, HEARTBEAT_INTERVAL_MS)
}

function stopMqttService() {
  isRunning = false
  if (reliabilityTimer) { clearInterval(reliabilityTimer); reliabilityTimer = null }
  for (const state of clients.values()) {
    try { state.mqttClient.end(true) } catch {}
  }
  clients.clear()
  log('Service', 'MQTT service stopped')
}

function getMqttStatus() {
  return {
    activeConnections: clients.size,
    isRunning,
  }
}

module.exports = { startMqttService, stopMqttService, getMqttStatus }

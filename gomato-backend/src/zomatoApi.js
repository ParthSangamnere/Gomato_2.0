// ============================================================
// zomatoApi.js — Port of all Jomato API calls to Node.js
// Sources: FoodRescueCartApi.kt, RestaurantMetaApi.kt,
//          TabbedHomeApi.kt, UserInfoApi.kt, OrderSummaryApi.kt
// ============================================================
const axios = require('axios')
const { getHeaders } = require('./zomatoHeaders')

const BASE = 'https://api.zomato.com'

/**
 * GET /gw/tabbed-home
 * Returns city_id + MQTT FoodRescue channel config
 * Source: TabbedHomeApi.kt
 */
async function getTabbedHomeEssentials(accessToken, cellId, addressId) {
  const url = `${BASE}/gw/tabbed-home?cell_id=${cellId}&address_id=${addressId}`
  const res = await axios.get(url, {
    headers: getHeaders(accessToken),
    validateStatus: () => true,
  })

  if (!res.data) throw new Error('Empty response from tabbed-home')

  const root = res.data
  const cityId = root?.location?.city?.id ?? 0

  // Find the food_rescue channel in subscription_channels
  const channels = root?.subscription_channels ?? []
  let foodRescue = null

  for (const ch of channels) {
    if (ch.type !== 'food_rescue') continue
    const channelName = Array.isArray(ch.name) ? ch.name[0] : ch.name
    foodRescue = {
      channelName,
      qos:        ch.qos ?? 0,
      validUntil: ch.time ?? 0,
      username:   ch.client?.username ?? '',
      password:   ch.client?.password ?? '',
      keepalive:  ch.client?.keepalive ?? 30,
    }
    break
  }

  return { cityId, foodRescue }
}

/**
 * POST /gw/gamification/food-rescue/create-cart
 * Returns cart details: price, original price, viewers, expiry, resId
 * Source: FoodRescueCartApi.kt
 */
async function getFoodRescueCart(accessToken, location, cityId) {
  const url = `${BASE}/gw/gamification/food-rescue/create-cart`

  const payload = {
    identifier: [],
    location: {
      entity_type:     location.entityType || 'subzone',
      lng:             location.lng,
      place_type:      location.entityId ? 'DSZ' : 'PLACE',
      address_id:      String(location.addressId),
      entity_id:       location.entityId ? String(location.entityId) : null,
      cell_id:         location.cellId,
      place_id:        location.placeId,
      lat:             location.lat,
      current_city_id: String(cityId),
      city_id:         String(cityId),
    },
  }

  const headers = {
    ...getHeaders(accessToken),
    'Content-Type':        'application/json; charset=UTF-8',
    'X-City-Id':           String(cityId),
    'X-O2-City-Id':        String(cityId),
    'X-User-Defined-Lat':  String(location.lat ?? '0.0'),
    'X-User-Defined-Long': String(location.lng ?? '0.0'),
  }

  const res = await axios.post(url, payload, {
    headers,
    validateStatus: () => true,
  })

  if (!res.data) return null

  try {
    return parseCartResponse(res.data)
  } catch (err) {
    console.error('[zomatoApi] parseCartResponse error:', err.message)
    return null
  }
}

/**
 * Parses the deeply nested SDUI (Server-Driven UI) cart response.
 * Mirrors the hand-crafted JSON traversal in FoodRescueCartApi.kt parseCartResponse()
 */
function parseCartResponse(json) {
  const responseObj     = json?.response
  const floatingTimer   = responseObj?.floating_timer_view_1
  const clickAction     = floatingTimer?.click_action
  const openBottomSheet = clickAction?.open_food_rescue_bottom_sheet
  const results         = openBottomSheet?.results ?? []
  const firstResult     = results[0]
  const timerSnippet    = firstResult?.timer_snippet_type_4
  const button          = timerSnippet?.button
  const buttonClick     = button?.click_action
  const deeplink        = buttonClick?.deeplink
  const deeplinkUrl     = deeplink?.url ?? ''
  const postBodyStr     = deeplink?.post_body ?? '{}'

  // Extract res_id from deeplink URL query param
  let resId = null
  try {
    const urlObj = new URL(deeplinkUrl)
    resId = urlObj.searchParams.get('res_id')
  } catch { /* ignore */ }

  // Extract cart_id, ParentOrderID, etc.
  let cartId, parentOrderId, parentCartId, cartModificationType
  let viewersCount = 0
  let cartExpiryTimestamp = 0
  let cartFinalCost = 0
  let catalogTotalCost = null

  try {
    const postBody        = JSON.parse(postBodyStr)
    cartId                = postBody?.cart_id
    const ctx             = postBody?.context
    const cartMod         = ctx?.cart_modification
    parentOrderId         = cartMod?.ParentOrderID
    parentCartId          = cartMod?.ParentCartID
    cartModificationType  = cartMod?.CartModificationType
    const cartAnalytics   = ctx?.cart_analytics_data
    viewersCount          = parseInt(cartAnalytics?.number_of_people_watching ?? '0', 10)
    cartExpiryTimestamp   = parseInt(cartAnalytics?.cart_expiry_timestamp ?? '0', 10)
  } catch { /* ignore */ }

  // Extract prices from tracking_data
  try {
    const timerContainer    = timerSnippet?.timer_container_data
    const timerComplete     = timerContainer?.timer_complete_action
    const showPopup         = timerComplete?.show_snippet_popup
    const snippets          = showPopup?.snippets ?? []
    const firstSnippet      = snippets[0]
    const imageText         = firstSnippet?.image_text_snippet_type_43
    const items             = imageText?.items ?? []
    const item              = items[0]
    const trackingData      = item?.tracking_data ?? []
    const trackingObj       = trackingData[0]
    const payloadStr        = trackingObj?.payload ?? '{}'
    const trackingPayload   = JSON.parse(payloadStr)
    const value             = trackingPayload?.value
    cartFinalCost           = value?.cart_final_cost ?? 0
    catalogTotalCost        = value?.catalog_total_cost ?? null
  } catch { /* ignore */ }

  return {
    resId,
    cartFinalCost,
    catalogTotalCost,
    viewersCount,
    cartExpiryTimestamp,
    cartId,
    parentOrderId,
    parentCartId,
    cartModificationType,
  }
}

/**
 * POST /gw/menu/res_info/:resId
 * Returns restaurant name and coordinates
 * Source: RestaurantMetaApi.kt
 */
async function getRestaurantMeta(accessToken, resId) {
  const url = `${BASE}/gw/menu/res_info/${resId}`
  const res = await axios.post(url, { should_fetch_res_info_from_agg: true }, {
    headers: {
      ...getHeaders(accessToken),
      'Content-Type': 'application/json; charset=utf-8',
    },
    validateStatus: () => true,
  })

  if (!res.data) return null

  try {
    return parseRestaurantMeta(res.data)
  } catch (err) {
    console.error('[zomatoApi] parseRestaurantMeta error:', err.message)
    return null
  }
}

function parseRestaurantMeta(json) {
  const results = json?.results ?? []
  let name = 'Unknown Restaurant'
  let lat = null, lng = null

  for (const result of results) {
    const snippet = result?.v4_image_text_snippet_type_3
    const items   = snippet?.items ?? []

    if (name === 'Unknown Restaurant' && items.length > 0) {
      const title = items[0]?.title?.text
      if (title) name = title
    }

    for (const item of items) {
      const containers = item?.icon_text_containers ?? []
      for (const container of containers) {
        const ca = container?.click_action
        if (ca?.type === 'open_map') {
          lat = ca?.open_map?.latitude ?? null
          lng = ca?.open_map?.longitude ?? null
          if (lat && lng) break
        }
      }
      if (lat && lng) break
    }
    if (lat && lng) break
  }

  return { name, lat, lng }
}

/**
 * GET /gw/user/info
 * Returns user profile (name, id, mobile)
 * Source: UserInfoApi.kt
 */
async function getUserInfo(accessToken) {
  const res = await axios.get(`${BASE}/gw/user/info`, {
    headers: getHeaders(accessToken),
    validateStatus: () => true,
  })
  if (!res.data) return null
  // Response is typically: { id, name, mobile, email, theme }
  return res.data?.user ?? res.data ?? null
}

/**
 * GET /gw/user/addresses
 * Returns saved delivery addresses
 * Source: UserLocationsApi.kt
 */
async function getUserLocations(accessToken) {
  const res = await axios.get(`${BASE}/gw/user/addresses`, {
    headers: getHeaders(accessToken),
    validateStatus: () => true,
  })
  if (!res.data) return []
  const addressesArray = res.data?.response?.user?.addresses || []
  return addressesArray.map(item => {
    const a = item.address || {}
    const place = a.place || {}
    return {
      name:        a.display_title || a.alias || 'Address',
      fullAddress: a.display_subtitle || a.address || '',
      addressId:   a.id,
      cellId:      place.cell_id || '',
      entityType:  a.entity_type || 'subzone',
      entityId:    a.entity_id ?? null,
      placeId:     place.place_id ?? null,
      lat:         a.address_latitude ?? null,
      lng:         a.address_longitude ?? null,
    }
  })
}

module.exports = {
  getTabbedHomeEssentials,
  getFoodRescueCart,
  getRestaurantMeta,
  getUserInfo,
  getUserLocations,
}

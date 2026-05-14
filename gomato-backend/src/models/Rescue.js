// ============================================================
// Rescue.js — Mongoose schema for logged Food Rescue orders
// ============================================================
const mongoose = require('mongoose')

const itemSchema = new mongoose.Schema({
  name:     { type: String, default: 'Unknown item' },
  quantity: { type: Number, default: 1 },
  price:    { type: Number, default: 0 },
}, { _id: false })

const rescueSchema = new mongoose.Schema({
  // ── MQTT message ──
  msgId:        { type: String, unique: true, index: true },
  receivedAt:   { type: Date,   default: Date.now, index: true },

  // ── Pricing (from create-cart API) ──
  rescuePrice:    { type: Number },   // cart_final_cost
  originalPrice:  { type: Number },   // catalog_total_cost
  savingsAmount:  { type: Number },   // original - rescue
  discountPercent:{ type: Number },   // (savings / original) * 100

  // ── Cart metadata ──
  viewersCount:   { type: Number, default: 0 },
  expiresAt:      { type: Date },

  // ── Restaurant (from res_info API) ──
  resId:          { type: String },
  restaurantName: { type: String, default: 'Unknown Restaurant' },
  restaurantRating: { type: Number },
  restaurantLat:  { type: Number },
  restaurantLng:  { type: Number },

  // ── Items ──
  items: [itemSchema],

  // ── Status ──
  wasClaimed:   { type: Boolean, default: false },
  claimedAt:    { type: Date },

  // ── Raw cart data (for debugging / future parsing) ──
  rawCartData:  { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
})

module.exports = mongoose.model('Rescue', rescueSchema)

// ============================================================
// Session.js — Stores the logged-in Shadow Account session
// Only one session document ever exists (upserted by phone)
// ============================================================
const mongoose = require('mongoose')

const locationSchema = new mongoose.Schema({
  addressId: Number,
  cellId:    String,
  lat:       Number,
  lng:       Number,
  entityId:  Number,
  placeId:   String,
  cityId:    Number,
  name:      String,
  fullAddress: String,
}, { _id: false })

const sessionSchema = new mongoose.Schema({
  phone:        { type: String, required: true, unique: true },
  userName:     { type: String },
  userId:       { type: String },
  accessToken:  { type: String, required: true },
  refreshToken: { type: String },
  location:     { type: locationSchema },
  locations:    { type: Array, default: [] },

  // MQTT credentials cache (refresh periodically)
  mqttChannel:  { type: String },
  mqttUsername: { type: String },
  mqttPassword: { type: String },
  mqttQos:      { type: Number },
  mqttValidUntil: { type: Number },    // Unix timestamp ms
  cityId:       { type: Number },
}, {
  timestamps: true,
})

module.exports = mongoose.model('Session', sessionSchema)

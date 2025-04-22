const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  method: String,
  url: String,
  headers: Object,
  body: Object,
  response: Object,
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  statusCode: Number,
  error: String,
  timestamp: { type: Date, default: Date.now },
  completedAt: Date
});

module.exports = mongoose.model('Request', requestSchema); 
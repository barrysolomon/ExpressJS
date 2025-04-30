const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
    method: {
        type: String,
        required: true,
        enum: ['GET', 'POST', 'PUT', 'DELETE']
    },
    url: {
        type: String,
        required: true
    },
    headers: {
        type: Object,
        default: {}
    },
    body: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    response: {
        status_code: {
            type: Number,
            default: null
        },
        headers: {
            type: Object,
            default: {}
        },
        body: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    }
});

// Add indexes for better query performance
requestSchema.index({ timestamp: -1 });
requestSchema.index({ url: 1 });
requestSchema.index({ method: 1 });

const Request = mongoose.model('Request', requestSchema);

module.exports = Request; 
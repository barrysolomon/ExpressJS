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
        status_code: Number,
        headers: Object,
        body: mongoose.Schema.Types.Mixed
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Add indexes for better query performance
requestSchema.index({ timestamp: -1 });
requestSchema.index({ url: 1 });
requestSchema.index({ method: 1 });

const Request = mongoose.model('Request', requestSchema);

module.exports = Request; 
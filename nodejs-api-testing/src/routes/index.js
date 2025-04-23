const express = require('express');
const router = express.Router();
const Request = require('../models/request');
const axios = require('axios');
const winston = require('winston');

// Create logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Home page
router.get('/', async (req, res) => {
    try {
        const requests = await Request.find().sort({ timestamp: -1 }).limit(10);
        res.render('index', { requests });
    } catch (err) {
        logger.error('Error fetching requests:', err);
        res.status(500).render('error', { error: 'Failed to fetch requests' });
    }
});

// Get all requests
router.get('/requests', async (req, res) => {
    try {
        const requests = await Request.find().sort({ timestamp: -1 });
        logger.debug({ requestCount: requests.length }, 'Fetched all requests');
        res.json(requests);
    } catch (error) {
        logger.error({ error }, 'Error fetching all requests');
        res.status(500).json({ error: error.message });
    }
});

// Get specific request
router.get('/requests/:id', async (req, res) => {
    try {
        const request = await Request.findById(req.params.id);
        if (!request) {
            logger.warn({ requestId: req.params.id }, 'Request not found');
            return res.status(404).json({ error: 'Request not found' });
        }
        logger.debug({ requestId: req.params.id }, 'Fetched request details');
        res.json(request);
    } catch (error) {
        logger.error({ error, requestId: req.params.id }, 'Error fetching request');
        res.status(500).json({ error: error.message });
    }
});

// Make API request
router.post('/api/request', async (req, res) => {
    try {
        const { url, method, headers, body } = req.body;
        
        // Validate request
        if (!url || !method) {
            return res.status(400).json({ error: 'URL and method are required' });
        }

        // Make the request
        const response = await axios({
            method,
            url,
            headers: headers || {},
            data: body || null
        });

        // Save request to database
        const request = new Request({
            url,
            method,
            headers,
            body,
            response: {
                status_code: response.status,
                headers: response.headers,
                body: response.data
            },
            timestamp: new Date()
        });

        await request.save();

        res.json({
            success: true,
            request: {
                id: request._id,
                url,
                method,
                response: {
                    status_code: response.status,
                    headers: response.headers,
                    body: response.data
                },
                timestamp: request.timestamp
            }
        });
    } catch (err) {
        logger.error('API request error:', err);
        
        // Save failed request
        const request = new Request({
            url: req.body.url,
            method: req.body.method,
            headers: req.body.headers,
            body: req.body.body,
            response: {
                status_code: err.response?.status || 500,
                headers: err.response?.headers || {},
                body: err.response?.data || { error: err.message }
            },
            timestamp: new Date()
        });

        await request.save();

        res.status(err.response?.status || 500).json({
            error: err.message,
            request: {
                id: request._id,
                url: req.body.url,
                method: req.body.method,
                response: {
                    status_code: err.response?.status || 500,
                    headers: err.response?.headers || {},
                    body: err.response?.data || { error: err.message }
                },
                timestamp: request.timestamp
            }
        });
    }
});

// Get request history
router.get('/api/requests', async (req, res) => {
    try {
        const requests = await Request.find()
            .sort({ timestamp: -1 })
            .limit(50);
        
        res.json(requests);
    } catch (err) {
        logger.error('Error fetching request history:', err);
        res.status(500).json({ error: 'Failed to fetch request history' });
    }
});

// Get request details
router.get('/api/request/:id', async (req, res) => {
    try {
        const request = await Request.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }
        res.json(request);
    } catch (error) {
        logger.error('Error fetching request details:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 
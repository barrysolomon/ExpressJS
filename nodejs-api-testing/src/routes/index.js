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
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
        })
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
        logger.debug('Fetched all requests', { requestCount: requests.length });
        res.json(requests);
    } catch (error) {
        logger.error('Error fetching all requests', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Get specific request
router.get('/requests/:id', async (req, res) => {
    try {
        const request = await Request.findById(req.params.id);
        if (!request) {
            logger.warn('Request not found', { requestId: req.params.id });
            return res.status(404).json({ error: 'Request not found' });
        }
        logger.debug('Fetched request details', { requestId: req.params.id });
        res.json(request);
    } catch (error) {
        logger.error('Error fetching request', { error: error.message, requestId: req.params.id });
        res.status(500).json({ error: error.message });
    }
});

// Delete specific request
router.delete('/requests/:id', async (req, res) => {
    try {
        const request = await Request.findByIdAndDelete(req.params.id);
        if (!request) {
            logger.warn('Request not found for deletion', { requestId: req.params.id });
            return res.status(404).json({ error: 'Request not found' });
        }
        logger.info('Deleted request', { requestId: req.params.id });
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting request', { error: error.message, requestId: req.params.id });
        res.status(500).json({ error: error.message });
    }
});

// Make API request
router.post('/request', async (req, res) => {
    try {
        const { url, method, headers, body } = req.body;
        
        // Validate request
        if (!url || !method) {
            logger.warn('Invalid request', { url, method });
            return res.status(400).json({ error: 'URL and method are required' });
        }

        logger.info('Making API request', { url, method, headers, body });

        // Make the request
        const response = await axios({
            method,
            url,
            headers: headers || {},
            data: body || null
        });

        logger.info('API request successful', { 
            url, 
            method, 
            status: response.status,
            headers: response.headers,
            body: response.data
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
        logger.error('API request error', { 
            error: err.message,
            url: req.body.url,
            method: req.body.method,
            headers: req.body.headers,
            body: req.body.body,
            response: err.response ? {
                status: err.response.status,
                headers: err.response.headers,
                data: err.response.data
            } : null
        });
        
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
router.get('/history', async (req, res) => {
    try {
        const requests = await Request.find()
            .sort({ timestamp: -1 })
            .limit(50)
            .lean(); // Use lean() for better performance
        
        // Convert MongoDB _id to string for JSON serialization
        const formattedRequests = requests.map(req => ({
            ...req,
            _id: req._id.toString(),
            timestamp: req.timestamp.toISOString()
        }));
        
        logger.debug('Fetched request history', { count: formattedRequests.length });
        res.json(formattedRequests);
    } catch (err) {
        logger.error('Error fetching request history', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch request history' });
    }
});

// Delete request history
router.delete('/history', async (req, res) => {
    try {
        await Request.deleteMany({});
        logger.info('Cleared request history');
        res.json({ success: true });
    } catch (err) {
        logger.error('Error clearing request history', { error: err.message });
        res.status(500).json({ error: 'Failed to clear request history' });
    }
});

// Get request details
router.get('/request/:id', async (req, res) => {
    try {
        const request = await Request.findById(req.params.id);
        if (!request) {
            logger.warn('Request not found', { requestId: req.params.id });
            return res.status(404).json({ error: 'Request not found' });
        }
        logger.debug('Fetched request details', { requestId: req.params.id });
        res.json(request);
    } catch (error) {
        logger.error('Error fetching request details', { error: error.message, requestId: req.params.id });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 
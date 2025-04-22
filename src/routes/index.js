const express = require('express');
const router = express.Router();
const Request = require('../models/request');
const axios = require('axios');

// Get all requests
router.get('/requests', async (req, res) => {
    try {
        const requests = await Request.find().sort({ timestamp: -1 });
        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific request
router.get('/requests/:id', async (req, res) => {
    try {
        const request = await Request.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }
        res.json(request);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Make API request
router.post('/test', async (req, res) => {
    try {
        const { method, url, headers, body } = req.body;
        
        const request = new Request({
            method,
            url,
            headers,
            body,
            status: 'pending',
            timestamp: new Date()
        });
        await request.save();

        try {
            const response = await axios({
                method,
                url,
                headers,
                data: body
            });

            request.status = 'completed';
            request.statusCode = response.status;
            request.response = response.data;
            await request.save();

            res.json({
                status: 'completed',
                statusCode: response.status,
                data: response.data
            });
        } catch (error) {
            request.status = 'failed';
            request.statusCode = error.response?.status || 500;
            request.response = error.response?.data || error.message;
            await request.save();

            res.status(error.response?.status || 500).json({
                status: 'failed',
                statusCode: error.response?.status || 500,
                error: error.response?.data || error.message
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear all history
router.delete('/requests', async (req, res) => {
    try {
        await Request.deleteMany({});
        res.json({ message: 'History cleared successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 
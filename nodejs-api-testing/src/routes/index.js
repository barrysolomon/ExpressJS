const express = require('express');
const router = express.Router();
const Request = require('../models/request');
const axios = require('axios');
const pino = require('pino');

// Create logger with default configuration
const logger = pino();

// Test logger immediately after creation
logger.info('Routes logger initialized');

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
    const requestStartTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
        const { url, method, headers, body } = req.body;
        
        // Validate request
        if (!url || !method) {
            logger.warn('Invalid request parameters', {
                event: 'api_request_validation_failed',
                requestId,
                validation: {
                    url: !!url,
                    method: !!method
                },
                request: { url, method }
            });
            return res.status(400).json({ error: 'URL and method are required' });
        }

        // Log outgoing request
        logger.info('Outgoing API request initiated', {
            event: 'api_request_started',
            requestId,
            request: {
                url,
                method,
                headers,
                bodySize: body ? JSON.stringify(body).length : 0
            },
            timestamp: new Date().toISOString()
        });

        // Make the request
        const response = await axios({
            method,
            url,
            headers: headers || {},
            data: body || null
        });

        const requestDuration = Date.now() - requestStartTime;

        // Log successful response
        logger.info('API request completed successfully', {
            event: 'api_request_completed',
            requestId,
            timing: {
                duration_ms: requestDuration,
                started_at: new Date(requestStartTime).toISOString(),
                completed_at: new Date().toISOString()
            },
            request: {
                url,
                method,
                headers,
                bodySize: body ? JSON.stringify(body).length : 0
            },
            response: {
                status: response.status,
                size: JSON.stringify(response.data).length,
                headers: response.headers
            }
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

        // Log database operation
        logger.info('Request saved to database', {
            event: 'database_operation',
            operation: 'insert',
            collection: 'requests',
            documentId: request._id.toString(),
            metadata: {
                requestId,
                url,
                method,
                timestamp: request.timestamp.toISOString()
            }
        });

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
        const requestDuration = Date.now() - requestStartTime;

        // Log error details
        logger.error('API request failed', {
            event: 'api_request_failed',
            requestId,
            error: {
                message: err.message,
                code: err.code,
                stack: err.stack
            },
            timing: {
                duration_ms: requestDuration,
                started_at: new Date(requestStartTime).toISOString(),
                failed_at: new Date().toISOString()
            },
            request: {
                url: req.body.url,
                method: req.body.method,
                headers: req.body.headers,
                bodySize: req.body.body ? JSON.stringify(req.body.body).length : 0
            },
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

        // Log failed request saved to database
        logger.info('Failed request saved to database', {
            event: 'database_operation',
            operation: 'insert',
            collection: 'requests',
            documentId: request._id.toString(),
            metadata: {
                requestId,
                status: 'failed',
                error: err.message,
                url: req.body.url,
                method: req.body.method,
                timestamp: request.timestamp.toISOString()
            }
        });

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
    const startTime = Date.now();
    const operationId = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
        logger.info('Fetching request history', {
            event: 'database_operation_started',
            operation: 'find',
            collection: 'requests',
            operationId,
            parameters: {
                sort: { timestamp: -1 },
                limit: 50
            }
        });

        const requests = await Request.find()
            .sort({ timestamp: -1 })
            .limit(50)
            .lean();
        
        const duration = Date.now() - startTime;
        
        // Convert MongoDB _id to string for JSON serialization
        const formattedRequests = requests.map(req => ({
            ...req,
            _id: req._id.toString(),
            timestamp: req.timestamp.toISOString()
        }));
        
        logger.info('Request history fetched successfully', {
            event: 'database_operation_completed',
            operation: 'find',
            collection: 'requests',
            operationId,
            timing: {
                duration_ms: duration,
                started_at: new Date(startTime).toISOString(),
                completed_at: new Date().toISOString()
            },
            metadata: {
                count: formattedRequests.length,
                oldest_record: formattedRequests.length ? formattedRequests[formattedRequests.length - 1].timestamp : null,
                newest_record: formattedRequests.length ? formattedRequests[0].timestamp : null
            }
        });

        res.json(formattedRequests);
    } catch (err) {
        const duration = Date.now() - startTime;

        logger.error('Failed to fetch request history', {
            event: 'database_operation_failed',
            operation: 'find',
            collection: 'requests',
            operationId,
            error: {
                message: err.message,
                code: err.code,
                stack: err.stack
            },
            timing: {
                duration_ms: duration,
                started_at: new Date(startTime).toISOString(),
                failed_at: new Date().toISOString()
            }
        });

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
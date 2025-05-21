import { initTracing, wrapWithSpan } from './utils/tracing.js';
await initTracing();

import dotenv from 'dotenv';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import pino from 'pino';
import fs from 'fs';
import mongoose from 'mongoose';
import axios from 'axios';
import { fileURLToPath } from 'url';

// ES module __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Import HTTP logger middleware
import httpLogger from './middleware/httpLogger.js';

// Create logger with default configuration
const logger = pino();

// Test logger immediately after creation
logger.info('Logger initialized');

// Get version information
const nodeVersion = process.version;
const expressVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../node_modules/express/package.json'))).version;
const packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'))).version;
const appVersion = process.env.VERSION || '1.0.8';

// Log version information
logger.info('Version information', {
    nodeVersion,
    expressVersion,
    packageVersion,
    appVersion,
    envVersion: process.env.VERSION
});

// Set test environment temporarily
process.env.NODE_ENV = 'test';

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/bundle', express.static(path.join(__dirname, 'public/bundle')));

// Use HTTP logger middleware
app.use(httpLogger);

// Render main page
app.get('/', (req, res) => {
    wrapWithSpan('ui_load_main_page',
        {
            'ui.action': 'load_main_page',
            'http.method': req.method,
            'http.url': req.url
        },
        async () => {
            res.render('index', { 
                nodeVersion,
                expressVersion,
                appVersion
            });
        }
    );
});

// Conditional API setup
if (mongoUri) {
    // --- Database Mode --- 
    logger.info('MONGODB_URI found, running in Database Mode.', { uri: mongoUri });

    // Add connection options
    const mongooseOptions = {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    };

    mongoose.connect(mongoUri, mongooseOptions)
        .then(() => {
            logger.info('MongoDB connected successfully.');
            // Verify connection
            mongoose.connection.db.admin().listDatabases()
                .then(result => {
                    logger.info('Available databases:', result.databases.map(db => db.name));
                })
                .catch(err => {
                    logger.error('Error listing databases:', err);
                });
        })
        .catch(err => {
            logger.error('MongoDB connection error:', err);
            // Log more details about the error
            if (err.name === 'MongoServerSelectionError') {
                logger.error('Could not connect to MongoDB server. Please check if the server is running and accessible.');
            } else if (err.name === 'MongoParseError') {
                logger.error('Invalid MongoDB connection string format.');
            }
        });

    // Use the database-backed routes
    import('./routes/index.js').then(dbRoutes => {
        app.use('/api', dbRoutes.default); 
    });
}

// Always set up the test endpoint regardless of mode
app.post('/api/test', async (req, res) => {
    await wrapWithSpan('ui_api_test', 
        {
            'ui.action': 'api_test',
            'http.method': req.method,
            'http.url': req.url,
            'http.target': req.body.url
        },
        async () => {
            const requestId = Date.now().toString();
            const startTime = Date.now();
            let dbRequest = null;
            
            try {
                const { method, url, headers, body } = req.body;
                
                // Parse headers if they're a string
                let parsedHeaders = {};
                try {
                    parsedHeaders = typeof headers === 'string' ? JSON.parse(headers) : headers;
                } catch (e) {
                    logger.warn('Failed to parse headers, using empty object');
                }

                // Parse body if it's a string
                let parsedBody = body;
                try {
                    if (typeof body === 'string' && body.trim()) {
                        parsedBody = JSON.parse(body);
                    }
                } catch (e) {
                    logger.warn('Failed to parse body, using as is');
                }

                // Log outgoing request with detailed tracing
                logger.info('Making outgoing request', {
                    type: 'outgoing_request',
                    requestId,
                    method,
                    url,
                    headers: parsedHeaders,
                    body: parsedBody,
                    timestamp: new Date().toISOString(),
                    trace: {
                        startTime,
                        requestId,
                        method,
                        url
                    }
                });

                // Save initial request to database if MongoDB is available
                if (mongoUri) {
                    try {
                        const Request = (await import('./models/request.js')).default;
                        dbRequest = new Request({
                            method,
                            url,
                            headers: parsedHeaders,
                            body: parsedBody,
                            response: {
                                status_code: null,
                                headers: {},
                                body: null
                            },
                            timestamp: new Date(),
                            status: 'pending'
                        });
                        await dbRequest.save();
                        logger.debug('Saved initial request to database', { requestId: dbRequest._id });
                    } catch (err) {
                        logger.error('Failed to save initial request to database', { error: err.message });
                    }
                }

                // For GET requests, don't send a body
                const fetchOptions = {
                    method,
                    headers: parsedHeaders
                };

                // Only add body for non-GET requests
                if (method !== 'GET' && parsedBody) {
                    fetchOptions.body = JSON.stringify(parsedBody);
                }

                const response = await fetch(url, fetchOptions);
                
                const endTime = Date.now();
                const responseTime = endTime - startTime;

                // Get the content type from response headers
                const contentType = response.headers.get('content-type');
                let responseData;
                if (contentType && contentType.includes('application/json')) {
                    responseData = await response.json();
                } else {
                    responseData = await response.text();
                }

                // Update dbRequest with response if MongoDB is available
                if (dbRequest) {
                    dbRequest.response = {
                        status_code: response.status,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: responseData
                    };
                    dbRequest.status = 'completed';
                    await dbRequest.save();
                }

                res.json({
                    success: true,
                    request: dbRequest ? {
                        id: dbRequest._id.toString(),
                        url: dbRequest.url,
                        method: dbRequest.method,
                        response: dbRequest.response,
                        timestamp: dbRequest.timestamp
                    } : null,
                    status: response.status,
                    headers: Object.fromEntries(response.headers.entries()),
                    data: responseData,
                    time: responseTime
                });
            } catch (error) {
                // Save failed request to database if MongoDB is available
                if (mongoUri) {
                    try {
                        const Request = (await import('./models/request.js')).default;
                        dbRequest = new Request({
                            method: req.body.method,
                            url: req.body.url,
                            headers: req.body.headers,
                            body: req.body.body,
                            response: {
                                status_code: 500,
                                headers: {},
                                body: { error: error.message }
                            },
                            timestamp: new Date(),
                            status: 'failed'
                        });
                        await dbRequest.save();
                    } catch (err) {
                        logger.error('Failed to save failed request to database', { error: err.message });
                    }
                }
                res.status(500).json({
                    error: error.message,
                    request: dbRequest ? {
                        id: dbRequest._id.toString(),
                        url: dbRequest.url,
                        method: dbRequest.method,
                        response: dbRequest.response,
                        timestamp: dbRequest.timestamp
                    } : null
                });
            }
        }
    );
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Start the server
const server = app.listen(port, () => {
    logger.info('Server started', {
        port,
        mode: process.env.NODE_ENV || 'development',
        mongoUri: mongoUri ? 'Database Mode' : 'File System Mode'
    });
}); 
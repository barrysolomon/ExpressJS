const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();
const winston = require('winston');
const fs = require('fs');
const mongoose = require('mongoose');

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
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
                })
            )
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
                })
            )
        })
    ]
});

// Get version information
const nodeVersion = process.version;
const expressVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../node_modules/express/package.json'))).version;
const appVersion = process.env.VERSION || JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'))).version;

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;

// Ensure logs directory exists
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware
app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Log request
    logger.info('Incoming request', {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        timestamp: new Date().toISOString()
    });

    // Capture response
    const originalSend = res.send;
    res.send = function (body) {
        const responseTime = Date.now() - startTime;
        
        // Log response
        logger.info('Outgoing response', {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            responseTime: `${responseTime}ms`,
            body: body,
            timestamp: new Date().toISOString()
        });

        return originalSend.call(this, body);
    };

    next();
});

// Render main page
app.get('/', (req, res) => {
    res.render('index', { 
        nodeVersion,
        expressVersion,
        appVersion
    });
});

// Add a new route to serve the JavaScript file
app.get('/js/app.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
        document.addEventListener('DOMContentLoaded', function() {
            // Initialize CodeMirror for headers and body
            const headersEditor = CodeMirror.fromTextArea(document.getElementById('headers'), {
                mode: 'application/json',
                lineNumbers: true,
                autoCloseBrackets: true,
                matchBrackets: true,
                indentUnit: 2,
                tabSize: 2
            });

            const bodyEditor = CodeMirror.fromTextArea(document.getElementById('body'), {
                mode: 'application/json',
                lineNumbers: true,
                autoCloseBrackets: true,
                matchBrackets: true,
                indentUnit: 2,
                tabSize: 2
            });

            // Set default request body for JSONPlaceholder POST
            const defaultBody = {
                "title": "foo",
                "body": "bar",
                "userId": 1
            };
            bodyEditor.setValue(JSON.stringify(defaultBody, null, 2));

            // Set default headers for JSONPlaceholder API
            const defaultHeaders = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'API-Testing-Tool'
            };
            headersEditor.setValue(JSON.stringify(defaultHeaders, null, 2));

            // History management
            let requestHistory = [];

            // Fetch history on page load
            async function fetchHistory() {
                try {
                    const response = await fetch('/api/history');
                    const data = await response.json();
                    requestHistory = data;
                    updateHistoryTable();
                } catch (error) {
                    console.error('Error fetching history:', error);
                }
            }

            // Call fetchHistory immediately and also on DOMContentLoaded
            fetchHistory();

            // Also ensure history is loaded when the page is fully loaded
            window.addEventListener('load', fetchHistory);

            function addToHistory(request) {
                requestHistory.unshift(request);
                if (requestHistory.length > 50) {
                    requestHistory.pop();
                }
                updateHistoryTable();
            }

            function updateHistoryTable() {
                const tbody = document.getElementById('historyTable');
                if (!tbody) {
                    console.error('History table element not found');
                    return;
                }
                
                if (!requestHistory || requestHistory.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No history available</td></tr>';
                    return;
                }
                
                tbody.innerHTML = requestHistory.map((req, index) => {
                    const headersString = JSON.stringify(req.headers, null, 2);
                    const bodyString = typeof req.body === 'object' ? JSON.stringify(req.body, null, 2) : req.body;
                    const tooltipText = \`Headers:\\n\${headersString}\\n\\nBody:\\n\${bodyString}\`;
                    
                    return \`
                    <tr title="\${tooltipText}">
                        <td>\${new Date(req.timestamp).toLocaleString()}</td>
                        <td><span class="badge bg-primary">\${req.method}</span></td>
                        <td class="text-truncate" style="max-width: 300px;">\${req.url}</td>
                        <td><span class="status-\${Math.floor(req.response.status_code / 100)}xx">\${req.response.status_code}</span></td>
                        <td>\${req.response.time || '-'}ms</td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary" onclick="loadRequest(\${index})">Load</button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteRequest(\${index})">Delete</button>
                        </td>
                    </tr>
                \`;}).join('');
            }

            // Clear history
            document.getElementById('clearHistory').addEventListener('click', async function() {
                try {
                    const response = await fetch('/api/history', {
                        method: 'DELETE'
                    });
                    if (response.ok) {
                        requestHistory = [];
                        updateHistoryTable();
                    } else {
                        console.error('Failed to clear history');
                    }
                } catch (error) {
                    console.error('Error clearing history:', error);
                }
            });

            // Load request from history
            window.loadRequest = function(index) {
                const request = requestHistory[index];
                document.getElementById('method').value = request.method;
                document.getElementById('url').value = request.url;
                headersEditor.setValue(JSON.stringify(request.headers, null, 2));
                bodyEditor.setValue(JSON.stringify(request.body, null, 2));
            };

            // Delete request from history
            window.deleteRequest = async function(index) {
                const request = requestHistory[index];
                try {
                    const response = await fetch(\`/api/requests/\${request._id}\`, {
                        method: 'DELETE'
                    });
                    if (response.ok) {
                        requestHistory.splice(index, 1);
                        updateHistoryTable();
                    } else {
                        console.error('Failed to delete request');
                    }
                } catch (error) {
                    console.error('Error deleting request:', error);
                }
            };

            // Handle form submission
            document.getElementById('requestForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const method = document.getElementById('method').value;
                const url = document.getElementById('url').value;
                const headers = headersEditor.getValue();
                const body = bodyEditor.getValue();

                try {
                    // Validate headers JSON
                    let parsedHeaders;
                    try {
                        parsedHeaders = JSON.parse(headers || '{}');
                    } catch (e) {
                        throw new Error('Invalid headers JSON format');
                    }

                    // Validate body JSON if not empty and not a GET request
                    let parsedBody = null;
                    if (method !== 'GET' && body.trim()) {
                        try {
                            parsedBody = JSON.parse(body);
                        } catch (e) {
                            throw new Error('Invalid body JSON format');
                        }
                    }

                    const response = await fetch('/api/test', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            method,
                            url,
                            headers: parsedHeaders,
                            body: parsedBody
                        })
                    });

                    const data = await response.json();
                    
                    // Update response display
                    const statusCode = document.getElementById('statusCode');
                    statusCode.textContent = data.status;
                    statusCode.className = \`status-\${Math.floor(data.status / 100)}xx\`;
                    
                    document.getElementById('responseTime').textContent = data.time || '-';
                    
                    // Update headers
                    const responseHeaders = document.getElementById('responseHeaders');
                    try {
                        const formattedHeaders = JSON.stringify(data.headers, null, 2);
                        responseHeaders.innerHTML = Object.keys(data.headers).length > 0
                            ? \`<pre class="mb-0 resizable-pre">\${formattedHeaders}</pre>\`
                            : '<pre class="mb-0 resizable-pre">No headers available</pre>';
                    } catch {
                        responseHeaders.innerHTML = '<pre class="mb-0 resizable-pre">No headers available</pre>';
                    }
                    
                    // Update body
                    const responseBody = document.getElementById('responseBody');
                    try {
                        // Try to format JSON response
                        const formattedJson = JSON.stringify(data.data, null, 2);
                        responseBody.innerHTML = \`<pre class="mb-0 resizable-pre">\${formattedJson}</pre>\`;
                    } catch {
                        // If not JSON, display as is
                        responseBody.innerHTML = \`<pre class="mb-0 resizable-pre">\${data.data}</pre>\`;
                    }

                    // Add to history
                    addToHistory({
                        method,
                        url,
                        headers: parsedHeaders,
                        body: parsedBody,
                        response: {
                            status_code: data.status,
                            headers: data.headers,
                            body: data.data,
                            time: data.time
                        },
                        timestamp: new Date()
                    });
                } catch (error) {
                    document.getElementById('statusCode').textContent = 'Error';
                    document.getElementById('statusCode').className = 'status-5xx';
                    document.getElementById('responseTime').textContent = '-';
                    document.getElementById('responseHeaders').innerHTML = '';
                    document.getElementById('responseBody').innerHTML = \`<h6>Error:</h6><pre>\${error.message}</pre>\`;
                }
            });

            // Header presets
            const headerPresets = {
                json: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                form: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                xml: {
                    'Content-Type': 'application/xml',
                    'Accept': 'application/xml'
                },
                auth: {
                    'Authorization': 'Basic ' + btoa('username:password'),
                    'Content-Type': 'application/json'
                }
            };

            // Handle header preset selection
            document.querySelectorAll('[data-preset]').forEach(preset => {
                preset.addEventListener('click', (e) => {
                    e.preventDefault();
                    const presetName = e.target.dataset.preset;
                    const presetHeaders = headerPresets[presetName];
                    headersEditor.setValue(JSON.stringify(presetHeaders, null, 2));
                });
            });

            // Handle preview button click
            document.getElementById('previewHeaders').addEventListener('click', () => {
                const headersPreview = document.getElementById('headersPreview');
                const headersPreviewContent = document.getElementById('headersPreviewContent');
                
                try {
                    const headers = JSON.parse(headersEditor.getValue() || '{}');
                    const formattedHeaders = Object.entries(headers)
                        .map(([key, value]) => \`\${key}: \${value}\`)
                        .join('\\n');
                    
                    headersPreviewContent.textContent = formattedHeaders;
                    headersPreview.classList.remove('d-none');
                } catch (error) {
                    headersPreviewContent.textContent = 'Invalid JSON format';
                    headersPreview.classList.remove('d-none');
                }
            });
        });
    `);
});

// Conditional API setup
if (mongoUri) {
    // --- Database Mode --- 
    logger.info('MONGODB_URI found, running in Database Mode.', { uri: mongoUri });

    // Add connection options
    const mongooseOptions = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
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
    const dbRoutes = require('./routes/index');
    app.use('/api', dbRoutes); 
}

// Always set up the test endpoint regardless of mode
app.post('/api/test', async (req, res) => {
    const requestId = Date.now().toString();
    const startTime = Date.now();
    
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

        // Log outgoing request
        logger.info('Making outgoing request', {
            type: 'outgoing_request',
            requestId,
            method,
            url,
            headers: parsedHeaders,
            body: parsedBody,
            timestamp: new Date().toISOString()
        });

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

        // Handle different response types
        if (contentType && contentType.includes('application/json')) {
            try {
                responseData = await response.json();
            } catch (e) {
                // If JSON parsing fails, get the raw text
                responseData = await response.text();
                logger.warn('Failed to parse JSON response', {
                    type: 'json_parse_error',
                    requestId,
                    error: e.message,
                    rawResponse: responseData
                });
            }
        } else {
            responseData = await response.text();
        }

        // Log response
        logger.info('Received response', {
            type: 'outgoing_response',
            requestId,
            method,
            url,
            statusCode: response.status,
            responseTime: `${responseTime}ms`,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseData,
            timestamp: new Date().toISOString()
        });

        // Save request to database if MongoDB is available
        if (mongoUri) {
            try {
                const Request = require('./models/request');
                const request = new Request({
                    method,
                    url,
                    headers: parsedHeaders,
                    body: parsedBody,
                    response: {
                        status_code: response.status,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: responseData
                    },
                    timestamp: new Date()
                });
                await request.save();
                logger.info('Saved request to database', { requestId: request._id });
            } catch (err) {
                logger.error('Failed to save request to database', { error: err.message });
            }
        }
        
        res.json({
            status: response.status,
            time: responseTime,
            data: responseData,
            headers: Object.fromEntries(response.headers.entries()),
            contentType: contentType || 'unknown'
        });
    } catch (error) {
        const endTime = Date.now();
        const responseTime = endTime - startTime;

        // Log error
        logger.error('Request failed', {
            type: 'error',
            requestId,
            method: req.body.method,
            url: req.body.url,
            error: error.message,
            stack: error.stack,
            responseTime: `${responseTime}ms`,
            timestamp: new Date().toISOString()
        });

        // Save failed request to database if MongoDB is available
        if (mongoUri) {
            try {
                const Request = require('./models/request');
                const request = new Request({
                    method: req.body.method,
                    url: req.body.url,
                    headers: req.body.headers,
                    body: req.body.body,
                    response: {
                        status_code: 500,
                        headers: {},
                        body: { error: error.message }
                    },
                    timestamp: new Date()
                });
                await request.save();
                logger.info('Saved failed request to database', { requestId: request._id });
            } catch (err) {
                logger.error('Failed to save failed request to database', { error: err.message });
            }
        }

        res.status(500).json({ 
            error: error.message,
            details: error.stack,
            type: 'request_error'
        });
    }
});

app.listen(port, () => {
    logger.info('Server started', {
        type: 'server_start',
        port,
        nodeVersion,
        expressVersion,
        appVersion,
        timestamp: new Date().toISOString()
    });
}); 
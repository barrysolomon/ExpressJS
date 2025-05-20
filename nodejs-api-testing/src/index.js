require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const pino = require('pino');
const fs = require('fs');
const mongoose = require('mongoose');
const axios = require('axios');

// Import HTTP logger middleware
const httpLogger = require('./middleware/httpLogger');

// Create logger with default configuration
const logger = pino();

// Test logger immediately after creation
logger.info('Logger initialized');

// Get version information
const nodeVersion = process.version;
const expressVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../node_modules/express/package.json'))).version;
const packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'))).version;
const appVersion = process.env.VERSION || packageVersion;

// Log version information
logger.info('Version information', {
    nodeVersion,
    expressVersion,
    packageVersion,
    appVersion,
    envVersion: process.env.VERSION
});

// Initialize OpenTelemetry tracing after logger is configured
const { initTracing, wrapWithSpan } = require('./utils/tracing');

// Set test environment temporarily
process.env.NODE_ENV = 'test';

initTracing();

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

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

// Add a new route to serve the JavaScript file
app.get('/js/app.js', (req, res) => {
    wrapWithSpan('ui_load_app_js',
        {
            'ui.action': 'load_app_js',
            'http.method': req.method,
            'http.url': req.url
        },
        async () => {
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
                            const response = await axios.get('/api/history');
                            requestHistory = response.data;
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
                            const response = await axios.delete('/api/history');
                            if (response.status === 200) {
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
                        if (!request || !request._id) {
                            console.error('Invalid request or missing ID');
                            return;
                        }
                        try {
                            const response = await axios.delete('/api/requests/' + request._id);
                            if (response.status === 200) {
                                requestHistory.splice(index, 1);
                                updateHistoryTable();
                                console.log('Request deleted successfully');
                            } else {
                                console.error('Failed to delete request:', response.data);
                            }
                        } catch (error) {
                            console.error('Error deleting request:', error.response?.data || error.message);
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

                            const response = await axios.post('/api/test', {
                                method,
                                url,
                                headers: parsedHeaders,
                                body: parsedBody
                            });

                            const data = response.data;
                            console.log('Response data:', JSON.stringify(data, null, 2));
                            
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
                                _id: data?.request?.id || data?.request?._id || \`temp_${Date.now()}\`,
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
                            // Refresh history immediately
                            await fetchHistory();
                        } catch (error) {
                            document.getElementById('statusCode').textContent = 'Error';
                            document.getElementById('statusCode').className = 'status-5xx';
                            document.getElementById('responseTime').textContent = '-';
                            document.getElementById('responseHeaders').innerHTML = '';
                            document.getElementById('responseBody').innerHTML = \`<h6>Error:</h6><pre>\${error.response?.data?.error || error.message}</pre>\`;
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
    const dbRoutes = require('./routes/index');
    app.use('/api', dbRoutes); 
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
                        const Request = require('./models/request');
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
                        const Request = require('./models/request');
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
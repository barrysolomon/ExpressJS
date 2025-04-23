const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();
const winston = require('winston');
const fs = require('fs');

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

// Get version information
const nodeVersion = process.version;
const expressVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../node_modules/express/package.json'))).version;
const mongooseVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../node_modules/mongoose/package.json'))).version;

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// Request logging middleware
app.use((req, res, next) => {
  logger.debug({
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body
  }, 'Incoming request');
  next();
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongodb:27017/api-testing')
  .then(() => {
    logger.info('Connected to MongoDB');
  })
  .catch((err) => {
    logger.error('MongoDB connection error:', err);
  });

// Import routes
const apiRoutes = require('./routes');

// Use routes
app.use('/api', apiRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Render main page
app.get('/', async (req, res) => {
  try {
    const Request = require('./models/request');
    const requests = await Request.find().sort({ timestamp: -1 }).limit(10);
    logger.debug({ requestCount: requests.length }, 'Fetched requests for main page');
    res.render('index', { 
      requests,
      nodeVersion,
      expressVersion,
      mongodbVersion: mongooseVersion
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching requests for main page');
    res.status(500).render('error', { message: 'Error loading requests' });
  }
});

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  logger.info(`Node.js version: ${nodeVersion}`);
  logger.info(`Express version: ${expressVersion}`);
  logger.info(`Mongoose version: ${mongooseVersion}`);
}); 
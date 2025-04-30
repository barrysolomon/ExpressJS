const pino = require('pino');
const path = require('path');

// Determine if we're running in a container
const isContainer = process.env.CONTAINER_ENV === 'true';

// Set up the transport configuration based on environment
const transportConfig = isContainer
  ? {
      target: 'pino/file',
      options: {
        destination: '/app/logs/app.log',
        mkdir: true
      }
    }
  : {
      target: 'pino/file',
      options: {
        destination: path.join(process.cwd(), 'logs', 'app.log'),
        mkdir: true
      }
    };

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: transportConfig
});

module.exports = logger; 
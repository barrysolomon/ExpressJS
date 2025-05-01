const pino = require('pino');

// Create logger with direct stdout output
const logger = pino({
  level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  customLevels: {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10
  },
  base: null,
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    }
  }
});

// Log initial configuration
logger.info({
  msg: 'Logger initialized',
  config: {
    level: logger.level,
    environment: process.env.NODE_ENV || 'development'
  }
});

module.exports = logger; 
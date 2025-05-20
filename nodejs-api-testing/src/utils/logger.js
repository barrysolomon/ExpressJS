const pino = require('pino');
const { logs } = require('@opentelemetry/api-logs');

// Create a logger instance
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
});

// Create a wrapper that sends logs to both Pino and OpenTelemetry
const otelLogger = logs.getLogger('api-testing-tool');

function createLogWrapper(level) {
  return function(msg, obj = {}) {
    // Log to Pino
    logger[level](obj, msg);

    // Log to OpenTelemetry
    if (otelLogger) {
      otelLogger.emit({
        severityText: level.toUpperCase(),
        body: msg,
        attributes: {
          ...obj,
          'service.name': process.env.OTEL_SERVICE_NAME || 'api-testing-tool',
          'service.version': process.env.OTEL_SERVICE_VERSION || '1.0.7',
          'environment': process.env.NODE_ENV || 'production'
        }
      });
    }
  };
}

// Create wrapped logging functions
const wrappedLogger = {
  debug: createLogWrapper('debug'),
  info: createLogWrapper('info'),
  warn: createLogWrapper('warn'),
  error: createLogWrapper('error'),
  fatal: createLogWrapper('fatal')
};

module.exports = wrappedLogger; 
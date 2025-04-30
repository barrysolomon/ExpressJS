const logger = require('../utils/logger');

function httpLogger(req, res, next) {
  if (process.env.HTTP_LOGGING_ENABLED !== 'true') {
    return next();
  }

  const start = Date.now();
  const requestId = req.headers['x-request-id'] || Math.random().toString(36).substring(7);

  // Log request
  logger.info('Incoming HTTP Request', {
    requestId,
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: req.query,
    body: req.body,
    ip: req.ip
  });

  // Capture response
  const originalSend = res.send;
  res.send = function (body) {
    const responseTime = Date.now() - start;
    
    // Log response
    logger.info('Outgoing HTTP Response', {
      requestId,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      headers: res.getHeaders(),
      body: body
    });

    return originalSend.call(this, body);
  };

  next();
}

module.exports = httpLogger; 
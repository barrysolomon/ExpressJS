const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { SimpleSpanProcessor, BatchSpanProcessor, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
const { metrics, ValueType } = require('@opentelemetry/api-metrics');
const { MeterProvider } = require('@opentelemetry/sdk-metrics');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const logger = require('./logger');
const { trace, context, SpanKind, SpanStatusCode } = require('@opentelemetry/api');

// Create metrics
const meter = metrics.getMeter('api-testing-metrics');
const requestCounter = meter.createCounter('http.server.requests', {
  description: 'Count of HTTP server requests',
  unit: '1'
});
const responseTimeHistogram = meter.createHistogram('http.server.duration', {
  description: 'Duration of HTTP server requests',
  unit: 'ms'
});
const exportBatchCounter = meter.createCounter('otlp.export.batches', {
  description: 'Count of OTLP export batches',
  unit: '1'
});
const exportErrorCounter = meter.createCounter('otlp.export.errors', {
  description: 'Count of OTLP export errors',
  unit: '1'
});
const activeSpansGauge = meter.createUpDownCounter('otlp.active.spans', {
  description: 'Number of active spans',
  unit: '1'
});

// Create a tracer instance
let tracer;

// Function to create a parent span for API operations
function createAPIOperationSpan(operationName, attributes = {}) {
  const currentSpan = trace.getSpan(context.active());
  const parentContext = currentSpan ? trace.setSpan(context.active(), currentSpan) : context.active();
  
  const span = tracer.startSpan(
    operationName,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'api.operation': operationName,
        ...attributes
      }
    },
    parentContext
  );
  
  return trace.setSpan(context.active(), span);
}

// Function to create a mock database span for testing
function createMockDatabaseSpan(parentContext, operationName) {
  const span = tracer.startSpan(
    `mongodb.${operationName}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'mongodb',
        'db.operation': operationName,
        'db.name': 'test',
        'db.mock': true
      }
    },
    parentContext
  );
  
  return span;
}

// Function to wrap an async operation with a parent span
async function wrapWithSpan(operationName, attributes = {}, operation) {
  const currentSpan = trace.getSpan(context.active());
  const parentContext = currentSpan ? trace.setSpan(context.active(), currentSpan) : context.active();
  
  // Create the parent span
  const parentSpan = tracer.startSpan(
    operationName,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'api.operation': operationName,
        ...attributes
      }
    },
    parentContext
  );
  
  // Create a new context with the parent span
  const ctx = trace.setSpan(context.active(), parentSpan);
  
  try {
    // Execute the operation within the new context
    const result = await context.with(ctx, async () => {
      // Create a child span for the operation
      const childSpan = tracer.startSpan(
        `${operationName}.operation`,
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            'api.operation': `${operationName}.operation`,
            ...attributes
          }
        },
        ctx
      );
      
      try {
        // Create a new context for child operations
        const childCtx = trace.setSpan(context.active(), childSpan);
        
        // Execute the operation within the child span's context
        const result = await context.with(childCtx, async () => {
          // Create MongoDB span for test environment
          if (process.env.NODE_ENV === 'test') {
            const mongoSpan = tracer.startSpan(
              `${operationName}.mongodb`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'mongodb',
                  'db.operation': 'find',
                  'db.name': 'test',
                  'db.mock': true,
                  'api.operation': `${operationName}.mongodb`
                }
              },
              childCtx
            );
            
            try {
              // Simulate MongoDB operation
              await new Promise(resolve => setTimeout(resolve, 100));
              mongoSpan.setStatus({ code: SpanStatusCode.OK });
            } catch (error) {
              mongoSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message
              });
              mongoSpan.recordException(error);
              throw error;
            } finally {
              mongoSpan.end();
            }
          }
          
          // Create a span for the HTTP request
          const httpSpan = tracer.startSpan(
            `${operationName}.http`,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'api.operation': `${operationName}.http`,
                ...attributes
              }
            },
            childCtx
          );
          
          try {
            const result = await operation();
            httpSpan.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            httpSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message
            });
            httpSpan.recordException(error);
            throw error;
          } finally {
            httpSpan.end();
          }
        });
        
        childSpan.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        childSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        childSpan.recordException(error);
        throw error;
      } finally {
        childSpan.end();
      }
    });
    
    parentSpan.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    parentSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message
    });
    parentSpan.recordException(error);
    throw error;
  } finally {
    parentSpan.end();
  }
}

// Custom span processor that logs batch export information
class LoggingBatchSpanProcessor extends BatchSpanProcessor {
  constructor(exporter, config) {
    super(exporter, config);
    this.exportCount = 0;
    this.lastExportTime = Date.now();
    this.failedExports = 0;
    this.successfulExports = 0;
    this.totalSpansExported = 0;
    this.totalBatchesExported = 0;
    
    // Log configuration on startup
    logger.info({
      msg: 'Initializing LoggingBatchSpanProcessor',
      config: {
        maxQueueSize: config.maxQueueSize,
        scheduledDelayMillis: config.scheduledDelayMillis,
        exportTimeoutMillis: config.exportTimeoutMillis,
        maxExportBatchSize: config.maxExportBatchSize
      }
    });

    // Log exporter details
    logger.info({
      msg: 'Trace Exporter Configuration',
      config: {
        type: exporter.constructor.name,
        url: exporter.url,
        timeoutMillis: exporter.timeoutMillis,
        headers: exporter.headers ? Object.keys(exporter.headers) : [],
        compression: exporter.compression
      }
    });
  }

  onStart(span, parentContext) {
    super.onStart(span, parentContext);
    logger.debug({
      msg: 'Span started',
      span: {
        name: span.name,
        kind: span.kind,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanId
      }
    });
  }

  onEnd(span) {
    super.onEnd(span);
    logger.debug({
      msg: 'Span ended',
      span: {
        name: span.name,
        kind: span.kind,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanId,
        duration: span.endTime - span.startTime
      }
    });
  }

  onExport(spans) {
    const now = Date.now();
    const timeSinceLastExport = now - this.lastExportTime;
    this.exportCount += spans.length;
    this.totalBatchesExported++;
    
    // Log detailed span information before export
    logger.info({
      msg: 'Preparing to export spans batch',
      batchDetails: {
        currentBatchSize: spans.length,
        totalSpansExported: this.exportCount,
        totalBatchesExported: this.totalBatchesExported,
        timeSinceLastExport: `${timeSinceLastExport}ms`,
        averageSpansPerBatch: Math.round(this.exportCount / this.totalBatchesExported)
      },
      exporterConfig: {
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        samplingRate: process.env.OTEL_SAMPLING_RATE,
        hasAuthHeader: !!process.env.OTEL_EXPORTER_OTLP_HEADERS,
        compression: 'gzip'
      },
      spans: spans.map(span => ({
        name: span.name,
        kind: span.kind,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanId,
        startTime: span.startTime,
        endTime: span.endTime,
        duration: span.endTime - span.startTime,
        attributes: span.attributes,
        events: span.events,
        status: span.status,
        links: span.links
      }))
    });

    this.lastExportTime = now;
    
    // Call the parent's onExport and handle the result
    return super.onExport(spans)
      .then(() => {
        this.successfulExports++;
        this.totalSpansExported += spans.length;
        logger.info({
          msg: 'Successfully exported spans batch',
          exportStats: {
            currentBatchSize: spans.length,
            totalSpansExported: this.totalSpansExported,
            totalSuccessfulExports: this.successfulExports,
            totalFailedExports: this.failedExports,
            successRate: `${((this.successfulExports / (this.successfulExports + this.failedExports)) * 100).toFixed(2)}%`,
            exporterConfig: {
              endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
              samplingRate: process.env.OTEL_SAMPLING_RATE,
              hasAuthHeader: !!process.env.OTEL_EXPORTER_OTLP_HEADERS,
              compression: 'gzip'
            }
          }
        });
      })
      .catch((error) => {
        this.failedExports++;
        logger.error({
          msg: 'Failed to export spans batch',
          error: {
            name: error.name,
            message: error.message,
            code: error.code,
            details: error.details,
            stack: error.stack,
            cause: error.cause ? {
              name: error.cause.name,
              message: error.cause.message,
              code: error.cause.code,
              details: error.cause.details,
              stack: error.cause.stack
            } : undefined
          },
          exportStats: {
            currentBatchSize: spans.length,
            totalSpansExported: this.totalSpansExported,
            totalSuccessfulExports: this.successfulExports,
            totalFailedExports: this.failedExports,
            successRate: `${((this.successfulExports / (this.successfulExports + this.failedExports)) * 100).toFixed(2)}%`,
            exporterConfig: {
              endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
              samplingRate: process.env.OTEL_SAMPLING_RATE,
              hasAuthHeader: !!process.env.OTEL_EXPORTER_OTLP_HEADERS,
              compression: 'gzip'
            }
          }
        });
        throw error; // Re-throw to maintain the error handling chain
      });
  }

  forceFlush() {
    logger.info({
      msg: 'Force flushing spans',
      stats: {
        totalSpansExported: this.totalSpansExported,
        totalBatchesExported: this.totalBatchesExported,
        successfulExports: this.successfulExports,
        failedExports: this.failedExports
      }
    });
    return super.forceFlush();
  }

  shutdown() {
    logger.info({
      msg: 'Shutting down span processor',
      finalStats: {
        totalSpansExported: this.totalSpansExported,
        totalBatchesExported: this.totalBatchesExported,
        successfulExports: this.successfulExports,
        failedExports: this.failedExports,
        averageSpansPerBatch: Math.round(this.totalSpansExported / this.totalBatchesExported)
      }
    });
    return super.shutdown();
  }
}

function logEnvironmentVariables() {
  const relevantVars = {
    // Application Configuration
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    MONGODB_URI: process.env.MONGODB_URI,
    
    // HTTP Logging
    HTTP_LOGGING_ENABLED: process.env.HTTP_LOGGING_ENABLED,
    
    // Lumigo Configuration
    LUMIGO_ENABLE_LOGS: process.env.LUMIGO_ENABLE_LOGS,
    
    // OpenTelemetry Configuration
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_SAMPLING_RATE: process.env.OTEL_SAMPLING_RATE,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_METRICS_ENABLED: process.env.OTEL_EXPORTER_OTLP_METRICS_ENABLED,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    OTEL_SERVICE_VERSION: process.env.OTEL_SERVICE_VERSION,
    OTEL_TRACES_SAMPLER: process.env.OTEL_TRACES_SAMPLER,
    OTEL_PROPAGATORS: process.env.OTEL_PROPAGATORS,
    OTEL_LOG_LEVEL: process.env.OTEL_LOG_LEVEL,
    
    // OpenTelemetry Instrumentation Control
    OTEL_INSTRUMENT_HTTP: process.env.OTEL_INSTRUMENT_HTTP,
    OTEL_INSTRUMENT_EXPRESS: process.env.OTEL_INSTRUMENT_EXPRESS,
    OTEL_INSTRUMENT_MONGODB: process.env.OTEL_INSTRUMENT_MONGODB,
    
    // Batch Processor Configuration
    OTEL_BSP_MAX_QUEUE_SIZE: process.env.OTEL_BSP_MAX_QUEUE_SIZE,
    OTEL_BSP_SCHEDULE_DELAY: process.env.OTEL_BSP_SCHEDULE_DELAY,
    OTEL_BSP_EXPORT_TIMEOUT: process.env.OTEL_BSP_EXPORT_TIMEOUT,
    OTEL_BSP_MAX_EXPORT_BATCH_SIZE: process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE
  };

  // Log all environment variables
  logger.info({
    msg: 'OpenTelemetry Environment Configuration',
    config: {
      ...relevantVars,
      // Mask sensitive values
      OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS ? '[MASKED]' : undefined,
      MONGODB_URI: process.env.MONGODB_URI ? '[MASKED]' : undefined
    }
  });

  // Log configuration summary
  const configSummary = {
    environment: process.env.NODE_ENV || 'development',
    tracingEnabled: process.env.OTEL_ENABLED === 'true',
    samplingRate: process.env.OTEL_SAMPLING_RATE || '1.0',
    httpLoggingEnabled: process.env.HTTP_LOGGING_ENABLED === 'true',
    lumigoLogsEnabled: process.env.LUMIGO_ENABLE_LOGS === 'true',
    enabledInstrumentations: {
      http: process.env.OTEL_INSTRUMENT_HTTP === 'true',
      express: process.env.OTEL_INSTRUMENT_EXPRESS === 'true',
      mongodb: process.env.OTEL_INSTRUMENT_MONGODB === 'true'
    }
  };

  logger.info({
    msg: 'OpenTelemetry Configuration Summary',
    config: configSummary
  });
}

function initTracing() {
  if (process.env.OTEL_ENABLED !== 'true') {
    logger.info('OpenTelemetry tracing is disabled');
    return;
  }

  logEnvironmentVariables();

  try {
    // Create a test span to verify tracing is working
    tracer = trace.getTracer('api-testing-tracer');
    const testSpan = tracer.startSpan('test-span');
    testSpan.setAttribute('test.attribute', 'test-value');
    testSpan.end();

    logger.info({
      msg: 'Created test span',
      span: {
        name: testSpan.name,
        traceId: testSpan.spanContext().traceId,
        spanId: testSpan.spanContext().spanId
      }
    });

    // Log exporter configuration before creation
    logger.info({
      msg: 'Creating OTLP Trace Exporter',
      config: {
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        hasAuthHeader: !!process.env.OTEL_EXPORTER_OTLP_HEADERS,
        compression: 'gzip'
      }
    });

    const traceExporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces',
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? {
        'Authorization': process.env.OTEL_EXPORTER_OTLP_HEADERS.split('=')[1],
        'Content-Type': 'application/json'
      } : {},
      compression: 'gzip',
      timeoutMillis: 30000,
      concurrencyLimit: 1,
      keepAlive: true,
      httpAgentOptions: {
        keepAlive: true,
        keepAliveMsecs: 20000,
        maxSockets: 10
      }
    });

    // Create span processor first with more aggressive settings
    const spanProcessor = new LoggingBatchSpanProcessor(traceExporter, {
      maxQueueSize: parseInt(process.env.OTEL_BSP_MAX_QUEUE_SIZE || '2048'),
      scheduledDelayMillis: parseInt(process.env.OTEL_BSP_SCHEDULE_DELAY || '500'),
      exportTimeoutMillis: parseInt(process.env.OTEL_BSP_EXPORT_TIMEOUT || '30000'),
      maxExportBatchSize: parseInt(process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE || '512')
    });

    // Override onStart to track spans
    const originalOnStart = spanProcessor.onStart.bind(spanProcessor);
    spanProcessor.onStart = (span, parentContext) => {
      spanProcessor.exportCount = (spanProcessor.exportCount || 0) + 1;
      logger.debug({
        msg: 'Span started',
        span: {
          name: span.name,
          kind: span.kind,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          parentSpanId: span.parentSpanId,
          attributes: span.attributes
        }
      });
      return originalOnStart(span, parentContext);
    };

    // Override onEnd to track spans
    const originalOnEnd = spanProcessor.onEnd.bind(spanProcessor);
    spanProcessor.onEnd = (span) => {
      logger.debug({
        msg: 'Span ended',
        span: {
          name: span.name,
          kind: span.kind,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          parentSpanId: span.parentSpanId,
          duration: span.endTime - span.startTime,
          attributes: span.attributes
        }
      });
      return originalOnEnd(span);
    };

    // Override export to track successful exports
    const originalExport = traceExporter.export.bind(traceExporter);
    traceExporter.export = async (spans, resultCallback) => {
      logger.debug({
        msg: 'Attempting to export spans',
        spanCount: spans.length,
        spans: spans.map(span => ({
          name: span.name,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          parentSpanId: span.parentSpanId,
          attributes: span.attributes,
          kind: span.kind
        }))
      });

      try {
        const result = await originalExport(spans, resultCallback);
        spanProcessor.successfulExports = (spanProcessor.successfulExports || 0) + 1;
        spanProcessor.totalSpansExported = (spanProcessor.totalSpansExported || 0) + spans.length;
        spanProcessor.totalBatchesExported = (spanProcessor.totalBatchesExported || 0) + 1;
        logger.debug({
          msg: 'Successfully exported spans',
          spanCount: spans.length,
          stats: {
            successfulExports: spanProcessor.successfulExports,
            totalSpansExported: spanProcessor.totalSpansExported,
            totalBatchesExported: spanProcessor.totalBatchesExported,
            spans: spans.map(span => ({
              name: span.name,
              kind: span.kind,
              traceId: span.spanContext().traceId,
              spanId: span.spanContext().spanId,
              attributes: span.attributes
            }))
          }
        });
        return result;
      } catch (error) {
        spanProcessor.failedExports = (spanProcessor.failedExports || 0) + 1;
        logger.error({
          msg: 'Failed to export spans',
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack
          }
        });
        throw error;
      }
    };

    // Log SDK configuration before creation
    logger.info({
      msg: 'Creating OpenTelemetry SDK',
      config: {
        serviceName: process.env.OTEL_SERVICE_NAME || 'api-testing-ui',
        serviceVersion: process.env.OTEL_SERVICE_VERSION || '1.0.7',
        environment: process.env.NODE_ENV || 'production',
        samplingRate: process.env.OTEL_SAMPLING_RATE || '1.0',
        enabledInstrumentations: {
          http: process.env.OTEL_INSTRUMENT_HTTP === 'true',
          express: process.env.OTEL_INSTRUMENT_EXPRESS === 'true',
          mongodb: process.env.OTEL_INSTRUMENT_MONGODB === 'true'
        }
      }
    });

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'api-testing-ui',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || '1.0.7',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production'
      }),
      spanProcessor: spanProcessor,
      sampler: new TraceIdRatioBasedSampler(1.0),
      instrumentations: [
        new HttpInstrumentation({
          enabled: process.env.OTEL_INSTRUMENT_HTTP === 'true',
          ignoreIncomingRequestHook: (request) => {
            return request.url === '/health';
          },
          ignoreOutgoingRequestHook: (request) => {
            return false;
          },
          applyCustomAttributesOnSpan: (span, request, response) => {
            const currentSpan = trace.getSpan(context.active());
            span.setAttribute('http.request.method', request.method);
            span.setAttribute('http.request.url', request.url);
            if (response) {
              span.setAttribute('http.response.status_code', response.statusCode);
            }
            if (currentSpan) {
              span.setParent(currentSpan);
            }
          },
          startIncomingSpanHook: (request) => {
            const currentSpan = trace.getSpan(context.active());
            const spanContext = currentSpan ? currentSpan.spanContext() : undefined;
            return {
              name: `${request.method} ${request.url}`,
              kind: SpanKind.SERVER,
              attributes: {
                'http.request.method': request.method,
                'http.request.url': request.url,
                'ui.action': currentSpan?.attributes['ui.action'] || 'unknown'
              },
              parent: spanContext
            };
          },
          startOutgoingSpanHook: (request) => {
            const currentSpan = trace.getSpan(context.active());
            const spanContext = currentSpan ? currentSpan.spanContext() : undefined;
            
            // Create a child span for the outgoing request
            const childSpan = tracer.startSpan(
              `${request.method} ${request.url}`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'http.request.method': request.method,
                  'http.request.url': request.url,
                  'ui.action': currentSpan?.attributes['ui.action'] || 'unknown'
                },
                parent: spanContext
              }
            );
            
            return {
              name: `${request.method} ${request.url}`,
              kind: SpanKind.CLIENT,
              attributes: {
                'http.request.method': request.method,
                'http.request.url': request.url,
                'ui.action': currentSpan?.attributes['ui.action'] || 'unknown'
              },
              parent: childSpan.spanContext()
            };
          },
          requestHook: (span, request) => {
            const currentSpan = trace.getSpan(context.active());
            if (currentSpan) {
              span.setParent(currentSpan);
            }
            span.setAttribute('http.request.method', request.method);
            span.setAttribute('http.request.url', request.url);
            span.setAttribute('http.request.headers', JSON.stringify(request.headers));
          },
          responseHook: (span, response) => {
            span.setAttribute('http.response.status_code', response.statusCode);
            span.setAttribute('http.response.headers', JSON.stringify(response.headers));
          }
        }),
        new ExpressInstrumentation({
          enabled: process.env.OTEL_INSTRUMENT_EXPRESS === 'true',
          requestHook: (span, req) => {
            const currentSpan = trace.getSpan(context.active());
            span.setAttribute('http.route', req.route?.path || 'unknown');
            span.setAttribute('http.method', req.method);
            span.setAttribute('http.url', req.url);
            if (currentSpan?.attributes['ui.action']) {
              span.setAttribute('ui.action', currentSpan.attributes['ui.action']);
            }
            if (currentSpan) {
              span.setParent(currentSpan);
            }
          }
        }),
        new MongoDBInstrumentation({
          enabled: true,
          enhancedDatabaseReporting: true,
          applyCustomAttributesOnSpan: (span, operation, attributes) => {
            const currentSpan = trace.getSpan(context.active());
            span.setAttribute('db.operation', operation);
            span.setAttribute('db.system', 'mongodb');
            span.setAttribute('db.name', attributes.dbName || 'unknown');
            span.setAttribute('db.collection', attributes.collection || 'unknown');
            if (currentSpan?.attributes['ui.action']) {
              span.setAttribute('ui.action', currentSpan.attributes['ui.action']);
            }
            if (currentSpan) {
              span.setParent(currentSpan);
            }
          },
          startSpanHook: (operation, attributes) => {
            const currentSpan = trace.getSpan(context.active());
            const spanContext = currentSpan ? currentSpan.spanContext() : undefined;
            return {
              name: `mongodb.${operation}`,
              kind: SpanKind.CLIENT,
              attributes: {
                'db.operation': operation,
                'db.system': 'mongodb',
                'db.name': attributes.dbName || 'unknown',
                'db.collection': attributes.collection || 'unknown',
                'ui.action': currentSpan?.attributes['ui.action'] || 'unknown'
              },
              parent: spanContext
            };
          }
        })
      ]
    });

    // Override the tracer to ensure proper context propagation
    const originalGetTracer = trace.getTracer;
    trace.getTracer = function(name, version) {
      const tracer = originalGetTracer(name, version);
      const originalStartSpan = tracer.startSpan;
      tracer.startSpan = function(name, options, context) {
        const currentSpan = trace.getSpan(context || trace.getActiveSpan());
        if (currentSpan) {
          options = options || {};
          options.parent = currentSpan;
          // Propagate UI action attribute
          if (currentSpan.attributes['ui.action']) {
            options.attributes = {
              ...options.attributes,
              'ui.action': currentSpan.attributes['ui.action']
            };
          }
        }
        return originalStartSpan.call(this, name, options, context);
      };
      return tracer;
    };

    sdk.start();
    logger.info('OpenTelemetry SDK started successfully');

    // Create another test span after SDK initialization
    const postInitSpan = tracer.startSpan('post-init-test-span');
    postInitSpan.setAttribute('test.phase', 'post-initialization');
    postInitSpan.end();

    logger.info({
      msg: 'Created post-initialization test span',
      span: {
        name: postInitSpan.name,
        traceId: postInitSpan.spanContext().traceId,
        spanId: postInitSpan.spanContext().spanId
      }
    });

    // Log active spans periodically
    setInterval(() => {
      const currentSpan = trace.getSpan(context.active());
      logger.info({
        msg: 'OpenTelemetry Status',
        stats: {
          enabled: process.env.OTEL_ENABLED === 'true',
          samplingRate: process.env.OTEL_SAMPLING_RATE,
          instrumentations: {
            http: process.env.OTEL_INSTRUMENT_HTTP === 'true',
            express: process.env.OTEL_INSTRUMENT_EXPRESS === 'true',
            mongodb: process.env.OTEL_INSTRUMENT_MONGODB === 'true'
          },
          currentSpan: currentSpan ? {
            name: currentSpan.name,
            traceId: currentSpan.spanContext().traceId,
            spanId: currentSpan.spanContext().spanId
          } : null
        }
      });
    }, 5000);

    // Log span export status periodically
    setInterval(() => {
      logger.info({
        msg: 'Span Export Status',
        stats: {
          exportCount: spanProcessor.exportCount,
          successfulExports: spanProcessor.successfulExports,
          failedExports: spanProcessor.failedExports,
          totalSpansExported: spanProcessor.totalSpansExported,
          totalBatchesExported: spanProcessor.totalBatchesExported,
          successRate: spanProcessor.successfulExports + spanProcessor.failedExports > 0 ?
            `${((spanProcessor.successfulExports / (spanProcessor.successfulExports + spanProcessor.failedExports)) * 100).toFixed(2)}%` :
            'N/A'
        }
      });
    }, 10000);

    process.on('SIGTERM', () => {
      try {
        sdk.shutdown();
        logger.info('OpenTelemetry SDK shut down successfully');
        process.exit(0);
      } catch (error) {
        logger.error({
          msg: 'Error shutting down OpenTelemetry SDK',
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: error.cause ? {
              name: error.cause.name,
              message: error.cause.message,
              stack: error.cause.stack
            } : undefined
          }
        });
        process.exit(1);
      }
    });

    // Export the wrapWithSpan function
    module.exports = {
      initTracing,
      metrics,
      requestCounter,
      responseTimeHistogram,
      exportBatchCounter,
      exportErrorCounter,
      activeSpansGauge,
      wrapWithSpan
    };
  } catch (error) {
    logger.error({
      msg: 'Error initializing OpenTelemetry SDK',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause ? {
          name: error.cause.name,
          message: error.cause.message,
          stack: error.cause.stack
        } : undefined
      }
    });
  }
}

module.exports = {
  initTracing,
  metrics,
  requestCounter,
  responseTimeHistogram,
  exportBatchCounter,
  exportErrorCounter,
  activeSpansGauge,
  wrapWithSpan
}; 
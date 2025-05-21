import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SimpleSpanProcessor, BatchSpanProcessor, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { metrics, ValueType } from '@opentelemetry/api-metrics';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { logs } from '@opentelemetry/api-logs';
import logger from './logger.js';
import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';

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

// Initialize tracer based on OTEL_ENABLED
if (process.env.OTEL_ENABLED !== 'true') {
  tracer = trace.getTracer('no-op-tracer');
} else {
  tracer = trace.getTracer('api-testing-tracer');
}

// Function to create a parent span for API operations
function createAPIOperationSpan(operationName, attributes = {}) {
  if (process.env.OTEL_ENABLED !== 'true') {
    return context.active();
  }

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
  if (process.env.OTEL_ENABLED !== 'true') {
    return null;
  }

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
  if (process.env.OTEL_ENABLED !== 'true') {
    return operation();
  }

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

async function initTracing() {
  if (process.env.OTEL_ENABLED !== 'true') {
    logger.info('OpenTelemetry is disabled');
    return;
  }

  try {
    // Create a resource with service information
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'api-testing-tool',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || '1.0.7',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production'
    });

    // Initialize the Logger Provider
    const loggerProvider = new LoggerProvider({
      resource: resource
    });

    // Create and configure the OTLP log exporter
    const logExporter = new OTLPLogExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`
    });

    // Add the log processor to the logger provider
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(logExporter)
    );

    // Set the global logger provider
    logs.setGlobalLoggerProvider(loggerProvider);

    // Check if providers are already registered
    const hasMeterProvider = !!metrics.getMeterProvider();
    const hasTracerProvider = !!trace.getTracerProvider();

    if (hasMeterProvider || hasTracerProvider) {
      logger.warn('OpenTelemetry providers already registered, skipping initialization');
      return;
    }

    // Create the SDK instance
    const sdk = new NodeSDK({
      resource: resource,
      traceExporter: new OTLPTraceExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
      }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`
        }),
        exportIntervalMillis: 1000
      }),
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (request) => {
            // Ignore health check requests
            return request.url === '/health';
          },
          requestHook: (span, request) => {
            // Only add query and body if they are simple objects
            if (request.query && typeof request.query === 'object') {
              try {
                span.setAttribute('http.query', JSON.stringify(request.query));
              } catch (error) {
                // Ignore serialization errors
              }
            }
            if (request.body && typeof request.body === 'object') {
              try {
                span.setAttribute('http.body', JSON.stringify(request.body));
              } catch (error) {
                // Ignore serialization errors
              }
            }
          }
        }),
        new ExpressInstrumentation(),
        new MongoDBInstrumentation()
      ],
      sampler: new TraceIdRatioBasedSampler(1.0)
    });

    await sdk.start();
    logger.info('OpenTelemetry SDK started successfully');

    // Log a test message to verify logging is working
    const testLogger = logs.getLogger('api-testing-tool');
    testLogger.emit({
      severityText: 'INFO',
      body: 'OpenTelemetry logging initialized',
      attributes: {
        'service.name': process.env.OTEL_SERVICE_NAME || 'api-testing-tool',
        'service.version': process.env.OTEL_SERVICE_VERSION || '1.0.7',
        'environment': process.env.NODE_ENV || 'production'
      }
    });

  } catch (error) {
    logger.error({
      msg: 'Failed to initialize OpenTelemetry',
      error: error.message,
      stack: error.stack
    });
  }
}

export { initTracing, wrapWithSpan }; 
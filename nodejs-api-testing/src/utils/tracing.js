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
        samplingRate: process.env.OTEL_SAMPLING_RATE
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
            successRate: `${((this.successfulExports / (this.successfulExports + this.failedExports)) * 100).toFixed(2)}%`
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
            stack: error.stack
          },
          exportStats: {
            currentBatchSize: spans.length,
            totalSpansExported: this.totalSpansExported,
            totalSuccessfulExports: this.successfulExports,
            totalFailedExports: this.failedExports,
            successRate: `${((this.successfulExports / (this.successfulExports + this.failedExports)) * 100).toFixed(2)}%`
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
    const traceExporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: {
        'Authorization': process.env.OTEL_EXPORTER_OTLP_HEADERS
      },
      compression: 'gzip'
    });

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'api-testing-ui',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || '1.0.7',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production'
      }),
      spanProcessor: new LoggingBatchSpanProcessor(traceExporter, {
        maxQueueSize: parseInt(process.env.OTEL_BSP_MAX_QUEUE_SIZE || '2048'),
        scheduledDelayMillis: parseInt(process.env.OTEL_BSP_SCHEDULE_DELAY || '1000'),
        exportTimeoutMillis: parseInt(process.env.OTEL_BSP_EXPORT_TIMEOUT || '30000'),
        maxExportBatchSize: parseInt(process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE || '512')
      }),
      instrumentations: [
        new HttpInstrumentation({
          enabled: process.env.OTEL_INSTRUMENT_HTTP === 'true'
        }),
        new ExpressInstrumentation({
          enabled: process.env.OTEL_INSTRUMENT_EXPRESS === 'true'
        }),
        new MongoDBInstrumentation({
          enabled: process.env.OTEL_INSTRUMENT_MONGODB === 'true'
        })
      ],
      sampler: new TraceIdRatioBasedSampler(parseFloat(process.env.OTEL_SAMPLING_RATE || '0.2'))
    });

    sdk.start();
    logger.info('OpenTelemetry SDK started successfully');

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
            stack: error.stack
          }
        });
        process.exit(1);
      }
    });
  } catch (error) {
    logger.error({
      msg: 'Error initializing OpenTelemetry SDK',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
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
  activeSpansGauge
}; 
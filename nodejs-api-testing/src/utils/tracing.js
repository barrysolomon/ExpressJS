const opentelemetry = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { ParentBasedSampler, TraceIdRatioBased } = require('@opentelemetry/sdk-trace-base');
const logger = require('./logger');

function initTracing() {
  if (process.env.OTEL_ENABLED !== 'true') {
    logger.info('OpenTelemetry is disabled. Skipping initialization.');
    return;
  }

  logger.info('Starting OpenTelemetry initialization...');
  logger.info('OpenTelemetry Configuration:', {
    samplingRate: process.env.OTEL_SAMPLING_RATE,
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: process.env.OTEL_SERVICE_NAME,
    serviceVersion: process.env.OTEL_SERVICE_VERSION,
    propagators: process.env.OTEL_PROPAGATORS,
    logLevel: process.env.OTEL_LOG_LEVEL,
    instrumentations: {
      http: process.env.OTEL_INSTRUMENT_HTTP === 'true',
      express: process.env.OTEL_INSTRUMENT_EXPRESS === 'true',
      mongodb: process.env.OTEL_INSTRUMENT_MONGODB === 'true',
      axios: process.env.OTEL_INSTRUMENT_AXIOS === 'true'
    }
  });

  try {
    // Create sampler
    const samplingRate = parseFloat(process.env.OTEL_SAMPLING_RATE || '1.0');
    logger.info(`Creating sampler with rate: ${samplingRate}`);
    const sampler = new ParentBasedSampler({
      root: new TraceIdRatioBased(samplingRate)
    });

    // Create resource
    logger.info('Creating OpenTelemetry resource...');
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'api-testing-ui',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || '1.0.0',
    });

    // Create exporter
    logger.info('Creating OTLP exporter...');
    const exporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS) : {},
    });

    // Get auto instrumentations with individual control
    logger.info('Loading auto instrumentations...');
    const instrumentations = getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        enabled: process.env.OTEL_INSTRUMENT_HTTP === 'true',
      },
      '@opentelemetry/instrumentation-express': {
        enabled: process.env.OTEL_INSTRUMENT_EXPRESS === 'true',
      },
      '@opentelemetry/instrumentation-mongodb': {
        enabled: process.env.OTEL_INSTRUMENT_MONGODB === 'true',
      },
      '@opentelemetry/instrumentation-axios': {
        enabled: process.env.OTEL_INSTRUMENT_AXIOS === 'true',
      },
    });

    const enabledInstrumentations = instrumentations
      .filter(i => i.enabled)
      .map(i => i.instrumentationName);
    
    logger.info('Enabled instrumentations:', enabledInstrumentations);

    // Initialize SDK
    logger.info('Initializing OpenTelemetry SDK...');
    const sdk = new opentelemetry.NodeSDK({
      resource,
      sampler,
      spanProcessor: new SimpleSpanProcessor(exporter),
      instrumentations,
    });

    // Start SDK
    logger.info('Starting OpenTelemetry SDK...');
    sdk.start()
      .then(() => {
        logger.info('OpenTelemetry SDK started successfully');
        logger.info('Tracing enabled for:', {
          http: process.env.OTEL_INSTRUMENT_HTTP === 'true',
          express: process.env.OTEL_INSTRUMENT_EXPRESS === 'true',
          mongodb: process.env.OTEL_INSTRUMENT_MONGODB === 'true',
          axios: process.env.OTEL_INSTRUMENT_AXIOS === 'true'
        });
      })
      .catch((error) => {
        logger.error('Error starting OpenTelemetry SDK:', error);
      });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM. Shutting down OpenTelemetry SDK...');
      sdk.shutdown()
        .then(() => {
          logger.info('OpenTelemetry SDK shut down successfully');
          process.exit(0);
        })
        .catch((error) => {
          logger.error('Error shutting down OpenTelemetry SDK:', error);
          process.exit(1);
        });
    });

  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry:', error);
  }
}

module.exports = { initTracing }; 
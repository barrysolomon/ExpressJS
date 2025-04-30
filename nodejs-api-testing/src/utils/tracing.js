const opentelemetry = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { SimpleSpanProcessor, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');

// Check if OpenTelemetry is enabled
const isOtelEnabled = process.env.OTEL_ENABLED === 'true';

if (!isOtelEnabled) {
  console.log('OpenTelemetry instrumentation is disabled');
  module.exports = {
    start: () => console.log('OpenTelemetry is disabled, no-op start'),
    shutdown: () => Promise.resolve()
  };
  return;
}

// Get sampling rate from environment variable, default to 1.0 (100%)
const samplingRate = parseFloat(process.env.OTEL_SAMPLING_RATE || '1.0');

// Create a sampler based on the sampling rate
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(samplingRate),
});

// Parse headers from environment variable
const parseHeaders = (headersStr) => {
  if (!headersStr) return {};
  return headersStr.split(',').reduce((acc, header) => {
    const [key, value] = header.split('=');
    acc[key] = value;
    return acc;
  }, {});
};

// Debug log the configuration
const config = {
  enabled: isOtelEnabled,
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
  samplingRate
};
console.log('OpenTelemetry Configuration:', config);

// Create the OTLP exporter with debug logging
class DebugOTLPTraceExporter extends OTLPTraceExporter {
  send(objects, onSuccess, onError) {
    console.log('Attempting to export traces:', {
      spanCount: objects.length,
      endpoint: this.url
    });

    const wrappedSuccess = () => {
      console.log(`Successfully exported ${objects.length} spans`);
      onSuccess();
    };

    const wrappedError = (error) => {
      console.error('Failed to export traces:', {
        error: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details
      });
      onError(error);
    };

    return super.send(objects, wrappedSuccess, wrappedError);
  }
}

// Create the OTLP exporter
const otlpExporter = new DebugOTLPTraceExporter({
  url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
  headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  timeoutMillis: 10000,
  concurrencyLimit: 10
});

// Initialize the SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'api-testing-ui',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  sampler: sampler,
  spanProcessors: [new BatchSpanProcessor(otlpExporter, {
    maxQueueSize: 2048,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  })],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-mongodb': { enabled: true },
    }),
  ],
});

// Start the SDK only if it hasn't been started yet
if (!global.__OPENTELEMETRY_SDK_STARTED__) {
  try {
    sdk.start();
    console.log('OpenTelemetry SDK started successfully');
    global.__OPENTELEMETRY_SDK_STARTED__ = true;
  } catch (error) {
    console.error('Error starting OpenTelemetry SDK:', error);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

module.exports = sdk; 
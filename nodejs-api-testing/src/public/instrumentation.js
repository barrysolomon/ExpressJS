import { BatchSpanProcessor, WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "@opentelemetry/semantic-conventions/incubating";
import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web";

const tracerProvider = new WebTracerProvider({
  resource: {
    attributes: {
      // TODO update these values with ones that make sense for your application
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: "production",
      [ATTR_SERVICE_NAME]: "my-website",
      [ATTR_SERVICE_VERSION]: "1.0.0",
    },
  },
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: "https://ingress.us-west-2.aws.dash0.com/v1/traces",
        headers: {
          // TODO we **highly** recommend that you use an auth token with restricted permissions for
          // in-browser telemetry collection. Within the auth token settings screen, you can restrict
          // an auth token to a single dataset and **only ingesting** permissions.
          Authorization: "Bearer auth_HvdEv1AswFrSJFC2KwgvmdeZGXSE00i6",
        },
      }),
      {
        maxQueueSize: 100, // The maximum queue size. After the size is reached, spans are dropped.
        maxExportBatchSize: 10, // The maximum batch size of every export. It must be smaller or equal to maxQueueSize.
        scheduledDelayMillis: 500, // The interval between two consecutive exports
        exportTimeoutMillis: 30000, // How long the export can run before it is cancelled
      }
    ),
  ],
});

tracerProvider.register({
  // Changing default context manager to use ZoneContextManager. This one supports tracking of asynchronous operations.
  // Optional, but recommended for better correlation.
  contextManager: new ZoneContextManager(),
});

// Registering instrumentations
registerInstrumentations({
  instrumentations: [
    // You can configure all the auto-instrumentations via this function's parameter.
    // Learn more via this documentation: https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-web
    getWebAutoInstrumentations(),
  ],
});
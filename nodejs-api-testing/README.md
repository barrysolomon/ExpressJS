# API Testing Tool

A modern web-based API testing tool built with Express.js, featuring OpenTelemetry integration for comprehensive observability.

## Features

- **Modern UI**: Clean, responsive interface built with Bootstrap 5
- **Real-time Testing**: Test APIs with various HTTP methods (GET, POST, PUT, DELETE)
- **Request History**: Save and manage your API test history
- **Header Management**: Easy header configuration with presets
- **Response Visualization**: Clear display of response status, headers, and body
- **OpenTelemetry Integration**: Comprehensive observability with traces, metrics, and logs
- **MongoDB Integration**: Persistent storage of request history
- **Kubernetes Ready**: Deployable to Kubernetes clusters

## Prerequisites

- Node.js v18.19.0 or higher
- MongoDB (optional, for persistent storage)
- Docker
- Kubernetes cluster (for deployment)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd nodejs-api-testing
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your configuration:
```env
# Application Configuration
NODE_ENV=production
PORT=3000
LOG_LEVEL=debug
MONGODB_URI=mongodb://localhost:27017/api-testing

# OpenTelemetry Configuration
OTEL_ENABLED=true
OTEL_SERVICE_NAME=api-testing-tool
OTEL_SERVICE_VERSION=1.0.7
OTEL_SAMPLING_RATE=1.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=Authorization=your-token

# Instrumentation Control
OTEL_INSTRUMENT_HTTP=true
OTEL_INSTRUMENT_EXPRESS=true
OTEL_INSTRUMENT_MONGODB=true
```

## Development

Start the development server:
```bash
npm run dev
```

## Building

Build the Docker image:
```bash
docker build -t api-testing-tool .
```

## Deployment

1. Ensure your Kubernetes cluster is running and configured
2. Deploy the OpenTelemetry collector:
```bash
kubectl apply -f k8s/otel-collector-config-with-loki.yaml
kubectl apply -f k8s/otel-collector-deployment-with-loki.yaml
kubectl apply -f k8s/otel-collector-service.yaml
```

3. Deploy the application:
```bash
kubectl apply -f k8s/app.yaml
```

## Observability

The application is configured with OpenTelemetry for comprehensive observability:

### Traces
- HTTP request/response tracing
- Express middleware tracing
- MongoDB operation tracing
- Custom span creation for business operations

### Metrics
- HTTP request counts
- Response time histograms
- Export batch statistics
- Active spans gauge

### Logs
- Application logs
- HTTP request/response logs
- Error logs
- OpenTelemetry SDK logs

### Visualization
- Grafana dashboards for metrics and logs
- Trace visualization in your preferred backend
- Log aggregation with Loki

## Environment Variables

### Application Configuration
- `NODE_ENV`: Environment (development/production)
- `PORT`: Application port
- `LOG_LEVEL`: Logging level (debug/info/warn/error)
- `MONGODB_URI`: MongoDB connection string

### OpenTelemetry Configuration
- `OTEL_ENABLED`: Enable/disable OpenTelemetry
- `OTEL_SERVICE_NAME`: Service name for telemetry
- `OTEL_SERVICE_VERSION`: Service version
- `OTEL_SAMPLING_RATE`: Trace sampling rate
- `OTEL_EXPORTER_OTLP_ENDPOINT`: OTLP endpoint
- `OTEL_EXPORTER_OTLP_HEADERS`: OTLP headers

### Instrumentation Control
- `OTEL_INSTRUMENT_HTTP`: Enable HTTP instrumentation
- `OTEL_INSTRUMENT_EXPRESS`: Enable Express instrumentation
- `OTEL_INSTRUMENT_MONGODB`: Enable MongoDB instrumentation

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 
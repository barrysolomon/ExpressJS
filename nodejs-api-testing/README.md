# API Testing Tool

A modern, feature-rich API testing tool built with Node.js, Express, and OpenTelemetry for comprehensive observability.

## Features

- 🚀 **Modern UI**: Clean, responsive interface built with Bootstrap 5
  - Resizable response panels
  - Syntax highlighting with CodeMirror
  - Dark mode support
  - Responsive design for all devices
- 📝 **Request Builder**: 
  - Support for all HTTP methods
  - JSON request body editor with syntax highlighting
  - Custom headers management
  - Header presets for common use cases
  - Default templates for common APIs
- 📊 **Response Viewer**:
  - Formatted JSON response display
  - Response headers inspection
  - Response time tracking
  - Status code highlighting
  - Resizable response panels
  - Syntax highlighting for response data
- 📚 **Request History**:
  - Automatic request logging
  - Request replay functionality
  - History management (load/delete)
  - MongoDB persistence (optional)
  - Request details view
  - Batch operations support
- 🔍 **Observability**:
  - OpenTelemetry integration
  - Distributed tracing
  - Metrics collection
  - Structured logging
  - Prometheus metrics endpoint
  - Grafana dashboards
  - Loki log aggregation

## Prerequisites

- Node.js 16+
- Docker
- Kubernetes cluster (for deployment)
- MongoDB (optional, for request history persistence)
- OpenTelemetry Collector
- Grafana (for visualization)
- Prometheus (for metrics)
- Loki (for logs)

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

2. Set up the observability stack:

   a. Create the observability namespace:
   ```bash
   kubectl create namespace observability
   ```

   b. Set up Grafana persistent storage:
   ```bash
   kubectl apply -f k8s/grafana-pv.yaml
   ```

   c. Deploy Prometheus and Grafana using Helm:
   ```bash
   helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
   helm repo update
   helm install prometheus prometheus-community/kube-prometheus-stack -n observability
   ```

   d. Deploy Loki:
   ```bash
   kubectl apply -f k8s/loki-deployment.yaml
   ```

   e. Deploy OpenTelemetry Collector:
   ```bash
   # Apply the config first
   kubectl apply -f k8s/otel-collector-config-with-loki.yaml

   # Then apply the deployment
   kubectl apply -f k8s/otel-collector-deployment-with-loki.yaml

   # Apply the service
   kubectl apply -f k8s/otel-collector-service.yaml
   
   # Apply the ServiceMonitor (for Prometheus to discover the collector)
   kubectl apply -f k8s/otel-collector-servicemonitor.yaml
   ```

   f. Configure Grafana Dashboards and Datasources:
   ```bash
   # Apply Loki as a datasource
   kubectl apply -f k8s/loki-datasource.yaml

   # Apply the dashboards
   kubectl apply -f k8s/grafana-dashboards.yaml
   ```

3. Deploy MongoDB (optional):
   ```bash
   kubectl apply -f k8s/mongodb.yaml
   ```

4. Deploy the application:
   ```bash
   kubectl apply -f k8s/app.yaml
   ```

## Environment Variables

### Application Configuration
- `NODE_ENV`: Environment (development/production)
- `PORT`: Server port (default: 3000)
- `LOG_LEVEL`: Logging level (default: info)
- `MONGODB_URI`: MongoDB connection string (optional)

### OpenTelemetry Configuration
- `OTEL_ENABLED`: Enable/disable OpenTelemetry (default: true)
- `OTEL_SERVICE_NAME`: Service name (default: api-testing-tool)
- `OTEL_SERVICE_VERSION`: Service version (default: 1.0.7)
- `OTEL_EXPORTER_OTLP_ENDPOINT`: OTLP endpoint URL
- `OTEL_SAMPLING_RATE`: Trace sampling rate (default: 1.0)
- `OTEL_TRACES_SAMPLER`: Trace sampler type (default: traceidratio)
- `OTEL_TRACES_SAMPLER_ARG`: Trace sampler argument (default: 1.0)
- `OTEL_EXPORTER_OTLP_COMPRESSION`: OTLP compression (default: gzip)
- `OTEL_EXPORT_TIMEOUT`: Export timeout in milliseconds (default: 30000)
- `OTEL_EXPORT_CONCURRENCY`: Export concurrency (default: 1)
- `OTEL_RETRY_INITIAL_DELAY`: Initial retry delay in milliseconds (default: 1000)
- `OTEL_RETRY_MAX_DELAY`: Maximum retry delay in milliseconds (default: 5000)
- `OTEL_RETRY_MAX_ATTEMPTS`: Maximum retry attempts (default: 5)
- `OTEL_RETRY_BACKOFF_MULTIPLIER`: Retry backoff multiplier (default: 1.5)
- `OTEL_BSP_MAX_QUEUE_SIZE`: Maximum batch span processor queue size (default: 2048)
- `OTEL_BSP_SCHEDULE_DELAY`: Batch span processor schedule delay in milliseconds (default: 1000)
- `OTEL_BSP_EXPORT_TIMEOUT`: Batch span processor export timeout in milliseconds (default: 30000)
- `OTEL_BSP_MAX_EXPORT_BATCH_SIZE`: Maximum batch span processor export batch size (default: 512)
- `OTEL_PROPAGATORS`: Trace propagators (default: b3)

### Instrumentation Control
- `OTEL_INSTRUMENT_HTTP`: Enable HTTP instrumentation
- `OTEL_INSTRUMENT_EXPRESS`: Enable Express instrumentation
- `OTEL_INSTRUMENT_MONGODB`: Enable MongoDB instrumentation

## Kubernetes Deployment

The application is configured for Kubernetes deployment with the following components:

### 1. Application Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-testing-tool
  namespace: nodejs
```

### 2. OpenTelemetry Collector
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
  namespace: observability
```

### 3. Service Configuration
```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-testing-tool
  namespace: nodejs
```

### 4. MongoDB Deployment (Optional)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb
  namespace: nodejs
```

## Observability Stack

The application integrates with a comprehensive observability stack:

### OpenTelemetry Collector
- Receives telemetry data (traces, metrics, logs)
- Processes and exports to various backends
- Configured with:
  - OTLP receivers (gRPC/HTTP)
  - Batch processing
  - Memory limiting
  - Resource attribution

### Metrics
- HTTP request counts
- Response time histograms
- Export batch statistics
- Active spans tracking
- Span drop rate monitoring
- Failed span count tracking

### Logging
- Structured logging with Pino
- OpenTelemetry log integration
- HTTP request/response logging
- Error tracking
- Log aggregation with Loki

### Visualization
- Grafana dashboards for metrics and logs
- Trace visualization in your preferred backend
- Log aggregation with Loki
- Custom dashboards for:
  - Spans received rate
  - Span drop rate
  - Failed span count
  - Response time distributions
  - Request counts by endpoint

## Recent Updates

### Version 1.0.7
- Fixed request ID handling in history management
- Improved error handling for undefined request properties
- Enhanced OpenTelemetry collector configuration
- Added fallback ID generation for temporary requests
- Improved UI responsiveness
- Added resizable response panels
- Enhanced syntax highlighting
- Added dark mode support

## Development

### Available Scripts
- `npm start`: Start the production server
- `npm run dev`: Start the development server with hot reload
- `npm run debug`: Start with Node.js inspector

### Code Structure
```
src/
├── index.js           # Application entry point
├── routes/           # API routes
├── models/           # Database models
├── middleware/       # Express middleware
├── utils/           # Utility functions
│   ├── tracing.js   # OpenTelemetry setup
│   └── logger.js    # Logging configuration
└── views/           # EJS templates
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details 
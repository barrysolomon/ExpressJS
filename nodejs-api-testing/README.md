# API Testing Tool

A web-based API testing tool built with Node.js, Express, and MongoDB. This tool allows you to make HTTP requests to any API endpoint and view the responses in a user-friendly interface.

## Features

- Make HTTP requests (GET, POST, PUT, DELETE)
- Customize request headers and body
- View response headers and body
- Save request history in MongoDB
- Track request status (pending, completed, failed)
- Beautiful UI with Bootstrap and CodeMirror
- Flexible deployment options (Docker, Kubernetes, or standalone)

## Prerequisites

- Node.js (v14 or higher) for local development
- Docker and Docker Compose for containerized deployment
- Kubernetes cluster (optional) for orchestrated deployment
- MongoDB (can be deployed separately or as part of the stack)

## Deployment Options

The application can be deployed in multiple ways, and different deployment methods can communicate with each other. For example, you can run the application in Kubernetes while connecting to a MongoDB instance running in Docker, or vice versa.

### Option 1: Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

2a. Start the development server (with OTEL, Sampling 20%):
```bash
OTEL_ENABLED=true OTEL_SAMPLING_RATE=0.2 OTEL_EXPORTER_OTLP_ENDPOINT=https://ga-otlp.lumigo-tracer-edge.golumigo.com OTEL_EXPORTER_OTLP_HEADERS="Authorization=LumigoToken t_f8f7b905da964eef89261" OTEL_EXPORTER_OTLP_METRICS_ENABLED=false npm run dev
```

2b. Start the development server (without OTEL):
```bash
OTEL_ENABLED=false OTEL_SAMPLING_RATE=1.0 OTEL_EXPORTER_OTLP_ENDPOINT=https://ga-otlp.lumigo-tracer-edge.golumigo.com OTEL_EXPORTER_OTLP_HEADERS="Authorization=LumigoToken t_f8f7b905da964eef89261" OTEL_EXPORTER_OTLP_METRICS_ENABLED=false npm run dev
```

The application will be available at `http://localhost:3000`

### Option 2: Docker Deployment

#### Build the Container
```bash
# Build the Docker image
docker build -t api-testing-tool .
```

#### Run with External MongoDB
```bash
# Run with MongoDB connection (can be a Kubernetes MongoDB service)
docker run -d \
  -p 3000:3000 \
  -e MONGODB_URI=mongodb://your-mongodb-host:27017/api-testing \
  -e PORT=3000 \
  --name api-testing \
  api-testing-tool
```

#### Run with Docker Compose (includes MongoDB)
```bash
# Start the application and MongoDB
docker-compose up -d
```

### Option 3: Kubernetes Deployment

The application includes Kubernetes manifests in the `k8s` directory.

#### Deploy Everything in Kubernetes
```bash
# Create namespace
kubectl create namespace nodejs

# Deploy MongoDB and application
kubectl apply -f k8s/
```

#### Deploy Only the Application (with External MongoDB)
```bash
# Create namespace
kubectl create namespace nodejs

# Deploy only the application
docker build -t api-testing-tool .
kubectl delete -f k8s/app.yaml
kubectl apply -f k8s/app.yaml
```

kubectl wait --for=condition=available --timeout=300s deployment/mongodb -n nodejs
kubectl wait --for=condition=available --timeout=300s deployment/api-testing-ui -n nodejs

## Cross-Environment Communication

The application can communicate between different deployment environments. Here are some common scenarios:

### 1. Kubernetes App → Docker MongoDB
```bash
# Run MongoDB in Docker
docker run -d \
  -p 27017:27017 \
  --name mongodb \
  mongo:latest

# Deploy app to Kubernetes with Docker MongoDB connection
kubectl apply -f k8s/app.yaml
# Update MONGODB_URI in the deployment to point to your Docker MongoDB
```

### 2. Docker App → Kubernetes MongoDB
```bash
# Deploy MongoDB to Kubernetes
kubectl apply -f k8s/mongodb.yaml

# Run app in Docker with Kubernetes MongoDB connection
docker run -d \
  -p 3000:3000 \
  -e MONGODB_URI=mongodb://mongodb.nodejs.svc.cluster.local:27017/api-testing \
  -e PORT=3000 \
  --name api-testing \
  api-testing-tool
```

## Environment Variables

- `PORT`: The port the application runs on (default: 3000)
- `MONGODB_URI`: MongoDB connection string (required for database mode)
- `LOG_LEVEL`: Logging level (default: 'info')

## Troubleshooting

### MongoDB Connection Issues

1. Check MongoDB status:
```bash
# For Docker
docker ps | grep mongodb
docker logs mongodb

# For Kubernetes
kubectl get pods -n nodejs -l app=mongodb
kubectl logs -n nodejs -l app=mongodb
```

2. Test MongoDB connection:
```bash
# For Docker
docker exec -it mongodb mongosh

# For Kubernetes
kubectl exec -n nodejs -it $(kubectl get pod -n nodejs -l app=mongodb -o jsonpath="{.items[0].metadata.name}") -- mongosh
```

### Application Issues

1. Check application status:
```bash
# For Docker
docker ps | grep api-testing
docker logs api-testing

# For Kubernetes
kubectl get pods -n nodejs -l app=api-testing-ui
kubectl logs -n nodejs -l app=api-testing-ui
```

2. Verify environment variables:
```bash
# For Docker
docker exec api-testing env | grep MONGODB_URI

# For Kubernetes
kubectl exec -n nodejs -it $(kubectl get pod -n nodejs -l app=api-testing-ui -o jsonpath="{.items[0].metadata.name}") -- env | grep MONGODB_URI
```

## API Endpoints

- `GET /`: Main application interface
- `POST /api/test`: Make an API request
- `GET /api/history`: Get request history
- `DELETE /api/history`: Clear request history
- `DELETE /api/requests/:id`: Delete a specific request

## License

MIT 
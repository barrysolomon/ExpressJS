# API Testing UI

A web application for testing API calls with MongoDB integration and Kubernetes deployment.

## Features

- Modern UI for making API requests
- Support for GET, POST, PUT, DELETE methods
- Request history stored in MongoDB
- Kubernetes deployment ready
- Default test endpoint to JSONPlaceholder API

## Prerequisites

- Node.js 18+
- Docker
- Kubernetes cluster
- kubectl configured to access your cluster

## Building the Application

1. Install dependencies:
```bash
npm install
```

2. Build the Docker image:
```bash
docker build -t api-testing-ui:latest .
```

## Local Development

1. Start MongoDB:
```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

2. Start the application:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Kubernetes Deployment

1. Deploy to the nodejs namespace:
```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/mongodb.yaml
kubectl apply -f k8s/app.yaml
```

2. Get the application URL:
```bash
kubectl get service -n nodejs api-testing-ui
```

The application will be available at the LoadBalancer IP (e.g., `http://198.19.249.2`)

## Debugging

### Common Issues

1. **MongoDB Connection Issues**
   - Check MongoDB pod status:
     ```bash
     kubectl get pods -n nodejs -l app=mongodb
     ```
   - View MongoDB logs:
     ```bash
     kubectl logs -n nodejs -l app=mongodb
     ```

2. **Application Issues**
   - Check application pod status:
     ```bash
     kubectl get pods -n nodejs -l app=api-testing-ui
     ```
   - View application logs:
     ```bash
     kubectl logs -n nodejs -l app=api-testing-ui
     ```

3. **Service Issues**
   - Check service status:
     ```bash
     kubectl get svc -n nodejs
     ```
   - Check endpoints:
     ```bash
     kubectl get endpoints -n nodejs
     ```

### Useful Commands

- View all resources in nodejs namespace:
  ```bash
  kubectl get all -n nodejs
  ```

- View pod details:
  ```bash
  kubectl describe pod -n nodejs <pod-name>
  ```

- Access application shell:
  ```bash
  kubectl exec -n nodejs -it <pod-name> -- /bin/sh
  ```

- View MongoDB data:
  ```bash
  kubectl exec -n nodejs -it <mongodb-pod-name> -- mongosh api-testing
  ```

## Architecture

- Express.js backend
- MongoDB for data storage
- EJS templating for the UI
- Bootstrap for styling
- Kubernetes for orchestration
- NodeJS namespace for isolation

## Environment Variables

- `MONGODB_URI`: MongoDB connection string (default: mongodb://mongodb.nodejs.svc.cluster.local:27017/api-testing)
- `PORT`: Application port (default: 3000)

## API Endpoints

- `POST /api/test`: Make an API request
- `GET /api/requests`: Get request history
- `GET /api/requests/:id`: Get specific request details
- `GET /`: Main UI 
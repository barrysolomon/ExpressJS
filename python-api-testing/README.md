# Python API Testing UI

A modern, FastAPI-based web application for testing REST APIs with a clean, intuitive interface. This version is built with Python and offers enhanced features compared to the Node.js version.

## Features

- 🚀 Modern FastAPI backend with async/await support
- 🎨 Clean, responsive UI using Bootstrap 5
- 📝 Make HTTP requests (GET, POST, PUT, DELETE)
- 📊 View detailed request/response information
- 📚 Persistent request history with MongoDB
- 🔍 View and replay previous requests
- 📈 Structured logging with structlog
- 🐳 Docker and Kubernetes ready

## Architecture

```
python-api-testing/
├── app/
│   ├── main.py           # FastAPI application
│   ├── models/           # Pydantic models
│   └── utils/            # Utility functions
├── templates/            # Jinja2 templates
│   └── index.html        # Main UI template
├── static/              # Static files
├── k8s/                 # Kubernetes configurations
│   ├── namespace.yaml   # Python namespace
│   ├── mongodb.yaml     # MongoDB deployment
│   └── app.yaml         # Application deployment
├── Dockerfile           # Container configuration
└── requirements.txt     # Python dependencies
```

## Prerequisites

- Python 3.11+
- Docker
- Kubernetes cluster (Docker Desktop, Minikube, or cloud provider)
- MongoDB (deployed via Kubernetes)

## Local Development

1. Clone the repository:
```bash
git clone <repository-url>
cd python-api-testing
```

2. Create a virtual environment and install dependencies:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

3. Set up environment variables:
```bash
export MONGODB_URI=mongodb://localhost:27017/api-testing
export LOG_LEVEL=DEBUG
```

4. Run the application:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The application will be available at `http://localhost:8000`

## Docker Build

Build the Docker image:
```bash
docker build -t python-api-testing-ui:latest .
```

## Kubernetes Deployment

1. Create the Python namespace:
```bash
kubectl apply -f k8s/namespace.yaml
```

2. Deploy MongoDB:
```bash
kubectl apply -f k8s/mongodb.yaml
```

3. Deploy the application:
```bash
kubectl apply -f k8s/app.yaml
```

4. Check the deployment status:
```bash
kubectl get all -n python
```

5. Access the application:
```bash
kubectl get service python-api-testing-ui -n python
```
The application will be available at `http://localhost:<NodePort>` (typically 32623)

## API Endpoints

- `GET /` - Web UI
- `POST /api/request` - Make an API request
- `GET /api/history` - Get request history
- `GET /api/request/{request_id}` - Get request details

## Environment Variables

- `MONGODB_URI`: MongoDB connection string (default: mongodb://localhost:27017/api-testing)
- `LOG_LEVEL`: Logging level (default: INFO)

## Debugging

1. Check pod status:
```bash
kubectl get pods -n python
```

2. View application logs:
```bash
kubectl logs -n python deployment/python-api-testing-ui
```

3. View MongoDB logs:
```bash
kubectl logs -n python deployment/mongodb
```

4. Access MongoDB shell:
```bash
kubectl exec -it -n python deployment/mongodb -- mongosh
```

## Useful Commands

```bash
# Get all resources in Python namespace
kubectl get all -n python

# View detailed pod information
kubectl describe pod -n python <pod-name>

# Delete and recreate deployment
kubectl delete -f k8s/app.yaml && kubectl apply -f k8s/app.yaml

# Port forward to access MongoDB
kubectl port-forward -n python svc/mongodb 27017:27017
```

## Advantages Over Node.js Version

- Better performance with async/await
- Type safety with Pydantic models
- More modern Python ecosystem
- Better structured logging
- Improved error handling
- More maintainable code structure

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License 
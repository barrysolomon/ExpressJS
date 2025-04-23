FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY templates/ app/templates/

ENV PYTHONPATH=/app
ENV LOG_LEVEL=INFO
ENV MONGODB_URI=mongodb://mongodb:27017/api-testing

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"] 
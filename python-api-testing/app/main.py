from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
import aiohttp
import json
import os
import sys
import platform
from dotenv import load_dotenv
from .utils.logger import get_logger, configure_logging
from .models.request import RequestInDB, RequestBase
from datetime import datetime
import pymongo
import fastapi

# Load environment variables
load_dotenv()

# Configure logging
configure_logging(os.getenv("LOG_LEVEL", "INFO"))
logger = get_logger(__name__)

# Initialize FastAPI app
app = FastAPI(title="API Testing UI")

# Templates and static files
templates = Jinja2Templates(directory="app/templates")
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# MongoDB connection
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/api-testing")
client = AsyncIOMotorClient(MONGODB_URI)
db = client.get_database()
requests_collection = db.requests

# Version information
VERSION_INFO = {
    "python_version": f"{platform.python_version()} ({platform.python_implementation()})",
    "fastapi_version": fastapi.__version__,
    "mongodb_version": pymongo.__version__
}

class APIRequest(BaseModel):
    url: str
    method: str
    headers: dict
    body: str = None

@app.on_event("startup")
async def startup_event():
    logger.info("Starting API Testing UI")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down API Testing UI")
    client.close()

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            **VERSION_INFO
        }
    )

@app.post("/api/request")
async def make_request(api_request: APIRequest):
    try:
        # Convert string body to JSON if possible
        body = None
        if api_request.body:
            try:
                body = json.loads(api_request.body)
            except json.JSONDecodeError:
                body = api_request.body

        async with aiohttp.ClientSession() as session:
            async with session.request(
                method=api_request.method,
                url=api_request.url,
                headers=api_request.headers,
                json=body if isinstance(body, dict) else None,
                data=body if not isinstance(body, dict) else None
            ) as response:
                response_body = await response.text()
                try:
                    response_body = json.loads(response_body)
                except json.JSONDecodeError:
                    pass

                # Store request and response in MongoDB
                request_data = {
                    "url": api_request.url,
                    "method": api_request.method,
                    "headers": api_request.headers,
                    "body": body,
                    "response": {
                        "status_code": response.status,
                        "headers": dict(response.headers),
                        "body": response_body
                    },
                    "timestamp": datetime.utcnow()
                }
                await requests_collection.insert_one(request_data)

                return {
                    "status_code": response.status,
                    "headers": dict(response.headers),
                    "body": response_body
                }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history")
async def get_history():
    cursor = requests_collection.find().sort("timestamp", -1).limit(10)
    history = await cursor.to_list(length=10)
    for item in history:
        item["_id"] = str(item["_id"])
    return history

@app.delete("/api/history")
async def clear_history():
    try:
        result = await requests_collection.delete_many({})
        return {"message": f"Cleared {result.deleted_count} requests"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/request/{request_id}")
async def get_request_details(request_id: str):
    from bson import ObjectId
    try:
        request = await requests_collection.find_one({"_id": ObjectId(request_id)})
        if request:
            request["_id"] = str(request["_id"])
            return request
        raise HTTPException(status_code=404, detail="Request not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 
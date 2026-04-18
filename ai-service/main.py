from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

from routers.agent import router as agent_router
from routers.insights import router as insights_router
from routers.feedback import router as feedback_router

app = FastAPI(title="Attune AI Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agent_router,    prefix="/agent")
app.include_router(insights_router, prefix="")
app.include_router(feedback_router, prefix="")

@app.get("/health")
async def health():
    return {"status": "ok"}

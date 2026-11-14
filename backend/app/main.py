import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.archmind.routes import router as arch_router
from app.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="RecallOps API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[get_settings().frontend_origin], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
app.include_router(arch_router)

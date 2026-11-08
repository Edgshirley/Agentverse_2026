"""
Main entry point for the Friend Spreader API (mirrors ../freevo-api/app/src/main.py).

    uvicorn src.main:api --host 0.0.0.0 --port 8000
"""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src import ws_worker
from src.backend.bus import MessageBusSingleton
from src.backend.engine import ENGINE
from src.backend.postgres import PostgresConnectionSingleton
from src.backend.redis import REDIS
from src.config import config
from src.routers import core, engine, ws

logger = logging.getLogger("uvicorn")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # No startup connectivity checks: backends connect lazily on first use
    # and the delivery worker retries on its own.
    logger.info("App startup: starting realtime delivery worker")
    ws_worker_task = asyncio.create_task(ws_worker.run())
    yield
    ws_worker_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await ws_worker_task
    await MessageBusSingleton.close()
    await ENGINE.close()
    await REDIS.close()
    await PostgresConnectionSingleton.close()


api = FastAPI(
    title=config.TITLE,
    version=config.VERSION,
    lifespan=lifespan,
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)

api.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_EXT_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    # `error` is what the UI's dispatcher reads (same key the engine uses).
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "error": exc.detail},
        headers=getattr(exc, "headers", None),
    )


api.include_router(core.router)
api.include_router(ws.router)
# Catch-all gateway to the rules engine: must stay last.
api.include_router(engine.router)

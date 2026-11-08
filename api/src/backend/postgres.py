"""
PostgreSQL async engine singleton, mirrors ../freevo-api/app/src/backend/postgres.py.
"""

import asyncio
from typing import AsyncIterator, Optional
from urllib.parse import quote_plus

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.config import config
from src.exceptions import BadGatewayError, ConflictError

CONNECTION_ERRORS = (OSError, OperationalError, InterfaceError, asyncio.TimeoutError)


class PostgresConnectionSingleton:
    """One async engine + session factory per process."""

    _engine: Optional[AsyncEngine] = None
    _factory: Optional[async_sessionmaker[AsyncSession]] = None

    @staticmethod
    def database_url() -> str:
        return (
            f"postgresql+asyncpg://{quote_plus(config.POSTGRES_USER)}:"
            f"{quote_plus(config.POSTGRES_PASSWORD)}@{config.POSTGRES_HOST}:"
            f"{config.POSTGRES_PORT}/{config.POSTGRES_DB}"
        )

    @classmethod
    def engine(cls) -> AsyncEngine:
        if cls._engine is None:
            cls._engine = create_async_engine(
                cls.database_url(),
                pool_size=config.POSTGRES_POOL_SIZE,
                max_overflow=config.POSTGRES_MAX_OVERFLOW,
                pool_pre_ping=True,
                connect_args={"timeout": 5},
            )
        return cls._engine

    @classmethod
    def session_factory(cls) -> async_sessionmaker[AsyncSession]:
        if cls._factory is None:
            cls._factory = async_sessionmaker(cls.engine(), expire_on_commit=False)
        return cls._factory

    @classmethod
    async def ping(cls) -> bool:
        try:
            async with cls.engine().connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception:  # pylint: disable=broad-except
            return False

    @classmethod
    async def close(cls) -> None:
        if cls._engine is not None:
            engine, cls._engine, cls._factory = cls._engine, None, None
            await engine.dispose()


POSTGRES_ASYNC_SESSION_FACTORY = PostgresConnectionSingleton.session_factory


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, errors mapped to API errors."""

    try:
        async with POSTGRES_ASYNC_SESSION_FACTORY()() as session:
            yield session
    except IntegrityError as e:
        raise ConflictError(detail="Resource conflict occurred") from e
    except CONNECTION_ERRORS as e:
        raise BadGatewayError(detail="Failed to connect to the database") from e

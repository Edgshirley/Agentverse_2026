"""
Configuration module for the MarketMate API (mirrors ../freevo-api/app/src/config.py).
Loads every setting from environment variables.
"""

import logging
import os
import sys
from dataclasses import dataclass

logger = logging.getLogger("uvicorn")


@dataclass
class Configuration:
    """Settings loaded from environment variables."""

    # pylint: disable=too-many-instance-attributes,invalid-name

    ENV: str = os.getenv("ENV", "dev")
    VERSION: str = os.getenv("VERSION") or "0.0.0"
    TITLE: str = os.getenv("TITLE") or "MarketMate API"

    FRONTEND_EXT_URL: str = os.getenv("FRONTEND_EXT_URL", "http://localhost:5173")
    FRONTEND_COOKIE_SECURE: bool = os.getenv("FRONTEND_COOKIE_SECURE") == "true"
    FRONTEND_COOKIE_SAMESITE: str = os.getenv("FRONTEND_COOKIE_SAMESITE") or "lax"

    # Internal URL of the TypeScript rules engine (never exposed publicly)
    ENGINE_URL: str = os.getenv("ENGINE_URL", "http://engine:4000")
    ENGINE_TIMEOUT_SECONDS: float = float(os.getenv("ENGINE_TIMEOUT_SECONDS") or 150)

    # Database Configuration
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: int = int(os.getenv("POSTGRES_PORT") or 5432)
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "spread")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "spread")
    POSTGRES_POOL_SIZE: int = int(os.getenv("POSTGRES_POOL_SIZE") or 2)
    POSTGRES_MAX_OVERFLOW: int = int(os.getenv("POSTGRES_MAX_OVERFLOW") or 3)

    # Keycloak Configuration
    #   KEYCLOAK_URL      what this API calls (docker network)
    #   KEYCLOAK_EXT_URL  what the browser is redirected to
    KEYCLOAK_URL: str = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
    KEYCLOAK_EXT_URL: str = os.getenv("KEYCLOAK_EXT_URL", "http://localhost:8080")
    KEYCLOAK_REALM: str = os.getenv("KEYCLOAK_REALM", "master")
    KEYCLOAK_REDIRECT_URI: str = os.getenv(
        "KEYCLOAK_REDIRECT_URI", "http://localhost:5173/api/v1/system/callback"
    )
    POST_LOGOUT_REDIRECT_URI: str = os.getenv(
        "POST_LOGOUT_REDIRECT_URI", "http://localhost:5173"
    )

    # Keycloak Clients: public frontend client (code exchange / refresh /
    # logout) and confidential backend client (token introspection).
    KEYCLOAK_FRONTEND_CLIENT_ID: str = os.getenv("KEYCLOAK_FRONTEND_CLIENT_ID", "spread-ui")
    KEYCLOAK_BACKEND_CLIENT_ID: str = os.getenv("KEYCLOAK_BACKEND_CLIENT_ID", "spread-api")
    KEYCLOAK_SECRET_PATH: str = os.getenv(
        "KEYCLOAK_SECRET_PATH", "/usr/shared/client-secret.txt"
    )
    KEYCLOAK_CLIENT_SECRET: str = None

    # Redis Configuration (db 2, like freevo-api)
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT") or 6379)
    REDIS_PASSWORD: str = os.getenv("REDIS_PASSWORD") or None
    # TTL of cached cookie sessions. Must be >= the realm's
    # ssoSessionMaxLifespanRememberMe (30 days, kc/configure_keycloak.py).
    SESSION_TTL_SECONDS: int = int(os.getenv("SESSION_TTL_SECONDS") or 30 * 24 * 60 * 60)

    # Real-time message bus backing the WebSocket fan-out ("redis" | "memory").
    # BUS_CHANNEL must match the engine's BUS_CHANNEL.
    MESSAGE_BUS: str = os.getenv("MESSAGE_BUS", "redis")
    BUS_CHANNEL: str = os.getenv("BUS_CHANNEL", "spread-messages")

    def __post_init__(self):
        if self.ENV not in {"prod", "dev", "stg", "test"}:
            logger.error("Environment can only be 'dev', 'prod', 'stg' or 'test'")
            sys.exit(1)

        # prod/stg: secret comes from the environment. dev: kc-config writes it
        # to the shared volume before this container starts.
        self.KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET") or None
        if not self.KEYCLOAK_CLIENT_SECRET and self.ENV == "dev":
            try:
                with open(self.KEYCLOAK_SECRET_PATH, "r", encoding="utf-8") as file:
                    self.KEYCLOAK_CLIENT_SECRET = file.read().strip() or None
            except FileNotFoundError:
                pass

        if not self.KEYCLOAK_CLIENT_SECRET:
            logger.error(
                "Keycloak client secret missing: set KEYCLOAK_CLIENT_SECRET or write %s",
                self.KEYCLOAK_SECRET_PATH,
            )
            sys.exit(1)

        if self.ENV == "dev":
            logger.info("Loading MarketMate API in development mode...")
            width = max(len(k) for k in self.__dict__)
            for key, value in self.__dict__.items():
                if "PASSWORD" in key or "SECRET" in key:
                    value = "***"
                logger.info("%-*s -> %s", width, key, value)


# Global configuration instance
config = Configuration()

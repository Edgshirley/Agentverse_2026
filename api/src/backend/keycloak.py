"""
Keycloak OpenID clients, mirrors ../freevo-api/app/src/backend/keycloak.py.

  KEYCLOAK_FRONTEND_CLIENT()  public client: code exchange, refresh, logout
  KEYCLOAK_OPENID_CLIENT()    confidential backend client: token introspection

Both talk to KEYCLOAK_URL (docker network). Only `auth_url` points the
browser at KEYCLOAK_EXT_URL.
"""

import base64
import hashlib
import secrets
from typing import Optional
from urllib.parse import urlencode

from keycloak import KeycloakOpenID

from src.config import config


class KeycloakClientSingleton:
    _frontend: Optional[KeycloakOpenID] = None
    _backend: Optional[KeycloakOpenID] = None

    @classmethod
    def frontend(cls) -> KeycloakOpenID:
        if cls._frontend is None:
            cls._frontend = KeycloakOpenID(
                server_url=config.KEYCLOAK_URL,
                realm_name=config.KEYCLOAK_REALM,
                client_id=config.KEYCLOAK_FRONTEND_CLIENT_ID,
                client_secret_key=None,
                verify=True,
            )
        return cls._frontend

    @classmethod
    def backend(cls) -> KeycloakOpenID:
        if cls._backend is None:
            cls._backend = KeycloakOpenID(
                server_url=config.KEYCLOAK_URL,
                realm_name=config.KEYCLOAK_REALM,
                client_id=config.KEYCLOAK_BACKEND_CLIENT_ID,
                client_secret_key=config.KEYCLOAK_CLIENT_SECRET,
                verify=True,
            )
        return cls._backend


KEYCLOAK_FRONTEND_CLIENT = KeycloakClientSingleton.frontend
KEYCLOAK_OPENID_CLIENT = KeycloakClientSingleton.backend


def new_pkce_pair() -> tuple[str, str]:
    """(code_verifier, S256 code_challenge) per RFC 7636."""

    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def auth_url(state: str, code_challenge: str) -> str:
    """Browser-facing authorization endpoint (authorization code + PKCE)."""

    params = {
        "client_id": config.KEYCLOAK_FRONTEND_CLIENT_ID,
        "redirect_uri": config.KEYCLOAK_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid profile email",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return (
        f"{config.KEYCLOAK_EXT_URL.rstrip('/')}/realms/{config.KEYCLOAK_REALM}"
        f"/protocol/openid-connect/auth?{urlencode(params)}"
    )

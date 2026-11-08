"""
One-shot Keycloak bootstrap for the dev stack (mirrors ../freevo-api/kc/configure_keycloak.py).

  - confidential backend client (KEYCLOAK_BACKEND_CLIENT_ID): used by the API
    for token introspection; its secret is written to /usr/shared/client-secret.txt
  - public frontend client (KEYCLOAK_FRONTEND_CLIENT_ID): authorization code +
    PKCE login through the API's /api/v1/system/callback
  - an admin user plus the default ring traders (alice, bob, carol, dave)
  - realm session settings matching the API's SESSION_TTL_SECONDS

Safe to re-run: existing clients are updated, existing users are kept.
"""

import os
import sys
import time

from keycloak import KeycloakAdmin, KeycloakAuthenticationError, KeycloakError

# ----------------------------------------- #
#               ENVIRONMENT                 #
# ----------------------------------------- #

ENV = os.getenv("ENV", "dev")

KC_BOOTSTRAP_ADMIN_USERNAME = os.getenv("KC_BOOTSTRAP_ADMIN_USERNAME")
KC_BOOTSTRAP_ADMIN_PASSWORD = os.getenv("KC_BOOTSTRAP_ADMIN_PASSWORD")
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "master")

KC_ADMIN_USERNAME = os.getenv("KC_ADMIN_USERNAME", "admin")
KC_ADMIN_PASSWORD = os.getenv("KC_ADMIN_PASSWORD", "admin")
KC_ADMIN_EMAIL = os.getenv("KC_ADMIN_EMAIL", "admin@spread.local")

KEYCLOAK_BACKEND_CLIENT_ID = os.getenv("KEYCLOAK_BACKEND_CLIENT_ID", "spread-api")
KEYCLOAK_FRONTEND_CLIENT_ID = os.getenv("KEYCLOAK_FRONTEND_CLIENT_ID", "spread-ui")

FRONTEND_EXT_URL = os.getenv("FRONTEND_EXT_URL", "http://localhost:5173").rstrip("/")
KEYCLOAK_REDIRECT_URI = os.getenv(
    "KEYCLOAK_REDIRECT_URI", f"{FRONTEND_EXT_URL}/api/v1/system/callback"
)
POST_LOGOUT_REDIRECT_URI = os.getenv("POST_LOGOUT_REDIRECT_URI", FRONTEND_EXT_URL)

SECRET_PATH = os.getenv("KEYCLOAK_SECRET_PATH", "/usr/shared/client-secret.txt")

SEED_USERS_PASSWORD = os.getenv("SEED_USERS_PASSWORD", "spread123")
SEED_USERS = [
    ("alice", "Alice", "Quant"),
    ("bob", "Bob", "Maker"),
    ("carol", "Carol", "Taker"),
    ("dave", "Dave", "Desk"),
]


def connect_admin() -> KeycloakAdmin:
    """Log in with the bootstrap admin, retrying while Keycloak finishes booting."""

    last_error = None
    for attempt in range(1, 31):
        try:
            kc = KeycloakAdmin(
                server_url=KEYCLOAK_URL,
                username=KC_BOOTSTRAP_ADMIN_USERNAME,
                password=KC_BOOTSTRAP_ADMIN_PASSWORD,
                realm_name=KEYCLOAK_REALM,
                verify=True,
            )
            kc.get_realm(KEYCLOAK_REALM)
            return kc
        except KeycloakAuthenticationError:
            # Bootstrap admin was removed: Keycloak was configured by hand.
            if os.path.exists(SECRET_PATH):
                print("Bootstrap admin rejected but a client secret exists. Nothing to do.")
                sys.exit(0)
            print("Bootstrap admin rejected and no client secret on disk.", file=sys.stderr)
            sys.exit(1)
        except Exception as e:  # pylint: disable=broad-except
            last_error = e
            print(f"Waiting for Keycloak ({attempt}/30): {e}")
            time.sleep(2)
    print(f"Keycloak never became reachable: {last_error}", file=sys.stderr)
    sys.exit(1)


def upsert_client(kc: KeycloakAdmin, representation: dict) -> str:
    """Create the client, or update it in place. Returns its internal id."""

    client_id = representation["clientId"]
    internal_id = kc.get_client_id(client_id)
    if internal_id:
        kc.update_client(internal_id, representation)
        print(f"Updated client {client_id}")
    else:
        internal_id = kc.create_client(representation)
        print(f"Created client {client_id}")
    return internal_id


def ensure_user(kc: KeycloakAdmin, username: str, first: str, last: str, email: str, password: str) -> str:
    user_id = kc.get_user_id(username)
    if user_id:
        print(f"User {username} already exists")
        return user_id
    user_id = kc.create_user(
        {
            "username": username,
            "firstName": first,
            "lastName": last,
            "email": email,
            "enabled": True,
            "emailVerified": True,
            "credentials": [{"type": "password", "value": password, "temporary": False}],
        },
        exist_ok=True,
    )
    print(f"Created user {username}")
    return user_id


def main() -> None:
    kc = connect_admin()

    # 1. Confidential backend client: only introspects tokens (no browser flows)
    backend_id = upsert_client(
        kc,
        {
            "clientId": KEYCLOAK_BACKEND_CLIENT_ID,
            "name": "MarketMate API",
            "description": "Confidential backend client (token introspection)",
            "enabled": True,
            "publicClient": False,
            "standardFlowEnabled": False,
            "directAccessGrantsEnabled": False,
            "serviceAccountsEnabled": True,
            "redirectUris": [],
            "webOrigins": [],
        },
    )

    secret = kc.get_client_secrets(backend_id)["value"]
    os.makedirs(os.path.dirname(SECRET_PATH), exist_ok=True)
    with open(SECRET_PATH, "w", encoding="utf-8") as file:
        file.write(secret)
    print(f"Wrote client secret to {SECRET_PATH}")

    # 2. Public frontend client: authorization code + PKCE via the API callback.
    #    Direct grants stay on in dev only (handy for scripts / live checks).
    upsert_client(
        kc,
        {
            "clientId": KEYCLOAK_FRONTEND_CLIENT_ID,
            "name": "MarketMate UI",
            "description": "Public frontend client",
            "enabled": True,
            "publicClient": True,
            "standardFlowEnabled": True,
            "directAccessGrantsEnabled": ENV == "dev",
            "rootUrl": FRONTEND_EXT_URL,
            "baseUrl": FRONTEND_EXT_URL,
            "redirectUris": [KEYCLOAK_REDIRECT_URI],
            "webOrigins": [FRONTEND_EXT_URL],
            "attributes": {
                "pkce.code.challenge.method": "S256",
                "post.logout.redirect.uris": POST_LOGOUT_REDIRECT_URI,
            },
            "protocolMappers": [
                {
                    "name": f"{KEYCLOAK_BACKEND_CLIENT_ID}-audience",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-audience-mapper",
                    "consentRequired": False,
                    "config": {
                        "included.client.audience": KEYCLOAK_BACKEND_CLIENT_ID,
                        "id.token.claim": "false",
                        "access.token.claim": "true",
                    },
                }
            ],
        },
    )

    # 3. Users: a permanent admin + the default ring traders
    admin_id = ensure_user(
        kc, KC_ADMIN_USERNAME, "MarketMate", "Administrator", KC_ADMIN_EMAIL, KC_ADMIN_PASSWORD
    )
    kc.assign_realm_roles(admin_id, [kc.get_realm_role("admin")])
    for username, first, last in SEED_USERS:
        ensure_user(kc, username, first, last, f"{username}@spread.local", SEED_USERS_PASSWORD)

    # 4. Realm settings (session lifetimes match the API's SESSION_TTL_SECONDS)
    realm = kc.get_realm(KEYCLOAK_REALM)
    realm["accessTokenLifespan"] = 5 * 60
    realm["rememberMe"] = True
    realm["ssoSessionIdleTimeout"] = 30 * 60
    realm["ssoSessionIdleTimeoutRememberMe"] = 7 * 24 * 60 * 60
    realm["ssoSessionMaxLifespan"] = 10 * 60 * 60
    realm["ssoSessionMaxLifespanRememberMe"] = 30 * 24 * 60 * 60
    realm["registrationAllowed"] = True
    realm["resetPasswordAllowed"] = True
    realm["bruteForceProtected"] = True
    if ENV == "dev":
        # master defaults to sslRequired=external, which blocks plain-HTTP
        # logins from non-private IPs; the dev stack serves :8080 over HTTP.
        realm["sslRequired"] = "NONE"
    kc.update_realm(KEYCLOAK_REALM, realm)
    print(f"Configured realm {KEYCLOAK_REALM}")


if __name__ == "__main__":
    try:
        main()
    except KeycloakError as e:
        print(f"Keycloak configuration failed: {e}", file=sys.stderr)
        sys.exit(1)

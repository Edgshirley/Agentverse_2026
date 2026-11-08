"""
One-shot schema sync, run by the `db-migrate` service before the API starts
(mirrors ../freevo-api/app/src/migrate.py).

Takes a transaction-scoped advisory lock so concurrent migrators serialize,
then creates every missing table from the ORM metadata. Additive only: it
never drops or alters existing columns.

    python -m src.migrate
"""

import asyncio
import logging
import sys

from sqlalchemy import text

from src.backend.postgres import PostgresConnectionSingleton
from src.orm import Base

logger = logging.getLogger("db-migrate")

# "SPRD" in ASCII
MIGRATION_LOCK_KEY = 0x53505244


async def migrate() -> None:
    engine = PostgresConnectionSingleton.engine()
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": MIGRATION_LOCK_KEY})
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await PostgresConnectionSingleton.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    try:
        asyncio.run(migrate())
    except Exception:  # pylint: disable=broad-except
        logger.exception("Migration failed")
        sys.exit(1)
    logger.info("Schema is up to date: %s", ", ".join(sorted(Base.metadata.tables)))


if __name__ == "__main__":
    main()

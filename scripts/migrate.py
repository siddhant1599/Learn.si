import asyncio
from pathlib import Path

import psycopg

from app.config import settings

MIGRATIONS = Path(__file__).parents[1] / "migrations"


def migration_files():
    """Ordered, idempotent SQL files; every file can be re-applied safely."""
    return sorted(MIGRATIONS.glob("*.sql"))


async def apply_all(dsn):
    async with await psycopg.AsyncConnection.connect(dsn, prepare_threshold=None) as conn:
        for path in migration_files():
            await conn.execute(path.read_text())
    return [path.name for path in migration_files()]


async def main():
    dsn = settings().database_url.get_secret_value()
    if not dsn:
        raise SystemExit("Set DATABASE_URL before applying migrations")
    applied = await apply_all(dsn)
    print("Schema is ready:", ", ".join(applied))


if __name__ == "__main__":
    asyncio.run(main())

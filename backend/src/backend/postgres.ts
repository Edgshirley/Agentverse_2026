// ============================================================================
// PostgreSQL Connection Singleton (Mirrors ../freevo-api/app/src/backend/postgres.py)
// ============================================================================

import pg from 'pg';
import { BadGatewayError, ConflictError, config } from '../config';

const { Pool } = pg;

export class PostgresConnectionSingleton {
  private static _pool: pg.Pool | null = null;
  private static _lastStatus: 'connected' | 'disconnected' | 'unconfigured' = 'unconfigured';

  public static getDatabaseUrl(): string {
    const {
      POSTGRES_USER,
      POSTGRES_PASSWORD,
      POSTGRES_HOST,
      POSTGRES_PORT,
      POSTGRES_DB,
    } = config;
    return `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(
      POSTGRES_PASSWORD
    )}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
  }

  public static getPool(): pg.Pool {
    if (!this._pool) {
      this._pool = new Pool({
        connectionString: this.getDatabaseUrl(),
        max: config.POSTGRES_POOL_SIZE,
        connectionTimeoutMillis: 2500,
        idleTimeoutMillis: 30000,
      });

      this._pool.on('error', () => {
        this._lastStatus = 'disconnected';
      });
    }
    return this._pool;
  }

  public static getInstance(): pg.Pool {
    return this.getPool();
  }

  public static getStatus(): 'connected' | 'disconnected' | 'unconfigured' {
    return this._lastStatus;
  }

  /**
   * Mirrors `get_db()` in `../freevo-api/app/src/backend/postgres.py`:
   * acquires a client, runs `fn` inside a transaction (`BEGIN` / `COMMIT` / `ROLLBACK`),
   * converts connection failures into `BadGatewayError("Failed to connect to the database")`
   * and unique constraint violations (`23505`) into `ConflictError`.
   */
  public static async withSession<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    let client: pg.PoolClient;
    try {
      client = await this.getPool().connect();
      this._lastStatus = 'connected';
    } catch (exc: any) {
      this._lastStatus = 'disconnected';
      throw new BadGatewayError('Failed to connect to the database');
    }

    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (err?.code === '23505') {
        throw new ConflictError('Resource conflict occurred');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  public static async ping(): Promise<boolean> {
    try {
      const pool = this.getPool();
      await pool.query('SELECT 1');
      this._lastStatus = 'connected';
      return true;
    } catch {
      this._lastStatus = 'disconnected';
      return false;
    }
  }

  public static async close(): Promise<void> {
    if (this._pool) {
      const p = this._pool;
      this._pool = null;
      this._lastStatus = 'disconnected';
      await p.end().catch(() => {});
    }
  }
}

export const POSTGRES_POOL = () => PostgresConnectionSingleton.getPool();
export const withPostgresSession = <T>(fn: (client: pg.PoolClient) => Promise<T>) =>
  PostgresConnectionSingleton.withSession(fn);

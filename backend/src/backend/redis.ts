// ============================================================================
// Redis Connection Singleton (Mirrors ../freevo-api/app/src/backend/redis.py)
// Uses db=2 and wraps connection errors into BadGatewayError
// ============================================================================

import { createClient, RedisClientType } from 'redis';
import { BadGatewayError, config } from '../config';

export class RedisClient {
  private _client: RedisClientType | null = null;
  private _connecting: Promise<RedisClientType> | null = null;
  private _status: 'connected' | 'disconnected' | 'fallback_memory' = 'fallback_memory';

  // Local fallback store when running unit tests without a live Redis daemon
  private _memoryKv: Map<string, string> = new Map();
  private _memorySets: Map<string, Set<string>> = new Map();

  public getStatus(): 'connected' | 'disconnected' | 'fallback_memory' {
    return this._status;
  }

  public createDedicatedClient(): RedisClientType {
    const url = config.REDIS_PASSWORD
      ? `redis://:${encodeURIComponent(config.REDIS_PASSWORD)}@${config.REDIS_HOST}:${config.REDIS_PORT}/2`
      : `redis://${config.REDIS_HOST}:${config.REDIS_PORT}/2`;

    return createClient({
      url,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => (retries > 5 ? false : Math.min(retries * 200, 1000)),
      },
    });
  }

  private async _getConn(): Promise<RedisClientType> {
    if (this._client?.isOpen) {
      return this._client;
    }
    if (this._connecting) {
      return this._connecting;
    }

    this._connecting = (async () => {
      try {
        const client = this.createDedicatedClient();
        client.on('error', () => {
          this._status = 'disconnected';
        });
        await client.connect();
        this._client = client;
        this._status = 'connected';
        return client;
      } catch (err) {
        this._status = 'disconnected';
        throw new BadGatewayError('Failed to connect to Redis');
      } finally {
        this._connecting = null;
      }
    })();

    return this._connecting;
  }

  public async set(key: string, value: unknown, keepTtl: boolean = false): Promise<void> {
    const serialized = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    this._memoryKv.set(key, serialized);
    try {
      const conn = await this._getConn();
      if (keepTtl) {
        await conn.set(key, serialized, { KEEPTTL: true });
      } else {
        await conn.set(key, serialized);
      }
    } catch (e) {
      if (config.ENV === 'prod') {
        throw new BadGatewayError('Failed to connect to Redis');
      }
    }
  }

  public async setEx(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const serialized = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    this._memoryKv.set(key, serialized);
    try {
      const conn = await this._getConn();
      await conn.set(key, serialized, { EX: ttlSeconds });
    } catch (e) {
      if (config.ENV === 'prod') {
        throw new BadGatewayError('Failed to connect to Redis');
      }
    }
  }

  public async get<T = any>(key: string): Promise<T | string | null> {
    let raw: string | null = null;
    try {
      const conn = await this._getConn();
      raw = await conn.get(key);
    } catch (e) {
      if (config.ENV === 'prod') {
        throw new BadGatewayError('Failed to connect to Redis');
      }
      raw = this._memoryKv.get(key) ?? null;
    }
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw;
    }
  }

  public async delete(...keys: string[]): Promise<void> {
    for (const k of keys) {
      this._memoryKv.delete(k);
      this._memorySets.delete(k);
    }
    if (keys.length === 0) return;
    try {
      const conn = await this._getConn();
      await conn.del(keys);
    } catch (e) {
      if (config.ENV === 'prod') {
        throw new BadGatewayError('Failed to connect to Redis');
      }
    }
  }

  public async sadd(key: string, member: string, ttlSeconds?: number): Promise<void> {
    const set = this._memorySets.get(key) ?? new Set<string>();
    set.add(member);
    this._memorySets.set(key, set);
    try {
      const conn = await this._getConn();
      await conn.sAdd(key, member);
      if (ttlSeconds !== undefined) {
        await conn.expire(key, ttlSeconds);
      }
    } catch (e) {
      if (config.ENV === 'prod') {
        throw new BadGatewayError('Failed to connect to Redis');
      }
    }
  }

  public async srem(key: string, member: string): Promise<void> {
    this._memorySets.get(key)?.delete(member);
    try {
      const conn = await this._getConn();
      await conn.sRem(key, member);
    } catch (e) {
      if (config.ENV === 'prod') {
        throw new BadGatewayError('Failed to connect to Redis');
      }
    }
  }

  public async smembers(key: string): Promise<Set<string>> {
    try {
      const conn = await this._getConn();
      const members = await conn.sMembers(key);
      return new Set(members);
    } catch (e) {
      if (config.ENV === 'prod') {
        throw new BadGatewayError('Failed to connect to Redis');
      }
      return new Set(this._memorySets.get(key) ?? []);
    }
  }

  public async ping(): Promise<boolean> {
    try {
      const conn = await this._getConn();
      const pong = await conn.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this._client?.isOpen) {
      const c = this._client;
      this._client = null;
      this._status = 'disconnected';
      await c.quit().catch(() => {});
    }
  }
}

export const REDIS = new RedisClient();

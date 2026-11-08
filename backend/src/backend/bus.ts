// ============================================================================
// Message-bus publisher (engine side of ../api/src/backend/bus.py)
// ============================================================================
// Every state mutation is published on BUS_CHANNEL. The FastAPI ws_worker in
// each API replica subscribes and fans the event out to browser WebSockets.
// Publishing is fire-and-forget: if Redis is down the event is dropped and
// clients catch up on their next /api/state fetch.

import { config } from '../config';
import { REDIS } from './redis';

export interface BusEventPayload {
  type: string;
  action?: string;
  user_id?: string;
  device_id?: string;
  timestamp?: string;
  data?: Record<string, any>;
  [key: string]: any;
}

const RETRY_AFTER_MS = 5000;

export class RedisMessagePublisher {
  private _client = REDIS.createDedicatedClient();
  private _connecting: Promise<void> | null = null;
  private _retryAt = 0;
  private _closed = false;

  constructor(private readonly _channel: string = config.BUS_CHANNEL) {
    this._client.on('error', () => {
      // Reported through publish() failures; the listener stops the process-level crash.
    });
  }

  private async _ensureConnected(): Promise<boolean> {
    if (this._client.isOpen) return true;
    if (this._closed || Date.now() < this._retryAt) return false;
    if (!this._connecting) {
      this._connecting = this._client
        .connect()
        .then(() => undefined)
        .catch(() => {
          this._retryAt = Date.now() + RETRY_AFTER_MS;
          this._client = REDIS.createDedicatedClient();
          this._client.on('error', () => {});
        })
        .finally(() => {
          this._connecting = null;
        });
    }
    await this._connecting;
    return this._client.isOpen;
  }

  public async publish(event: BusEventPayload): Promise<void> {
    if (config.MESSAGE_BUS !== 'redis' || !config.REDIS_ENABLED) return;
    if (!(await this._ensureConnected())) return;
    try {
      await this._client.publish(this._channel, JSON.stringify(event));
    } catch {
      this._retryAt = Date.now() + RETRY_AFTER_MS;
    }
  }

  public async close(): Promise<void> {
    this._closed = true;
    if (this._client.isOpen) await this._client.quit().catch(() => {});
  }
}

let _bus: RedisMessagePublisher | null = null;

export const MESSAGE_BUS = (): RedisMessagePublisher => {
  if (!_bus) _bus = new RedisMessagePublisher();
  return _bus;
};

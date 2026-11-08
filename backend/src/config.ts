// ============================================================================
// Rules-engine configuration (internal service behind the FastAPI gateway in ../api)
// ============================================================================
// Authentication, sessions and client WebSockets live in the FastAPI service.
// The engine only needs its own persistence (Postgres / Redis) and the message
// bus channel it publishes state changes on.

const envObj: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

export class BadGatewayError extends Error {
  public readonly status = 502;
  constructor(public readonly detail: string) {
    super(detail);
    this.name = 'BadGatewayError';
  }
}

export class ConflictError extends Error {
  public readonly status = 409;
  constructor(public readonly detail: string) {
    super(detail);
    this.name = 'ConflictError';
  }
}

export class Configuration {
  public readonly ENV: string = envObj.ENV || 'dev';
  public readonly VERSION: string = envObj.VERSION || '1.0.0';
  public readonly TITLE: string = envObj.TITLE || 'Friend Spreader Rules Engine';

  // PostgreSQL (schema owned by `python -m src.migrate` in ../api)
  public readonly POSTGRES_HOST: string = envObj.POSTGRES_HOST || 'localhost';
  public readonly POSTGRES_PORT: number = parseInt(envObj.POSTGRES_PORT || '5432', 10);
  public readonly POSTGRES_USER: string = envObj.POSTGRES_USER || 'spread';
  public readonly POSTGRES_PASSWORD: string = envObj.POSTGRES_PASSWORD || 'password';
  public readonly POSTGRES_DB: string = envObj.POSTGRES_DB || 'spread';
  public readonly POSTGRES_POOL_SIZE: number = parseInt(envObj.POSTGRES_POOL_SIZE || '5', 10);

  // Redis (db=2, shared with the API)
  public readonly REDIS_HOST: string = envObj.REDIS_HOST || 'localhost';
  public readonly REDIS_PORT: number = parseInt(envObj.REDIS_PORT || '6379', 10);
  public readonly REDIS_PASSWORD: string | undefined = envObj.REDIS_PASSWORD || undefined;

  // Postgres / Redis persistence + bus publishing are on only when their host
  // is configured (the docker stack sets both); bare local runs and unit
  // tests stay on the SQLite file without waiting on connection timeouts.
  public readonly POSTGRES_ENABLED: boolean = Boolean(envObj.POSTGRES_HOST);
  public readonly REDIS_ENABLED: boolean = Boolean(envObj.REDIS_HOST);

  // Message bus: the API's ws_worker subscribes to this channel
  public readonly MESSAGE_BUS: string = envObj.MESSAGE_BUS || 'redis';
  public readonly BUS_CHANNEL: string = envObj.BUS_CHANNEL || 'spread-messages';

  public readonly HOST: string = envObj.HOST || '0.0.0.0';
  public readonly PORT: number = parseInt(envObj.PORT || '4000', 10);
}

export const config = new Configuration();

// ============================================================================
// Local SQLite Adapter implementing Cloudflare's D1Database Interface
// Backed by `better-sqlite3` for Node.js / Docker dev & prod environments
// ============================================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

function normalizeParam(val: any): any {
  if (val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

class SqliteD1PreparedStatement {
  private boundValues: any[] = [];

  constructor(
    private readonly db: Database.Database,
    private readonly sql: string
  ) {}

  public bind(...values: any[]): SqliteD1PreparedStatement {
    const clone = new SqliteD1PreparedStatement(this.db, this.sql);
    clone.boundValues = values.map(normalizeParam);
    return clone;
  }

  private prepareNormalized(): { stmt: Database.Statement; params: any[] } {
    const numberedMatches = Array.from(this.sql.matchAll(/\?(\d+)/g));
    if (numberedMatches.length > 0) {
      const normalizedSql = this.sql.replace(/\?\d+/g, '?');
      const params = numberedMatches.map((m) => {
        const idx = parseInt(m[1], 10) - 1;
        return normalizeParam(this.boundValues[idx]);
      });
      return { stmt: this.db.prepare(normalizedSql), params };
    }
    return { stmt: this.db.prepare(this.sql), params: this.boundValues };
  }

  public executeSync() {
    const { stmt, params } = this.prepareNormalized();
    if (stmt.reader) {
      const results = stmt.all(...params);
      return {
        results,
        success: true,
        meta: { changes: 0, last_row_id: 0 },
      };
    } else {
      const info = stmt.run(...params);
      return {
        results: [],
        success: true,
        meta: {
          changes: info.changes,
          last_row_id: Number(info.lastInsertRowid),
        },
      };
    }
  }

  public async run(): Promise<any> {
    return this.executeSync();
  }

  public async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: any }> {
    const { stmt, params } = this.prepareNormalized();
    const results = (stmt.reader ? stmt.all(...params) : []) as T[];
    return {
      results,
      success: true,
      meta: {},
    };
  }

  public async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const { stmt, params } = this.prepareNormalized();
    const row = stmt.get(...params) as Record<string, any> | undefined;
    if (!row) return null;
    if (colName) return (row[colName] ?? null) as T;
    return row as T;
  }

  public async raw<T = unknown[]>(): Promise<T[]> {
    const { stmt, params } = this.prepareNormalized();
    return stmt.raw(true).all(...params) as T[];
  }
}

export class SqliteD1Database {
  public readonly sqlite: Database.Database;

  constructor(filename: string = ':memory:') {
    if (filename !== ':memory:') {
      const dir = path.dirname(path.resolve(filename));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.sqlite = new Database(filename);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('synchronous = NORMAL');
    this.sqlite.pragma('foreign_keys = OFF');
  }

  public prepare(query: string): any {
    return new SqliteD1PreparedStatement(this.sqlite, query);
  }

  public async batch<T = unknown>(statements: any[]): Promise<any[]> {
    const runTx = this.sqlite.transaction((stmts: SqliteD1PreparedStatement[]) => {
      return stmts.map((s) => s.executeSync());
    });
    return runTx(statements as SqliteD1PreparedStatement[]);
  }

  public async exec(query: string): Promise<{ count: number; duration: number }> {
    const start = Date.now();
    this.sqlite.exec(query);
    return {
      count: 1,
      duration: Date.now() - start,
    };
  }

  public async dump(): Promise<ArrayBuffer> {
    const buf = this.sqlite.serialize();
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  public close(): void {
    this.sqlite.close();
  }
}

export function createSqliteD1Database(filename: string = ':memory:'): D1Database {
  return new SqliteD1Database(filename) as unknown as D1Database;
}

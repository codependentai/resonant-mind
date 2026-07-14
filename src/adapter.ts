/**
 * D1-Compatible Adapter for Postgres via Hyperdrive
 *
 * Wraps pg.Client in D1's .prepare().bind().run/all/first() API
 * so all 302 env.DB.prepare() calls work without modification.
 *
 * SQL transformation pipeline:
 * 1. ? → $1, $2, ... (state machine, respects string literals)
 * 2. datetime('now') → NOW()
 * 3. datetime('now', '-N unit') → NOW() - INTERVAL 'N unit'
 * 4. INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
 * 5. .run() on INSERTs → appends RETURNING id for meta.last_row_id
 */

import { Client } from "pg";

interface D1Meta {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1BoundStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1BoundStatement {
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

// ============================================================
// SQL TRANSFORMATION
// ============================================================

/**
 * Convert ? placeholders to $1, $2, ... while respecting string literals.
 * State machine tracks whether we're inside single-quoted strings.
 */
function convertPlaceholders(sql: string): string {
  let result = "";
  let paramIndex = 1;
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inString) {
      if (ch === "'" && sql[i + 1] === "'") {
        // Escaped quote inside string literal
        result += "''";
        i++;
      } else if (ch === "'") {
        inString = false;
        result += ch;
      } else {
        result += ch;
      }
    } else {
      if (ch === "'") {
        inString = true;
        result += ch;
      } else if (ch === "?") {
        result += `$${paramIndex++}`;
      } else {
        result += ch;
      }
    }
  }

  return result;
}

/**
 * Apply all SQLite → Postgres SQL transformations.
 */
function transformSql(sql: string): string {
  let s = sql;

  // datetime('now', '-N unit') → NOW() - INTERVAL 'N unit'
  s = s.replace(
    /datetime\(\s*'now'\s*,\s*'(-?\d+\s+\w+)'\s*\)/gi,
    (_match, interval: string) => {
      // Strip leading minus: datetime('now', '-30 days') → NOW() - INTERVAL '30 days'
      const clean = interval.replace(/^-/, "").trim();
      return `NOW() - INTERVAL '${clean}'`;
    }
  );

  // datetime('now') → NOW()
  s = s.replace(/datetime\(\s*'now'\s*\)/gi, "NOW()");

  // INSERT OR IGNORE INTO → INSERT INTO ... (ON CONFLICT DO NOTHING appended later)
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");

  // Convert ? → $1, $2, ...
  s = convertPlaceholders(s);

  return s;
}

/**
 * Check if the (already transformed) SQL was originally an INSERT OR IGNORE.
 * We need to detect this before transformation, so we check the original SQL.
 */
function wasInsertOrIgnore(originalSql: string): boolean {
  return /INSERT\s+OR\s+IGNORE/i.test(originalSql);
}

// ============================================================
// QUERY EXECUTION
// ============================================================

async function executeQuery(
  connectionString: string,
  sql: string,
  values: unknown[]
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(sql, values);
    return {
      rows: result.rows ?? [],
      rowCount: result.rowCount ?? 0,
    };
  } finally {
    await client.end();
  }
}

function makeMeta(overrides: Partial<D1Meta> = {}): D1Meta {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
    ...overrides,
  };
}

// ============================================================
// ADAPTER
// ============================================================

function createBoundStatement(
  connectionString: string,
  originalSql: string,
  transformedSql: string,
  values: unknown[]
): D1BoundStatement {
  return {
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      let sql = transformedSql;
      const isInsert = /^\s*INSERT/i.test(sql);

      // Append ON CONFLICT DO NOTHING for INSERT OR IGNORE
      if (isInsert && wasInsertOrIgnore(originalSql)) {
        sql = sql.replace(/\s*$/, "") + " ON CONFLICT DO NOTHING";
      }

      // Append RETURNING id for INSERTs to populate meta.last_row_id
      if (isInsert && !/RETURNING/i.test(sql)) {
        sql = sql.replace(/\s*$/, "") + " RETURNING id";
      }

      const result = await executeQuery(connectionString, sql, values);
      return {
        results: result.rows as T[],
        success: true,
        meta: makeMeta({
          rows_written: result.rowCount,
          last_row_id:
            isInsert && result.rows[0]
              ? Number(result.rows[0].id)
              : 0,
          changed_db: result.rowCount > 0,
          changes: result.rowCount,
        }),
      };
    },

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const result = await executeQuery(
        connectionString,
        transformedSql,
        values
      );
      return {
        results: result.rows as T[],
        success: true,
        meta: makeMeta({ rows_read: result.rows.length }),
      };
    },

    async first<T = Record<string, unknown>>(): Promise<T | null> {
      const result = await executeQuery(
        connectionString,
        transformedSql,
        values
      );
      return (result.rows[0] as T) ?? null;
    },
  };
}

function createPreparedStatement(
  connectionString: string,
  originalSql: string,
  transformedSql: string
): D1PreparedStatement {
  // No-bind versions (for queries without parameters)
  const noBind = createBoundStatement(
    connectionString,
    originalSql,
    transformedSql,
    []
  );

  return {
    bind(...values: unknown[]): D1BoundStatement {
      return createBoundStatement(
        connectionString,
        originalSql,
        transformedSql,
        values
      );
    },
    run: noBind.run,
    all: noBind.all,
    first: noBind.first,
  };
}

/**
 * Create a D1-compatible database adapter backed by Postgres via Hyperdrive.
 *
 * Usage:
 *   const db = createD1Adapter(env.HYPERDRIVE);
 *   // Then use exactly like env.DB:
 *   const result = await db.prepare("SELECT * FROM entities WHERE id = ?").bind(1).first();
 */
export function createD1Adapter(hyperdrive: { connectionString: string }) {
  const connStr = hyperdrive.connectionString;

  return {
    prepare(sql: string): D1PreparedStatement {
      const transformed = transformSql(sql);
      return createPreparedStatement(connStr, sql, transformed);
    },
  };
}

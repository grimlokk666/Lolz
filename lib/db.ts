import { Pool, type QueryResultRow } from "pg";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://mastereye:mastereye_dev@localhost:5432/mastereye";

declare global {
  // eslint-disable-next-line no-var
  var __masterEyePool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __masterEyeDbHealth: { ok: boolean; checkedAt: number } | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getPool(): Pool {
  if (!global.__masterEyePool) {
    global.__masterEyePool = createPool();
  }
  return global.__masterEyePool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const pool = getPool();
  const result = await pool.query<T>(text, params);
  return { rows: result.rows, rowCount: result.rowCount };
}

const DB_HEALTH_TTL_MS = 15_000;

/** Cached ping — avoids SELECT 1 on every API hit during layer polls. */
export async function isDatabaseAvailable(): Promise<boolean> {
  const cached = global.__masterEyeDbHealth;
  if (cached && Date.now() - cached.checkedAt < DB_HEALTH_TTL_MS) {
    return cached.ok;
  }
  try {
    await query("SELECT 1");
    global.__masterEyeDbHealth = { ok: true, checkedAt: Date.now() };
    return true;
  } catch {
    global.__masterEyeDbHealth = { ok: false, checkedAt: Date.now() };
    return false;
  }
}

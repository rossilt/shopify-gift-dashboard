const { Pool } = require("pg");

const { DATABASE_URL } = require("./config");

const dbEnabled =
  Boolean(DATABASE_URL) &&
  !String(DATABASE_URL).startsWith("REPLACE_LATER");

let pool = null;

function getPool() {
  if (!dbEnabled) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("render.com")
        ? { rejectUnauthorized: false }
        : false,
    });
  }

  return pool;
}

function createSessionStore(sessionLib) {
  if (!dbEnabled) {
    return null;
  }

  const PgSession = require("connect-pg-simple")(sessionLib);

  return new PgSession({
    pool: getPool(),
    tableName: "user_sessions",
    createTableIfMissing: true,
  });
}

async function initDb() {
  if (!dbEnabled) {
    return { enabled: false };
  }

  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS run_history (
      id TEXT PRIMARY KEY,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fetched_at TIMESTAMPTZ,
      mode TEXT NOT NULL,
      selection_mode TEXT,
      limit_value INTEGER,
      total_fetched_orders INTEGER,
      applied_count INTEGER,
      planned_count INTEGER,
      skipped_count INTEGER,
      failed_count INTEGER,
      payload JSONB NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS run_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES run_history(id) ON DELETE CASCADE,
      order_number TEXT,
      order_name TEXT,
      subtotal NUMERIC,
      planned_tier TEXT,
      planned_sku TEXT,
      status TEXT,
      reason TEXT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_run_history_saved_at
    ON run_history(saved_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_run_items_run_id
    ON run_items(run_id)
  `);

  return { enabled: true };
}

module.exports = {
  dbEnabled,
  getPool,
  initDb,
  createSessionStore,
};
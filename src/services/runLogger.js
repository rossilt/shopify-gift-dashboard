const { randomUUID } = require("crypto");

const { dbEnabled, getPool } = require("../db");

let memoryRunHistory = [];

function toEntry(id, savedAt, run) {
  return {
    id,
    savedAt,
    run,
  };
}

function toNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function saveRun(run) {
  const id = randomUUID();
  const savedAt = new Date().toISOString();
  const entry = toEntry(id, savedAt, run);

  if (!dbEnabled) {
    memoryRunHistory.unshift(entry);
    memoryRunHistory = memoryRunHistory.slice(0, 100);
    return entry;
  }

  const pool = getPool();

  await pool.query("BEGIN");

  try {
    await pool.query(
      `
      INSERT INTO run_history (
        id,
        saved_at,
        fetched_at,
        mode,
        selection_mode,
        limit_value,
        total_fetched_orders,
        applied_count,
        planned_count,
        skipped_count,
        failed_count,
        payload
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb
      )
      `,
      [
        id,
        savedAt,
        run.fetchedAt || null,
        run.mode || null,
        run.selectionMode || null,
        run.limit ?? null,
        run.summary?.totalFetchedOrders ?? null,
        run.summary?.applied ?? 0,
        run.summary?.planned ?? 0,
        run.summary?.skipped ?? 0,
        run.summary?.failed ?? 0,
        JSON.stringify(run),
      ]
    );

    for (const row of run.results || []) {
      await pool.query(
        `
        INSERT INTO run_items (
          id,
          run_id,
          order_number,
          order_name,
          subtotal,
          planned_tier,
          planned_sku,
          status,
          reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          randomUUID(),
          id,
          row.orderNumber ? String(row.orderNumber) : null,
          row.orderName || null,
          toNumberOrNull(row.subtotal),
          row.plannedTier || null,
          row.plannedSku || null,
          row.status || null,
          row.reason || null,
        ]
      );
    }

    await pool.query("COMMIT");
    return entry;
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function getLatestRun() {
  if (!dbEnabled) {
    return memoryRunHistory[0]?.run || null;
  }

  const pool = getPool();

  const { rows } = await pool.query(
    `
    SELECT payload
    FROM run_history
    ORDER BY saved_at DESC
    LIMIT 1
    `
  );

  if (!rows.length) {
    return null;
  }

  return rows[0].payload;
}

async function listRuns(limit = 20) {
  if (!dbEnabled) {
    return memoryRunHistory.slice(0, limit);
  }

  const pool = getPool();

  const { rows } = await pool.query(
    `
    SELECT id, saved_at, payload
    FROM run_history
    ORDER BY saved_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return rows.map((row) =>
    toEntry(
      row.id,
      row.saved_at instanceof Date ? row.saved_at.toISOString() : row.saved_at,
      row.payload
    )
  );
}

async function getRunById(id) {
  if (!dbEnabled) {
    return memoryRunHistory.find((item) => item.id === id) || null;
  }

  const pool = getPool();

  const { rows } = await pool.query(
    `
    SELECT id, saved_at, payload
    FROM run_history
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];

  return toEntry(
    row.id,
    row.saved_at instanceof Date ? row.saved_at.toISOString() : row.saved_at,
    row.payload
  );
}

module.exports = {
  saveRun,
  getLatestRun,
  listRuns,
  getRunById,
};
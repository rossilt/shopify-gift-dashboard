const {
  GIFT_REASON,
  SCHEDULE_ENABLED,
  SCHEDULE_HOUR,
  SCHEDULE_MINUTE,
  TIMEZONE,
} = require("../config");

const { dbEnabled, getPool } = require("../db");
const {
  DEFAULT_GIFT_RULES,
  cloneGiftRules,
  normalizeGiftRules,
} = require("./giftRules");

const SETTINGS_KEY = "global";

const DEFAULT_SETTINGS = {
  reasonText: GIFT_REASON,
  scheduleEnabled: SCHEDULE_ENABLED,
  scheduleHour: SCHEDULE_HOUR,
  scheduleMinute: SCHEDULE_MINUTE,
  timezone: TIMEZONE,
  giftRules: cloneGiftRules(DEFAULT_GIFT_RULES),
};

let memorySettings = {
  ...DEFAULT_SETTINGS,
  giftRules: cloneGiftRules(DEFAULT_GIFT_RULES),
};

function normalizeSettings(raw = {}) {
  return {
    reasonText: String(raw.reasonText ?? DEFAULT_SETTINGS.reasonText).trim() || DEFAULT_SETTINGS.reasonText,
    scheduleEnabled: Boolean(raw.scheduleEnabled ?? DEFAULT_SETTINGS.scheduleEnabled),
    scheduleHour: Number.isInteger(Number(raw.scheduleHour))
      ? Number(raw.scheduleHour)
      : DEFAULT_SETTINGS.scheduleHour,
    scheduleMinute: Number.isInteger(Number(raw.scheduleMinute))
      ? Number(raw.scheduleMinute)
      : DEFAULT_SETTINGS.scheduleMinute,
    timezone: String(raw.timezone ?? DEFAULT_SETTINGS.timezone).trim() || DEFAULT_SETTINGS.timezone,
    giftRules: normalizeGiftRules(raw.giftRules),
  };
}

async function getSettings() {
  if (!dbEnabled) {
    return normalizeSettings(memorySettings);
  }

  const pool = getPool();

  const { rows } = await pool.query(
    `
    SELECT value
    FROM app_settings
    WHERE key = $1
    LIMIT 1
    `,
    [SETTINGS_KEY]
  );

  if (!rows.length) {
    const initial = normalizeSettings(DEFAULT_SETTINGS);

    await pool.query(
      `
      INSERT INTO app_settings (key, value)
      VALUES ($1, $2::jsonb)
      `,
      [SETTINGS_KEY, JSON.stringify(initial)]
    );

    return initial;
  }

  return normalizeSettings(rows[0].value);
}

async function updateSettings(patch) {
  const current = await getSettings();

  const next = normalizeSettings({
    ...current,
    ...patch,
  });

  if (!dbEnabled) {
    memorySettings = next;
    return normalizeSettings(memorySettings);
  }

  const pool = getPool();

  await pool.query(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
    `,
    [SETTINGS_KEY, JSON.stringify(next)]
  );

  return next;
}

module.exports = {
  getSettings,
  updateSettings,
};
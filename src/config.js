require("dotenv").config();

function toBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  SHOP: (process.env.SHOPIFY_SHOP || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, ""),

  CLIENT_ID: process.env.SHOPIFY_CLIENT_ID || "",
  CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET || "",
  API_VERSION: process.env.SHOPIFY_API_VERSION || "2026-04",
  LOCATION_ID: process.env.LOCATION_ID || "",

  TEST_ORDER_NUMBERS: (process.env.TEST_ORDER_NUMBERS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),

  SUCCESS_TAG: "mask-gift-added",
  CHECKED_TAG: "mask-checked",
  SKIP_TAG: "no-mask",

  GIFT_REASON: process.env.GIFT_REASON || "DOVANA",

  DASHBOARD_USERNAME: process.env.DASHBOARD_USERNAME || "admin",
  DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || "",
  SESSION_SECRET: process.env.SESSION_SECRET || "",

  DATABASE_URL: process.env.DATABASE_URL || "",

  SCHEDULE_ENABLED: toBoolean(process.env.SCHEDULE_ENABLED, false),
  SCHEDULE_HOUR: toNumber(process.env.SCHEDULE_HOUR, 10),
  SCHEDULE_MINUTE: toNumber(process.env.SCHEDULE_MINUTE, 0),
  TIMEZONE: process.env.TIMEZONE || "Europe/Vilnius",
};
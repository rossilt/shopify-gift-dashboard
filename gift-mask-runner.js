require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { TEST_ORDER_NUMBERS } = require("./src/config");
const { runGiftJob } = require("./src/services/giftEngine");

function parseArgs(argv) {
  const result = {
    orderNumbers: [],
    apply: false,
    allUnfulfilled: false,
    limit: null,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--orders=")) {
      const raw = arg.slice("--orders=".length);
      result.orderNumbers.push(
        ...raw
          .split(",")
          .map((v) => v.trim().replace(/^#/, ""))
          .filter(Boolean)
      );
    } else if (arg.startsWith("--range=")) {
      const raw = arg.slice("--range=".length).trim();
      const match = raw.match(/^(\d+)\s*-\s*(\d+)$/);

      if (!match) {
        throw new Error(`Invalid --range format: ${raw}. Use --range=126257-126261`);
      }

      const start = Number(match[1]);
      const end = Number(match[2]);

      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        throw new Error(`Invalid range values: ${raw}`);
      }

      for (let i = start; i <= end; i++) {
        result.orderNumbers.push(String(i));
      }
    } else if (arg === "--apply") {
      result.apply = true;
    } else if (arg === "--all-unfulfilled") {
      result.allUnfulfilled = true;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length).trim());
      if (Number.isNaN(value) || value <= 0) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      result.limit = value;
    }
  }

  const unique = [...new Set(result.orderNumbers)];
  result.orderNumbers = unique.length ? unique : TEST_ORDER_NUMBERS;

  if (!result.allUnfulfilled && result.orderNumbers.length === 0) {
    throw new Error(
      "Use --all-unfulfilled or pass --orders=... / --range=..., or set TEST_ORDER_NUMBERS in .env"
    );
  }

  return result;
}

function makeCsv(rows) {
  const headers = [
    "order_number",
    "order_name",
    "subtotal",
    "planned_tier",
    "planned_sku",
    "status",
    "reason",
  ];

  const escape = (value) => {
    const str = String(value ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.orderNumber,
        row.orderName,
        row.subtotal,
        row.plannedTier,
        row.plannedSku,
        row.status,
        row.reason,
      ]
        .map(escape)
        .join(",")
    );
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const output = await runGiftJob(args);

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = output.mode === "apply" ? "gift-run-apply" : "gift-run-plan";
  const jsonPath = path.join(outDir, `${prefix}-${timestamp}.json`);
  const csvPath = path.join(outDir, `${prefix}-${timestamp}.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), "utf8");
  fs.writeFileSync(csvPath, makeCsv(output.results), "utf8");

  console.log(`\n${output.mode === "apply" ? "LIVE APPLY RESULTS" : "DRY RUN RESULTS"}\n`);
  for (const row of output.results) {
    console.log(
      `[${row.status.toUpperCase()}] ${row.orderName} | subtotal=${row.subtotal || "-"} | tier=${row.plannedTier || "-"} | sku=${row.plannedSku || "-"} | ${row.reason}`
    );
  }

  console.log("\nSummary:");
  console.log(output.summary);
  console.log(`\nSaved JSON: ${jsonPath}`);
  console.log(`Saved CSV:  ${csvPath}`);
}

main().catch((error) => {
  console.error("\nERROR:\n");
  console.error(error);
  process.exit(1);
});
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const SHOP = (process.env.SHOPIFY_SHOP || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

const DEFAULT_ORDER_NUMBERS = (process.env.TEST_ORDER_NUMBERS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const LOCATION_ID = "gid://shopify/Location/99809919320";

const SUCCESS_TAG = "mask-gift-added";
const SKIP_TAG = "no-mask";

const GIFT_RULES = [
  {
    tier: "50_60",
    min: 50,
    maxExclusive: 60,
    skus: ["P0268S", "P0310S"],
  },
  {
    tier: "60_70",
    min: 60,
    maxExclusive: 70,
    skus: ["P1527S"],
  },
  {
    tier: "70_100",
    min: 70,
    maxExclusive: 100,
    skus: ["P0566S"],
  },
  {
    tier: "100_plus",
    min: 100,
    maxExclusive: Infinity,
    skus: ["P1988S"],
  },
];

const GIFT_SKU_ALIAS_MAP = {
  P0268S: "sku_0268",
  P0310S: "sku_0310",
  P1527S: "sku_1527",
  P0566S: "sku_0566",
  P1988S: "sku_1988",
};

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function parseArgs(argv) {
  const result = {
    orderNumbers: [],
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
    }
  }

  const unique = [...new Set(result.orderNumbers)];

  if (unique.length === 0) {
    result.orderNumbers = DEFAULT_ORDER_NUMBERS;
  } else {
    result.orderNumbers = unique;
  }

  return result;
}

function pickTier(subtotal) {
  for (const rule of GIFT_RULES) {
    if (subtotal >= rule.min && subtotal < rule.maxExclusive) {
      return rule;
    }
  }
  return null;
}

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Token request failed (${response.status} ${response.statusText}): ${text}`
    );
  }

  const json = JSON.parse(text);

  if (!json.access_token) {
    throw new Error(`Token response did not contain access_token: ${text}`);
  }

  return json.access_token;
}

async function gql(accessToken, query, variables = {}) {
  const response = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const json = await response.json();

  if (!response.ok) {
    throw new Error(
      `GraphQL HTTP error (${response.status} ${response.statusText}): ${JSON.stringify(
        json,
        null,
        2
      )}`
    );
  }

  if (json.errors) {
    throw new Error(`GraphQL top-level errors: ${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data;
}

function buildOrdersQuery(orderNumbers) {
  const blocks = orderNumbers
    .map(
      (num, index) => `
      order_${index}: orders(first: 1, query: "name:${num}") {
        edges {
          node {
            id
            name
            number
            currencyCode
            presentmentCurrencyCode
            displayFinancialStatus
            displayFulfillmentStatus
            merchantEditable
            merchantEditableErrors
            edited
            tags
            currentSubtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  quantity
                  unfulfilledQuantity
                  merchantEditable
                }
              }
            }
          }
        }
      }`
    )
    .join("\n");

  return `query SelectedOrders { ${blocks} }`;
}

const VARIANTS_QUERY = `
  query GiftVariants {
    sku_0268: productVariants(first: 5, query: "sku:P0268S") {
      edges {
        node {
          id
          sku
          title
          product {
            title
          }
          inventoryItem {
            id
            inventoryLevel(locationId: "${LOCATION_ID}") {
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }

    sku_0310: productVariants(first: 5, query: "sku:P0310S") {
      edges {
        node {
          id
          sku
          title
          product {
            title
          }
          inventoryItem {
            id
            inventoryLevel(locationId: "${LOCATION_ID}") {
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }

    sku_1527: productVariants(first: 5, query: "sku:P1527S") {
      edges {
        node {
          id
          sku
          title
          product {
            title
          }
          inventoryItem {
            id
            inventoryLevel(locationId: "${LOCATION_ID}") {
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }

    sku_0566: productVariants(first: 5, query: "sku:P0566S") {
      edges {
        node {
          id
          sku
          title
          product {
            title
          }
          inventoryItem {
            id
            inventoryLevel(locationId: "${LOCATION_ID}") {
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }

    sku_1988: productVariants(first: 5, query: "sku:P1988S") {
      edges {
        node {
          id
          sku
          title
          product {
            title
          }
          inventoryItem {
            id
            inventoryLevel(locationId: "${LOCATION_ID}") {
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

function getAvailableQuantityFromVariantEdge(edge) {
  const quantities = edge?.node?.inventoryItem?.inventoryLevel?.quantities || [];
  const available = quantities.find((q) => q.name === "available");
  return Number(available?.quantity || 0);
}

function normalizeGiftVariants(data) {
  const out = {};

  for (const [sku, alias] of Object.entries(GIFT_SKU_ALIAS_MAP)) {
    const edges = data[alias]?.edges || [];
    const edge = edges[0];

    if (!edge) {
      out[sku] = null;
      continue;
    }

    out[sku] = {
      variantId: edge.node.id,
      sku: edge.node.sku,
      productTitle: edge.node.product?.title || null,
      title: edge.node.title || null,
      available: getAvailableQuantityFromVariantEdge(edge),
      matchCount: edges.length,
    };
  }

  return out;
}

function normalizeOrders(data, requestedOrderNumbers) {
  return requestedOrderNumbers.map((requestedNumber, index) => {
    const connection = data[`order_${index}`];
    const order = connection?.edges?.[0]?.node || null;

    if (!order) {
      return {
        requestedNumber,
        found: false,
      };
    }

    const subtotal = Number(order.currentSubtotalPriceSet?.shopMoney?.amount || 0);
    const lineItems = (order.lineItems?.edges || []).map((edge) => ({
      id: edge.node.id,
      title: edge.node.title,
      sku: edge.node.sku,
      quantity: edge.node.quantity,
      unfulfilledQuantity: edge.node.unfulfilledQuantity,
      merchantEditable: edge.node.merchantEditable,
    }));

    return {
      requestedNumber,
      found: true,
      id: order.id,
      name: order.name,
      number: order.number,
      currencyCode: order.currencyCode,
      presentmentCurrencyCode: order.presentmentCurrencyCode,
      displayFinancialStatus: order.displayFinancialStatus,
      displayFulfillmentStatus: order.displayFulfillmentStatus,
      merchantEditable: order.merchantEditable,
      merchantEditableErrors: order.merchantEditableErrors || [],
      edited: order.edited,
      tags: order.tags || [],
      subtotal,
      lineItems,
    };
  });
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

function planAssignments(orders, gifts) {
  const stock = {};

  for (const [sku, gift] of Object.entries(gifts)) {
    stock[sku] = gift?.available ?? 0;
  }

  const foundOrders = orders.filter((o) => o.found);
  const notFoundOrders = orders.filter((o) => !o.found);
  const sorted = [...foundOrders].sort((a, b) => b.subtotal - a.subtotal);

  const results = [];

  for (const order of sorted) {
    const base = {
      orderId: order.id,
      orderNumber: order.number,
      orderName: order.name,
      subtotal: order.subtotal,
      currencyCode: order.currencyCode,
      plannedTier: "",
      plannedSku: "",
      status: "",
      reason: "",
    };

    if (order.tags.includes(SKIP_TAG)) {
      results.push({
        ...base,
        status: "skipped",
        reason: `Order has skip tag: ${SKIP_TAG}`,
      });
      continue;
    }

    if (order.tags.includes(SUCCESS_TAG)) {
      results.push({
        ...base,
        status: "skipped",
        reason: `Order already processed tag present: ${SUCCESS_TAG}`,
      });
      continue;
    }

    if (!order.merchantEditable) {
      results.push({
        ...base,
        status: "failed",
        reason: `Order not editable: ${(order.merchantEditableErrors || []).join("; ")}`,
      });
      continue;
    }

    if (order.displayFulfillmentStatus !== "UNFULFILLED") {
      results.push({
        ...base,
        status: "skipped",
        reason: `Order fulfillment status is ${order.displayFulfillmentStatus}, not UNFULFILLED`,
      });
      continue;
    }

    if (order.currencyCode !== "EUR" || order.presentmentCurrencyCode !== "EUR") {
      results.push({
        ...base,
        status: "failed",
        reason: `Order currency mismatch. currencyCode=${order.currencyCode}, presentmentCurrencyCode=${order.presentmentCurrencyCode}`,
      });
      continue;
    }

    const tierRule = pickTier(order.subtotal);

    if (!tierRule) {
      results.push({
        ...base,
        status: "skipped",
        reason: `Subtotal ${order.subtotal.toFixed(2)} is below €50 threshold`,
      });
      continue;
    }

    let selectedSku = null;
    let selectedGift = null;

    for (const sku of tierRule.skus) {
      const gift = gifts[sku];
      const qty = stock[sku] ?? 0;

      if (gift && gift.matchCount === 1 && qty > 0) {
        selectedSku = sku;
        selectedGift = gift;
        break;
      }
    }

    if (!selectedSku || !selectedGift) {
      const stockView = tierRule.skus
        .map((sku) => `${sku}=${stock[sku] ?? 0}`)
        .join(", ");

      results.push({
        ...base,
        plannedTier: tierRule.tier,
        status: "failed",
        reason: `No stock left for any SKU in tier ${tierRule.tier}. Candidates: ${stockView}`,
      });
      continue;
    }

    stock[selectedSku] -= 1;

    results.push({
      ...base,
      plannedTier: tierRule.tier,
      plannedSku: selectedSku,
      status: "planned",
      reason: `Eligible. Selected ${selectedSku}. Remaining simulated stock: ${stock[selectedSku]}`,
    });
  }

  for (const order of notFoundOrders) {
    results.push({
      orderId: "",
      orderNumber: order.requestedNumber,
      orderName: `#${order.requestedNumber}`,
      subtotal: "",
      currencyCode: "",
      plannedTier: "",
      plannedSku: "",
      status: "failed",
      reason: "Order not found",
    });
  }

  return {
    results,
    endingSimulatedStock: stock,
  };
}

async function main() {
  requireEnv("SHOPIFY_SHOP", SHOP);
  requireEnv("SHOPIFY_CLIENT_ID", CLIENT_ID);
  requireEnv("SHOPIFY_CLIENT_SECRET", CLIENT_SECRET);

  const args = parseArgs(process.argv);

  if (!args.orderNumbers.length) {
    throw new Error(
      "No order numbers were supplied. Add TEST_ORDER_NUMBERS to .env or pass --orders=126257,126258"
    );
  }

  const accessToken = await getAccessToken();

  const [variantData, orderData] = await Promise.all([
    gql(accessToken, VARIANTS_QUERY),
    gql(accessToken, buildOrdersQuery(args.orderNumbers)),
  ]);

  const gifts = normalizeGiftVariants(variantData);
  const orders = normalizeOrders(orderData, args.orderNumbers);
  const plan = planAssignments(orders, gifts);

  const output = {
    fetchedAt: new Date().toISOString(),
    shop: SHOP,
    apiVersion: API_VERSION,
    mode: "dry-run",
    selectedOrderNumbers: args.orderNumbers,
    locationId: LOCATION_ID,
    giftRules: GIFT_RULES,
    initialGiftStock: Object.fromEntries(
      Object.entries(gifts).map(([sku, gift]) => [sku, gift?.available ?? 0])
    ),
    gifts,
    results: plan.results,
    endingSimulatedStock: plan.endingSimulatedStock,
    summary: {
      planned: plan.results.filter((r) => r.status === "planned").length,
      skipped: plan.results.filter((r) => r.status === "skipped").length,
      failed: plan.results.filter((r) => r.status === "failed").length,
    },
  };

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `step2-plan-${timestamp}.json`);
  const csvPath = path.join(outDir, `step2-plan-${timestamp}.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), "utf8");
  fs.writeFileSync(csvPath, makeCsv(plan.results), "utf8");

  console.log("\nDRY RUN RESULTS\n");
  for (const row of plan.results) {
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
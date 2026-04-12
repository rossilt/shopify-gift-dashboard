require("dotenv").config();

const fs = require("fs");
const path = require("path");

const SHOP = (process.env.SHOPIFY_SHOP || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

const TEST_ORDER_NUMBERS = (process.env.TEST_ORDER_NUMBERS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

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

const GIFT_SKUS = new Set(Object.keys(GIFT_SKU_ALIAS_MAP));
const SUCCESS_TAG = "mask-gift-added";

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function pickTier(subtotal) {
  for (const rule of GIFT_RULES) {
    if (subtotal >= rule.min && subtotal < rule.maxExclusive) {
      return {
        tier: rule.tier,
        candidateSkus: rule.skus,
      };
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

function buildOrderDiagnosticsQuery(orderNumbers) {
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
            tags
            edited
            currentSubtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 50) {
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

  return `query TestOrdersDiagnostics { ${blocks} }`;
}

const SCOPES_QUERY = `
  query AccessScopeList {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

const LOCATIONS_QUERY = `
  query LocationList {
    locations(first: 20) {
      edges {
        node {
          id
          name
          address {
            formatted
          }
        }
      }
    }
  }
`;

const VARIANTS_AND_INVENTORY_QUERY = `
  query GiftVariantsAndInventory {
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
            inventoryLevels(first: 20) {
              edges {
                node {
                  location {
                    id
                    name
                  }
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
            inventoryLevels(first: 20) {
              edges {
                node {
                  location {
                    id
                    name
                  }
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
            inventoryLevels(first: 20) {
              edges {
                node {
                  location {
                    id
                    name
                  }
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
            inventoryLevels(first: 20) {
              edges {
                node {
                  location {
                    id
                    name
                  }
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
            inventoryLevels(first: 20) {
              edges {
                node {
                  location {
                    id
                    name
                  }
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
    }
  }
`;

function normalizeLocations(data) {
  return (data.locations?.edges || []).map((edge) => ({
    id: edge.node.id,
    name: edge.node.name,
    address: edge.node.address?.formatted || [],
  }));
}

function normalizeVariantGroup(group) {
  return (group?.edges || []).map((edge) => ({
    id: edge.node.id,
    sku: edge.node.sku,
    title: edge.node.title,
    productTitle: edge.node.product?.title || null,
    inventoryItemId: edge.node.inventoryItem?.id || null,
    inventoryByLocation: (edge.node.inventoryItem?.inventoryLevels?.edges || []).map(
      (levelEdge) => ({
        locationId: levelEdge.node.location?.id || null,
        locationName: levelEdge.node.location?.name || null,
        quantities: levelEdge.node.quantities || [],
      })
    ),
  }));
}

function normalizeOrders(data) {
  return TEST_ORDER_NUMBERS.map((requestedNumber, index) => {
    const connection = data[`order_${index}`];
    const order = connection?.edges?.[0]?.node || null;

    if (!order) {
      return {
        requestedNumber,
        found: false,
      };
    }

    const subtotal = Number(order.currentSubtotalPriceSet?.shopMoney?.amount || 0);
    const picked = pickTier(subtotal);

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
      subtotalShopMoney: order.currentSubtotalPriceSet?.shopMoney || null,
      expectedGiftRule: picked,
      alreadyTaggedAsProcessed: (order.tags || []).includes(SUCCESS_TAG),
      containsAnyGiftSku: lineItems.some((line) => GIFT_SKUS.has(line.sku)),
      lineItems,
    };
  });
}

async function main() {
  requireEnv("SHOPIFY_SHOP", SHOP);
  requireEnv("SHOPIFY_CLIENT_ID", CLIENT_ID);
  requireEnv("SHOPIFY_CLIENT_SECRET", CLIENT_SECRET);

  const accessToken = await getAccessToken();

  const [scopesData, locationsData, variantsData, ordersData] = await Promise.all([
    gql(accessToken, SCOPES_QUERY),
    gql(accessToken, LOCATIONS_QUERY),
    gql(accessToken, VARIANTS_AND_INVENTORY_QUERY),
    gql(accessToken, buildOrderDiagnosticsQuery(TEST_ORDER_NUMBERS)),
  ]);

  const result = {
    fetchedAt: new Date().toISOString(),
    shop: SHOP,
    apiVersion: API_VERSION,
    giftRules: GIFT_RULES,
    requiredScopesChecklist: [
      "read_orders",
      "write_orders",
      "write_order_edits",
      "read_products",
      "read_inventory",
      "read_locations",
    ],
    grantedScopes: (scopesData.currentAppInstallation?.accessScopes || []).map(
      (scope) => scope.handle
    ),
    locations: normalizeLocations(locationsData),
    maskVariants: {
      P0268S: normalizeVariantGroup(variantsData.sku_0268),
      P0310S: normalizeVariantGroup(variantsData.sku_0310),
      P1527S: normalizeVariantGroup(variantsData.sku_1527),
      P0566S: normalizeVariantGroup(variantsData.sku_0566),
      P1988S: normalizeVariantGroup(variantsData.sku_1988),
    },
    testOrders: normalizeOrders(ordersData),
  };

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, "step1-check.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(JSON.stringify(result, null, 2));
  console.log(`\nSaved diagnostics to: ${outFile}`);
}

main().catch((error) => {
  console.error("\nERROR:\n");
  console.error(error);
  process.exit(1);
});
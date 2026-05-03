const express = require("express");

const { LOCATION_ID } = require("../config");
const { getAccessToken, gql } = require("../services/shopifyClient");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
});

const PRODUCT_VARIANT_SEARCH = `
  query ProductVariantSearch($query: String!, $first: Int!, $locationId: ID!) {
    productVariants(first: $first, query: $query) {
      edges {
        node {
          id
          sku
          title
          image {
            url(transform: { maxWidth: 80, maxHeight: 80 })
          }
          product {
            id
            title
            featuredImage {
              url(transform: { maxWidth: 80, maxHeight: 80 })
            }
          }
          inventoryItem {
            inventoryLevel(locationId: $locationId) {
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

function getAvailable(node) {
  const quantities = node?.inventoryItem?.inventoryLevel?.quantities || [];
  const available = quantities.find((q) => q.name === "available");
  return Number(available?.quantity || 0);
}

function buildSearchString(raw) {
  const term = String(raw || "").trim();
  if (!term) return "";

  // Pass the term as-is so Shopify's default full-text search runs across SKU,
  // variant title, and product title in one go. Field-qualified wildcard queries
  // like `sku:*foo bar*` break on multi-word input because the unquoted space is
  // parsed as an AND between two separate clauses.
  return term.replace(/["\\]/g, "\\$&");
}

function escapeSkuForQuery(sku) {
  return String(sku).replace(/["\\]/g, "\\$&");
}

function variantPayload(node) {
  return {
    variantId: node.id,
    sku: node.sku || "",
    variantTitle: node.title || "",
    productTitle: node.product?.title || "",
    image: node.image?.url || node.product?.featuredImage?.url || null,
    available: getAvailable(node),
  };
}

router.use(requireAuth);

router.get("/products/search", async (req, res, next) => {
  try {
    const queryString = buildSearchString(req.query.q);

    if (!queryString) {
      return res.json({ results: [] });
    }

    if (!LOCATION_ID) {
      throw new Error("Missing LOCATION_ID in .env");
    }

    const accessToken = await getAccessToken();
    const data = await gql(
      PRODUCT_VARIANT_SEARCH,
      { query: queryString, first: 15, locationId: LOCATION_ID },
      accessToken
    );

    const results = (data.productVariants?.edges || [])
      .map((edge) => variantPayload(edge.node))
      .filter((variant) => variant.sku);

    res.json({ results });
  } catch (error) {
    next(error);
  }
});

router.get("/products/lookup", async (req, res, next) => {
  try {
    const skus = String(req.query.skus || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (skus.length === 0) {
      return res.json({ variants: {} });
    }

    if (!LOCATION_ID) {
      throw new Error("Missing LOCATION_ID in .env");
    }

    const queryString = skus.map((sku) => `sku:${escapeSkuForQuery(sku)}`).join(" OR ");

    const accessToken = await getAccessToken();
    const data = await gql(
      PRODUCT_VARIANT_SEARCH,
      { query: queryString, first: Math.max(skus.length * 2, 10), locationId: LOCATION_ID },
      accessToken
    );

    const bySku = {};
    for (const edge of data.productVariants?.edges || []) {
      const variant = variantPayload(edge.node);
      if (!variant.sku) continue;

      if (!bySku[variant.sku]) {
        bySku[variant.sku] = variant;
      }
    }

    res.json({ variants: bySku });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

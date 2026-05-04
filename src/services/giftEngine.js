const {
  LOCATION_ID,
  SUCCESS_TAG,
  CHECKED_TAG,
  SKIP_TAG,
  GIFT_REASON,
  SHOP,
  API_VERSION,
} = require("../config");

const {
  DEFAULT_GIFT_RULES,
  normalizeGiftRules,
  pickTier,
} = require("./giftRules");
const { getAccessToken, gql } = require("./shopifyClient");

function collectUniqueSkus(giftRules) {
  return [
    ...new Set(
      giftRules
        .flatMap((rule) => (Array.isArray(rule.skus) ? rule.skus : []))
        .map((sku) => String(sku).trim())
        .filter(Boolean)
    ),
  ];
}

function buildSkuAliasMap(giftRules) {
  const skus = collectUniqueSkus(giftRules);
  const aliasMap = {};

  skus.forEach((sku, index) => {
    aliasMap[sku] = `sku_${index}`;
  });

  return aliasMap;
}

function buildSelectedOrdersQuery(orderNumbers) {
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

function buildVariantsQuery(giftRules) {
  const aliasMap = buildSkuAliasMap(giftRules);
  const uniqueSkus = Object.keys(aliasMap);

  if (uniqueSkus.length === 0) {
    throw new Error("No SKUs configured in gift rules");
  }

  const blocks = uniqueSkus
    .map(
      (sku) => `
      ${aliasMap[sku]}: productVariants(first: 5, query: "sku:${sku}") {
        edges {
          node {
            id
            sku
            title
            product { title }
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
      }`
    )
    .join("\n");

  return {
    query: `query GiftVariants { ${blocks} }`,
    aliasMap,
  };
}

const ALL_UNFULFILLED_ORDERS_QUERY = `
  query AllUnfulfilledOrders($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        cursor
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ORDER_EDIT_BEGIN = `
  mutation orderEditBegin($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ORDER_EDIT_ADD_VARIANT = `
  mutation orderEditAddVariant(
    $id: ID!,
    $variantId: ID!,
    $locationId: ID,
    $quantity: Int!,
    $allowDuplicates: Boolean
  ) {
    orderEditAddVariant(
      id: $id,
      variantId: $variantId,
      locationId: $locationId,
      quantity: $quantity,
      allowDuplicates: $allowDuplicates
    ) {
      calculatedLineItem {
        id
        title
        quantity
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ORDER_EDIT_ADD_DISCOUNT = `
  mutation orderEditAddLineItemDiscount(
    $id: ID!,
    $lineItemId: ID!,
    $discount: OrderEditAppliedDiscountInput!
  ) {
    orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
      calculatedLineItem {
        id
      }
      addedDiscountStagedChange {
        id
        description
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ORDER_EDIT_COMMIT = `
  mutation orderEditCommit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
      order {
        id
        name
        tags
      }
      successMessages
      userErrors {
        field
        message
      }
    }
  }
`;

const TAGS_ADD = `
  mutation addTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function getAvailableQuantityFromVariantEdge(edge) {
  const quantities = edge?.node?.inventoryItem?.inventoryLevel?.quantities || [];
  const available = quantities.find((q) => q.name === "available");
  return Number(available?.quantity || 0);
}

function normalizeGiftVariants(data, aliasMap) {
  const out = {};

  for (const [sku, alias] of Object.entries(aliasMap)) {
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

function normalizeOrderNode(order) {
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
}

function normalizeSelectedOrders(data, requestedOrderNumbers) {
  return requestedOrderNumbers.map((requestedNumber, index) => {
    const connection = data[`order_${index}`];
    const order = connection?.edges?.[0]?.node || null;

    if (!order) {
      return {
        requestedNumber,
        found: false,
      };
    }

    return {
      requestedNumber,
      ...normalizeOrderNode(order),
    };
  });
}

async function fetchGiftVariants(accessToken, giftRules) {
  const effectiveGiftRules = normalizeGiftRules(giftRules);
  const { query, aliasMap } = buildVariantsQuery(effectiveGiftRules);
  const data = await gql(query, {}, accessToken);

  return normalizeGiftVariants(data, aliasMap);
}

async function fetchSelectedOrders(accessToken, orderNumbers) {
  if (!Array.isArray(orderNumbers) || orderNumbers.length === 0) {
    return [];
  }

  const data = await gql(buildSelectedOrdersQuery(orderNumbers), {}, accessToken);
  return normalizeSelectedOrders(data, orderNumbers);
}

async function fetchAllUnfulfilledOrders(accessToken, limit = null) {
  const queryString = [
    "status:open",
    "fulfillment_status:unfulfilled",
    `tag_not:${CHECKED_TAG}`,
    `tag_not:${SUCCESS_TAG}`,
    `tag_not:${SKIP_TAG}`,
  ].join(" ");

  const orders = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const pageSize =
      limit == null ? 100 : Math.max(1, Math.min(100, limit - orders.length));

    if (pageSize <= 0) {
      break;
    }

    const data = await gql(
      ALL_UNFULFILLED_ORDERS_QUERY,
      {
        first: pageSize,
        after,
        query: queryString,
      },
      accessToken
    );

    const connection = data.orders;
    const edges = connection?.edges || [];

    for (const edge of edges) {
      orders.push(normalizeOrderNode(edge.node));

      if (limit != null && orders.length >= limit) {
        break;
      }
    }

    if (limit != null && orders.length >= limit) {
      break;
    }

    hasNextPage = connection?.pageInfo?.hasNextPage || false;
    after = connection?.pageInfo?.endCursor || null;
  }

  return orders;
}

function planAssignments(orders, gifts, giftRules) {
  const effectiveGiftRules = normalizeGiftRules(giftRules);
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
      plannedTier: "",
      plannedSku: "",
      plannedVariantId: "",
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

    const tierRule = pickTier(order.subtotal, effectiveGiftRules);

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
      plannedVariantId: selectedGift.variantId,
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
      plannedTier: "",
      plannedSku: "",
      plannedVariantId: "",
      status: "failed",
      reason: "Order not found",
    });
  }

  return { results, endingSimulatedStock: stock };
}

async function applyGiftToOrder(accessToken, row, reasonText) {
  const beginData = await gql(
    ORDER_EDIT_BEGIN,
    {
      id: row.orderId,
    },
    accessToken
  );

  const beginPayload = beginData.orderEditBegin;
  if (!beginPayload) {
    throw new Error("orderEditBegin returned no payload");
  }

  if (beginPayload.userErrors?.length) {
    throw new Error(
      `orderEditBegin userErrors: ${JSON.stringify(beginPayload.userErrors)}`
    );
  }

  const calculatedOrderId = beginPayload.calculatedOrder?.id;
  if (!calculatedOrderId) {
    throw new Error("orderEditBegin did not return calculatedOrder.id");
  }

  const addVariantData = await gql(
    ORDER_EDIT_ADD_VARIANT,
    {
      id: calculatedOrderId,
      variantId: row.plannedVariantId,
      locationId: LOCATION_ID,
      quantity: 1,
      allowDuplicates: true,
    },
    accessToken
  );

  const addVariantPayload = addVariantData.orderEditAddVariant;
  if (!addVariantPayload) {
    throw new Error("orderEditAddVariant returned no payload");
  }

  if (addVariantPayload.userErrors?.length) {
    throw new Error(
      `orderEditAddVariant userErrors: ${JSON.stringify(addVariantPayload.userErrors)}`
    );
  }

  const calculatedLineItemId = addVariantPayload.calculatedLineItem?.id;
  if (!calculatedLineItemId) {
    throw new Error("orderEditAddVariant did not return calculatedLineItem.id");
  }

  const discountData = await gql(
    ORDER_EDIT_ADD_DISCOUNT,
    {
      id: calculatedOrderId,
      lineItemId: calculatedLineItemId,
      discount: {
        description: reasonText,
        percentValue: 100,
      },
    },
    accessToken
  );

  const discountPayload = discountData.orderEditAddLineItemDiscount;
  if (!discountPayload) {
    throw new Error("orderEditAddLineItemDiscount returned no payload");
  }

  if (discountPayload.userErrors?.length) {
    throw new Error(
      `orderEditAddLineItemDiscount userErrors: ${JSON.stringify(discountPayload.userErrors)}`
    );
  }

  const commitData = await gql(
    ORDER_EDIT_COMMIT,
    {
      id: calculatedOrderId,
      notifyCustomer: false,
      staffNote: reasonText,
    },
    accessToken
  );

  const commitPayload = commitData.orderEditCommit;
  if (!commitPayload) {
    throw new Error("orderEditCommit returned no payload");
  }

  if (commitPayload.userErrors?.length) {
    throw new Error(
      `orderEditCommit userErrors: ${JSON.stringify(commitPayload.userErrors)}`
    );
  }

  const tagsData = await gql(
    TAGS_ADD,
    {
      id: row.orderId,
      tags: [SUCCESS_TAG, CHECKED_TAG, `mask-gift-sku-${row.plannedSku}`],
    },
    accessToken
  );

  const tagsPayload = tagsData.tagsAdd;
  if (!tagsPayload) {
    throw new Error("tagsAdd returned no payload");
  }

  if (tagsPayload.userErrors?.length) {
    throw new Error(`tagsAdd userErrors: ${JSON.stringify(tagsPayload.userErrors)}`);
  }

  return {
    calculatedOrderId,
    calculatedLineItemId,
    successMessages: commitPayload.successMessages || [],
  };
}

async function markOrderChecked(accessToken, orderId) {
  const data = await gql(TAGS_ADD, { id: orderId, tags: [CHECKED_TAG] }, accessToken);
  const payload = data.tagsAdd;

  if (!payload) {
    throw new Error("tagsAdd returned no payload");
  }

  if (payload.userErrors?.length) {
    throw new Error(`tagsAdd userErrors: ${JSON.stringify(payload.userErrors)}`);
  }
}

async function runGiftJob({
  apply = false,
  allUnfulfilled = false,
  orderNumbers = [],
  limit = null,
  reasonText = GIFT_REASON,
  giftRules = DEFAULT_GIFT_RULES,
} = {}) {
  if (!LOCATION_ID) {
    throw new Error("Missing LOCATION_ID in .env");
  }

  const effectiveGiftRules = normalizeGiftRules(giftRules);

  if (!allUnfulfilled && (!Array.isArray(orderNumbers) || orderNumbers.length === 0)) {
    throw new Error("Pass orderNumbers or set allUnfulfilled=true");
  }

  const accessToken = await getAccessToken();
  const gifts = await fetchGiftVariants(accessToken, effectiveGiftRules);

  let orders = [];
  let selectionMode = "";

  if (allUnfulfilled) {
    selectionMode = "all-unfulfilled";
    orders = await fetchAllUnfulfilledOrders(accessToken, limit);
  } else {
    selectionMode = "selected-orders";
    orders = await fetchSelectedOrders(accessToken, orderNumbers);
  }

  const plan = planAssignments(orders, gifts, effectiveGiftRules);
  const results = [];

  if (!apply) {
    results.push(...plan.results);
  } else {
    for (const row of plan.results) {
      if (row.status !== "planned") {
        // Mark every processed order as checked, even when the engine decided
        // not to add a gift, so the merchant can see what was evaluated and
        // future runs don't re-fetch the same order.
        if (row.orderId) {
          try {
            await markOrderChecked(accessToken, row.orderId);
          } catch (error) {
            results.push({
              ...row,
              reason: `${row.reason} | Failed to add ${CHECKED_TAG} tag: ${error.message}`.trim(),
            });
            continue;
          }
        }

        results.push(row);
        continue;
      }

      try {
        const applyResult = await applyGiftToOrder(accessToken, row, reasonText);
        results.push({
          ...row,
          status: "applied",
          reason: `Gift added with reason ${reasonText}, discounted 100%, committed, and tagged. ${applyResult.successMessages.join(" | ")}`.trim(),
        });
      } catch (error) {
        // Apply failed mid-flight (transient/network/GraphQL error). Do NOT
        // mark as checked so the next run can retry this order.
        results.push({
          ...row,
          status: "failed",
          reason: error.message,
        });
      }
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    shop: SHOP,
    apiVersion: API_VERSION,
    mode: apply ? "apply" : "dry-run",
    selectionMode,
    limit,
    selectedOrderNumbers: allUnfulfilled ? null : orderNumbers,
    locationId: LOCATION_ID,
    giftReason: reasonText,
    giftRules: effectiveGiftRules,
    initialGiftStock: Object.fromEntries(
      Object.entries(gifts).map(([sku, gift]) => [sku, gift?.available ?? 0])
    ),
    gifts,
    results,
    endingSimulatedStock: plan.endingSimulatedStock,
    summary: {
      applied: results.filter((r) => r.status === "applied").length,
      planned: results.filter((r) => r.status === "planned").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      totalFetchedOrders: orders.length,
    },
  };
}

module.exports = {
  fetchGiftVariants,
  fetchSelectedOrders,
  fetchAllUnfulfilledOrders,
  planAssignments,
  applyGiftToOrder,
  markOrderChecked,
  runGiftJob,
};
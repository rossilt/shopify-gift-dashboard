const {
  SHOP,
  CLIENT_ID,
  CLIENT_SECRET,
  API_VERSION,
} = require("../config");

function requireShopifyEnv() {
  if (!SHOP) throw new Error("Missing SHOPIFY_SHOP in .env");
  if (!CLIENT_ID) throw new Error("Missing SHOPIFY_CLIENT_ID in .env");
  if (!CLIENT_SECRET) throw new Error("Missing SHOPIFY_CLIENT_SECRET in .env");
}

async function getAccessToken() {
  requireShopifyEnv();

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

async function gql(query, variables = {}, accessToken = null) {
  requireShopifyEnv();

  const token = accessToken || (await getAccessToken());

  const response = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
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

module.exports = {
  getAccessToken,
  gql,
};
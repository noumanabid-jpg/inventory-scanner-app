import { getStore } from "@netlify/blobs";

const STORE = "inventory";

/**
 * Uses Netlify platform credentials by default.
 * If NETLIFY_SITE_ID + NETLIFY_ACCESS_TOKEN are present, switches to manual mode.
 */
export function getInventoryStore() {
  const opts = { name: STORE };

  const siteID =
    process.env.NETLIFY_SITE_ID || process.env.SITE_ID || "";
  const token =
    process.env.NETLIFY_ACCESS_TOKEN ||
    process.env.NETLIFY_API_TOKEN ||
    process.env.TOKEN ||
    "";

  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }

  return getStore(opts);
}

export function json(res, status = 200) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(res),
  };
}

export function bad(res, status = 400) {
  return json(
    { error: typeof res === "string" ? res : "Bad Request", detail: res },
    status
  );
}

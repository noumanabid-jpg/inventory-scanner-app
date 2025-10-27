import { getStore } from "@netlify/blobs";

const STORE = "inventory";

export function getInventoryStore() {
  // On live Netlify, credentials are injected automatically.
  return getStore({ name: STORE });
}

export function json(res, status = 200) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(res),
  };
}

export function bad(res, status = 400) {
  return json({ error: typeof res === "string" ? res : "Bad Request", detail: res }, status);
}

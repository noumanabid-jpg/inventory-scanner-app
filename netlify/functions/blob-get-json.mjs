// netlify/functions/blob-get-json.mjs
import { getInventoryStore, json, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return bad("Use GET", 405);
  const key = event.queryStringParameters?.key;
  if (!key) return bad("Missing key", 400);

  try {
    const store = getInventoryStore();
    const text = await store.get(key, { type: "text" });
    if (text == null) return json({ data: null }); // no scans yet
    return json(JSON.parse(text));
  } catch (e) {
    return bad(`Get JSON error: ${e?.message || e}`, 500);
  }
}

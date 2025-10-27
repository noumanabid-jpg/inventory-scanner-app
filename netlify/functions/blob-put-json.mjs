// netlify/functions/blob-put-json.mjs
import { getInventoryStore, json, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "POST") return bad("Use POST", 405);
  const key = event.queryStringParameters?.key;
  if (!key) return bad("Missing key", 400);

  try {
    const store = getInventoryStore();
    const data = event.body ? JSON.parse(event.body) : {};
    const buf = Buffer.from(JSON.stringify(data), "utf8");
    await store.set(key, buf, { contentType: "application/json" });
    return json({ ok: true, key });
  } catch (e) {
    return bad(`Put JSON error: ${e?.message || e}`, 500);
  }
}

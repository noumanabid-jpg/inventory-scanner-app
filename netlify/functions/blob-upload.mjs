import { getInventoryStore, json, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "POST") return bad("Use POST", 405);
  const ns = event.queryStringParameters?.ns || "default";
  const name = event.queryStringParameters?.name || "file.csv";
  if (!event.isBase64Encoded) return bad("Body must be base64 encoded file bytes");
  try {
    const bytes = Buffer.from(event.body, "base64");
    const key = `${ns}/${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const store = getInventoryStore();
    await store.set(key, bytes, { contentType: "text/csv" });
    return json({ ok: true, key });
  } catch (e) {
    return bad(e?.message || "Upload failed", 500);
  }
}
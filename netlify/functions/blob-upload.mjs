import { getInventoryStore, json, bad } from "./_blob-common.mjs";

function sanitizeName(s = "file.csv") {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return bad("Use POST", 405);

  const ns = event.queryStringParameters?.ns || "default";
  const name = sanitizeName(event.queryStringParameters?.name || "file.csv");

  try {
    if (!event.body) return bad("Empty body", 400);

    // Try to decode as base64 first; if that fails, fall back to utf8.
    let bytes;
    try {
      bytes = Buffer.from(event.body, "base64");
      // If decode produced empty but body isn't empty, fall back
      if (bytes.length === 0 && event.body.length > 0) {
        bytes = Buffer.from(event.body, "utf8");
      }
    } catch {
      bytes = Buffer.from(event.body, "utf8");
    }

    const key = `${ns}/${Date.now()}_${name}`;
    const store = getInventoryStore();
    await store.set(key, bytes, { contentType: "text/csv" });

    return json({ ok: true, key });
  } catch (e) {
    return bad(e?.message || "Upload failed", 500);
  }
}

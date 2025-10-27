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

    // Body is base64 from the app; fall back to utf8 if needed
    let bytes;
    try {
      bytes = Buffer.from(event.body, "base64");
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
    return bad(`Upload error: ${e?.message || e}`, 500);
  }
}

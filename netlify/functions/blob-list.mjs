// netlify/functions/blob-list.mjs
import { getInventoryStore, json, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return bad("Use GET", 405);
  const ns = event.queryStringParameters?.ns || "default";
  try {
    const store = getInventoryStore();
    // use prefix without forced trailing slash (catches both ns and ns/)
    const out = await store.list({ prefix: ns });
    const files = out?.objects || out?.blobs || [];

    const normalized = files
      .map((f) => ({
        key: f.key || f.name || f.id,
        size: f.size ?? f.bytes ?? null,
        uploadedAt: f.uploadedAt || f.uploaded_at || null,
      }))
      .filter((f) => f.key);

    return json({ ok: true, ns, files: normalized });
  } catch (e) {
    return bad(`List error: ${e?.message || e}`, 500);
  }
}

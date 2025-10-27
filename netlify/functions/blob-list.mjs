import { getInventoryStore, json, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return bad("Use GET", 405);
  const ns = event.queryStringParameters?.ns || "default";

  try {
    const store = getInventoryStore();

    // Try with trailing slash first (folder-like), then without
    let out = await store.list({ prefix: `${ns}/` });
    let files = out?.objects || out?.blobs || [];
    if (!files.length) {
      out = await store.list({ prefix: ns });
      files = out?.objects || out?.blobs || [];
    }

    // Normalize and keep only CSVs
    const normalized = files
      .map((f) => ({
        key: f.key || f.name || f.id,
        size: f.size ?? f.bytes ?? null,
        uploadedAt: f.uploadedAt || f.uploaded_at || null,
      }))
      .filter((f) => f.key && /\.csv$/i.test(f.key));

    // Sort newest first (fallback to key)
    normalized.sort((a, b) => {
      const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return (b.key || "").localeCompare(a.key || "");
    });

    return json({ ok: true, ns, files: normalized });
  } catch (e) {
    return bad(`List error: ${e?.message || e}`, 500);
  }
}

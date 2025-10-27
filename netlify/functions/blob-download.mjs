// netlify/functions/blob-download.mjs
import { getInventoryStore, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return bad("Use GET", 405);
  const key = event.queryStringParameters?.key;
  if (!key) return bad("Missing key", 400);

  try {
    const store = getInventoryStore();

    // ✅ Ask Netlify Blobs to give us text directly
    const text = await store.get(key, { type: "text" });
    if (text == null) return bad(`Not found: ${key}`, 404);

    return {
      statusCode: 200,
      headers: {
        "content-type": /\.csv$/i.test(key)
          ? "text/csv; charset=utf-8"
          : "text/plain; charset=utf-8",
        "access-control-allow-origin": "*",
      },
      body: text,            // plain CSV text
      isBase64Encoded: false // important: not base64
    };
  } catch (e) {
    return bad(`Download error: ${e?.message || e}`, 500);
  }
}

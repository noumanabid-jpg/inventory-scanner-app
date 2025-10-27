// netlify/functions/blob-download.mjs
import { getInventoryStore, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return bad("Use GET", 405);
  const key = event.queryStringParameters?.key;
  if (!key) return bad("Missing key", 400);

  try {
    const store = getInventoryStore();
    const blob = await store.get(key);
    if (!blob) return bad("Not found", 404);

    // Explicitly treat CSV as text
    const type = /\.csv$/i.test(key)
      ? "text/csv; charset=utf-8"
      : "application/octet-stream";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
      },
      body: await blob.text(), // ✅ always convert to text
    };
  } catch (e) {
    return bad(`Download error: ${e.message || e}`, 500);
  }
}

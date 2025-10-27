// netlify/functions/blob-download.mjs
import { getInventoryStore, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return bad("Use GET", 405);
  const key = event.queryStringParameters?.key;
  if (!key) return bad("Missing key", 400);

  try {
    const store = getInventoryStore();
    const text = await store.get(key, { type: "text" }); // simple & robust
    if (text == null) return bad(`Not found: ${key}`, 404);

    return {
      statusCode: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `inline; filename="${key.split("/").pop()}"`,
      },
      body: text,
      isBase64Encoded: false,
    };
  } catch (e) {
    return bad(`Download error: ${e?.message || e}`, 500);
  }
}

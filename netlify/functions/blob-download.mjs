import { getInventoryStore, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return bad("Use GET", 405);
  const key = event.queryStringParameters?.key;
  if (!key) return bad("Missing key", 400);

  try {
    const store = getInventoryStore();

    // Read as plain text (CSV). Simple, robust in Netlify Functions.
    const text = await store.get(key, { type: "text" });
    if (text == null) return bad(`Not found: ${key}`, 404);

    return {
      statusCode: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `inline; filename="${key.split("/").pop()}"`,
      },
      body: text,                // <-- return CSV text
      isBase64Encoded: false,    // <-- plain text response
    };
  } catch (e) {
    return bad(`Download error: ${e?.message || e}`, 500);
  }
}

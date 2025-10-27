import { getInventoryStore, bad } from "./_blob-common.mjs";

export async function handler(event) {
  if (event.httpMethod !== "GET") return bad("Use GET", 405);
  const key = event.queryStringParameters?.key;
  if (!key) return bad("Missing key", 400);

  try {
    const store = getInventoryStore();
    const bytes = await store.get(key, { type: "bytes" }); // simpler & reliable
    if (!bytes || !bytes.length) return bad(`Not found or empty: ${key}`, 404);

    const base64 = Buffer.from(bytes).toString("base64");
    return {
      statusCode: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": `inline; filename="${key.split("/").pop()}"`,
      },
      body: base64,
      isBase64Encoded: true,
    };
  } catch (e) {
    return bad(`Download error: ${e?.message || e}`, 500);
  }
}

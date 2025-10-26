import { getInventoryStore, bad } from "./_blob-common.mjs";
export async function handler(event){
  if(event.httpMethod!=="GET") return bad("Use GET",405);
  const key=event.queryStringParameters?.key;
  if(!key) return bad("Missing key");
  try{
    const store=getInventoryStore();
    const blob=await store.get(key,{ type:"stream" });
    if(!blob) return bad("Not found",404);
    return {
      statusCode:200,
      headers:{ "content-type":"text/csv", "content-disposition": `inline; filename="${key.split("/").pop()}"` },
      body: await streamToBase64(blob.body),
      isBase64Encoded:true
    };
  }catch(e){ return bad(e?.message||"Download failed",500); }
}
async function streamToBase64(stream){ const chunks=[]; for await(const c of stream) chunks.push(c); return Buffer.concat(chunks).toString("base64"); }
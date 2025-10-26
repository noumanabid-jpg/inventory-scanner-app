import { getInventoryStore, bad } from "./_blob-common.mjs";
export async function handler(event){
  if(event.httpMethod!=="GET") return bad("Use GET",405);
  const key=event.queryStringParameters?.key; if(!key) return bad("Missing key");
  try{
    const store=getInventoryStore();
    const blob=await store.get(key,{ type:"stream" });
    if(!blob) return { statusCode:200, headers:{"content-type":"application/json"}, body: JSON.stringify({ ok:true, diffs: [] }) };
    const body=await streamToString(blob.body);
    return { statusCode:200, headers:{"content-type":"application/json"}, body };
  }catch(e){ return bad(e?.message||"JSON get failed",500); }
}
async function streamToString(stream){ const chunks=[]; for await(const c of stream) chunks.push(c); return Buffer.concat(chunks).toString("utf8"); }
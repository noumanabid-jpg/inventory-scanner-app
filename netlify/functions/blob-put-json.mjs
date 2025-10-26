import { getInventoryStore, json, bad } from "./_blob-common.mjs";
export async function handler(event){
  if(event.httpMethod!=="POST") return bad("Use POST",405);
  const key=event.queryStringParameters?.key; if(!key) return bad("Missing key");
  try{
    const store=getInventoryStore();
    await store.set(key, event.body||"{}", { contentType:"application/json" });
    return json({ ok:true, key });
  }catch(e){ return bad(e?.message||"JSON save failed",500); }
}
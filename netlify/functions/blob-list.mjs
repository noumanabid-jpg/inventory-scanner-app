import { getInventoryStore, json, bad } from "./_blob-common.mjs";
export async function handler(event){
  if(event.httpMethod!=="GET") return bad("Use GET",405);
  const ns=event.queryStringParameters?.ns||"default";
  try{
    const store=getInventoryStore();
    const out=await store.list({ prefix: `${ns}/` });
    return json({ ok:true, files: out.objects || [] });
  }catch(e){ return bad(e?.message||"List failed",500); }
}
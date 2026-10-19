import {test} from "node:test";
import assert from "node:assert/strict";
import {createAdServerWorker} from "../src/web/worker.mjs";
import {HOUSE_CREATIVE_CATALOG} from "../src/catalog.mjs";

function fakeKV(){
  const values=new Map(),writes=[];
  return {
    values,writes,
    async get(key,mode){const row=values.get(key);return row===undefined?null:mode==="json"?JSON.parse(row):row},
    async put(key,value){values.set(key,value);writes.push(key)},
    async list({prefix,limit=50,cursor}){
      const keys=[...values.keys()].filter(key=>key.startsWith(prefix)).sort();
      const start=cursor?Number(cursor):0;
      const selected=keys.slice(start,start+limit),end=start+selected.length;
      return {keys:selected.map(name=>({name})),list_complete:end>=keys.length,
        cursor:end>=keys.length?"":String(end)};
    },
  };
}
const base="https://ads.example";
const slot="slot=footer&property=play-561-group";
const chosen="creative=koios-news-v1";

test("health, catalog, public CORS and route methods are truthful",async()=>{
  const worker=createAdServerWorker();
  const health=await worker.fetch(new Request(base+"/health"),{});
  assert.equal(health.status,200);
  assert.equal(health.headers.get("access-control-allow-origin"),"*");
  assert.equal((await health.json()).catalogSize,HOUSE_CREATIVE_CATALOG.length);
  assert.ok((await (await worker.fetch(new Request(base+"/catalog"),{})).json()).catalog.some(x=>x.status==="coming-soon"));
  assert.equal((await worker.fetch(new Request(base+"/other"),{})).status,404);
  for(const pathname of ["/ad","/click","/catalog","/receipts"]){
    const response=await worker.fetch(new Request(base+pathname,{method:"POST"}),{});
    assert.equal(response.status,405,pathname);
  }
});

test("GET /ad selects a live non-self creative without counting or writing an impression",async()=>{
  const kv=fakeKV(),worker=createAdServerWorker();
  const response=await worker.fetch(new Request(base+"/ad?"+slot),{AD_RECEIPTS:kv});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.ok(data.creative.id);
  assert.notEqual(data.creative.id,"play-561-group-v1");
  assert.equal(data.creative.relationship,"house");
  assert.equal(Object.hasOwn(data,"receipt"),false);
  assert.equal(Object.hasOwn(data,"receiptStatus"),false);
  assert.equal(kv.writes.length,0);
  assert.equal((await (await worker.fetch(new Request(base+"/receipts"),{AD_RECEIPTS:kv})).json()).entries.length,0);
  assert.equal((await worker.fetch(new Request(base+"/ad"),{})).status,400);
});

test("POST /view records exactly one browser-reported event with one content-addressed KV PUT",async()=>{
  const kv=fakeKV(),worker=createAdServerWorker();
  const preflight=await worker.fetch(new Request(base+"/view",{method:"OPTIONS"}),{AD_RECEIPTS:kv});
  assert.equal(preflight.status,204);
  assert.match(preflight.headers.get("access-control-allow-methods"),/POST/u);
  const reported=await worker.fetch(new Request(base+"/view?"+slot+"&"+chosen,{method:"POST"}),{AD_RECEIPTS:kv});
  assert.equal(reported.status,202);
  const answer=await reported.json();
  assert.equal(answer.status,"recorded");
  assert.match(answer.id,/^ni:\/\/\/sha-256;/u);
  assert.equal(kv.writes.length,1);
  assert.match(kv.writes[0],/^delivery:v2:/u);
  assert.equal(kv.values.has("chain:head"),false);
  const records=(await (await worker.fetch(new Request(base+"/receipts"),{AD_RECEIPTS:kv})).json()).entries;
  assert.equal(records.length,1);
  assert.equal(records[0].type,"view");
  assert.equal(records[0].evidenceKind,"publisher-client-visibility-report");
});

test("a selection, GET /view, expired/unrelated/unknown creative and unbound KV cannot fabricate a view",async()=>{
  const kv=fakeKV(),worker=createAdServerWorker();
  for(const [query,method,expected] of [
    [slot+"&"+chosen,"GET",405],
    [slot+"&creative=house-agent-plugin-v1","POST",404],
    [slot+"&creative=no-such-creative","POST",404],
    ["slot=footer&property=koios-news&creative=koios-news-v1","POST",404],
    ["slot=unknown&property=play-561-group&creative=koios-news-v1","POST",404],
    ["property=play-561-group&creative=koios-news-v1","POST",400],
  ]){
    assert.equal((await worker.fetch(new Request(base+"/view?"+query,{method}),{AD_RECEIPTS:kv})).status,expected);
  }
  assert.equal(kv.writes.length,0);
  assert.equal((await worker.fetch(new Request(base+"/view?"+slot+"&"+chosen,{method:"POST"}),{})).status,503);
});

test("GET /click redirects and records a redirect request, not proof of a sale",async()=>{
  const kv=fakeKV(),worker=createAdServerWorker();
  const response=await worker.fetch(new Request(base+"/click?"+slot+"&"+chosen,{redirect:"manual"}),{AD_RECEIPTS:kv});
  assert.equal(response.status,302);
  assert.equal(response.headers.get("location"),"https://koios.news/");
  assert.equal(response.headers.get("x-561-receipt-status"),"recorded");
  assert.equal(kv.writes.length,1);
  const entry=(await (await worker.fetch(new Request(base+"/receipts"),{AD_RECEIPTS:kv})).json()).entries[0];
  assert.equal(entry.type,"click");
  assert.equal(entry.evidenceKind,"redirect-request");
  assert.equal(Object.hasOwn(entry,"paid"),false);
});

test("ineligible self-promotion, inactive or unknown click neither redirects nor records",async()=>{
  const kv=fakeKV(),worker=createAdServerWorker();
  for(const url of [
    base+"/click?"+slot+"&creative=house-agent-plugin-v1",
    base+"/click?"+slot+"&creative=unknown",
    base+"/click?slot=footer&property=koios-news&creative=koios-news-v1",
  ]){
    const response=await worker.fetch(new Request(url,{redirect:"manual"}),{AD_RECEIPTS:kv});
    assert.equal(response.status,404);
    assert.equal(response.headers.get("location"),null);
  }
  assert.deepEqual(kv.writes,[]);
});

test("receipt retrieval supports actual native KV cursors and read-only historical events",async()=>{
  const kv=fakeKV(),worker=createAdServerWorker();
  await worker.fetch(new Request(base+"/view?"+slot+"&"+chosen,{method:"POST"}),{AD_RECEIPTS:kv});
  await worker.fetch(new Request(base+"/click?"+slot+"&"+chosen),{AD_RECEIPTS:kv});
  const p1=await (await worker.fetch(new Request(base+"/receipts?limit=1"),{AD_RECEIPTS:kv})).json();
  assert.equal(p1.series,"current");
  assert.equal(p1.entries.length,1);
  assert.equal(p1.complete,false);
  const p2=await (await worker.fetch(new Request(base+"/receipts?limit=1&cursor="+encodeURIComponent(p1.cursor)),{AD_RECEIPTS:kv})).json();
  assert.equal(p2.entries.length,1);
  assert.equal(p2.complete,true);
  const legacy={id:"old",seq:0,type:"impression",occurredAt:"2026-08-31T00:00:00.000Z"};
  kv.values.set("chain:entry:000000000000",JSON.stringify(legacy));
  const readsBefore=kv.writes.length;
  const history=await (await worker.fetch(new Request(base+"/receipts?series=legacy"),{AD_RECEIPTS:kv})).json();
  assert.deepEqual(history.entries,[legacy]);
  assert.equal(kv.writes.length,readsBefore);
  assert.equal((await worker.fetch(new Request(base+"/receipts?series=invalid"),{AD_RECEIPTS:kv})).status,400);
  assert.equal((await worker.fetch(new Request(base+"/receipts?limit=10000"),{AD_RECEIPTS:kv})).status,400);
});

test("KV write quota produces a transparent refused signal; selection still works and reset permits later view",async()=>{
  let now=Date.parse("2026-10-19T23:59:00.000Z");
  const reset=Date.parse("2026-10-20T00:00:00.000Z");
  const worker=createAdServerWorker({nowMs:()=>now});
  const kv=fakeKV(),originalPut=kv.put,attempts=[];
  kv.put=async(k,v)=>{attempts.push(k);if(now<reset){const e=new Error("hidden provider secret 429");e.status=429;throw e;}return originalPut(k,v)};
  const originalError=console.error,logs=[];console.error=v=>logs.push(v);
  try{
    const v=base+"/view?"+slot+"&"+chosen;
    assert.equal((await worker.fetch(new Request(v,{method:"POST"}),{AD_RECEIPTS:kv})).status,503);
    assert.equal(attempts.length,1);
    assert.equal((await worker.fetch(new Request(v,{method:"POST"}),{AD_RECEIPTS:kv})).status,503);
    assert.equal((await worker.fetch(new Request(base+"/ad?"+slot),{AD_RECEIPTS:kv})).status,200);
    const click=await worker.fetch(new Request(base+"/click?"+slot+"&"+chosen),{AD_RECEIPTS:kv});
    assert.equal(click.status,302);
    assert.equal(click.headers.get("x-561-receipt-status"),"unavailable");
    assert.equal(attempts.length,1);
    assert.equal(logs.length,1);
    assert.equal(JSON.parse(logs[0]).errorClass,"kv-write-quota-exhausted");
    assert.doesNotMatch(logs[0],/hidden provider secret/u);
    now=reset;
    assert.equal((await worker.fetch(new Request(v,{method:"POST"}),{AD_RECEIPTS:kv})).status,202);
    assert.equal(attempts.length,2,"one KV write per observed event");
  }finally{console.error=originalError;}
});

test("transient KV transport errors remain retryable without leaking raw provider details",async()=>{
  const worker=createAdServerWorker(),kv=fakeKV();
  const errors=[],before=console.error;let puts=0;
  kv.put=async()=>{puts++;throw new Error("secret=PRIVATE_VALUE transport failed")};
  console.error=v=>errors.push(v);
  try{
    const url=base+"/view?"+slot+"&"+chosen;
    assert.equal((await worker.fetch(new Request(url,{method:"POST"}),{AD_RECEIPTS:kv})).status,503);
    assert.equal((await worker.fetch(new Request(url,{method:"POST"}),{AD_RECEIPTS:kv})).status,503);
    assert.equal(puts,2);
    assert.equal(errors.length,2);
    assert.equal(JSON.parse(errors[0]).errorClass,"receipt-storage-error");
    assert.doesNotMatch(errors.join(" "),/PRIVATE_VALUE|secret=/u);
  }finally{console.error=before;}
});

test("paid sponsored relationship includes relevant terms, refuses unrelated contexts, and expires on time",async()=>{
  let now=Date.parse("2026-10-19T14:00:00.000Z");
  const paid={id:"paid",status:"live",relationship:"affiliate",property:"merchant",
    properties:["koios-news"],slots:["footer"],contexts:["science"],allowedContexts:["science"],
    title:"Offer",href:"https://example.org/",disclosure:"We receive a commission.",
    eligibility:"Only qualified users.",riskNotice:"Losses are possible.",
    expiresAt:"2026-10-19T15:00:00.000Z"};
  const worker=createAdServerWorker({catalog:[paid],nowMs:()=>now});
  const url=base+"/ad?slot=footer&property=koios-news&context=science";
  const result=await worker.fetch(new Request(url),{});
  assert.equal(result.status,200);
  const creative=(await result.json()).creative;
  assert.equal(creative.relationship,"affiliate");
  assert.equal(creative.linkRel,"sponsored nofollow");
  assert.deepEqual(creative.allowedContexts,["science"]);
  assert.equal(creative.riskNotice,paid.riskNotice);
  assert.equal((await worker.fetch(new Request(url.replace("science","sports")),{})).status,404);
  const clicked=await worker.fetch(new Request(base+"/click?slot=footer&property=koios-news&creative=paid&context=science"),{});
  assert.equal(clicked.status,302);
  now=Date.parse("2026-10-19T15:00:00.000Z");
  assert.equal((await worker.fetch(new Request(url),{})).status,404);
  assert.equal((await worker.fetch(new Request(base+"/view?slot=footer&property=koios-news&creative=paid&context=science",{method:"POST"}),{})).status,404);
  assert.equal((await worker.fetch(new Request(base+"/click?slot=footer&property=koios-news&creative=paid&context=science"),{})).status,404);
});

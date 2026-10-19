import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdServerWorker } from "../src/web/worker.mjs";
import { HOUSE_CREATIVE_CATALOG } from "../src/catalog.mjs";

const base="https://ads.example";
const house={id:"our-news",status:"live",relationship:"house",property:"koios-news",
  properties:["*"],slots:["footer"],title:"Read Koios.News",body:"First-party news",
  href:"https://koios.news/",contexts:[]};
const paid={id:"sponsor",status:"live",relationship:"affiliate",property:"merchant",
  properties:["publisher"],slots:["footer"],title:"A qualified referral",body:"Terms apply",
  href:"https://example.org/offer",disclosure:"The publisher may receive a commission.",
  eligibility:"Eligible adults only.",riskNotice:"Loss of funds is possible.",
  contexts:["science"],allowedContexts:["science"],expiresAt:"2099-12-31T23:59:59Z"};
const houseQuery="/ad?slot=footer&property=game-561";
const houseView="/view?slot=footer&property=game-561&creative=our-news";
const houseClick="/click?slot=footer&property=game-561&creative=our-news";
const paidQuery="/ad?slot=footer&property=publisher&context=science";
const paidView="/view?slot=footer&property=publisher&creative=sponsor&context=science";
const paidClick="/click?slot=footer&property=publisher&creative=sponsor&context=science";

function fakeKV(){
  const values=new Map(),writes=[];
  return {
    values,writes,
    async put(key,value){writes.push(key);values.set(key,value);},
    async get(key,type){const v=values.get(key);return v===undefined?null:type==="json"?JSON.parse(v):v;},
    async list({prefix,limit=50,cursor}){
      const keys=[...values.keys()].filter(k=>k.startsWith(prefix)).sort();
      const start=cursor?Number(cursor):0;
      const selected=keys.slice(start,start+limit),end=start+selected.length;
      return {keys:selected.map(name=>({name})),list_complete:end>=keys.length,
        cursor:end>=keys.length?"":String(end)};
    },
  };
}
function fakeActivity(){
  const points=[];
  return {points,writeDataPoint(point){points.push(point);}};
}
const worker=(catalog,nowMs=()=>Date.parse("2026-10-19T12:00:00Z"))=>
  createAdServerWorker({catalog,nowMs});

test("service and catalog are readable and preserve CORS",async()=>{
  const instance=createAdServerWorker();
  const health=await instance.fetch(new Request(base+"/health"),{});
  assert.equal(health.status,200);
  assert.equal(health.headers.get("access-control-allow-origin"),"*");
  assert.equal((await health.json()).catalogSize,HOUSE_CREATIVE_CATALOG.length);
  const catalog=await instance.fetch(new Request(base+"/catalog"),{});
  assert.equal(catalog.status,200);
  assert.ok((await catalog.json()).catalog.some(x=>x.status==="coming-soon"));
  for(const route of ["/health","/ad","/view","/click","/catalog","/receipts"]){
    const response=await instance.fetch(new Request(base+route,{method:route==="/view"?"GET":"POST"}),{});
    assert.equal(response.status,405,route);
  }
});

test("house creative selection uses aggregate WAE and consumes zero KV writes",async()=>{
  const kv=fakeKV(),activity=fakeActivity(),instance=worker([house]);
  const response=await instance.fetch(new Request(base+houseQuery),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.creative.id,"our-news");
  assert.equal(data.creative.relationship,"house");
  assert.equal(data.activityStatus,"submitted");
  assert.equal(Object.hasOwn(data,"receipt"),false);
  assert.deepEqual(kv.writes,[]);
  assert.deepEqual(activity.points,[{indexes:["game-561"],blobs:["creative-response","footer","our-news","house"],doubles:[1]}]);
  const body=await (await instance.fetch(new Request(base+"/receipts"),{AD_RECEIPTS:kv})).json();
  assert.deepEqual(body.entries,[]);
});

test("house view report uses aggregate WAE with no KV and does not pretend to be a durable impression",async()=>{
  const activity=fakeActivity(),instance=worker([house]);
  const view=await instance.fetch(new Request(base+houseView,{method:"POST"}),{AD_ACTIVITY:activity});
  assert.equal(view.status,202);
  assert.deepEqual(await view.json(),{status:"submitted",activityStatus:"submitted"});
  assert.deepEqual(activity.points,[{indexes:["game-561"],blobs:["client-visible-opportunity","footer","our-news","house"],doubles:[1]}]);
  const unbound=await instance.fetch(new Request(base+houseView,{method:"POST"}),{});
  assert.equal(unbound.status,202);
  assert.equal((await unbound.json()).status,"unbound");
});

test("house redirect stays useful through KV outages without writing a fake paid receipt",async()=>{
  const kv=fakeKV(),activity=fakeActivity(),instance=worker([house]);
  kv.put=async()=>{throw Error("quota exhausted");};
  const redirect=await instance.fetch(new Request(base+houseClick,{redirect:"manual"}),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(redirect.status,302);
  assert.equal(redirect.headers.get("location"),"https://koios.news/");
  assert.equal(redirect.headers.get("x-561-receipt-status"),"not-applicable");
  assert.equal(redirect.headers.get("x-561-activity-status"),"submitted");
  assert.equal(activity.points[0].blobs[0],"outbound-redirect");
});

test("paid selection requires a storage binding but never records a premature impression",async()=>{
  const kv=fakeKV(),activity=fakeActivity(),instance=worker([paid]);
  assert.equal((await instance.fetch(new Request(base+paidQuery),{})).status,503);
  const selected=await instance.fetch(new Request(base+paidQuery),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(selected.status,200);
  const body=await selected.json();
  assert.equal(body.creative.relationship,"affiliate");
  assert.equal(body.creative.linkRel,"sponsored nofollow");
  assert.deepEqual(body.creative.allowedContexts,["science"]);
  assert.equal(body.activityStatus,"submitted");
  assert.equal(Object.hasOwn(body,"receipt"),false);
  assert.deepEqual(kv.writes,[]);
  assert.equal((await instance.fetch(new Request(base+paidQuery.replace("science","sports")),{AD_RECEIPTS:kv})).status,404);
});

test("view preflight and paid visible-placement report issue one uniquely addressed KV event",async()=>{
  const kv=fakeKV(),instance=worker([paid]);
  const preflight=await instance.fetch(new Request(base+"/view",{method:"OPTIONS"}),{AD_RECEIPTS:kv});
  assert.equal(preflight.status,204);
  assert.match(preflight.headers.get("access-control-allow-methods"),/POST/u);
  const accepted=await instance.fetch(new Request(base+paidView,{method:"POST"}),{AD_RECEIPTS:kv});
  assert.equal(accepted.status,202);
  const body=await accepted.json();
  assert.equal(body.status,"recorded");
  assert.match(body.id,/^ni:\/\/\/sha-256;/u);
  assert.equal(kv.writes.length,1);
  assert.match(kv.writes[0],/^delivery:v2:/u);
  assert.equal(kv.values.has("chain:head"),false);
  const page=await(await instance.fetch(new Request(base+"/receipts"),{AD_RECEIPTS:kv})).json();
  assert.equal(page.entries[0].type,"view");
  assert.equal(page.entries[0].evidenceKind,"publisher-client-visibility-report");
  assert.deepEqual(page.entries[0].context,["science"]);
});

test("paid redirect records a distinct event with one KV PUT or refuses",async()=>{
  const kv=fakeKV(),activity=fakeActivity(),instance=worker([paid]);
  assert.equal((await instance.fetch(new Request(base+paidClick,{redirect:"manual"}),{})).status,503);
  const sent=await instance.fetch(new Request(base+paidClick,{redirect:"manual"}),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(sent.status,302);
  assert.equal(sent.headers.get("location"),paid.href);
  assert.equal(sent.headers.get("x-561-receipt-status"),"recorded");
  assert.equal(kv.writes.length,1);
  assert.equal(activity.points[0].blobs[0],"outbound-redirect");
  const records=(await(await instance.fetch(new Request(base+"/receipts"),{AD_RECEIPTS:kv})).json()).entries;
  assert.equal(records[0].type,"click");
  assert.equal(records[0].evidenceKind,"redirect-request");
});

test("concurrent paid events never overwrite a shared KV sequence",async()=>{
  const kv=fakeKV(),instance=worker([paid]);
  const events=await Promise.all(Array.from({length:12},()=>instance.fetch(new Request(base+paidView,{method:"POST"}),{AD_RECEIPTS:kv})));
  assert.ok(events.every(r=>r.status===202));
  assert.equal(kv.writes.length,12);
  assert.equal(new Set(kv.writes).size,12);
  assert.equal(kv.values.has("chain:head"),false);
  assert.equal((await(await instance.fetch(new Request(base+"/receipts"),{AD_RECEIPTS:kv})).json()).entries.length,12);
});

test("paged receipts preserve distinct v2 events and read-only legacy chain",async()=>{
  const kv=fakeKV(),instance=worker([paid]);
  await instance.fetch(new Request(base+paidView,{method:"POST"}),{AD_RECEIPTS:kv});
  await instance.fetch(new Request(base+paidClick),{AD_RECEIPTS:kv});
  const one=await(await instance.fetch(new Request(base+"/receipts?limit=1"),{AD_RECEIPTS:kv})).json();
  assert.equal(one.series,"current");
  assert.equal(one.entries.length,1);
  assert.equal(one.complete,false);
  const two=await(await instance.fetch(new Request(base+"/receipts?limit=1&cursor="+encodeURIComponent(one.cursor)),{AD_RECEIPTS:kv})).json();
  assert.equal(two.entries.length,1);
  assert.equal(two.complete,true);
  const original={id:"old",seq:0,type:"impression",occurredAt:"2026-08-31T00:00:00.000Z"};
  kv.values.set("chain:entry:000000000000",JSON.stringify(original));
  const writes=kv.writes.length;
  const legacy=await(await instance.fetch(new Request(base+"/receipts?series=legacy"),{AD_RECEIPTS:kv})).json();
  assert.deepEqual(legacy.entries,[original]);
  assert.equal(kv.writes.length,writes);
  assert.equal((await instance.fetch(new Request(base+"/receipts?series=unknown"),{AD_RECEIPTS:kv})).status,400);
  assert.equal((await instance.fetch(new Request(base+"/receipts?limit=10000"),{AD_RECEIPTS:kv})).status,400);
});

test("invalid placement, missing creative, unknown relation and self-promotion never produce events",async()=>{
  const kv=fakeKV(),instance=worker([house,paid]);
  const refused=[
    ["/ad?slot=footer%20bad&property=publisher","GET",400],
    ["/ad?slot=footer&property=%0A","GET",400],
    ["/view?slot=footer&property=publisher&creative=sponsor&context=sports","POST",404],
    ["/view?slot=footer&property=publisher&creative=unknown","POST",404],
    ["/view?slot=footer&property=koios-news&creative=our-news","POST",404],
    ["/click?slot=footer&property=publisher&creative=sponsor","GET",404],
    ["/click?slot=footer&property=koios-news&creative=our-news","GET",404]
  ];
  for(const [path,method,status] of refused){
    assert.equal((await instance.fetch(new Request(base+path,{method}),{AD_RECEIPTS:kv})).status,status,path);
  }
  assert.deepEqual(kv.writes,[]);
});

test("paid quota hold does not interrupt house delivery and resets at midnight UTC",async()=>{
  let now=Date.parse("2026-10-19T23:59:00.000Z");
  const reset=Date.parse("2026-10-20T00:00:00.000Z");
  const instance=worker([house,paid],()=>now),kv=fakeKV(),put=kv.put,attempts=[];
  kv.put=async(key,value)=>{attempts.push(key);if(now<reset){const e=Error("KV quota token-secret 429");e.status=429;throw e;}return put(key,value);};
  const before=console.error,logs=[];console.error=v=>logs.push(v);
  try{
    assert.equal((await instance.fetch(new Request(base+paidView,{method:"POST"}),{AD_RECEIPTS:kv})).status,503);
    assert.equal(attempts.length,1);
    assert.equal((await instance.fetch(new Request(base+paidView,{method:"POST"}),{AD_RECEIPTS:kv})).status,503);
    assert.equal((await instance.fetch(new Request(base+paidQuery),{AD_RECEIPTS:kv})).status,503);
    assert.equal((await instance.fetch(new Request(base+paidClick),{AD_RECEIPTS:kv})).status,503);
    assert.equal(attempts.length,1);
    assert.equal((await instance.fetch(new Request(base+houseQuery),{AD_RECEIPTS:kv})).status,200);
    assert.equal((await instance.fetch(new Request(base+houseClick),{AD_RECEIPTS:kv})).status,302);
    assert.equal(logs.length,1);
    assert.equal(JSON.parse(logs[0]).errorClass,"kv-write-quota-exhausted");
    assert.doesNotMatch(logs[0],/token-secret/u);
    now=reset;
    assert.equal((await instance.fetch(new Request(base+paidView,{method:"POST"}),{AD_RECEIPTS:kv})).status,202);
    assert.equal(attempts.length,2);
  }finally{console.error=before;}
});

test("unknown KV errors can retry without leaking provider details or advertising a paid view",async()=>{
  const kv=fakeKV(),instance=worker([paid]),logs=[],before=console.error;
  let count=0;kv.put=async()=>{count++;throw Error("secret=private transport");};
  console.error=message=>logs.push(message);
  try{
    for(let i=0;i<2;i++){
      assert.equal((await instance.fetch(new Request(base+paidView,{method:"POST"}),{AD_RECEIPTS:kv})).status,503);
    }
    assert.equal(count,2);
    assert.equal(logs.length,2);
    assert.doesNotMatch(logs.join(" "),/secret=private/u);
  }finally{console.error=before;}
});

test("aggregate sink failures never prevent a first-party creative from displaying",async()=>{
  const instance=worker([house]),activity={writeDataPoint(){throw Error("private token");}};
  const response=await instance.fetch(new Request(base+houseQuery),{AD_ACTIVITY:activity});
  assert.equal(response.status,200);
  assert.equal((await response.json()).activityStatus,"unavailable");
  const v=await instance.fetch(new Request(base+houseView,{method:"POST"}),{AD_ACTIVITY:activity});
  assert.equal(v.status,202);
  assert.equal((await v.json()).activityStatus,"unavailable");
});

test("expiry refuses paid selection, view and redirects at the exact boundary",async()=>{
  let now=Date.parse("2026-10-19T15:00:00.000Z");
  const expiresAt="2026-10-19T15:01:00.000Z";
  const instance=worker([{...paid,expiresAt}],()=>now),kv=fakeKV();
  assert.equal((await instance.fetch(new Request(base+paidQuery),{AD_RECEIPTS:kv})).status,200);
  now=Date.parse(expiresAt);
  assert.equal((await instance.fetch(new Request(base+paidQuery),{AD_RECEIPTS:kv})).status,404);
  assert.equal((await instance.fetch(new Request(base+paidView,{method:"POST"}),{AD_RECEIPTS:kv})).status,404);
  assert.equal((await instance.fetch(new Request(base+paidClick),{AD_RECEIPTS:kv})).status,404);
});

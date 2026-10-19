import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdServerWorker } from "../src/web/worker.mjs";
import { HOUSE_CREATIVE_CATALOG } from "../src/catalog.mjs";

/** Minimal in-memory stand-in for a Cloudflare Workers KV namespace binding. */
function createFakeKv() {
  const store = new Map();
  return {
    async get(key, type) {
      if (!store.has(key)) return null;
      const raw = store.get(key);
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) };
    },
  };
}


/** Only aggregate fields are accepted; no identifiers about a reader exist. */
function fakeActivity() {
  const points=[];
  return { points, writeDataPoint(point){ points.push(point); } };
}
const PAID = Object.freeze({
  id:"paid",status:"live",relationship:"affiliate",property:"promoted",
  properties:["publisher"],slots:["footer"],contexts:["finance"],
  title:"Example qualifying offer",body:"Referral",
  href:"https://example.org/offer",disclosure:"Publisher may earn a referral reward.",
  allowedContexts:["finance"],eligibility:"Qualifying adults only.",
  riskNotice:"Capital at risk.",expiresAt:"2099-12-31T23:59:59Z",
});
const paidAd="/ad?slot=footer&property=publisher&context=finance";
const paidClick="/click?slot=footer&property=publisher&creative=paid&context=finance";


test("aggregate data points describe only catalog and placement, not readers",()=>{
  const activity=fakeActivity();
  activity.writeDataPoint({indexes:["koios-news"],blobs:["creative-response","footer","offer","house"],doubles:[1]});
  assert.deepEqual(Object.keys(activity.points[0]).sort(),["blobs","doubles","indexes"]);
  assert.equal(activity.points[0].blobs.length,4);
});

test("GET /health reports ok and catalog size", async () => {
  const worker = createAdServerWorker();
  const response = await worker.fetch(new Request("https://ads.example/health"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.catalogSize, HOUSE_CREATIVE_CATALOG.length);
});

test("JSON responses carry an open CORS header so any house property can fetch cross-origin", async () => {
  const worker = createAdServerWorker();
  const response = await worker.fetch(new Request("https://ads.example/health"), {});
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("GET /catalog returns the full catalog including coming-soon entries", async () => {
  const worker = createAdServerWorker();
  const response = await worker.fetch(new Request("https://ads.example/catalog"), {});
  const body = await response.json();
  assert.equal(body.catalog.length, HOUSE_CREATIVE_CATALOG.length);
  assert.ok(body.catalog.some((creative) => creative.status === "coming-soon"));
});

test("GET /ad requires slot and property", async () => {
  const worker = createAdServerWorker();
  const response = await worker.fetch(new Request("https://ads.example/ad"), {});
  assert.equal(response.status, 400);
});


test("GET /ad serves a house creative without consuming KV and emits one aggregate response event",async()=>{
  const worker=createAdServerWorker();
  const kv=createFakeKv(),activity=fakeActivity();
  let writes=0;const put=kv.put;
  kv.put=async(...args)=>{writes++;return put(...args);};
  const response=await worker.fetch(new Request("https://ads.example/ad?slot=footer&property=play-561-group"),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.creative.relationship,"house");
  assert.equal(body.receipt,null);
  assert.equal(body.receiptStatus,"not-applicable");
  assert.equal(body.activityStatus,"submitted");
  assert.equal(writes,0,"no KV writes are consumed by a house response");
  assert.deepEqual(activity.points,[{
    indexes:["play-561-group"],
    blobs:["creative-response","footer",body.creative.id,"house"],
    doubles:[1]
  }]);
  const receipts=await (await worker.fetch(new Request("https://ads.example/receipts"),{AD_RECEIPTS:kv})).json();
  assert.deepEqual(receipts.entries,[]);
});


test("GET /ad stays productive when unrelated KV quota is exhausted",async()=>{
  const worker=createAdServerWorker(),kv=createFakeKv(),activity=fakeActivity();
  let attempted=0;kv.put=async()=>{attempted++;throw new Error("KV quota exceeded");};
  const response=await worker.fetch(new Request("https://ads.example/ad?slot=footer&property=play-561-group"),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.receiptStatus,"not-applicable");
  assert.equal(result.activityStatus,"submitted");
  assert.equal(attempted,0);
  assert.equal(activity.points.length,1);
});


test("GET /click redirects an eligible house creative with aggregate activity and no KV write",async()=>{
  const worker=createAdServerWorker(),kv=createFakeKv(),activity=fakeActivity();
  const response=await worker.fetch(new Request(
    "https://ads.example/click?slot=footer&property=play-561-group&creative=koios-news-v1",{redirect:"manual"}),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(response.status,302);
  assert.equal(response.headers.get("location"),"https://koios.news/");
  assert.equal(response.headers.get("x-561-receipt-status"),"not-applicable");
  assert.equal(response.headers.get("x-561-activity-status"),"submitted");
  assert.deepEqual(activity.points,[{
    indexes:["play-561-group"],
    blobs:["outbound-redirect","footer","koios-news-v1","house"],
    doubles:[1]
  }]);
  const receipts=await (await worker.fetch(new Request("https://ads.example/receipts"),{AD_RECEIPTS:kv})).json();
  assert.deepEqual(receipts.entries,[]);
});

test("GET /click refuses inactive, self-promoted and unknown creatives without writing receipts", async () => {
  const worker = createAdServerWorker();
  const kv = createFakeKv();
  for (const url of [
    "https://ads.example/click?slot=footer&property=play-561-group&creative=house-agent-plugin-v1",
    "https://ads.example/click?slot=footer&property=koios-news&creative=koios-news-v1",
    "https://ads.example/click?slot=footer&property=play-561-group&creative=nonexistent",
  ]) {
    const response = await worker.fetch(new Request(url, { redirect: "manual" }), { AD_RECEIPTS: kv });
    assert.equal(response.status, 404, url);
    assert.equal(response.headers.get("location"), null);
  }
  const { entries } = await (await worker.fetch(new Request("https://ads.example/receipts"), { AD_RECEIPTS: kv })).json();
  assert.deepEqual(entries, [], "refused clicks must never enter the receipt chain");
});

test("GET /click enforces slot/property matching and still redirects for eligible campaigns", async () => {
  const worker = createAdServerWorker({ catalog: [
    { id: "approved", status: "live", relationship: "house", property: "promoted", slots: ["footer"], properties: ["publisher-ok"], href: "https://example.com/" },
  ] });
  for (const url of [
    "https://ads.example/click?slot=sidebar&property=publisher-ok&creative=approved",
    "https://ads.example/click?slot=footer&property=publisher-other&creative=approved",
  ]) {
    const response = await worker.fetch(new Request(url, { redirect: "manual" }), {});
    assert.equal(response.status, 404, url);
    assert.equal(response.headers.get("location"), null);
  }
  const ok = await worker.fetch(new Request("https://ads.example/click?slot=footer&property=publisher-ok&creative=approved", { redirect: "manual" }), {});
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), "https://example.com/");
});


test("GET /click keeps eligible house links useful when KV storage is down",async()=>{
  const worker=createAdServerWorker(),kv=createFakeKv(),activity=fakeActivity();
  let attempted=0;kv.put=async()=>{attempted++;throw new Error("KV quota exceeded");};
  const response=await worker.fetch(new Request(
    "https://ads.example/click?slot=footer&property=play-561-group&creative=koios-news-v1",
    {redirect:"manual"}),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(response.status,302);
  assert.equal(response.headers.get("location"),"https://koios.news/");
  assert.equal(response.headers.get("x-561-receipt-status"),"not-applicable");
  assert.equal(attempted,0);
  assert.equal(activity.points.length,1);
});


test("paid campaigns fail closed under KV quota and resume only after UTC reset",async()=>{
  let clock=Date.parse("2026-10-13T23:59:00Z");
  const reset=Date.parse("2026-10-14T00:00:00Z");
  const worker=createAdServerWorker({catalog:[PAID],nowMs:()=>clock});
  const kv=createFakeKv(),activity=fakeActivity(),normalPut=kv.put;
  const attempts=[];
  kv.put=async(key,value)=>{
    attempts.push(key);
    if(clock<reset){const e=new Error("KV write quota");e.status=429;throw e;}
    return normalPut(key,value);
  };
  const oldError=console.error,errors=[];console.error=message=>errors.push(message);
  try{
    const first=await worker.fetch(new Request("https://ads.example"+paidAd),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
    assert.equal(first.status,503);
    assert.equal((await first.json()).creative,undefined);
    assert.equal(attempts.length,1);
    assert.equal(activity.points.length,0,"refused paid response produces no success event");
    const held=await worker.fetch(new Request("https://ads.example"+paidAd),{AD_RECEIPTS:kv});
    assert.equal(held.status,503);
    assert.equal(attempts.length,1,"isolate does not repeat known exhausted KV writes");
    const denied=await worker.fetch(new Request("https://ads.example"+paidClick,{redirect:"manual"}),{AD_RECEIPTS:kv});
    assert.equal(denied.status,503);
    assert.equal(denied.headers.get("location"),null);
    assert.equal(errors.length,1);
    assert.equal(JSON.parse(errors[0]).errorClass,"kv-write-quota-exhausted");
    clock=reset;
    const after=await worker.fetch(new Request("https://ads.example"+paidAd),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
    assert.equal(after.status,200);
    const body=await after.json();
    assert.equal(body.receiptStatus,"recorded");
    assert.equal(body.activityStatus,"submitted");
    assert.equal(attempts.length,3,"paid response uses the two original custody writes");
    assert.equal(activity.points.length,1);
    const redirect=await worker.fetch(new Request("https://ads.example"+paidClick,{redirect:"manual"}),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
    assert.equal(redirect.status,302);
    assert.equal(redirect.headers.get("x-561-receipt-status"),"recorded");
    assert.equal(attempts.length,5);
  }finally{console.error=oldError;}
});


test("paid custody failures remain retryable, redacted and do not serve creatives",async()=>{
  const worker=createAdServerWorker({catalog:[PAID],nowMs:()=>Date.parse("2026-10-13T20:00:00Z")});
  const kv=createFakeKv();
  let attempts=0;
  kv.put=async()=>{attempts++;throw new Error("transport fault secret=PRIVATE_NOT_A_TOKEN");};
  const oldError=console.error,errors=[];console.error=message=>errors.push(message);
  try{
    for(let i=0;i<2;i++){
      const response=await worker.fetch(new Request("https://ads.example"+paidAd),{AD_RECEIPTS:kv});
      assert.equal(response.status,503);
      assert.equal((await response.json()).creative,undefined);
    }
    assert.equal(attempts,2);
    assert.equal(errors.length,2);
    assert.equal(JSON.parse(errors[0]).errorClass,"receipt-storage-error");
    assert.doesNotMatch(errors.join(" "),/PRIVATE_NOT_A_TOKEN|secret=/u);
  }finally{console.error=oldError;}
});


test("clock admission is explicit; unbound house aggregates cannot claim durable receipts",async()=>{
  assert.throws(()=>createAdServerWorker({nowMs:null}),/nowMs must provide/u);
  const worker=createAdServerWorker({nowMs:()=>Date.parse("2026-10-13T23:59:50Z")});
  const result=await(await worker.fetch(new Request("https://ads.example/ad?slot=footer&property=play-561-group"),{})).json();
  assert.equal(result.receiptStatus,"not-applicable");
  assert.equal(result.activityStatus,"unbound");
});

test("unknown route returns 404", async () => {
  const worker = createAdServerWorker();
  const response = await worker.fetch(new Request("https://ads.example/nowhere"), {});
  assert.equal(response.status, 404);
});


test("paid offers require accountable custody and enforce context, terms and exact expiry",async()=>{
  let clock=Date.parse("2026-10-17T23:00:00Z");
  const campaign={...PAID,expiresAt:"2026-10-18T00:00:00Z"};
  const worker=createAdServerWorker({catalog:[campaign],nowMs:()=>clock});
  const noLedger=await worker.fetch(new Request("https://ads.example"+paidAd),{});
  assert.equal(noLedger.status,503,"paid offers never serve without a receipt owner");
  const kv=createFakeKv(),activity=fakeActivity();
  const before=await worker.fetch(new Request("https://ads.example"+paidAd),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(before.status,200);
  const body=await before.json();
  assert.equal(body.receiptStatus,"recorded");
  assert.equal(body.creative.relationship,"affiliate");
  assert.equal(body.creative.disclosure,campaign.disclosure);
  assert.equal(body.creative.linkRel,"sponsored nofollow");
  assert.deepEqual(body.creative.allowedContexts,["finance"]);
  assert.equal(body.creative.eligibility,campaign.eligibility);
  assert.equal(body.creative.riskNotice,campaign.riskNotice);
  assert.equal(body.creative.expiresAt,campaign.expiresAt);
  assert.equal((await worker.fetch(new Request("https://ads.example/ad?slot=footer&property=publisher&context=sport"),{AD_RECEIPTS:kv})).status,404);
  const noContext=await worker.fetch(new Request("https://ads.example/click?slot=footer&property=publisher&creative=paid",{redirect:"manual"}),{AD_RECEIPTS:kv});
  assert.equal(noContext.status,404);
  const redirect=await worker.fetch(new Request("https://ads.example"+paidClick,{redirect:"manual"}),{AD_RECEIPTS:kv,AD_ACTIVITY:activity});
  assert.equal(redirect.status,302);
  assert.equal(redirect.headers.get("location"),campaign.href);
  assert.equal(redirect.headers.get("x-561-receipt-status"),"recorded");
  assert.equal(activity.points.length,2);
  clock=Date.parse("2026-10-18T00:00:00Z");
  assert.equal((await worker.fetch(new Request("https://ads.example"+paidAd),{AD_RECEIPTS:kv})).status,404);
  const expired=await worker.fetch(new Request("https://ads.example"+paidClick,{redirect:"manual"}),{AD_RECEIPTS:kv});
  assert.equal(expired.status,404);
  assert.equal(expired.headers.get("location"),null);
});


test("aggregate sink errors do not break house service or assert durable activity",async()=>{
  const worker=createAdServerWorker();
  const activity={writeDataPoint(){throw new Error("provider not ready secret=never-log");}};
  const response=await worker.fetch(new Request("https://ads.example/ad?slot=footer&property=play-561-group"),{AD_ACTIVITY:activity});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.activityStatus,"unavailable");
  assert.equal(body.receiptStatus,"not-applicable");
});

test("bounded placement coordinates refuse malformed properties before recording",async()=>{
  const worker=createAdServerWorker(),activity=fakeActivity();
  for(const target of [
    "/ad?slot=footer&property="+("x".repeat(100)),
    "/ad?slot=footer&property=%0A",
    "/ad?slot=footer%20illegal&property=koios-news",
    "/click?slot=footer&property=%0A&creative=koios-news-v1"
  ]) {
    const response=await worker.fetch(new Request("https://ads.example"+target),{AD_ACTIVITY:activity});
    assert.equal(response.status,400,target);
  }
  assert.equal(activity.points.length,0);
});

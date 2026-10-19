import test from "node:test";
import assert from "node:assert/strict";
import {recordDeliveryEvent,listDeliveryEvents} from "../src/kv-events.mjs";

const input=id=>({type:"view",slot:"afterArticle",property:"koios-news",
  creativeId:"other-offer",context:["science"],requestId:id,
  occurredAt:"2026-10-19T14:00:00.000Z",decisionReason:"publisher-client-50pct-1s"});

function fakeKV(){
  const entries=new Map(),writes=[];
  return {
    entries,writes,
    async put(key,value){entries.set(key,value);writes.push(key)},
    async get(key,format){const value=entries.get(key);return value===undefined?null:format==="json"?JSON.parse(value):value},
    async list({prefix,cursor,limit}){
      const all=[...entries.keys()].filter(key=>key.startsWith(prefix)).sort();
      const offset=cursor?Number(cursor):0;
      const selected=all.slice(offset,offset+limit);
      const end=offset+selected.length;
      return {keys:selected.map(name=>({name})),list_complete:end>=all.length,
        cursor:end>=all.length?"":String(end)};
    },
  };
}

test("concurrent events commute through one unique KV PUT apiece",async()=>{
  const kv=fakeKV();
  const records=await Promise.all(Array.from({length:12},(_,index)=>recordDeliveryEvent(kv,input("request-"+index))));
  assert.equal(new Set(records.map(row=>row.id)).size,12);
  assert.equal(kv.writes.length,12);
  assert.ok(kv.writes.every(key=>key.startsWith("delivery:v2:")));
  assert.equal(kv.entries.has("chain:head"),false);
  assert.equal((await listDeliveryEvents(kv,{limit:50})).entries.length,12);
});

test("provider cursor walks all KV pages and does not mistake an empty page for completion",async()=>{
  const kv=fakeKV();
  for(let i=0;i<5;i++)await recordDeliveryEvent(kv,input("req-"+i));
  const first=await listDeliveryEvents(kv,{limit:2});
  assert.equal(first.entries.length,2);
  assert.equal(first.complete,false);
  const second=await listDeliveryEvents(kv,{cursor:first.cursor,limit:2});
  assert.equal(second.entries.length,2);
  const third=await listDeliveryEvents(kv,{cursor:second.cursor,limit:2});
  assert.equal(third.entries.length,1);
  assert.equal(third.complete,true);
  assert.equal(third.cursor,null);
});

test("historical v1 events remain discoverable without any rewriting",async()=>{
  const kv=fakeKV();
  const old={id:"ni:///sha-256;legacy",seq:0,type:"impression",
    occurredAt:"2026-08-31T00:00:00.000Z"};
  kv.entries.set("chain:entry:000000000000",JSON.stringify(old));
  const before=kv.writes.length;
  const page=await listDeliveryEvents(kv,{series:"legacy"});
  assert.deepEqual(page.entries,[old]);
  assert.equal(kv.writes.length,before);
  assert.deepEqual((await listDeliveryEvents(kv)).entries,[]);
});

test("invalid series, limits and non-advancing KV cursors are rejected",async()=>{
  const kv=fakeKV();
  await assert.rejects(listDeliveryEvents(kv,{series:"unknown"}),TypeError);
  await assert.rejects(listDeliveryEvents(kv,{limit:1000}),TypeError);
  await assert.rejects(listDeliveryEvents(kv,{cursor:""}),TypeError);
  kv.list=async()=>({keys:[],list_complete:false,cursor:"same"});
  await assert.rejects(listDeliveryEvents(kv,{cursor:"same"}),/pagination/u);
});

test("KV storage failure refuses event receipt instead of claiming an impression",async()=>{
  const kv=fakeKV();
  kv.put=async()=>{throw new Error("quota reached")};
  await assert.rejects(recordDeliveryEvent(kv,input("failed")),/quota reached/u);
  assert.equal(kv.entries.size,0);
});

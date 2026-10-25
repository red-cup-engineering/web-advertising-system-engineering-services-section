import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { each, LegacyStoreRefused, StoreCorruption } from "@red-cup-engineering/semiotic-eavt-services-section/store";
import { recordFile } from "@red-cup-engineering/semiotic-eavt-services-section/layout";
import { buildDeliveryReceipt } from "../src/receipts.mjs";
import { buildDeliveryEvent } from "../src/delivery-events.mjs";
import {syncAdEvents} from "../scripts/sync-ad-receipts-to-journal.mjs";

function scenario(){
  const received=[],calls=[];
  const journal={
    query(){return received.map(record=>({record}))},
    record(input){received.push(input.record)}
  };
  const old={id:"legacy-1",type:"impression",seq:0,occurredAt:"2026-08-31T00:00:00.000Z"};
  const a={id:"event-a",kind:"advertising.delivery-event/v2",type:"view",occurredAt:"2026-10-19T14:00:00.000Z"};
  const b={id:"event-b",kind:"advertising.delivery-event/v2",type:"click",occurredAt:"2026-10-19T14:00:01.000Z"};
  const fetchImpl=async address=>{
    const u=new URL(address),series=u.searchParams.get("series"),cursor=u.searchParams.get("cursor");
    calls.push({series,cursor});
    const page=series==="legacy"?{series,entries:[old],complete:true,cursor:null}:
      !cursor?{series,entries:[a],complete:false,cursor:"next"}:
        {series,entries:[b],complete:true,cursor:null};
    return {ok:true,json:async()=>page};
  };
  return{journal,received,calls,fetchImpl};
}

test("existing journal importer processes all provider pages from both distinct evidence series",async()=>{
  const x=scenario(),base="https://ads.561.group";
  const first=await syncAdEvents(base,{journal:x.journal,fetchImpl:x.fetchImpl});
  assert.deepEqual(first,{pages:3,pulled:3,appended:3,skipped:0});
  assert.deepEqual(x.calls,[{series:"legacy",cursor:null},{series:"current",cursor:null},{series:"current",cursor:"next"}]);
  assert.deepEqual(x.received.map(x=>x.id),["legacy-1","event-a","event-b"]);
  const second=await syncAdEvents(base,{journal:x.journal,fetchImpl:x.fetchImpl});
  assert.equal(second.appended,0);
  assert.equal(x.received.length,3);
});

test("cursor refusal halts without announcing a completed sweep",async()=>{
  const x=scenario();
  const invalid=async()=>({ok:true,json:async()=>({series:"legacy",entries:[],complete:false,cursor:"duplicate"})});
  await assert.rejects(syncAdEvents("https://ads.561.group",{journal:x.journal,fetchImpl:invalid}),/invalid receipt page/u);
});

test("untrusted or malformed service origin cannot direct journal intake",async()=>{
  const x=scenario();
  for(const origin of ["http://ads.561.group","https://evil@ads.561.group","https://ads.561.group/path","https://ads.561.group?x=y"]){
    await assert.rejects(syncAdEvents(origin,{journal:x.journal,fetchImpl:x.fetchImpl}),TypeError);
  }
  assert.equal(x.calls.length,0);
});

const receiptType="advertising-delivery-receipt";
const receiptCategory="advertising.delivery-receipt";

async function nativeScenario(t){
  const root=mkdtempSync(join(tmpdir(),"advertising-receipts-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const old={...await buildDeliveryReceipt({type:"impression",slot:"footer",
    property:"play-561-group",creativeId:"koios-news-v1",occurredAt:"2026-08-31T00:00:00.000Z"}),seq:0};
  const a=buildDeliveryEvent({type:"view",slot:"footer",property:"koios-news",creativeId:"sponsor",
    context:["science"],requestId:"reported-opportunity-a",occurredAt:"2026-10-19T14:00:00.000Z"});
  const b=buildDeliveryEvent({type:"click",slot:"footer",property:"koios-news",creativeId:"sponsor",
    context:["science"],requestId:"redirect-b",occurredAt:"2026-10-19T14:00:01.000Z"});
  const calls=[];
  const fetchImpl=async(address,options)=>{
    assert.deepEqual(options,{method:"GET",redirect:"error"});
    const u=new URL(address),series=u.searchParams.get("series"),cursor=u.searchParams.get("cursor");
    calls.push({series,cursor});
    const page=series==="legacy"?{series,entries:[old],complete:true,cursor:null}:
      !cursor?{series,entries:[a],complete:false,cursor:"next"}:
        {series,entries:[b],complete:true,cursor:null};
    return {ok:true,json:async()=>page};
  };
  return {root,old,a,b,calls,fetchImpl};
}

test("declared native SEAVT store preserves receipt bytes and identities across a fresh intake",async t=>{
  const x=await nativeScenario(t),base="https://ads.561.group";
  assert.deepEqual(await syncAdEvents(base,x),{pages:3,pulled:3,appended:3,skipped:0});
  const stored=[...each(x.root,receiptType,{strict:true})];
  const byId=new Map(stored.map(({record})=>[record.record.id,record]));
  assert.equal(stored.length,3);
  assert.equal(x.old.id,"ni:///sha-256;YidFTmTCuxoLNhllulqzGIsSpM6XRWrjJzFfi7JIoFM");
  for(const entry of [x.old,x.a,x.b]){
    assert.deepEqual(byId.get(entry.id),{category:receiptCategory,record:entry,recordedAt:entry.occurredAt,
      told:{for:true,against:false},
      relation:{subject:"advertising-services-section",predicate:"reports-event",object:entry.id}});
  }
  assert.equal(byId.get(x.old.id).record.seq,0);
  assert.equal(byId.get(x.a.id).record.evidenceKind,"publisher-client-visibility-report");
  assert.equal(byId.get(x.b.id).record.evidenceKind,"redirect-request");
  assert.equal(existsSync(join(x.root,"data","journals")),false);
  assert.deepEqual(await syncAdEvents(base,{root:x.root,fetchImpl:x.fetchImpl}),
    {pages:3,pulled:3,appended:0,skipped:3});
  assert.equal([...each(x.root,receiptType,{strict:true})].length,3);
});

test("native intake refuses an earlier journal layout before fetching or creating a second store",async t=>{
  const x=await nativeScenario(t);
  mkdirSync(join(x.root,"data","journals"),{recursive:true});
  await assert.rejects(syncAdEvents("https://ads.561.group",x),LegacyStoreRefused);
  assert.equal(x.calls.length,0);
  assert.equal(existsSync(join(x.root,"data","records")),false);
});

test("native intake refuses a corrupt receipt bucket without overwriting evidence or fetching",async t=>{
  const x=await nativeScenario(t);
  await syncAdEvents("https://ads.561.group",x);
  const [{address}]=[...each(x.root,receiptType,{strict:true})];
  const file=recordFile(x.root,receiptType,address);
  appendFileSync(file,"{corrupt receipt}\n");
  const bytes=readFileSync(file),before=x.calls.length;
  await assert.rejects(syncAdEvents("https://ads.561.group",x),StoreCorruption);
  assert.equal(x.calls.length,before);
  assert.deepEqual(readFileSync(file),bytes);
});

test("a different provider body cannot be silently skipped under an already received receipt id",async t=>{
  const x=await nativeScenario(t);
  await syncAdEvents("https://ads.561.group",x);
  const before=[...each(x.root,receiptType,{strict:true})];
  const fetchImpl=async()=>({ok:true,json:async()=>({series:"legacy",complete:true,cursor:null,
    entries:[{...x.old,creativeId:"changed-after-receiving"}]})});
  await assert.rejects(syncAdEvents("https://ads.561.group",{root:x.root,fetchImpl}),/conflicting receipt identity/u);
  assert.deepEqual([...each(x.root,receiptType,{strict:true})],before);
});

test("an interrupted native sweep retains received evidence and restarts without duplication",async t=>{
  const x=await nativeScenario(t);
  const fetchImpl=async(address,options)=>new URL(address).searchParams.get("cursor")==="next"?
    {ok:false,status:503}:x.fetchImpl(address,options);
  await assert.rejects(syncAdEvents("https://ads.561.group",{root:x.root,fetchImpl}),/HTTP 503/u);
  assert.equal([...each(x.root,receiptType,{strict:true})].length,2);
  assert.deepEqual(await syncAdEvents("https://ads.561.group",{root:x.root,fetchImpl:x.fetchImpl}),
    {pages:3,pulled:3,appended:1,skipped:2});
  assert.equal([...each(x.root,receiptType,{strict:true})].length,3);
});

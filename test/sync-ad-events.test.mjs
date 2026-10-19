import test from "node:test";
import assert from "node:assert/strict";
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

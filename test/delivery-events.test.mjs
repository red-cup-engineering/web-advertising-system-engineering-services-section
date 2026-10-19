import test from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryEvent } from "../src/delivery-events.mjs";

const base={
  type:"view",slot:"afterArticle",property:"koios-news",creativeId:"house-book",
  context:["technology"],requestId:"e1c8a1d2-unique",occurredAt:"2026-10-19T14:00:00.000Z",
  decisionReason:"publisher-client-50pct-1s",
};

test("one complete observed opportunity has original data-provider content identity",()=>{
  const a=buildDeliveryEvent(base),b=buildDeliveryEvent({...base});
  assert.deepEqual(a,b);
  assert.match(a.id,/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(a.kind,"advertising.delivery-event/v2");
  assert.equal(a.evidenceKind,"publisher-client-visibility-report");
  assert.deepEqual(a.context,["technology"]);
  assert.equal("prevHash" in a,false);
  assert.equal("seq" in a,false);
});

test("distinct events have distinct identities without a common mutable sequence",()=>{
  const a=buildDeliveryEvent(base),b=buildDeliveryEvent({...base,requestId:"another-unique-request"});
  assert.notEqual(a.id,b.id);
  assert.equal(buildDeliveryEvent({...base,type:"click"}).evidenceKind,"redirect-request");
});

test("selection and billable impression are not accepted event types",()=>{
  for(const type of ["impression","selection","purchase","conversion",""]) {
    assert.throws(()=>buildDeliveryEvent({...base,type}),/view or click/u);
  }
});

test("invalid page context and missing occurrence identity refuse without issuing an address",()=>{
  for(const value of [
    {...base,context:"technology"},
    {...base,context:[""]},
    {...base,context:Array(9).fill("technology")},
    {...base,requestId:""},
    {...base,occurredAt:"yesterday"},
    {...base,decisionReason:""},
  ]) assert.throws(()=>buildDeliveryEvent(value),TypeError);
});

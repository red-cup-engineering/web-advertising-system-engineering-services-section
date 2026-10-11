import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryReceipt, canonicalJson, sha256Ni } from "../src/receipts.mjs";

test("canonicalJson sorts keys regardless of insertion order", () => {
  const first = canonicalJson({ b: 1, a: 2 });
  const second = canonicalJson({ a: 2, b: 1 });
  assert.equal(first, second);
  assert.equal(first, '{"a":2,"b":1}');
});

test("sha256Ni is a deterministic RFC 6920 ni:// URI", async () => {
  const first = await sha256Ni("hello");
  const second = await sha256Ni("hello");
  assert.equal(first, second);
  assert.match(first, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
});

test("sha256Ni differs for different input", async () => {
  const first = await sha256Ni("hello");
  const second = await sha256Ni("goodbye");
  assert.notEqual(first, second);
});

test("buildDeliveryReceipt validates required fields and type", async () => {
  await assert.rejects(
    buildDeliveryReceipt({ type: "not-a-type", slot: "footer", property: "koios-news", creativeId: "x" }),
    TypeError,
  );
  await assert.rejects(
    buildDeliveryReceipt({ type: "impression", slot: "", property: "koios-news", creativeId: "x" }),
    TypeError,
  );
});

test("buildDeliveryReceipt is content-addressed and chains prevHash", async () => {
  const first = await buildDeliveryReceipt({
    type: "impression",
    slot: "footer",
    property: "play-561-group",
    creativeId: "koios-news-v1",
    occurredAt: "2026-08-31T00:00:00.000Z",
  });
  assert.match(first.id, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(first.prevHash, null);

  const second = await buildDeliveryReceipt({
    type: "click",
    slot: "footer",
    property: "play-561-group",
    creativeId: "koios-news-v1",
    prevHash: first.id,
    occurredAt: "2026-08-31T00:01:00.000Z",
  });
  assert.equal(second.prevHash, first.id);
  assert.notEqual(second.id, first.id);
});

test("buildDeliveryReceipt is deterministic for identical input", async () => {
  const input = {
    type: "impression",
    slot: "footer",
    property: "koios-news",
    creativeId: "play-561-group-v1",
    occurredAt: "2026-08-31T00:00:00.000Z",
  };
  const first = await buildDeliveryReceipt(input);
  const second = await buildDeliveryReceipt(input);
  assert.equal(first.id, second.id);
});

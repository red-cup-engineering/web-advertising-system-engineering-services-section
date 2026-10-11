import { test } from "node:test";
import assert from "node:assert/strict";
import { appendChainedReceipt, chainHead, listChain } from "../src/kv-chain.mjs";

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
      const keys = [...store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name }));
      return { keys };
    },
  };
}

test("appendChainedReceipt starts the chain with prevHash null then chains forward", async () => {
  const kv = createFakeKv();
  const first = await appendChainedReceipt(kv, { type: "impression", slot: "footer", property: "play-561-group", creativeId: "koios-news-v1" });
  assert.equal(first.seq, 0);
  assert.equal(first.prevHash, null);

  const second = await appendChainedReceipt(kv, { type: "click", slot: "footer", property: "play-561-group", creativeId: "koios-news-v1" });
  assert.equal(second.seq, 1);
  assert.equal(second.prevHash, first.id);
});

test("chainHead reflects the most recently appended entry", async () => {
  const kv = createFakeKv();
  assert.equal(await chainHead(kv), null);
  const entry = await appendChainedReceipt(kv, { type: "impression", slot: "footer", property: "koios-news", creativeId: "play-561-group-v1" });
  assert.deepEqual(await chainHead(kv), { seq: 0, id: entry.id });
});

test("listChain returns entries in ascending sequence order honoring since/limit", async () => {
  const kv = createFakeKv();
  for (let i = 0; i < 5; i += 1) {
    await appendChainedReceipt(kv, { type: "impression", slot: "footer", property: "koios-news", creativeId: "play-561-group-v1" });
  }
  const all = await listChain(kv);
  assert.deepEqual(all.map((entry) => entry.seq), [0, 1, 2, 3, 4]);

  const fromTwo = await listChain(kv, { since: 2 });
  assert.deepEqual(fromTwo.map((entry) => entry.seq), [2, 3, 4]);

  const limited = await listChain(kv, { limit: 2 });
  assert.deepEqual(limited.map((entry) => entry.seq), [0, 1]);
});

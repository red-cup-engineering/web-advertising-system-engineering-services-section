import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("receipt-gap logs have an admitted operational observability carrier", async () => {
  const wrangler = JSON.parse(await readFile(new URL("../sites/house-ads-server/wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(wrangler.observability?.enabled, true);
  assert.ok(Number(wrangler.observability?.head_sampling_rate) > 0);
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

test("GET /ad returns a live creative and records an impression receipt", async () => {
  const worker = createAdServerWorker();
  const kv = createFakeKv();
  const response = await worker.fetch(new Request("https://ads.example/ad?slot=footer&property=play-561-group"), { AD_RECEIPTS: kv });
  assert.equal(response.status, 200);
  const body = await response.json();
  // play-561-group never advertises itself; the pick rotates among the other live creatives.
  const live = HOUSE_CREATIVE_CATALOG.filter((creative) => creative.status === "live" && creative.property !== "play-561-group").map((creative) => creative.id);
  assert.ok(live.includes(body.creative.id), body.creative.id);
  assert.ok(body.receipt.id);
  assert.equal(body.receiptStatus, "recorded");

  const receiptsResponse = await worker.fetch(new Request("https://ads.example/receipts"), { AD_RECEIPTS: kv });
  const { entries } = await receiptsResponse.json();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "impression");
});

test("GET /ad still serves a creative when receipt KV persistence fails", async () => {
  const worker = createAdServerWorker();
  const kv = createFakeKv();
  kv.put = async () => { throw new Error("KV put quota exceeded"); };
  const priorError = console.error;
  const errors = [];
  console.error = (message) => errors.push(message);
  try {
    const response = await worker.fetch(new Request("https://ads.example/ad?slot=footer&property=play-561-group"), { AD_RECEIPTS: kv });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.creative);
    assert.equal(body.receipt, null);
    assert.equal(body.receiptStatus, "unavailable");
    assert.equal(errors.length, 1);
    const gap = JSON.parse(errors[0]);
    assert.equal(gap.event, "advertising.receipt-persistence-unavailable");
    assert.equal(gap.delivered, true);
    assert.equal(gap.attribution, "unavailable");
    assert.equal(gap.type, "impression");
    assert.equal(gap.property, "play-561-group");
    assert.ok(gap.requestId);
  } finally {
    console.error = priorError;
  }
});

test("GET /click redirects to the creative href and records a click receipt", async () => {
  const worker = createAdServerWorker();
  const kv = createFakeKv();
  const response = await worker.fetch(
    new Request("https://ads.example/click?slot=footer&property=play-561-group&creative=koios-news-v1", { redirect: "manual" }),
    { AD_RECEIPTS: kv },
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://koios.news/");
  assert.equal(response.headers.get("x-561-receipt-status"), "recorded");

  const { entries } = await (await worker.fetch(new Request("https://ads.example/receipts"), { AD_RECEIPTS: kv })).json();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "click");
});

test("GET /click still redirects when receipt KV persistence fails", async () => {
  const worker = createAdServerWorker();
  const kv = createFakeKv();
  kv.put = async () => { throw new Error("KV put quota exceeded"); };
  const priorError = console.error;
  const errors = [];
  console.error = (message) => errors.push(message);
  try {
    const response = await worker.fetch(
      new Request("https://ads.example/click?slot=footer&property=play-561-group&creative=koios-news-v1", { redirect: "manual" }),
      { AD_RECEIPTS: kv },
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://koios.news/");
    assert.equal(response.headers.get("x-561-receipt-status"), "unavailable");
    assert.equal(errors.length, 1);
    const gap = JSON.parse(errors[0]);
    assert.equal(gap.event, "advertising.receipt-persistence-unavailable");
    assert.equal(gap.delivered, true);
    assert.equal(gap.attribution, "unavailable");
    assert.equal(gap.type, "click");
    assert.equal(gap.creativeId, "koios-news-v1");
    assert.ok(gap.requestId);
  } finally {
    console.error = priorError;
  }
});

test("unknown route returns 404", async () => {
  const worker = createAdServerWorker();
  const response = await worker.fetch(new Request("https://ads.example/nowhere"), {});
  assert.equal(response.status, 404);
});

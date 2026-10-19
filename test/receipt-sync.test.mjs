import test from "node:test";
import assert from "node:assert/strict";
import { readAdReceiptSnapshot, syncAdReceipts } from "../scripts/sync-ad-receipts-to-journal.mjs";
import { buildDeliveryReceipt } from "../src/receipts.mjs";

const origin = "https://ads.561.group";

async function receipts(count) {
  const rows = [];
  let prevHash = null;
  for (let seq = 0; seq < count; seq += 1) {
    const receipt = await buildDeliveryReceipt({
      prevHash, type: seq % 2 ? "click" : "impression", slot: "footer",
      property: "koios-news", creativeId: "promotion",
      requestId: "fixture-" + seq, occurredAt: "2026-10-19T00:00:00Z",
    });
    rows.push({ seq, ...receipt });
    prevHash = receipt.id;
  }
  return rows;
}

function service(rows, modifier = (_since, page) => page) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const request = new URL(url), since = Number(request.searchParams.get("since"));
    calls.push({ since, options });
    assert.equal(request.origin, origin);
    assert.equal(request.pathname, "/receipts");
    const entries = rows.slice(since, since + 100);
    const head = rows.at(-1) ? { seq: rows.at(-1).seq, id: rows.at(-1).id } : null;
    return { ok: true, json: async () => modifier(since, {
      head, entries, nextSince: since + entries.length,
      complete: !head || since + entries.length > head.seq,
    }) };
  };
  return { fetchImpl, calls };
}

function journal() {
  const records = [];
  return {
    records,
    query() { return records.map(record => ({ record: record.record })); },
    record(record) { records.push(record); },
  };
}

test("the actual paged source sends all 205 sequential entries, not just the first 100", async () => {
  const rows = await receipts(205), { fetchImpl, calls } = service(rows);
  const received = await readAdReceiptSnapshot(origin, fetchImpl);
  assert.deepEqual(received, rows);
  assert.deepEqual(calls.map(call => call.since), [0, 100, 200]);
  assert.ok(calls.every(call => call.options.redirect === "manual"));
});

test("one complete source snapshot enters the original semantic journal once", async () => {
  const rows = await receipts(205), { fetchImpl } = service(rows), store = journal();
  assert.deepEqual(await syncAdReceipts({ adServerUrl: origin, journal: store, fetchImpl }), {
    pulled: 205, appended: 205, skipped: 0,
  });
  assert.equal(store.records.length, 205);
  assert.equal(store.records[204].record.id, rows[204].id);
  assert.equal(store.records[0].relation.predicate, "delivers");
  assert.deepEqual(await syncAdReceipts({ adServerUrl: origin, journal: store, fetchImpl }), {
    pulled: 205, appended: 0, skipped: 205,
  });
  assert.equal(store.records.length, 205);
});

test("zero receipts mean no ledger writes", async () => {
  const store = journal(), { fetchImpl } = service([]);
  assert.deepEqual(await syncAdReceipts({ adServerUrl: origin, journal: store, fetchImpl }), {
    pulled: 0, appended: 0, skipped: 0,
  });
  assert.equal(store.records.length, 0);
});

test("a missing middle page or broken sequence refuses before any journal write", async () => {
  const rows = await receipts(205), store = journal();
  for (const transform of [
    (since, page) => since === 100 ? { ...page, entries: [] } : page,
    (since, page) => since === 100
      ? { ...page, entries: page.entries.map((row, i) => i === 5 ? { ...row, seq: 900 } : row) }
      : page,
    (since, page) => since === 100
      ? { ...page, entries: page.entries.map((row, i) => i === 0 ? { ...row, prevHash: "wrong" } : row) }
      : page,
    (since, page) => since === 100
      ? { ...page, entries: page.entries.map((row, i) => i === 3 ? { ...row, property: "forged" } : row) }
      : page,
  ]) {
    await assert.rejects(syncAdReceipts({ adServerUrl: origin, journal: store,
      fetchImpl: service(rows, transform).fetchImpl }), /required page|gap|address mismatch/u);
    assert.equal(store.records.length, 0);
  }
});

test("a contradictory snapshot head and broken cursor refuse without partial receipts", async () => {
  const rows = await receipts(105);
  await assert.rejects(readAdReceiptSnapshot(origin,
    service(rows, (since, page) => since === 0 ? { ...page, head: {seq:104,id:"wrong"} } : page).fetchImpl), /starting chain head/u);
  await assert.rejects(readAdReceiptSnapshot(origin,
    service(rows, (since, page) => since === 0 ? { ...page, nextSince:999 } : page).fetchImpl), /cursor/u);
});

test("a failed server page and unapproved origin cannot become advertising receipts", async () => {
  for (const bad of ["http://ads.561.group", "https://user:pass@ads.561.group", "https://ads.561.group/mirror", "https://ads.561.group/?q=1"]) {
    await assert.rejects(readAdReceiptSnapshot(bad, service([]).fetchImpl), /bare HTTPS origin/u);
  }
  await assert.rejects(readAdReceiptSnapshot(origin, async () => ({ ok:false, status:503 })), /refused page/u);
  await assert.rejects(syncAdReceipts({ adServerUrl: origin, journal:{}, fetchImpl: service([]).fetchImpl }), /semantic journal required/u);
});

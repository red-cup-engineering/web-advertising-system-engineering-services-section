#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";

const CATEGORY = "advertising.delivery-receipt";
const SECTION_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAX_SNAPSHOT_ENTRIES = 100000;

/**
 * Receive the original ad server's bounded, ordered receipt pages. This is
 * custody of source-observed ad responses/clicks, not a claim of human views,
 * advertiser billing, or customer conversion.
 */
export async function readAdReceiptSnapshot(adServerUrl, fetchImpl = fetch) {
  const base = new URL(adServerUrl);
  if (base.protocol !== "https:" || base.username || base.password ||
      base.port || base.pathname !== "/" || base.search || base.hash)
    throw new TypeError("ad server must be a bare HTTPS origin");
  let next = 0, target = null, expectedPrevious = null, rows = [];
  for (;;) {
    const response = await fetchImpl(base.origin + "/receipts?since=" + next, {
      redirect: "manual",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("ad receipt source refused page");
    const page = await response.json();
    if (!Array.isArray(page?.entries))
      throw new TypeError("ad receipt source returned an invalid page");
    if (target === null) {
      if (page.head == null) {
        if (page.entries.length) throw new Error("entries without chain head");
        return [];
      }
      if (!Number.isSafeInteger(page.head.seq) || page.head.seq < 0 ||
          typeof page.head.id !== "string" || !page.head.id)
        throw new Error("ad receipt source head is malformed");
      if (page.head.seq >= MAX_SNAPSHOT_ENTRIES)
        throw new RangeError("ad receipt snapshot exceeds bounded run");
      target = { seq: page.head.seq, id: page.head.id };
    }
    if (page.entries.length === 0) throw new Error("ad receipt source omitted a required page");
    if (page.entries.length > 100) throw new Error("ad receipt source exceeded page size");
    for (const entry of page.entries) {
      if (!entry || entry.seq !== next ||
          typeof entry.id !== "string" || !entry.id ||
          entry.prevHash !== expectedPrevious)
        throw new Error("ad receipt source contains a sequence or hash-chain gap");
      rows.push(entry);
      expectedPrevious = entry.id;
      next += 1;
      if (next > target.seq) break;
    }
    if (next > target.seq) {
      if (rows.at(-1).id !== target.id)
        throw new Error("ad receipt source changed the starting chain head");
      return rows;
    }
    if (page.nextSince !== undefined && page.nextSince !== next)
      throw new Error("ad receipt source cursor disagrees with its entries");
  }
}

/** Pull and durably receive one complete snapshot into the original journal. */
export async function syncAdReceipts({ adServerUrl, journal, fetchImpl = fetch }) {
  if (!journal || typeof journal.query !== "function" ||
      typeof journal.record !== "function") throw new TypeError("semantic journal required");
  const entries = await readAdReceiptSnapshot(adServerUrl, fetchImpl);
  const already = new Set(journal.query({ category: CATEGORY }).map((row) => row.record.id));
  let appended = 0;
  for (const entry of entries) {
    if (already.has(entry.id)) continue;
    journal.record({
      category: CATEGORY,
      record: entry,
      recordedAt: entry.occurredAt,
      told: { for: true, against: false },
      relation: { subject: "advertising-services-section", predicate: "delivers", object: entry.id },
    });
    already.add(entry.id);
    appended += 1;
  }
  return { pulled: entries.length, appended, skipped: entries.length - appended };
}

async function main(argv) {
  const [adServerUrl] = argv;
  if (!adServerUrl) {
    console.error("usage: sync-ad-receipts-to-journal.mjs <ad-server-https-origin>");
    process.exitCode = 1;
    return;
  }
  const journal = createSemanticRecordJournal({
    root: SECTION_ROOT, objectKind: "advertising.delivery-receipt",
  });
  console.log(JSON.stringify(await syncAdReceipts({ adServerUrl, journal }), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => {
    console.error(error?.message ?? "ad receipt sync failed");
    process.exitCode = 1;
  });

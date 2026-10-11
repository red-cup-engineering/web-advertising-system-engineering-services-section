#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";

const CATEGORY = "advertising.delivery-receipt";
const SECTION_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The durable lane: pull the Worker-edge KV hash chain via its own
 * GET /receipts endpoint and append each new entry into this section's
 * semantic-record-journal (data/logs/), idempotent by the entry's own
 * content-addressed id — the edge append is v0 storage, this is custody.
 * @param {string[]} argv `node sync-ad-receipts-to-journal.mjs <ad-server-base-url>`
 */
async function main(argv) {
  const [adServerUrl] = argv;
  if (!adServerUrl) {
    console.error("usage: sync-ad-receipts-to-journal.mjs <ad-server-base-url>");
    process.exitCode = 1;
    return;
  }
  const journal = createSemanticRecordJournal({ root: SECTION_ROOT, objectKind: "advertising.delivery-receipt" });
  const already = new Set(journal.query({ category: CATEGORY }).map((row) => row.record.id));
  const response = await fetch(`${adServerUrl.replace(/\/$/u, "")}/receipts`);
  if (!response.ok) throw new Error(`ad server /receipts responded ${response.status}`);
  const { entries } = await response.json();
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
    appended += 1;
  }
  console.log(JSON.stringify({ pulled: entries.length, appended, skipped: entries.length - appended }, null, 2));
}

main(process.argv.slice(2));

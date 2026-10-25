#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { each, put } from "@red-cup-engineering/semiotic-eavt-services-section/store";

const CATEGORY = "advertising.delivery-receipt";
const RECORD_TYPE = "advertising-delivery-receipt";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The source-operation journal now uses SEAVT's exported immutable store.
 * Keep the receipt envelope and its original JSON/NI identity intact; the store
 * separately addresses the envelope. No mutable head, new chain or event order
 * is inferred. Native strict discovery refuses corrupt or legacy layouts.
 */
function receiptJournal(root) {
  return {
    query() {
      const rows = [...each(root, RECORD_TYPE, { strict: true })].map(row => row.record);
      if (rows.some(row => row.category !== CATEGORY)) throw new Error("invalid receipt record category");
      return rows;
    },
    record(row) { return put(root, RECORD_TYPE, row, { durableRoot: root }); },
  };
}

function receiptIdentity(entry) {
  if (typeof entry?.id !== "string" || !entry.id) throw new Error("unidentified event");
  return canonicalJson(entry);
}

/** Read both the historical chain and the current independently addressed
 * events using the native KV cursor, keeping evidence versions distinct.
 */
export async function syncAdEvents(base, { fetchImpl = fetch, journal, root = ROOT } = {}) {
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.search || origin.hash || origin.pathname !== "/")
    throw new TypeError("require bare HTTPS advertising origin");
  const store = journal ?? receiptJournal(root);
  const known = new Map();
  const remember = entry => {
    const identity = receiptIdentity(entry);
    if (known.has(entry.id) && known.get(entry.id) !== identity) throw new Error("conflicting receipt identity");
    known.set(entry.id, identity);
  };
  for (const row of store.query({category: CATEGORY})) remember(row.record);
  let pages = 0, pulled = 0, appended = 0;
  for (const series of ["legacy", "current"]) {
    let cursor;
    do {
      if (++pages > 1000) throw new Error("incomplete receipt sweep: too many pages");
      const url = new URL("/receipts", origin);
      url.searchParams.set("series", series);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetchImpl(url.toString(), { method: "GET", redirect: "error" });
      if (!response.ok) throw new Error("receipt provider refused " + series + ": HTTP " + response.status);
      const page = await response.json();
      if (page.series !== series || !Array.isArray(page.entries) ||
          typeof page.complete !== "boolean" ||
          (!page.complete && (!page.cursor || page.cursor === cursor)))
        throw new Error("invalid receipt page");
      for (const entry of page.entries) {
        pulled++;
        const identity = receiptIdentity(entry);
        if (known.has(entry.id)) {
          if (known.get(entry.id) !== identity) throw new Error("conflicting receipt identity");
          continue;
        }
        store.record({ category: CATEGORY, record: entry, recordedAt: entry.occurredAt,
          told: {for:true, against:false},
          relation: {subject:"advertising-services-section", predicate:"reports-event", object:entry.id} });
        known.set(entry.id, identity);
        appended++;
      }
      cursor = page.complete ? undefined : page.cursor;
    } while (cursor);
  }
  return { pages, pulled, appended, skipped: pulled - appended };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("usage: sync-ad-receipts-to-journal.mjs https://ads.561.group");
  console.log(JSON.stringify(await syncAdEvents(process.argv[2]), null, 2));
}

#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";

const CATEGORY = "advertising.delivery-receipt";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Read both the historical chain and the current independently addressed
 * events using the native KV cursor, keeping evidence versions distinct.
 */
export async function syncAdEvents(base, { fetchImpl = fetch, journal } = {}) {
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.search || origin.hash || origin.pathname !== "/")
    throw new TypeError("require bare HTTPS advertising origin");
  const store = journal ?? createSemanticRecordJournal({ root: ROOT, objectKind: CATEGORY });
  const known = new Set(store.query({category: CATEGORY}).map(row => row.record.id));
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
        if (typeof entry?.id !== "string" || !entry.id) throw new Error("unidentified event");
        if (known.has(entry.id)) continue;
        store.record({ category: CATEGORY, record: entry, recordedAt: entry.occurredAt,
          told: {for:true, against:false},
          relation: {subject:"advertising-services-section", predicate:"reports-event", object:entry.id} });
        known.add(entry.id);
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

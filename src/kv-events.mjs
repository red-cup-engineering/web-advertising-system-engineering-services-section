import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { buildDeliveryEvent } from "./delivery-events.mjs";

const PREFIX = Object.freeze({
  current: "delivery:v2:",
  legacy: "chain:entry:",
});

/** One content address, one KV key, one PUT. This is an unordered event set,
 * not a KV-based transaction log or synchronized global counter.
 * Distinct events cannot overwrite the same sequence key.
 */
export async function recordDeliveryEvent(kv, input) {
  if (typeof kv?.put !== "function") throw new TypeError("KV put is required");
  const event = buildDeliveryEvent(input);
  await kv.put(PREFIX.current + encodeURIComponent(event.id), canonicalJson(event));
  return event;
}

/** Read a page of independently keyed events or the original v1 chain.
 * Caller retains provider cursor and repeats complete sweeps to account for
 * Workers KV eventual consistency. The old series is strictly read-only.
 */
export async function listDeliveryEvents(kv, { series = "current", cursor, limit = 50 } = {}) {
  if (typeof kv?.list !== "function" || typeof kv?.get !== "function") {
    throw new TypeError("KV list/get are required");
  }
  const prefix = PREFIX[series];
  if (!prefix) throw new TypeError("invalid event series");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("limit must be a positive integer at most 100");
  }
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 1024)) {
    throw new TypeError("invalid event cursor");
  }
  const listing = await kv.list({
    prefix, limit, ...(cursor === undefined ? {} : { cursor }),
  });
  if (!Array.isArray(listing?.keys) || typeof listing.list_complete !== "boolean") {
    throw new TypeError("KV listing must include keys and list_complete");
  }
  if (!listing.list_complete && (typeof listing.cursor !== "string" ||
      !listing.cursor || listing.cursor === cursor)) {
    throw new TypeError("KV did not advance its pagination cursor");
  }
  const entries = (await Promise.all(listing.keys.map(key => kv.get(key.name, "json"))))
    .filter(value => value !== null && value !== undefined);
  return Object.freeze({
    series,
    entries: Object.freeze(entries),
    complete: listing.list_complete,
    cursor: listing.list_complete ? null : listing.cursor,
  });
}

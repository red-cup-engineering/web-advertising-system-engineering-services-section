import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

export { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";

/**
 * Build one content-addressed, hash-chained delivery receipt.
 * @param {object} input
 * @param {"impression"|"click"} input.type
 * @param {string} input.slot
 * @param {string} input.property
 * @param {string} input.creativeId
 * @param {?string} [input.decisionReason]
 * @param {?string} [input.prevHash] Previous chain entry's id, or null for the first entry.
 * @param {?string} [input.requestId]
 * @param {string} [input.occurredAt] ISO-8601 timestamp; defaults to now.
 * @returns {Promise<object>} Frozen receipt with its own content-addressed `id`.
 */
export async function buildDeliveryReceipt({
  type,
  slot,
  property,
  creativeId,
  decisionReason = null,
  prevHash = null,
  requestId = null,
  occurredAt = new Date().toISOString(),
}) {
  if (type !== "impression" && type !== "click") {
    throw new TypeError("Advertising delivery receipt type must be 'impression' or 'click'");
  }
  if (!slot || !property || !creativeId) {
    throw new TypeError("Advertising delivery receipt requires slot, property, and creativeId");
  }
  const body = Object.freeze({
    type,
    slot: String(slot),
    property: String(property),
    creativeId: String(creativeId),
    decisionReason,
    prevHash,
    requestId,
    occurredAt,
  });
  const id = makeNiUri(new TextEncoder().encode(canonicalJson(body)));
  return Object.freeze({ id, ...body });
}

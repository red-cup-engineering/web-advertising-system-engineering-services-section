/**
 * v0 receipts: WebCrypto SHA-256 over canonical JSON, chained by prevHash,
 * as an RFC 6920 ni:// URI (no fs at the edge for the full RMN/CBOR
 * pipeline; scripts/sync-ad-receipts-to-journal.mjs re-derives the
 * canonical semantic-record-journal identity off-edge — the durable lane).
 * @param {unknown} value Deterministically sorted before JSON.stringify.
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

/**
 * @param {unknown} value Any JSON-serializable value.
 * @returns {string} Canonical (key-sorted) JSON text.
 */
export function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} Unpadded base64url, without Node's Buffer.
 */
function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/**
 * @param {string} text UTF-8 text to digest.
 * @returns {Promise<string>} `ni:///sha-256;<base64url>` content address.
 */
export async function sha256Ni(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `ni:///sha-256;${toBase64Url(new Uint8Array(digest))}`;
}

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
  const id = await sha256Ni(canonicalJson(body));
  return Object.freeze({ id, ...body });
}

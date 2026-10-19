import { buildDeliveryReceipt } from "./receipts.mjs";

const HEAD_KEY = "chain:head";

/** @param {number} seq @returns {string} */
function entryKey(seq) {
  return `chain:entry:${String(seq).padStart(12, "0")}`;
}

/**
 * Minimal KV-compatible store contract this module needs (matches the
 * Cloudflare Workers KV namespace binding shape) — `get(key, "json")`,
 * `put(key, string)`, `list({prefix})`.
 * @typedef {{get: Function, put: Function, list: Function}} KvNamespace
 */

/**
 * Append one delivery receipt to the KV-backed hash chain, reading the
 * current head to set `prevHash` and advancing the head atomically per
 * this call. Known v0 limitation: KV has no cross-key transaction, so two
 * concurrent writes can race onto the same seq; graduating to a Durable
 * Object or D1 lock is future work, not needed at v0 traffic.
 * @param {KvNamespace} kv
 * @param {object} input Same shape as {@link buildDeliveryReceipt}'s input, minus `prevHash`.
 * @returns {Promise<object>} The appended chain entry (receipt plus `seq`).
 */
export async function appendChainedReceipt(kv, input) {
  const head = await kv.get(HEAD_KEY, "json");
  const seq = head ? head.seq + 1 : 0;
  const receipt = await buildDeliveryReceipt({ ...input, prevHash: head ? head.id : null });
  const entry = Object.freeze({ seq, ...receipt });
  await kv.put(entryKey(seq), JSON.stringify(entry));
  await kv.put(HEAD_KEY, JSON.stringify({ seq, id: receipt.id }));
  return entry;
}

/**
 * @param {KvNamespace} kv
 * @param {object} [options]
 * @param {number} [options.since] Minimum sequence number, inclusive.
 * @param {number} [options.limit] Maximum entries to return.
 * @returns {Promise<object[]>} Chain entries in ascending sequence order.
 */
export async function listChain(kv, { since = 0, limit = 100, head } = {}) {
  if (!Number.isSafeInteger(since) || since < 0)
    throw new TypeError("receipt since must be a nonnegative safe integer");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("receipt page limit must be within 1..100");
  // Fixed-width sequence keys are already an index. Do not rely on one
  // truncated KV list page: after 1,000 keys it stranded every newer receipt.
  const recordedHead = head === undefined ? await chainHead(kv) : head;
  if (!recordedHead) return [];
  if (!Number.isSafeInteger(recordedHead.seq) || recordedHead.seq < 0)
    throw new Error("receipt chain head is malformed");
  const entries = [];
  const last = Math.min(recordedHead.seq, since + limit - 1);
  for (let seq = since; seq <= last; seq += 1) {
    const entry = await kv.get(entryKey(seq), "json");
    if (!entry || entry.seq !== seq)
      throw new Error("receipt chain has a missing or malformed entry");
    entries.push(entry);
  }
  return entries;
}

/**
 * @param {KvNamespace} kv
 * @returns {Promise<?{seq: number, id: string}>} The current chain head, or null if empty.
 */
export async function chainHead(kv) {
  return (await kv.get(HEAD_KEY, "json")) ?? null;
}

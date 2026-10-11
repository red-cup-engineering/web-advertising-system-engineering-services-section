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
export async function listChain(kv, { since = 0, limit = 100 } = {}) {
  const { keys } = await kv.list({ prefix: "chain:entry:" });
  const selected = keys
    .filter((key) => Number(key.name.slice("chain:entry:".length)) >= since)
    .slice(0, limit);
  const entries = [];
  for (const key of selected) {
    const value = await kv.get(key.name, "json");
    if (value) entries.push(value);
  }
  return entries.sort((a, b) => a.seq - b.seq);
}

/**
 * @param {KvNamespace} kv
 * @returns {Promise<?{seq: number, id: string}>} The current chain head, or null if empty.
 */
export async function chainHead(kv) {
  return (await kv.get(HEAD_KEY, "json")) ?? null;
}

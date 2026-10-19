import { HOUSE_CREATIVE_CATALOG } from "../catalog.mjs";
import { listEligibleCreatives, selectCreative } from "../advertising.mjs";
import { appendChainedReceipt, chainHead, listChain } from "../kv-chain.mjs";

/**
 * House properties call this ad server cross-origin (play.561.group,
 * koios.news, ...) from a plain client-side fetch(); allow any origin
 * since responses carry no per-viewer or credentialed data.
 * @param {unknown} body @param {{status?: number}} [init] @returns {Response}
 */
function json(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
}

/** Strip internal catalog fields (status, slots, properties, tags) from a served creative. */
function publicCreative(creative) {
  const { id, title, body, href, imageAlt, relationship } = creative;
  return {
    id, title, body, href, imageAlt: imageAlt ?? null, relationship,
    // Renderers must present disclosure beside non-house calls to action;
    // search engines and agent clients must also receive a paid-link relation.
    disclosure: relationship === "house" ? null : creative.disclosure,
    linkRel: relationship === "house" ? null : "sponsored nofollow",
    allowedContexts: relationship === "house" ? null : creative.allowedContexts,
    eligibility: relationship === "house" ? null : (creative.eligibility ?? null),
    riskNotice: relationship === "house" ? null : (creative.riskNotice ?? null),
    expiresAt: relationship === "house" ? null : creative.expiresAt,
  };
}

/** Cloudflare's free Workers KV PUT limit resets daily at 00:00 UTC.
 * Hold additional writes in the current isolate after a native 429 or explicit
 * write quota refusal; do not create another database or authoritative ledger.
 */
function kvWriteQuotaExhausted(error) {
  if (error?.status === 429 || error?.statusCode === 429) return true;
  const message = typeof error?.message === "string" ? error.message : "";
  return /\b429\b|(?:KV|put|write).*(?:quota|limit|exceed)|(?:quota|limit|exceed).*(?:KV|put|write)/iu.test(message);
}

function pageContext(url) {
  return (url.searchParams.get("context") ?? "").split(",").map(v => v.trim()).filter(Boolean).slice(0,8);
}
function nextUtcQuotaReset(nowMs) {
  const when = new Date(nowMs);
  return Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate() + 1);
}

/** Emit a structured operational gap event without creating a second receipt ledger. */
function reportReceiptGap({ type, slot, property, creativeId, decisionReason, requestId, error }) {
  console.error(JSON.stringify({
    event: "advertising.receipt-persistence-unavailable",
    delivered: true,
    attribution: "unavailable",
    type,
    slot,
    property,
    creativeId,
    decisionReason,
    requestId,
    errorClass: kvWriteQuotaExhausted(error)
      ? "kv-write-quota-exhausted" : "receipt-storage-error",
  }));
}

/** A placement identity is a bounded catalog coordinate, not an arbitrary reader label. */
function placementName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(value);
}

/**
 * Best-effort, aggregate activity, not a durable receipt or a human impression.
 * No URL, address, user agent, cookie, requestId, or person-level signal enters
 * this event. WAE can sample; "submitted" means only that its write was invoked.
 */
function recordActivity(env, { event, slot, property, creativeId, relationship }) {
  const dataset = env?.AD_ACTIVITY;
  if (typeof dataset?.writeDataPoint !== "function") return "unbound";
  try {
    dataset.writeDataPoint({
      indexes: [property],
      blobs: [event, slot, creativeId, relationship],
      doubles: [1],
    });
    return "submitted";
  } catch {
    return "unavailable";
  }
}

/**
 * Build the house ad server's fetch handler. GET /ad?slot&property[&context] returns
 * one contextual (no cookies, no cross-request profile) creative. Ordinary
 * house responses and redirects emit nonbillable aggregate activity without
 * consuming Workers KV. Paid campaigns require the existing receipt chain
 * before a creative response or redirect. GET /receipts remains the custody
 * reader for that chain and its historic entries; GET /catalog reads offers.
 * Analytics activity is not a witnessed human view, conversion, or payment.
 * @param {object} [options]
 * @param {import("../catalog.mjs").AdCreative[]} [options.catalog]
 * @returns {{fetch: (request: Request, env: object) => Promise<Response>}}
 */
export function createAdServerWorker({ catalog = HOUSE_CREATIVE_CATALOG, nowMs = Date.now } = {}) {
  if (typeof nowMs !== "function") throw new TypeError("nowMs must provide the current epoch milliseconds");
  // This is local backpressure on one Worker isolate, not a claim of globally
  // synchronized quota state. The provider remains authoritative.
  let kvPutHoldUntilMs = 0;
  const receiptWritesOpen = () => nowMs() >= kvPutHoldUntilMs;
  const onReceiptWriteFailure = (details, error) => {
    if (kvWriteQuotaExhausted(error)) kvPutHoldUntilMs = nextUtcQuotaReset(nowMs());
    reportReceiptGap({ ...details, error });
  };
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const kv = env?.AD_RECEIPTS;

      if (url.pathname === "/health") {
        return json({ ok: true, service: "advertising-services-section", catalogSize: catalog.length });
      }

      if (url.pathname === "/catalog") {
        return json({ catalog });
      }

      if (url.pathname === "/ad") {
        const slot = url.searchParams.get("slot");
        const property = url.searchParams.get("property");
        if (!placementName(slot) || !placementName(property))
          return json({ error: "invalid slot or property" }, { status: 400 });
        const context = pageContext(url);
        const picked = selectCreative({ catalog, slot, property, context, now: new Date(nowMs()) });
        if (!picked) return json({ error: "no eligible creative for slot/property" }, { status: 404 });

        let receipt = null;
        // Paid decisions need the existing accountable custody. An ordinary
        // house promotion never spends two KV writes on a nonbillable response.
        if (picked.creative.relationship !== "house") {
          if (!kv || !receiptWritesOpen())
            return json({ error: "paid campaign receipt unavailable" }, { status: 503 });
          const requestId = crypto.randomUUID();
          try {
            receipt = await appendChainedReceipt(kv, {
              type: "impression", slot, property,
              creativeId: picked.creative.id,
              decisionReason: picked.decision.reason, requestId,
            });
          } catch (error) {
            onReceiptWriteFailure({ type: "impression", slot, property, creativeId: picked.creative.id, decisionReason: picked.decision.reason, requestId }, error);
            return json({ error: "paid campaign receipt unavailable" }, { status: 503 });
          }
        }
        const activityStatus = recordActivity(env, {
          event: "creative-response", slot, property,
          creativeId: picked.creative.id, relationship: picked.creative.relationship,
        });
        return json({
          creative: publicCreative(picked.creative),
          receipt: receipt ? { id: receipt.id, seq: receipt.seq } : null,
          receiptStatus: receipt ? "recorded" : "not-applicable",
          activityStatus,
        });
      }

      if (url.pathname === "/click") {
        const slot = url.searchParams.get("slot");
        const property = url.searchParams.get("property");
        const creativeId = url.searchParams.get("creative");
        if (!placementName(slot) || !placementName(property) || !creativeId)
          return json({ error: "invalid slot, property, or creative" }, { status: 400 });
        // The same context, live state and scope apply to both serving and
        // redirects. A forged or expired creative never becomes a destination.
        const creative = listEligibleCreatives({ catalog, slot, property, context: pageContext(url), now: new Date(nowMs()) }).find((entry) => entry.id === creativeId);
        if (!creative) return json({ error: "creative is not eligible for slot/property" }, { status: 404 });

        let receiptStatus = "not-applicable";
        if (creative.relationship !== "house") {
          if (!kv || !receiptWritesOpen())
            return json({ error: "paid campaign receipt unavailable" }, { status: 503 });
          const requestId = crypto.randomUUID();
          try {
            await appendChainedReceipt(kv, {
              type: "click", slot, property, creativeId,
              decisionReason: "publisher-click", requestId,
            });
            receiptStatus = "recorded";
          } catch (error) {
            onReceiptWriteFailure({ type: "click", slot, property, creativeId, decisionReason: "publisher-click", requestId }, error);
            return json({ error: "paid campaign receipt unavailable" }, { status: 503 });
          }
        }
        const activityStatus = recordActivity(env, {
          event: "outbound-redirect", slot, property, creativeId,
          relationship: creative.relationship,
        });
        return new Response(null, {
          status: 302,
          headers: {
            location: creative.href,
            "x-561-receipt-status": receiptStatus,
            "x-561-activity-status": activityStatus,
          },
        });
      }

      if (url.pathname === "/receipts") {
        if (!kv) return json({ error: "receipt chain not bound" }, { status: 503 });
        const since = Number(url.searchParams.get("since") ?? "0");
        const [entries, head] = await Promise.all([listChain(kv, { since }), chainHead(kv)]);
        return json({ head, entries });
      }

      return json({ error: "not found" }, { status: 404 });
    },
  };
}

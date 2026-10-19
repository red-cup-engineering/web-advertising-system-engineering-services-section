import { HOUSE_CREATIVE_CATALOG } from "../catalog.mjs";
import { listEligibleCreatives, selectCreative } from "../advertising.mjs";
import { recordDeliveryEvent, listDeliveryEvents } from "../kv-events.mjs";

/**
 * House properties call this ad server cross-origin (play.561.group,
 * koios.news, ...) from a plain client-side fetch(); allow any origin
 * since responses carry no per-viewer or credentialed data.
 * @param {unknown} body @param {{status?: number}} [init] @returns {Response}
 */
function json(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" },
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
    attempted: true,
    recorded: false,
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
 * one contextual creative without recording an impression. POST /view stores
 * a browser-reported visibility opportunity, and GET /click records a redirect.
 * GET /receipts pages content-addressed independent events or v1 history.
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
      if (request.method === "OPTIONS" && url.pathname === "/view") {
        return new Response(null, {status: 204, headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        }});
      }

      if (url.pathname === "/health") {
        if (request.method !== "GET") return json({error:"method not allowed"},{status:405});
        return json({ ok: true, service: "advertising-services-section", catalogSize: catalog.length });
      }

      if (url.pathname === "/catalog") {
        if (request.method !== "GET") return json({error:"method not allowed"},{status:405});
        return json({ catalog });
      }

      if (url.pathname === "/ad") {
        if (request.method !== "GET") return json({error:"method not allowed"},{status:405});
        const slot = url.searchParams.get("slot");
        const property = url.searchParams.get("property");
        if (!placementName(slot) || !placementName(property)) return json({error:"invalid slot or property"},{status:400});
        const context = pageContext(url);
        const picked = selectCreative({ catalog, slot, property, context, now: new Date(nowMs()) });
        if (!picked) return json({ error: "no eligible creative for slot/property" }, { status: 404 });
        // A paid campaign requires a functioning receipt sink, but selection
        // itself is never a view or a charged impression.
        if (picked.creative.relationship !== "house" && (!kv || !receiptWritesOpen()))
          return json({error:"paid campaign delivery unavailable"},{status:503});
        const activityStatus=recordActivity(env,{event:"creative-response",slot,property,
          creativeId:picked.creative.id,relationship:picked.creative.relationship});
        return json({ creative: publicCreative(picked.creative), activityStatus });
      }

      if (url.pathname === "/view") {
        if (request.method !== "POST") return json({error:"method not allowed"},{status:405});
        if (url.href.length > 2048) return json({error:"request too long"},{status:414});
        const slot=url.searchParams.get("slot");
        const property=url.searchParams.get("property");
        const creativeId=url.searchParams.get("creative");
        if (!placementName(slot) || !placementName(property) || !creativeId)
          return json({error:"invalid slot, property or creative"},{status:400});
        const context=pageContext(url);
        const eligible=listEligibleCreatives({catalog,slot,property,context,now:new Date(nowMs())});
        const creative=eligible.find(c=>c.id===creativeId);
        if (!creative) return json({error:"creative not eligible for slot/property/context"},{status:404});
        if (creative.relationship === "house") {
          const activityStatus=recordActivity(env,{event:"client-visible-opportunity",slot,property,
            creativeId,relationship:creative.relationship});
          return json({status:activityStatus==="submitted"?"submitted":"unbound",activityStatus},{status:202});
        }
        if (!kv || !receiptWritesOpen())
          return json({error:"paid view event not recorded"},{status:503});
        const requestId=crypto.randomUUID();
        try {
          const receipt=await recordDeliveryEvent(kv,{type:"view",slot,property,creativeId,
            context,decisionReason:"publisher-client-50pct-1s",
            requestId,occurredAt:new Date(nowMs()).toISOString()});
          return json({status:"recorded",id:receipt.id},{status:202});
        } catch(error) {
          onReceiptWriteFailure({type:"view",slot,property,creativeId,requestId},error);
          return json({error:"view event not recorded"},{status:503});
        }
      }

      if (url.pathname === "/click") {
        if (request.method !== "GET") return json({error:"method not allowed"},{status:405});
        const slot = url.searchParams.get("slot");
        const property = url.searchParams.get("property");
        const creativeId = url.searchParams.get("creative");
        if (!placementName(slot) || !placementName(property) || !creativeId) return json({error:"invalid slot, property or creative"},{status:400});
        // Direct /click calls must satisfy the same live/slot/property eligibility
        // as /ad. Refused clicks are neither redirected nor receipted.
        const creative = listEligibleCreatives({ catalog, slot, property, context: pageContext(url), now: new Date(nowMs()) }).find((entry) => entry.id === creativeId);
        if (!creative) return json({ error: "creative is not eligible for slot/property" }, { status: 404 });
        let receiptStatus="not-applicable";
        if (creative.relationship !== "house") {
          if (!kv || !receiptWritesOpen())
            return json({error:"paid campaign delivery unavailable"},{status:503});
          const requestId=crypto.randomUUID();
          try {
            await recordDeliveryEvent(kv,{type:"click",slot,property,creativeId,
              context:pageContext(url),decisionReason:"redirect-request",requestId,
              occurredAt:new Date(nowMs()).toISOString()});
            receiptStatus="recorded";
          } catch(error) {
            onReceiptWriteFailure({type:"click",slot,property,creativeId,requestId},error);
            return json({error:"paid campaign event not recorded"},{status:503});
          }
        }
        const activityStatus=recordActivity(env,{event:"outbound-redirect",slot,property,
          creativeId,relationship:creative.relationship});
        return new Response(null,{status:302,headers:{location:creative.href,
          "x-561-receipt-status":receiptStatus,"x-561-activity-status":activityStatus}});

      }

      if (url.pathname === "/receipts") {
        if (request.method !== "GET") return json({error:"method not allowed"},{status:405});
        if (!kv) return json({ error: "receipt chain not bound" }, { status: 503 });
        const series=url.searchParams.get("series")??"current";
        const cursor=url.searchParams.get("cursor")??undefined;
        const rawLimit=url.searchParams.get("limit")??"50";
        if (!/^[0-9]{1,3}$/u.test(rawLimit)) return json({error:"invalid limit"},{status:400});
        try { return json(await listDeliveryEvents(kv,{series,cursor,limit:Number(rawLimit)})); }
        catch(error) {
          if (error instanceof TypeError) return json({error:error.message},{status:400});
          throw error;
        }
      }

      return json({ error: "not found" }, { status: 404 });
    },
  };
}

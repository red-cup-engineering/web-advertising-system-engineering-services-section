import { HOUSE_CREATIVE_CATALOG } from "../catalog.mjs";
import { selectCreative } from "../advertising.mjs";
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
  const { id, title, body, href, imageAlt } = creative;
  return { id, title, body, href, imageAlt: imageAlt ?? null };
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
    error: error instanceof Error ? error.message : String(error),
  }));
}

/**
 * Build the house ad server's fetch handler. GET /ad?slot&property[&context] returns
 * one contextual (no cookies, no cross-request profile) creative and
 * records an impression receipt; GET /click redirects and records a click
 * receipt; GET /receipts and GET /catalog expose the same chain and
 * catalog transparently — the receipts-native, auditable-by-default
 * differentiator no incumbent network offers.
 * @param {object} [options]
 * @param {import("../catalog.mjs").AdCreative[]} [options.catalog]
 * @returns {{fetch: (request: Request, env: object) => Promise<Response>}}
 */
export function createAdServerWorker({ catalog = HOUSE_CREATIVE_CATALOG } = {}) {
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
        if (!slot || !property) return json({ error: "slot and property query parameters are required" }, { status: 400 });
        const context = (url.searchParams.get("context") ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 8);
        const picked = selectCreative({ catalog, slot, property, context });
        if (!picked) return json({ error: "no eligible creative for slot/property" }, { status: 404 });
        let receipt = null;
        let receiptStatus = kv ? "recorded" : "unbound";
        if (kv) {
          const requestId = crypto.randomUUID();
          try {
            receipt = await appendChainedReceipt(kv, {
              type: "impression",
              slot,
              property,
              creativeId: picked.creative.id,
              decisionReason: picked.decision.reason,
              requestId,
            });
          } catch (error) {
            receiptStatus = "unavailable";
            reportReceiptGap({ type: "impression", slot, property, creativeId: picked.creative.id, decisionReason: picked.decision.reason, requestId, error });
          }
        }
        return json({
          creative: publicCreative(picked.creative),
          receipt: receipt ? { id: receipt.id, seq: receipt.seq } : null,
          receiptStatus,
        });
      }

      if (url.pathname === "/click") {
        const slot = url.searchParams.get("slot");
        const property = url.searchParams.get("property");
        const creativeId = url.searchParams.get("creative");
        if (!slot || !property || !creativeId) return json({ error: "slot, property, and creative query parameters are required" }, { status: 400 });
        const creative = catalog.find((entry) => entry.id === creativeId);
        if (!creative) return json({ error: "unknown creative" }, { status: 404 });
        let receiptStatus = kv ? "recorded" : "unbound";
        if (kv) {
          const requestId = crypto.randomUUID();
          try {
            await appendChainedReceipt(kv, {
              type: "click",
              slot,
              property,
              creativeId,
              decisionReason: "publisher-click",
              requestId,
            });
          } catch (error) {
            receiptStatus = "unavailable";
            reportReceiptGap({ type: "click", slot, property, creativeId, decisionReason: "publisher-click", requestId, error });
          }
        }
        return new Response(null, { status: 302, headers: { location: creative.href, "x-561-receipt-status": receiptStatus } });
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

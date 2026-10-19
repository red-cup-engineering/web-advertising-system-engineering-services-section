import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

/**
 * Pure admission and identity for independently stored ad events.
 * A browser-reported view is an opportunity-to-see signal, not a
 * human-verified or billable impression. A redirect is not a sale.
 */
export function buildDeliveryEvent({
  type, slot, property, creativeId, context = [],
  requestId, occurredAt, decisionReason = null,
}) {
  if (type !== "view" && type !== "click") throw new TypeError("type must be view or click");
  for (const [field, value] of Object.entries({ slot, property, creativeId, requestId })) {
    if (typeof value !== "string" || !value.trim()) throw new TypeError("event requires " + field);
  }
  if (!Array.isArray(context) || context.length > 8 ||
      !context.every(value => typeof value === "string" && value.length > 0 && value.length < 100)) {
    throw new TypeError("context requires up to eight non-empty page topics");
  }
  if (typeof occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(occurredAt) ||
      !Number.isFinite(Date.parse(occurredAt))) throw new TypeError("occurredAt requires a UTC instant");
  if (decisionReason !== null && (typeof decisionReason !== "string" || !decisionReason.trim())) {
    throw new TypeError("decisionReason must be null or non-empty string");
  }
  const body = Object.freeze({
    kind: "advertising.delivery-event/v2", type, slot, property, creativeId,
    context: Object.freeze([...context]), requestId, occurredAt, decisionReason,
    evidenceKind: type === "view" ? "publisher-client-visibility-report" : "redirect-request",
  });
  return Object.freeze({
    id: makeNiUri(new TextEncoder().encode(canonicalJson(body))),
    ...body,
  });
}

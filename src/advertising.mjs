import { hashSeed } from "@red-cup-engineering/computer-data-engineering-services-section/randomization/hash-seed";

/**
 * Contextual-only creative selection: no cookies, no cross-request user
 * state, no behavioral profile — the only signal is the requested slot and
 * property, matched against the catalog's own declared eligibility.
 * @param {import("./catalog.mjs").AdCreative[]} catalog
 * @param {string} slot Requested slot name.
 * @param {string} property Requesting property key (never advertised to itself).
 * @returns {import("./catalog.mjs").AdCreative[]} Eligible creatives, in catalog order.
 */
const pageContexts = context => new Set((Array.isArray(context) ? context : [context]).filter(v => typeof v === "string" && v.trim()));
export function listEligibleCreatives({ catalog, slot, property, context = [], now = new Date() }) {
  if (!Array.isArray(catalog)) throw new TypeError("listEligibleCreatives requires a catalog array");
  if (!slot) throw new TypeError("listEligibleCreatives requires a slot");
  if (!property) throw new TypeError("listEligibleCreatives requires a property");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("listEligibleCreatives requires a valid clock");
  }
  const wanted = pageContexts(context);
  return catalog.filter((creative) => {
    if (!creative || creative.status !== "live") return false;
    if (!["house", "sponsored", "affiliate"].includes(creative.relationship)) return false;
    // An undocumented or expired offer cannot be advertised or clicked, even if
    // an operator accidentally leaves its catalog status at "live".
    if (creative.expiresAt !== undefined) {
      if (typeof creative.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(creative.expiresAt)) ||
          Date.parse(creative.expiresAt) <= now.getTime()) return false;
    }
    if (creative.relationship !== "house") {
      if (typeof creative.expiresAt !== "string" ||
          typeof creative.disclosure !== "string" || !creative.disclosure.trim()) return false;
      try {
        const target = new URL(creative.href);
        if (target.protocol !== "https:" || target.username || target.password) return false;
      } catch { return false; }
      // The publisher's page topic is an admission condition, not a weak
      // preference for commercial placements.
      if (!Array.isArray(creative.allowedContexts) ||
          !creative.allowedContexts.some(v => typeof v === "string" && wanted.has(v))) return false;
      // Publisher-rendered referral ads require both offer qualifications and
      // material risk information. Do not record an impression for an offer
      // the receiving publisher must correctly refuse to display.
      if (creative.relationship === "affiliate" &&
          ["eligibility", "riskNotice"].some(k =>
            typeof creative[k] !== "string" || !creative[k].trim())) return false;
    }
    if (creative.property === property) return false;
    if (!Array.isArray(creative.slots) || !Array.isArray(creative.properties)) return false;
    const slotOk = creative.slots.includes("*") || creative.slots.includes(slot);
    const propertyOk = creative.properties.includes("*") || creative.properties.includes(property);
    return slotOk && propertyOk;
  });
}

/**
 * Deterministic day-rotated pick from the eligible set — the same
 * slot/property pair returns the same creative for one UTC day, then
 * rotates, so delivery is auditable and reproducible without per-viewer
 * tracking state.
 * @param {import("./catalog.mjs").AdCreative[]} catalog
 * @param {string} slot
 * @param {string} property
 * @param {string[]} [context] What the requesting page is about; creatives declaring one of these contexts are preferred.
 * @param {Date} [now]
 * @returns {?{creative: import("./catalog.mjs").AdCreative, decision: {slot: string, property: string, consideredIds: string[], selectedId: string, reason: string}}}
 */
export function selectCreative({ catalog, slot, property, context = [], now = new Date() }) {
  const all = listEligibleCreatives({ catalog, slot, property, context, now });
  if (all.length === 0) return null;
  // Contextual, never behavioral: the page says what it is about (an article's
  // desk, a game's genre), and creatives that declare that context are
  // preferred; with none matching, every eligible creative rotates.
  const wanted = pageContexts(context);
  const matching = wanted.size === 0 ? [] : all.filter((creative) =>
    (creative.relationship === "house" ? creative.contexts ?? [] : creative.allowedContexts ?? [])
      .some((value) => wanted.has(value)));
  const eligible = matching.length > 0 ? matching : all;
  const dayStamp = now.toISOString().slice(0, 10);
  const index = Math.abs(hashSeed(`${slot}\u0000${property}\u0000${dayStamp}`) | 0) % eligible.length;
  const creative = eligible[index];
  return {
    creative,
    decision: {
      slot,
      property,
      consideredIds: eligible.map((c) => c.id),
      selectedId: creative.id,
      reason: `${matching.length > 0 ? `context-match:${[...wanted].sort().join("+")}:` : ""}day-rotation:${dayStamp}:${index}/${eligible.length}`,
    },
  };
}


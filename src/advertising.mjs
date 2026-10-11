/**
 * Contextual-only creative selection: no cookies, no cross-request user
 * state, no behavioral profile — the only signal is the requested slot and
 * property, matched against the catalog's own declared eligibility.
 * @param {import("./catalog.mjs").AdCreative[]} catalog
 * @param {string} slot Requested slot name.
 * @param {string} property Requesting property key (never advertised to itself).
 * @returns {import("./catalog.mjs").AdCreative[]} Eligible creatives, in catalog order.
 */
export function listEligibleCreatives({ catalog, slot, property }) {
  if (!Array.isArray(catalog)) throw new TypeError("listEligibleCreatives requires a catalog array");
  if (!slot) throw new TypeError("listEligibleCreatives requires a slot");
  if (!property) throw new TypeError("listEligibleCreatives requires a property");
  return catalog.filter((creative) => {
    if (creative.status !== "live") return false;
    if (creative.property === property) return false;
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
  const all = listEligibleCreatives({ catalog, slot, property });
  if (all.length === 0) return null;
  // Contextual, never behavioral: the page says what it is about (an article's
  // desk, a game's genre), and creatives that declare that context are
  // preferred; with none matching, every eligible creative rotates.
  const wanted = new Set((Array.isArray(context) ? context : [context]).filter((value) => typeof value === "string" && value !== ""));
  const matching = wanted.size === 0 ? [] : all.filter((creative) => (creative.contexts ?? []).some((value) => wanted.has(value)));
  const eligible = matching.length > 0 ? matching : all;
  const dayStamp = now.toISOString().slice(0, 10);
  const index = Math.abs(hashString(`${slot}\u0000${property}\u0000${dayStamp}`)) % eligible.length;
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

/** Small non-cryptographic string hash (FNV-1a) for deterministic rotation. */
function hashString(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}

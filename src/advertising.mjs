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

/** Real source-calendar second: Date.parse alone normalizes 24:00 and
 * impossible February dates into different instants, so cannot establish
 * a licensed campaign's declared expiry. Accept UTC and numeric offsets;
 * preserve fractional seconds without silently rewriting the source wall
 * clock. This is syntactic expiry admission, NOT a signed campaign contract.
 */
function campaignExpiry(value, now) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match || +match[1].slice(0,4)===0 || +match[1].slice(11,13)>23 ||
      +match[1].slice(14,16)>59 || +match[1].slice(17,19)>59) return false;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || instant<=now.getTime()) return false;
  const zone=match[2];
  const offset=zone==="Z" ? 0 :
    (zone[0]==="+"?1:-1)*(Number(zone.slice(1,3))*60+Number(zone.slice(4,6)));
  if (zone!=="Z" && (Number(zone.slice(1,3))>23 || Number(zone.slice(4,6))>59)) return false;
  return new Date(instant+offset*60_000).toISOString().slice(0,19)===match[1];
}

/** A paid redirect may reach a real public merchant, never a local host,
 * embedded credential, or secret-bearing URL. No personal click tracking or
 * permission to contact a merchant follows from accepting a destination.
 */
function publicPaidDestination(href) {
  if (typeof href!=="string" || href.length>2048 || href.trim()!==href ||
      /\s/u.test(href)) return false;
  try {
    const target=new URL(href);
    const host=target.hostname.toLowerCase();
    return target.protocol==="https:" && !target.username && !target.password &&
      host.includes(".") && !host.endsWith(".") && host!=="localhost" &&
      !host.endsWith(".local") && !host.endsWith(".internal") &&
      !/^\d+\.\d+\.\d+\.\d+$/u.test(host) && !host.startsWith("[") &&
      ![...target.searchParams.keys()].some(key =>
        /^(?:token|secret|password|api[-_]?key|access[-_]?token|auth(?:entication|orization)?|session|signature|sig)$/iu.test(key));
  } catch { return false; }
}

const contextName = v => typeof v === "string" &&
  /^[a-z][a-z0-9-]{0,63}$/u.test(v);

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
    if (creative.expiresAt !== undefined &&
        !campaignExpiry(creative.expiresAt, now)) return false;
    // An opt-in topic gate for targeted house marketing. Preserve all legacy
    // house ads without this field, but never rotate a specialized science
    // appeal onto an unrelated page or a context-free publisher.
    if (creative.relationship === "house" && creative.allowedContexts !== undefined &&
        (!Array.isArray(creative.allowedContexts) || creative.allowedContexts.length === 0 ||
         !creative.allowedContexts.some(v => typeof v === "string" && wanted.has(v))))
      return false;
    if (creative.relationship !== "house") {
      if (typeof creative.expiresAt !== "string" ||
          typeof creative.disclosure !== "string" || !creative.disclosure.trim()) return false;
      if (!publicPaidDestination(creative.href)) return false;
      // Paid inventory must have a bounded, typed and unambiguous publisher
      // topic policy. Unchecked extra contexts are not licensed placements.
      if (!Array.isArray(creative.allowedContexts) ||
          creative.allowedContexts.length===0 || creative.allowedContexts.length>16 ||
          creative.allowedContexts.some(v => !contextName(v)) ||
          new Set(creative.allowedContexts).size!==creative.allowedContexts.length ||
          !creative.allowedContexts.some(v => wanted.has(v))) return false;
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


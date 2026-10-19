import { test } from "node:test";
import assert from "node:assert/strict";
import { listEligibleCreatives, selectCreative } from "../src/advertising.mjs";

const CATALOG = Object.freeze([
  Object.freeze({ id: "a", status: "live", relationship: "house", slots: ["footer"], properties: ["*"], property: "prop-a", tags: [] }),
  Object.freeze({ id: "b", status: "live", relationship: "house", slots: ["*"], properties: ["prop-x"], property: "prop-b", tags: [] }),
  Object.freeze({ id: "c", status: "coming-soon", relationship: "house", slots: ["*"], properties: ["*"], property: "prop-c", tags: [] }),
  Object.freeze({ id: "d", status: "live", relationship: "house", slots: ["*"], properties: ["*"], property: "prop-x", tags: [] }),
]);

test("listEligibleCreatives excludes non-live and self-promotion, keeps slot/property matches", () => {
  const eligible = listEligibleCreatives({ catalog: CATALOG, slot: "footer", property: "prop-x" });
  const ids = eligible.map((creative) => creative.id).sort();
  // "c" is coming-soon (excluded) and "d" promotes prop-x itself (self-promotion, excluded).
  assert.deepEqual(ids, ["a", "b"]);
});

test("listEligibleCreatives matches a slot only reachable via wildcard", () => {
  const eligible = listEligibleCreatives({ catalog: CATALOG, slot: "sidebar", property: "prop-x" });
  const ids = eligible.map((creative) => creative.id).sort();
  assert.deepEqual(ids, ["b"]);
});

test("listEligibleCreatives requires catalog, slot, and property", () => {
  assert.throws(() => listEligibleCreatives({ catalog: undefined, slot: "footer", property: "prop-x" }), TypeError);
  assert.throws(() => listEligibleCreatives({ catalog: CATALOG, slot: undefined, property: "prop-x" }), TypeError);
  assert.throws(() => listEligibleCreatives({ catalog: CATALOG, slot: "footer", property: undefined }), TypeError);
});

test("selectCreative returns null when nothing is eligible", () => {
  const onlySelf = Object.freeze([
    Object.freeze({ id: "self", status: "live", relationship: "house", slots: ["*"], properties: ["*"], property: "prop-only", tags: [] }),
  ]);
  const picked = selectCreative({ catalog: onlySelf, slot: "footer", property: "prop-only" });
  assert.equal(picked, null);
});

test("selectCreative is deterministic for the same day and picks from the eligible set", () => {
  const now = new Date("2026-08-31T12:00:00.000Z");
  const first = selectCreative({ catalog: CATALOG, slot: "sidebar", property: "prop-x", now });
  const second = selectCreative({ catalog: CATALOG, slot: "sidebar", property: "prop-x", now });
  assert.deepEqual(first, second);
  assert.equal(first.creative.id, "b");
  assert.deepEqual(first.decision.consideredIds, ["b"]);
  assert.equal(first.decision.selectedId, "b");
});

test("selectCreative prefers creatives that declare the page's context, and says so", () => {
  const catalog = Object.freeze([
    Object.freeze({ id: "news", status: "live", relationship: "house", slots: ["*"], properties: ["*"], property: "news", contexts: [], tags: [] }),
    Object.freeze({ id: "book", status: "live", relationship: "house", slots: ["*"], properties: ["*"], property: "book", contexts: ["crypto"], tags: [] }),
  ]);
  const now = new Date("2026-09-27T12:00:00.000Z");
  const picked = selectCreative({ catalog, slot: "afterArticle", property: "koios", context: ["crypto", "stablecoins"], now });
  assert.equal(picked.creative.id, "book");
  assert.match(picked.decision.reason, /^context-match:crypto\+stablecoins:day-rotation/u);
  const unmatched = selectCreative({ catalog, slot: "afterArticle", property: "koios", context: ["sport"], now });
  assert.deepEqual(unmatched.decision.consideredIds, ["news", "book"]);
});

test("campaign expiry uses the supplied clock for both house and paid creatives", () => {
  const issued = new Date("2026-10-17T12:00:00.000Z");
  const expired = new Date("2026-10-18T00:00:00.000Z");
  const catalog = [
    { id: "house", status: "live", relationship: "house", slots: ["*"], properties: ["*"], property: "house-property", expiresAt: "2026-10-18T00:00:00.000Z" },
    { id: "paid", status: "live", relationship: "sponsored", slots: ["*"], properties: ["*"], property: "advertiser", expiresAt: "2026-10-18T00:00:00.000Z", disclosure: "Paid advertising", href: "https://example.org/offer" },
  ];
  assert.deepEqual(listEligibleCreatives({ catalog, slot: "footer", property: "publisher", now: issued }).map(x => x.id), ["house", "paid"]);
  assert.deepEqual(listEligibleCreatives({ catalog, slot: "footer", property: "publisher", now: expired }), []);
});

test("third-party eligibility refuses missing disclosure, expiry, unsafe redirect and untyped relations", () => {
  const base = { id: "campaign", status: "live", relationship: "affiliate", slots: ["*"], properties: ["*"], property: "merchant", expiresAt: "2026-11-01T00:00:00Z", disclosure: "We may earn a referral commission.", href: "https://example.org/offer" };
  const now = new Date("2026-10-18T00:00:00Z");
  const eligible = creative => listEligibleCreatives({ catalog: [creative], slot: "footer", property: "publisher", now });
  assert.equal(eligible(base).length, 1);
  for (const changed of [
    { ...base, disclosure: "" },
    { ...base, disclosure: undefined },
    { ...base, expiresAt: undefined },
    { ...base, expiresAt: "a made-up date" },
    { ...base, href: "javascript:alert(1)" },
    { ...base, relationship: undefined },
    { ...base, relationship: "unknown" },
  ]) assert.deepEqual(eligible(changed), []);
  assert.throws(() => listEligibleCreatives({ catalog: [base], slot: "footer", property: "publisher", now: new Date("bad") }), /valid clock/);
});

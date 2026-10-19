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
    { id: "paid", status: "live", relationship: "sponsored", slots: ["*"], properties: ["*"], property: "advertiser", expiresAt: "2026-10-18T00:00:00.000Z", disclosure: "Paid advertising", allowedContexts: ["business"], href: "https://example.org/offer" },
  ];
  assert.deepEqual(listEligibleCreatives({ catalog, slot: "footer", property: "publisher", context: ["business"], now: issued }).map(x => x.id), ["house", "paid"]);
  assert.deepEqual(listEligibleCreatives({ catalog, slot: "footer", property: "publisher", context: ["business"], now: expired }), []);
});

test("third-party eligibility refuses missing disclosure, expiry, unsafe redirect and untyped relations", () => {
  const base = { id: "campaign", status: "live", relationship: "affiliate", slots: ["*"], properties: ["*"], property: "merchant", expiresAt: "2026-11-01T00:00:00Z", disclosure: "We may earn a referral commission.", eligibility: "Eligible participants only.", riskNotice: "Capital may be lost.", allowedContexts: ["finance"], href: "https://example.org/offer" };
  const now = new Date("2026-10-18T00:00:00Z");
  const eligible = creative => listEligibleCreatives({ catalog: [creative], slot: "footer", property: "publisher", context: ["finance"], now });
  assert.equal(eligible(base).length, 1);
  for (const changed of [
    { ...base, disclosure: "" },
    { ...base, disclosure: undefined },
    { ...base, expiresAt: undefined },
    { ...base, expiresAt: "a made-up date" },
    { ...base, href: "javascript:alert(1)" },
    { ...base, relationship: undefined },
    { ...base, relationship: "unknown" },
    { ...base, allowedContexts: [] },
    { ...base, allowedContexts: undefined },
    { ...base, eligibility: undefined },
    { ...base, eligibility: "" },
    { ...base, riskNotice: "" },
    { ...base, riskNotice: undefined },
    { ...base, href: "https://user:pass@example.org/offer" },
  ]) assert.deepEqual(eligible(changed), []);
  assert.throws(() => listEligibleCreatives({ catalog: [base], slot: "footer", property: "publisher", now: new Date("bad") }), /valid clock/);
});

test("third-party contextual admission fails closed while house placement still rotates",()=>{
  const now=new Date("2026-10-17T12:00:00Z");
  const house={id:"h",status:"live",relationship:"house",property:"house",slots:["*"],properties:["*"]};
  const paid={id:"p",status:"live",relationship:"sponsored",property:"merchant",slots:["*"],properties:["*"],allowedContexts:["science"],disclosure:"Paid",expiresAt:"2026-11-01T00:00:00Z",href:"https://example.org/"};
  assert.deepEqual(listEligibleCreatives({catalog:[house,paid],slot:"footer",property:"publisher",now}).map(x=>x.id),["h"]);
  assert.deepEqual(listEligibleCreatives({catalog:[house,paid],slot:"footer",property:"publisher",context:["sports"],now}).map(x=>x.id),["h"]);
  assert.deepEqual(listEligibleCreatives({catalog:[house,paid],slot:"footer",property:"publisher",context:["science"],now}).map(x=>x.id),["h","p"]);
  assert.equal(selectCreative({catalog:[paid],slot:"footer",property:"publisher",context:["sports"],now}),null);
  assert.equal(selectCreative({catalog:[paid],slot:"footer",property:"publisher",context:["science"],now}).creative.id,"p");
  // A paid campaign's admission contexts are its selection contexts too; an
  // unrelated broadly eligible house ad cannot hide a valid matched placement.
  assert.equal(selectCreative({catalog:[house,paid],slot:"footer",property:"publisher",context:["science"],now}).creative.id,"p");
});

// A merchant's acknowledged recurring offer must be carried to real publisher
// inventory; price-only source or a proposed campaign is not distribution.
test("existing house-ad selector carries an actual sustaining support offer to two distinct real publishers", async () => {
  const { HOUSE_CREATIVE_CATALOG } = await import("../src/catalog.mjs");
  const campaign = HOUSE_CREATIVE_CATALOG.find(row => row.id === "561-group-sustaining-support-20261019");
  assert.ok(campaign);
  assert.equal(campaign.relationship, "house");
  assert.equal(campaign.status, "live");
  assert.equal(campaign.href, "https://buy.stripe.com/28E28s1b4gJcb2Y3Io5EY02");
  assert.match(campaign.body, /\$10 per month/);
  assert.match(campaign.body, /cancel anytime/);
  assert.match(campaign.body, /No exclusive access, influence, or tax deduction/);
  const now = new Date("2026-10-19T12:00:00.000Z");
  const publishers = [
    {property:"koios-news", slot:"afterArticle", context:["science"]},
    {property:"play-561-group", slot:"belowGame", context:["games"]},
  ];
  for (const publisher of publishers) {
    const candidates = listEligibleCreatives({catalog:HOUSE_CREATIVE_CATALOG,...publisher,now});
    assert.ok(candidates.some(row => row.id === campaign.id), publisher.property);
    const targeted = selectCreative({catalog:[campaign],...publisher,now});
    assert.equal(targeted?.creative?.id,campaign.id);
    assert.equal(targeted.decision.reason.startsWith("context-match:"),true);
  }
  for (const property of ["shop-561-group","561-group-sustaining-support","other-merchant"]) {
    assert.ok(!listEligibleCreatives({catalog:[campaign],slot:"afterArticle",property,context:["science"],now}).length);
  }
  assert.ok(!listEligibleCreatives({catalog:[{...campaign,status:"coming-soon"}],slot:"afterArticle",property:"koios-news",context:["science"],now}).length);
});

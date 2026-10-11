import { test } from "node:test";
import assert from "node:assert/strict";
import { listEligibleCreatives, selectCreative } from "../src/advertising.mjs";

const CATALOG = Object.freeze([
  Object.freeze({ id: "a", status: "live", slots: ["footer"], properties: ["*"], property: "prop-a", tags: [] }),
  Object.freeze({ id: "b", status: "live", slots: ["*"], properties: ["prop-x"], property: "prop-b", tags: [] }),
  Object.freeze({ id: "c", status: "coming-soon", slots: ["*"], properties: ["*"], property: "prop-c", tags: [] }),
  Object.freeze({ id: "d", status: "live", slots: ["*"], properties: ["*"], property: "prop-x", tags: [] }),
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
    Object.freeze({ id: "self", status: "live", slots: ["*"], properties: ["*"], property: "prop-only", tags: [] }),
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
    Object.freeze({ id: "news", status: "live", slots: ["*"], properties: ["*"], property: "news", contexts: [], tags: [] }),
    Object.freeze({ id: "book", status: "live", slots: ["*"], properties: ["*"], property: "book", contexts: ["crypto"], tags: [] }),
  ]);
  const now = new Date("2026-09-27T12:00:00.000Z");
  const picked = selectCreative({ catalog, slot: "afterArticle", property: "koios", context: ["crypto", "stablecoins"], now });
  assert.equal(picked.creative.id, "book");
  assert.match(picked.decision.reason, /^context-match:crypto\+stablecoins:day-rotation/u);
  const unmatched = selectCreative({ catalog, slot: "afterArticle", property: "koios", context: ["sport"], now });
  assert.deepEqual(unmatched.decision.consideredIds, ["news", "book"]);
});

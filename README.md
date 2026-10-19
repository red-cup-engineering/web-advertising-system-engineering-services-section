# Web advertising system

The house advertising engine, `@red-cup-engineering/web-advertising-system-engineering-services-section`: the ad server the
561 Group's own properties (koios.news, play.561.group) call for their house ad slots.

- `data/records/house-creatives.json` is the one creative catalog. A creative is `live` only when
  its destination is live. Its `contexts` name the page contexts it fits: Koios desks and article
  tags, game genres.
- `src/advertising.mjs` selects contextually and never behaviorally. The requesting page says what
  it is about (`/ad?slot&property&context`), creatives declaring that context are preferred, and
  the pick rotates by day. No cookie or reader profile is kept. A creative never advertises the
  property it promotes.
- `src/kv-chain.mjs` and `src/receipts.mjs` keep a hash-chained receipt of every impression and
  click. `GET /receipts` and `GET /catalog` expose them. `scripts/sync-ad-receipts-to-journal.mjs`
  copies the chain into the one journal.
- `sites/house-ads-server` is the Cloudflare Worker that deploys it
  (`ads.561.group`).

The engine was deleted from the tree on 2026-09-19 (f773c353e79) while its Worker kept serving.
It was revived on 2026-09-27 from that commit's parent, with the catalog moved from code into its
record and contextual preference added.

## Campaign admission and publisher rendering

Each creative declares `relationship` as `house`, `sponsored`, or
`affiliate`. House creatives identify the Group's own properties and offers.
A paid or affiliate creative must also declare its truthful `disclosure`, an
absolute HTTPS destination and a future `expiresAt` timestamp. All dated
creatives stop being eligible **at** the expiry instant, on both `GET /ad` and
`GET /click`, regardless of a stale catalog `status: "live"`.

`GET /ad` returns `creative.relationship`, `creative.disclosure`, and
`creative.linkRel` (the last two are null for house creatives). Publisher
renderers must display a non-house disclosure next to the offer, and put the
returned `linkRel` on its clickable link. These fields carry the required
material-connection information to humans and agents; merely obtaining this
JSON **does not** constitute disclosure on a published page.

The current source catalog contains only house creatives. Do not activate a
third-party campaign until the receiving property renders those fields and
the actual offer, terms, rights, merchant attribution and expiry are qualified.
Do not treat an ad API response as a verified human impression or a redirect
request as an independently received purchase. Receipt KV write failure means
that the delivered response has **no durable ad attribution**; never synthesize
a conversion count from it.

The original FNV rotation seed now comes from Computer Data; JSON identity
comes from the house JSON service; RFC 6920 NI hashing comes from the URI
service. Historic ad receipt byte identity is pinned by a golden fixture, not
recomputed as a SignCell/CBOR semantic identity. Ad slots, campaign admission,
redirects and merchant disclosures stay downstream in this advertising engine.

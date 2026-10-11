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

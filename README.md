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
- The Cloudflare Analytics Engine dataset `AD_ACTIVITY` receives best-effort aggregate
  creative-response and outbound-redirect observations for the whole advertising service.
  It records only the event, slot, publisher property, creative ID and relationship:
  no reader IDs, URLs, IPs or profiles. WAE may sample; these events are neither
  verified human impressions nor billable conversions.
- `src/kv-chain.mjs` and `src/receipts.mjs` retain original source-observed,
  paid-campaign and historical receipt custody. Paid creatives refuse to serve or
  redirect without an accountable KV write. `GET /receipts?since=N` reads
  an exact 100-entry-at-most sequence page with a next cursor; missing rows
  refuse. `scripts/sync-ad-receipts-to-journal.mjs` consumes every page
  and receives the whole intact chain in the existing semantic journal.
  The source journal CLI's SEAVT dependency is development/operations-only;
  it is not linked into the production Worker.
- `sites/house-ads-server` is the Cloudflare Worker that deploys it
  (`ads.561.group`).

The engine was deleted from the tree on 2026-09-19 (f773c353e79) while its Worker kept serving.
It was revived on 2026-09-27 from that commit's parent, with the catalog moved from code into its
record and contextual preference added.

## Campaign admission and publisher rendering

Each creative declares `relationship` as `house`, `sponsored`, or
`affiliate`. House creatives identify the Group's own properties and offers.
A paid or affiliate creative must also declare its truthful `disclosure`, an
absolute HTTPS destination, a future `expiresAt` timestamp, and at least one
`allowedContexts` page topic. An affiliate creative additionally requires
`eligibility` and `riskNotice` text or the engine refuses to serve or redirect
it. Page context must match a declared topic on both `GET /ad` and `GET /click`;
for paid campaigns the `allowedContexts` are also the contextual selection
preference. All dated creatives stop being eligible **at** the expiry instant,
regardless of a stale catalog `status: "live"`.

`GET /ad` returns `creative.relationship`, `creative.disclosure`, and
`creative.linkRel` (the last two are null for house creatives), as well as
`allowedContexts`, `eligibility`, `riskNotice`, and `expiresAt` for
third-party campaigns. Publisher renderers must display a non-house disclosure
next to the offer, present affiliate terms/risk, retain page context in their
redirect, and put the
returned `linkRel` on its clickable link. These fields carry the required
material-connection information to humans and agents; merely obtaining this
JSON **does not** constitute disclosure on a published page.

The current source catalog contains only house creatives. Do not activate a
third-party campaign until the receiving property renders those fields and
the actual offer, terms, rights, merchant attribution and expiry are qualified.
Do not treat an ad API response as a verified human impression or a redirect
request as an independently received purchase. For paid creatives, a KV receipt refusal now suppresses both serving and
redirect. For house creatives, KV is not used at all. Cloudflare aggregate activity
is a non-billable response/redirect signal, not a rendered human impression or
conversion. Never synthesize booked revenue from either signal. The older KV
chain is not transactional under concurrency, so do not use it alone for
settlement-grade advertising billing.

The original FNV rotation seed now comes from Computer Data; JSON identity
comes from the house JSON service; RFC 6920 NI hashing comes from the URI
service. Historic ad receipt byte identity is pinned by a golden fixture, not
recomputed as a SignCell/CBOR semantic identity. Ad slots, campaign admission,
redirects and merchant disclosures stay downstream in this advertising engine.

Version `0.2.1` is a source candidate until its exact registry artifact and the
`house-ads-server-site` consumer are independently installed. The site declares
its own `AD_ACTIVITY` dataset while retaining legacy KV custody for paid traffic.

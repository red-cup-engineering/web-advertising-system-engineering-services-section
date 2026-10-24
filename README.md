# Web advertising system

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

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


## Evidence-first open-work marketing experiment (2026-10-22)

Three existing-rail **house** creatives in `data/records/house-creatives.json` lead to a public [proof-rich open-work story](https://github.com/561-group/.github/blob/main/OPEN-WORK.md). Their topic choices are genuinely different: science/formal methods, engineering/agent infrastructure, and playful curiosity. The new optional `allowedContexts` field bounds **first-party** creatives as well as sponsored inventory: a science appeal does not rotate into an unrelated article or an untyped page, while ordinary house creatives without the opt-in gate retain their historical behavior. No behavioral tracking or visitor profile is required.

`test/advertising.test.mjs` exercises the unchanged original selector against the actual campaign, two existing publisher identifiers, relevant/irrelevant/missing contexts and legacy behavior. The creative click leads first to inspectable public work, not an unexplained payment screen. Attribution of **house placement opportunities** is not a count of impressions, humans, open-source users or Stripe customers. Our original [supplier release blocker](https://github.com/red-cup-engineering/web-advertising-system-engineering-services-section/issues/3) and [host receiving blocker](https://github.com/red-cup-engineering/house-ads-server-site/issues/1) still govern package release and deployment. A merged catalog is **not** evidence these creatives have been seen by anyone.

## Current delivery boundary (0.3.0-dev.1)

- `GET /ad` selects an eligible creative. An ad response is not a human view or a billable impression. House responses use only optional aggregate Workers Analytics Engine activity, with zero KV writes. Paid campaigns require an available receipt sink but do not write until the actual reported view or redirect.
- The publisher reports a visible-placement opportunity through `POST /view` only after at least half the rendered placement is visible in an active browser tab for one continuous second. House placements use the existing aggregate `AD_ACTIVITY` provider; paid placements store one content-addressed event in `AD_RECEIPTS`. Client telemetry is untrusted and cannot establish verified human exposure or lawful billing.
- `GET /click` rechecks campaign validity: house promotions redirect with aggregate activity, while paid redirects fail closed when their event cannot be stored. Neither endpoint establishes a purchase.
- `src/delivery-events.mjs` derives NI identities from the original canonical JSON/URI suppliers; `src/kv-events.mjs` writes one independent key per event. The racy v1 head-writer is retired, while `GET /receipts?series=legacy` retains historical KV entries without rewriting them.
- `scripts/sync-ad-receipts-to-journal.mjs` receives cursor-paged historical/current event series through the existing semantic journal. No duplicate ledger or inferred global ordering is introduced.
- These source changes do not install a new package, authorize paid campaigns, guarantee KV capacity, or establish revenue.

The engine was deleted from the tree on 2026-09-19 (f773c353e79) while its Worker kept serving.
It was revived on 2026-09-27 from that commit's parent, with the catalog moved from code into its
record and contextual preference added.

## Source-qualified campaign admission for earning-directed publishers (2026-10-23)

The original `src/advertising.mjs` is the **one** selector consumed by the original `src/web/worker.mjs` for `GET /ad`, `POST /view` and `GET /click`. Source qualification before selection prevents an invalid creative from creating a public redirect, an aggregate house event, or a potentially monetized sponsored KV view/click. No user tracker or campaign ledger is added.

- **Supplier/source time:** Reject a sponsored or affiliate campaign expiry whose Gregorian date, 24-hour field or UTC-offset wall time does not represent its *declared* instant. JavaScript `Date.parse("2027-02-30T12:00:00Z")` silently normalizes an impossible calendar day, previously admitting the candidate. The source reader now uses a bounded RFC 3339-like **subset** with checked numeric offsets, fractional seconds, calendar round-trip and no 24:00; exact expiry remains ineligible. This does not claim full RFC 3339 validation (e.g., leap-second rules) or a signed commercial contract.
- **Destination custody:** House creatives with declared URLs, and all paid creatives, now reject non-HTTPS, local/internal/IP-literal, userinfo-credential and common access-token query destinations. An admitted public URL is only syntactic safety; it is **not** ownership, independently authenticated merchant identity, program license, publication consent or permission to perform network traffic. Existing original catalog URLs for Shop books, the public original Work page, and voluntary sustaining support remain eligible.
- **Paid placement eligibility:** Sponsored/affiliate `allowedContexts` must form a nonempty, bounded, distinct list of typed page topics, and contain the original publisher's page context. The publisher still owes a real visible disclosure, partner/supplier rights, budget, lawful merchant terms and successful independent receiving; the selector cannot invent them.
- **Negative and positive receiving:** The exact prior `main` source allowed an invalid expiry and internal/credential-bearing destinations in controlled source tests. The candidate refused them and preserved valid UTC/numeric-offset paid records. The **original full 13-case advertising test suite** passed source-loaded V8 with explicit URL/hash substitutes and the real 16-creative first-party catalog. Two additional original Worker test families exercised the unchanged real HTTP handler with bounded Request/Response/KV/activity substitutes: both **failed against main** (unsafe `/click` or paid `/ad` still admitted) and **passed against the candidate**, with no denied KV or aggregate activity. These are not a native dependency-backed Node suite, browser, Cloudflare release or independently observed buyer.
- **Original host gate:** The [house-ads-server-site original draft consumer](https://github.com/red-cup-engineering/house-ads-server-site/pull/2) has source tests that now also demand these negative behaviors from its *selected installed* provider. Its exact `0.3.0-dev.1` supplier selection is **not** proven to be a published registry archive containing this repair. The original [Engineering release obligation #3](https://github.com/red-cup-engineering/web-advertising-system-engineering-services-section/issues/3) must qualify, publish and read back the authentic artifact; the original host must then select its exact compatible version, run native tests and independently observe both actual publisher placements. Source commit or public `/catalog` is not installed reach.

**Economic and standards claim boundary:** This enables more defensible first-party acquisition and a safer prospective paid/affiliate campaign surface; it does not establish sponsor contracts, regulatory disclosure compliance, number of served buyers, real views/impressions, completed Stripe support, externally collected sponsor money, cost per accepted subscriber or parity/superiority to OpenClaw, Kubernetes or COSMOPlat. Measure original human/customer acceptance and net proceeds separately from publisher responses.

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

When durable paid-event storage is absent or under provider quota hold,
the serving engine continues selecting eligible house promotions through
the **same original contextual selector**. It refuses paid-only inventory with
503 and reports genuine no-fill with 404; selection never invents a receipt.

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

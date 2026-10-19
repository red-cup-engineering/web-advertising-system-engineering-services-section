# Web advertising system

The 561 Group's existing contextual ad server serving its own publishers (including Koios.News and Play) without cross-site identity, cookies, behavioral profiles, or personal targeting. The public Cloudflare deployment is carried by `house-ads-server-site`; this package supplies the original selector and event producer.

## Current application contract

- `GET /ad?slot=…&property=…[&context=…]` selects an eligible creative. **Selection does not record an impression or any other delivery event.**
- Publishers render the creative and any required sponsored or affiliate material-connection disclosure, eligibility, and risk notice. Refused/incomplete creatives cannot be displayed.
- `POST /view?slot=…&property=…&creative=…[&context=…]` accepts a **publisher-browser-reported view opportunity** only after the consumer observes at least 50% of the placement within a visible document for one continuous second. It never establishes a verified human, accredited impression, billable exposure, or sale. The server rechecks campaign eligibility and expiry before writing, and responds 202 only after the event is stored; an unbound/refused write returns 503.
- `GET /click?slot=…&property=…&creative=…[&context=…]` rechecks current eligibility, emits a **redirect-request** event where storage permits, and redirects. A request is not proof of a human click, referral qualification, completed purchase, or revenue.
- `GET /receipts?series=current&limit=…&cursor=…` provides **cursor-paged** new events. `series=legacy` exposes the original v1 `chain:entry:` history read-only; no historical IDs are rewritten. `GET /catalog` exposes the same declared campaign catalog.

## Pure data and storage boundaries

`src/advertising.mjs` owns domain eligibility and context-only selection; its deterministic rotation imports `hashSeed` from Computer Data. `src/delivery-events.mjs` creates the immutable v2 event identity using the original JSON canonicalization and RFC 6920 NI suppliers. `src/kv-events.mjs` issues one `KV.put` for each independently addressed event: no racy global head, sequence, CAS illusion or two-write quota multiplication.

The old two-write `src/kv-chain.mjs` producer is **retired**, not wrapped in another interface. `src/receipts.mjs` remains a read-only historical v1 body-identity implementation, with its original byte identity regression fixture. The original `scripts/sync-ad-receipts-to-journal.mjs` importer consumes every available KV cursor page of both series, preserving source IDs in the semantic record journal; repeated runs can recover entries not yet visible because Workers KV is eventually consistent. Legacy "impression" receipts are historical server events and must not be relabeled as actual human views.

The current Worker binding `AD_RECEIPTS` continues to be the only advertising event store. Quota exhaustion prevents persistence and is reported without leaking provider errors. Browser view reports have no fraud-certification mechanism; **they must not serve as paid billing units**. The current house catalog carries no activated third-party campaigns. Real external campaigns still require offer-specific rights, terms, eligible users, customer authority and independent commercial receiving.

## Ownership and release

Red Cup owns generic ad selection, delivery-event type and the HTTP Worker; Computer Data, JSON and URI own reusable primitives; Causeway publishers own rendering, disclosure and contextual selection inputs; Coesite owns deployments and release/rollback procedures. Metrologic → SignCraft remain pure and do not absorb HTTP, payment, campaign policy or employer authority. Build and test the original `npm run check && npm test` before immutable package publication; the existing `red-cup-engineering/house-ads-server-site` consumer selects the received package. A source commit, GitHub run, request counter or demo is not an installed Cloudflare release.

Industry references: [MRC/IAB viewable display criteria](https://www.iab.com/wp-content/uploads/2015/06/MRC-Viewable-Ad-Impression-Measurement-Guideline.pdf), [Cloudflare Workers KV concurrent writes](https://developers.cloudflare.com/kv/api/write-key-value-pairs/), [KV native pagination](https://developers.cloudflare.com/kv/api/list-keys/).

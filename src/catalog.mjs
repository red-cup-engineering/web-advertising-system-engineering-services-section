/**
 * One catalog entry: id; status ("live" serves, "coming-soon" is
 * catalog-only until its destination is confirmed live); slots/properties
 * eligibility (or ["*"] for any); property (the key it promotes, used to
 * suppress self-promotion); contexts (the page contexts it fits, for
 * contextual preference); tags; title; body; href; optional imageAlt.
 * @typedef {object} AdCreative
 * @property {string} id
 * @property {"live"|"coming-soon"} status
 * @property {"house"|"sponsored"|"affiliate"} relationship
 * @property {string} property Promoted property identity, for suppression of self-ads.
 * @property {string[]} properties Allowed publisher property identities.
 * @property {string[]} slots Allowed inventory slots.
 * @property {string[]} [contexts] Preferred publisher-declared page topics for house ads.
 * @property {string[]} [allowedContexts] Required page topics for third-party campaigns.
 * @property {string} title
 * @property {string} [body]
 * @property {string} href
 * @property {string} [disclosure] Non-house campaign material-connection statement.
 * @property {string} [eligibility] Affiliate program-specific offer terms.
 * @property {string} [riskNotice] Affiliate program-specific risk statement.
 * @property {string} [expiresAt] ISO expiry required for non-house creatives.
 * @property {string|null} [imageAlt]
 */
import catalog from "../data/records/house-creatives.json" with { type: "json" };

/**
 * The house's own creative catalog, read from its record
 * (data/records/house-creatives.json). The first advertiser is the house:
 * its properties and its products.
 * @type {AdCreative[]}
 */
export const HOUSE_CREATIVE_CATALOG = Object.freeze(catalog.creatives.map((creative) => Object.freeze({ ...creative })));

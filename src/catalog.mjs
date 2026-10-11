/**
 * One catalog entry: id; status ("live" serves, "coming-soon" is
 * catalog-only until its destination is confirmed live); slots/properties
 * eligibility (or ["*"] for any); property (the key it promotes, used to
 * suppress self-promotion); contexts (the page contexts it fits, for
 * contextual preference); tags; title; body; href; optional imageAlt.
 * @typedef {object} AdCreative
 */
import catalog from "../data/records/house-creatives.json" with { type: "json" };

/**
 * The house's own creative catalog, read from its record
 * (data/records/house-creatives.json). The first advertiser is the house:
 * its properties and its products.
 * @type {AdCreative[]}
 */
export const HOUSE_CREATIVE_CATALOG = Object.freeze(catalog.creatives.map((creative) => Object.freeze({ ...creative })));

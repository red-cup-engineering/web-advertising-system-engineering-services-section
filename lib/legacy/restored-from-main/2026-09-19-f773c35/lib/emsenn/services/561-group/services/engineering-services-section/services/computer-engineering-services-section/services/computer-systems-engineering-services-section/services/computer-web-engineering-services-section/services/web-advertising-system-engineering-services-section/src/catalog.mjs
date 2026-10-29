/**
 * One catalog entry: id; status ("live" serves, "coming-soon" is
 * catalog-only until its destination is confirmed live); slots/properties
 * eligibility (or ["*"] for any); property (the key it promotes, used to
 * suppress self-promotion); tags; title; body; href; optional imageAlt.
 * @typedef {object} AdCreative
 */

/**
 * The house's own creative catalog. First advertiser is the house itself:
 * cross-promotion of confirmed-live properties (koios.news, play.561.group)
 * plus coming-soon house products (the Handbook, the agent plugin) that are
 * cataloged but excluded from serving until their destination is live.
 *
 * @type {AdCreative[]}
 */
export const HOUSE_CREATIVE_CATALOG = Object.freeze([
  Object.freeze({
    id: "koios-news-v1",
    status: "live",
    slots: ["*"],
    properties: ["*"],
    property: "koios-news",
    tags: ["house", "news", "media"],
    title: "koios.news",
    body: "Independent news, sourced and edited by the house's own editorial pipeline.",
    href: "https://koios.news/",
    imageAlt: null,
  }),
  Object.freeze({
    id: "play-561-group-v1",
    status: "live",
    slots: ["*"],
    properties: ["*"],
    property: "play-561-group",
    tags: ["house", "games", "storefront"],
    title: "play.561.group",
    body: "Free browser games from the house — solitaire, weiqi, and more.",
    href: "https://play.561.group/",
    imageAlt: null,
  }),
  Object.freeze({
    id: "agent-operators-handbook-v1",
    status: "coming-soon",
    slots: ["*"],
    properties: ["*"],
    property: "agent-operators-handbook",
    tags: ["house", "education", "agent-ops"],
    title: "The Agent Operator's Handbook",
    body: "A field guide to running agentic engineering — $29.",
    href: "https://561.group/handbook",
    imageAlt: null,
  }),
  Object.freeze({
    id: "house-agent-plugin-v1",
    status: "coming-soon",
    slots: ["*"],
    properties: ["*"],
    property: "house-agent-plugin",
    tags: ["house", "tooling", "agents"],
    title: "The house agent plugin",
    body: "Coming soon: the house's own Claude Code plugin.",
    href: "https://561.group/plugin",
    imageAlt: null,
  }),
]);

#!/usr/bin/env node
import { HOUSE_CREATIVE_CATALOG } from "../src/catalog.mjs";

/**
 * CLI: print the house creative catalog, optionally filtered by status.
 * @param {string[]} argv `node list-catalog.mjs [live|coming-soon]`
 */
function main(argv) {
  const [status] = argv;
  const rows = status ? HOUSE_CREATIVE_CATALOG.filter((creative) => creative.status === status) : HOUSE_CREATIVE_CATALOG;
  console.log(JSON.stringify(rows, null, 2));
}

main(process.argv.slice(2));

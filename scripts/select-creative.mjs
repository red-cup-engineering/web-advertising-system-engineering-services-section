#!/usr/bin/env node
import { HOUSE_CREATIVE_CATALOG } from "../src/catalog.mjs";
import { selectCreative } from "../src/advertising.mjs";

/**
 * CLI: print the creative the decision algorithm would serve for a given
 * slot/property, for local testing without deploying the worker.
 * @param {string[]} argv `node select-creative.mjs <slot> <property>`
 */
function main(argv) {
  const [slot, property] = argv;
  if (!slot || !property) {
    console.error("usage: select-creative.mjs <slot> <property>");
    process.exitCode = 1;
    return;
  }
  const picked = selectCreative({ catalog: HOUSE_CREATIVE_CATALOG, slot, property });
  console.log(JSON.stringify(picked, null, 2));
}

main(process.argv.slice(2));

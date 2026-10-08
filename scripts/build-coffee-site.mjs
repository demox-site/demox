// Writes the real coffee.demox.site page from the shared homepage source.
// usage: node scripts/build-coffee-site.mjs /path/to/index.html
import { writeFileSync } from "node:fs";
import { coffeeSiteDocument } from "../src/components/marketing/coffee-page.mjs";
const out = process.argv[2] || "coffee-site/index.html";
writeFileSync(out, coffeeSiteDocument());
console.log("wrote", out);

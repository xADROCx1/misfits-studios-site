#!/usr/bin/env node
/* Tighten the Paddle init guard inside product pages + the page generator
 * from the loose `/^(live|test)_/` to the strict v2 client-side token shape:
 *   `live_apikey_<id>_<secret>` AND length >= 50.
 * Idempotent. */
const fs = require('fs');
const path = require('path');

const OLD = "if (!t || !/^(live|test)_/.test(t)) return;";
const NEW = "if (!t || !/^(live|test)_apikey_[A-Za-z0-9_-]+$/.test(t) || t.length < 50) return;";

const root = path.resolve(__dirname, '..');
const targets = [
  path.join(root, 'scripts/generate-product-pages.js'),
  ...fs.readdirSync(path.join(root, 'products')).filter(f => f.endsWith('.html')).map(f => path.join(root, 'products', f))
];
let patched = 0, skipped = 0;
for (const f of targets) {
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes(OLD)) { skipped++; continue; }
  fs.writeFileSync(f, src.split(OLD).join(NEW));
  patched++;
}
console.log(`patched ${patched}, skipped ${skipped}`);

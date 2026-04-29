#!/usr/bin/env node
/* Reverse the strict-format guard back to a loose `live_<8+ chars>` shape.
 * Idempotent. */
const fs = require('fs');
const path = require('path');

const STRICT = "if (!t || !/^(live|test)_apikey_[A-Za-z0-9_-]+$/.test(t) || t.length < 50) return;";
const LOOSE  = "if (!t || !/^(live|test)_[A-Za-z0-9_-]{8,}$/.test(t)) return;";

const root = path.resolve(__dirname, '..');
const targets = [
  path.join(root, 'scripts/generate-product-pages.js'),
  ...fs.readdirSync(path.join(root, 'products')).filter(f => f.endsWith('.html')).map(f => path.join(root, 'products', f))
];
let patched = 0, skipped = 0;
for (const f of targets) {
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes(STRICT)) { skipped++; continue; }
  fs.writeFileSync(f, src.split(STRICT).join(LOOSE));
  patched++;
}
console.log(`patched ${patched}, skipped ${skipped}`);

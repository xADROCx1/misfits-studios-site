#!/usr/bin/env node
/* One-shot: update <link rel="canonical">, og:url, twitter URL, and
 * JSON-LD url/item fields on the 8 top-level pages so they point at the
 * clean URL the Worker actually serves (no .html), eliminating the
 * Google Search Console "Alternate page with proper canonical tag"
 * mismatch.
 *
 * Idempotent — safe to re-run; touches only `.html` suffixes preceded by
 * known page names. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES = ['index', 'about', 'apps', 'plugins', 'support', 'terms', 'privacy', 'refund', 'changelog', '404'];

let edited = 0;

// --- 1. Top-level pages ---
for (const slug of PAGES) {
  const file = path.join(ROOT, slug + '.html');
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  if (slug !== 'index' && slug !== '404') {
    const dotHtml = '/' + slug + '.html';
    const clean   = '/' + slug;
    src = src.split('shadowkidsstudios.com' + dotHtml).join('shadowkidsstudios.com' + clean);
  }
  if (src !== before) {
    fs.writeFileSync(file, src);
    edited++;
    console.log('updated', slug + '.html');
  }
}

// --- 2. Product pages: strip .html from canonical/og/JSON-LD ---
const productsDir = path.join(ROOT, 'products');
if (fs.existsSync(productsDir)) {
  for (const f of fs.readdirSync(productsDir)) {
    if (!f.endsWith('.html')) continue;
    const slug = f.replace(/\.html$/, '');
    const file = path.join(productsDir, f);
    let src = fs.readFileSync(file, 'utf8');
    const before = src;
    // Only touch the absolute URL forms; relative or unrelated `.html`
    // strings (e.g. `index.html` in nav) stay intact.
    src = src.split('shadowkidsstudios.com/products/' + slug + '.html')
             .join('shadowkidsstudios.com/products/' + slug);
    if (src !== before) {
      fs.writeFileSync(file, src);
      edited++;
      console.log('updated products/' + f);
    }
  }
}

console.log(`edited ${edited} files`);

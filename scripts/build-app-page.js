#!/usr/bin/env node
/* Build a single app-page static HTML file from products.json + the editor's
 * renderer (admin/app-page-template.js). Used to bootstrap a new entry into
 * apps/<slug>/index.html before the editor is opened — the editor itself
 * regenerates the same file on every Save via S.stagedFiles.
 *
 * Usage: node scripts/build-app-page.js <slug>
 *   e.g.: node scripts/build-app-page.js rustcon-desktop
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const slug = process.argv[2];
if (!slug) { console.error('Usage: node scripts/build-app-page.js <slug>'); process.exit(1); }

// Shim a browser-ish window so the IIFE in app-page-template.js runs under Node.
const sandbox = { window: {} };
const tplSrc = fs.readFileSync(path.join(ROOT, 'admin/app-page-template.js'), 'utf8');
new Function('window', tplSrc)(sandbox.window);
const SKSAppPage = sandbox.window.SKSAppPage;
if (!SKSAppPage || typeof SKSAppPage.render !== 'function') {
  console.error('SKSAppPage.render not exported from admin/app-page-template.js');
  process.exit(2);
}

const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'products.json'), 'utf8'));
const data = (products.apps_pages || {})[slug];
if (!data) { console.error(`apps_pages[${slug}] not found in products.json`); process.exit(3); }

const html = SKSAppPage.render(data);
const outDir = path.join(ROOT, 'apps', slug);
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'index.html');
fs.writeFileSync(outPath, html);
console.log(`✓ Wrote ${path.relative(ROOT, outPath)} (${(html.length / 1024).toFixed(1)} KB)`);

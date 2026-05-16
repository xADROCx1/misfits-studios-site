#!/usr/bin/env node
/**
 * generate-ls-cheatsheet.js
 *
 * Reads products.json and emits a copy-paste-ready guide for creating the
 * 31 paid products in the Lemon Squeezy dashboard. Output is a single
 * markdown file (.ls-work/LS-CREATION-CHEATSHEET.md) with one block per
 * product, fields ordered to match the LS dashboard creation form:
 *
 *   Name | Status | Price | Description | (image path on disk) | Notes
 *
 * Why names must match exactly: scripts/sync-from-lemonsqueezy.js matches
 * LS products back to products.json entries by name (case-insensitive).
 * Once you create them with the names below, run the sync and every
 * variant_id + buy_url gets wired automatically.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT, 'products.json');
const OUT_DIR = path.join(ROOT, '.ls-work');
const OUT_PATH = path.join(OUT_DIR, 'LS-CREATION-CHEATSHEET.md');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const db = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
const paid = (db.products || []).filter(p => Number(p.price_usd) > 0);

let out = '# Lemon Squeezy — Bulk Product Creation Cheat Sheet\n\n';
out += '**' + paid.length + ' paid products** to create at https://app.lemonsqueezy.com/products/new\n\n';
out += '## Workflow (per product, ~30 sec each)\n\n';
out += '1. Click **New product**\n';
out += '2. Paste **Name** exactly as shown (case matters for sync)\n';
out += '3. Paste **Description** (the short one — long description optional, can use the tagline)\n';
out += '4. Set **Price**\n';
out += '5. Leave variant as default (the one auto-created)\n';
out += '6. Optionally upload product icon from the path shown\n';
out += '7. **Publish** (not Draft)\n';
out += '8. Move on. No need to copy any IDs — sync script auto-wires them.\n\n';
out += 'Once done with all ' + paid.length + ' → tell Claude and they run `node scripts/sync-from-lemonsqueezy.js`.\n\n';
out += '---\n\n';

paid.forEach((p, i) => {
  const num = String(i + 1).padStart(2, '0');
  const iconPath = p.assets && p.assets.icon ? path.join(ROOT, p.assets.icon.replace(/^\//, '')) : '(no icon)';
  out += '## ' + num + '. ' + p.name + ' — $' + p.price_usd + '\n\n';
  out += '**Name** (paste exactly):\n```\n' + p.name + '\n```\n\n';
  out += '**Price (USD)**: `' + p.price_usd + '`\n\n';
  out += '**Description** (short, paste):\n```\n' + (p.short_description || p.tagline || p.name) + '\n```\n\n';
  out += '**Tagline** (one-liner, optional second field if LS asks):\n```\n' + (p.tagline || '') + '\n```\n\n';
  out += '**Icon to upload** (drag from disk):\n`' + iconPath + '`\n\n';
  out += '**Status**: Published\n\n';
  out += '---\n\n';
});

fs.writeFileSync(OUT_PATH, out);
console.log('wrote', OUT_PATH, '·', paid.length, 'products');

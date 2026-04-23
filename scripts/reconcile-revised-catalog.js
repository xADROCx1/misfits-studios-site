#!/usr/bin/env node
/**
 * reconcile-revised-catalog.js
 *
 * Makes products.json + Paddle + product detail pages match the contents
 * of `../Revised plugins/` (the canonical list of for-sale plugins).
 *
 *   - ADDS  plugins that exist in the folder but not in products.json
 *   - UPDATES version numbers from each .cs file's [Info(...)] attribute
 *   - REMOVES entries from products.json that have no matching .cs file
 *            in the folder (keeps the 3 originals — MisfitsUI, MisfitsCommands, Dev2Discord — by explicit allow-list)
 *   - ARCHIVES the corresponding Paddle products for each removal
 *   - CREATES new Paddle products for each addition (via bulk-create)
 *   - DELETES the obsolete /products/<slug>.html files
 *   - Regenerates the remaining product pages + sitemap
 *
 * Usage:
 *   node scripts/reconcile-revised-catalog.js --dry-run   # preview only
 *   node scripts/reconcile-revised-catalog.js             # execute
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..');
const REVISED_DIR = path.join(PROJECT_ROOT, 'Revised plugins');
const PRODUCTS_JSON = path.join(ROOT, 'products.json');
const PRODUCTS_HTML_DIR = path.join(ROOT, 'products');

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes('--dry-run');

// ---- env loader ----
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_BASE = 'https://api.paddle.com';

// ---- original products (not in Revised folder but always kept — the three plugins shipped under the Misfits Studios brand pre-rebrand) ----
const ORIGINALS_KEEP = new Set(['dev2discord', 'misfitsui', 'misfitscommands']);

// ---- pricing tiers (matching existing convention) ----
const PRICE_TIERS = {
  micro: 2.99, small: 4.99, medium: 7.99, large: 9.99, pro: 12.99, flagship: 19.99, bundle: 29.99,
};

// ---- metadata for NEW plugins added by this reconcile ----
const NEW_PLUGIN_META = {
  neighborhoodwatch: {
    id: 'neighborhoodwatch',
    slug: 'neighborhoodwatch',
    name: 'NeighborhoodWatch',
    category: 'plugin',
    status: 'live',
    tagline: 'Server monitor: PvP, loot, raids → Discord',
    short_description: 'All-in-one server monitor: PvP kills, unauthorized looting/access, and comprehensive raid tracking — pushed live to Discord.',
    price_usd: PRICE_TIERS.pro,
    price_label: '$12.99',
    lemonsqueezy: { variant_id: null, buy_url: null, overlay_enabled: true },
    tags: ['admin', 'monitoring', 'discord', 'raid', 'alerts', 'pvp'],
    cs_info_author: 'XADROCX',
  },
  rustconchat: {
    id: 'rustconchat',
    slug: 'rustconchat',
    name: 'RustconChat',
    category: 'plugin',
    status: 'live',
    tagline: 'RCON chat + event ring buffer',
    short_description: 'Stores recent chat and events in a ring buffer, served via RCON for RustCON app backfill. Lightweight, zero-config.',
    price_usd: PRICE_TIERS.small,
    price_label: '$4.99',
    lemonsqueezy: { variant_id: null, buy_url: null, overlay_enabled: true },
    tags: ['admin', 'rcon', 'chat', 'utility', 'buffer'],
    cs_info_author: 'xADROCx',
  },
};

// ---- scan Revised folder ----
function scanRevised() {
  const files = fs.readdirSync(REVISED_DIR).filter(f => f.endsWith('.cs') && !f.includes('OLD'));
  const byId = new Map();
  for (const file of files) {
    const full = path.join(REVISED_DIR, file);
    const src = fs.readFileSync(full, 'utf8');
    const m = src.match(/\[Info\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)\]/);
    if (!m) continue;
    const [, name, author, version] = m;
    // Match by normalized id = lowercase name without special chars
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    byId.set(id, { name, author, version, file });
  }
  return byId;
}

// ---- load products.json ----
const manifest = JSON.parse(fs.readFileSync(PRODUCTS_JSON, 'utf8'));
const products = manifest.products;
const byLocalId = new Map(products.map(p => [p.id, p]));

// ---- compute diffs ----
const revised = scanRevised();
console.log(`→ Scanned Revised folder: ${revised.size} plugins found`);

const toKeep = []; // products remaining after reconcile
const toAdd = [];  // new products to add
const toRemove = []; // products to archive + delete

for (const p of products) {
  if (ORIGINALS_KEEP.has(p.id)) { toKeep.push(p); continue; }
  if (revised.has(p.id)) {
    const r = revised.get(p.id);
    // bump version if different
    if (p.version !== r.version) {
      console.log(`  ~ version bump: ${p.id}  ${p.version} → ${r.version}`);
      p.version = r.version;
    }
    toKeep.push(p);
  } else {
    toRemove.push(p);
  }
}

for (const [id, r] of revised) {
  if (!byLocalId.has(id)) {
    const meta = NEW_PLUGIN_META[id];
    if (!meta) {
      console.warn(`  ! No pricing metadata defined for new plugin "${r.name}" (id=${id}) — skipping. Add an entry to NEW_PLUGIN_META in this script to include it.`);
      continue;
    }
    meta.version = r.version;
    meta.cs_info_author = r.author;
    toAdd.push(meta);
  }
}

console.log(`\nPLAN:`);
console.log(`  keep: ${toKeep.length} products (incl. 3 originals)`);
console.log(`  add:  ${toAdd.length} new → ${toAdd.map(p => p.name).join(', ') || '(none)'}`);
console.log(`  remove: ${toRemove.length} → ${toRemove.map(p => p.id).join(', ') || '(none)'}`);

if (IS_DRY_RUN) {
  console.log('\n(dry run — no writes, no API calls, no file deletes)');
  process.exit(0);
}

// ---- Paddle helpers ----
async function paddleArchive(productId) {
  if (!PADDLE_API_KEY) return false;
  const res = await fetch(`${PADDLE_BASE}/products/${productId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    body: JSON.stringify({ status: 'archived' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`  ! Paddle archive ${productId} failed: ${res.status} ${body.slice(0, 200)}`);
    return false;
  }
  return true;
}

(async () => {
  // 1. Archive removed products in Paddle
  console.log('\n→ Archiving removed Paddle products…');
  for (const p of toRemove) {
    const pid = p.paddle && p.paddle.product_id;
    if (pid) {
      const ok = await paddleArchive(pid);
      console.log(`  ${ok ? '✓' : '✗'} ${p.id} (${pid})`);
    } else {
      console.log(`  ~ ${p.id} (no Paddle product_id — nothing to archive)`);
    }
  }

  // 2. Delete obsolete product detail HTML files
  console.log('\n→ Deleting obsolete /products/*.html files…');
  for (const p of toRemove) {
    const htmlPath = path.join(PRODUCTS_HTML_DIR, `${p.slug}.html`);
    if (fs.existsSync(htmlPath)) {
      fs.unlinkSync(htmlPath);
      console.log(`  ✓ deleted products/${p.slug}.html`);
    }
  }

  // 3. Write updated products.json
  manifest.products = [...toKeep, ...toAdd];
  fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n✓ wrote products.json (${manifest.products.length} products total)`);

  // 4. Bulk-create new Paddle products (only the 2 additions will actually get API calls;
  //    the script is idempotent and skips anything with paddle.price_id already set)
  if (toAdd.length > 0) {
    console.log('\n→ Creating new Paddle products via bulk-create-paddle-products.js…');
    const res = spawnSync(process.execPath, [path.join(__dirname, 'bulk-create-paddle-products.js')], {
      stdio: 'inherit',
      cwd: ROOT,
      env: process.env,
    });
    if (res.status !== 0) console.warn('  ! bulk-create exited non-zero — check logs');
  }

  // 5. Regenerate product detail pages + sitemap
  console.log('\n→ Regenerating product detail pages…');
  const gen = spawnSync(process.execPath, [path.join(__dirname, 'generate-product-pages.js')], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  if (gen.status !== 0) console.warn('  ! generate-product-pages exited non-zero');

  console.log('\n✓ Reconcile complete.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

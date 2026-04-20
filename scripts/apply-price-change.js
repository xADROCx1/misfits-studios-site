#!/usr/bin/env node
/**
 * apply-price-change.js
 *
 * Applies a percentage discount (default 30%) across the entire live catalog,
 * rounded to $X.99 endings for psychological pricing.
 *
 * Steps:
 *   1. Computes new price_usd + price_label for each live, paid product
 *   2. PATCHes Paddle /prices/{id} with the new unit_price.amount (cents)
 *   3. Writes new prices to products.json
 *   4. Re-runs sync-from-paddle.js to refresh checkout URLs (Paddle snapshots
 *      the old amount in existing transactions; fresh transactions = fresh prices)
 *
 * Usage:
 *   node scripts/apply-price-change.js --dry-run          # preview only
 *   node scripts/apply-price-change.js                     # 30% off (default)
 *   node scripts/apply-price-change.js --percent=25        # 25% off
 *   node scripts/apply-price-change.js --sandbox           # sandbox API
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT, 'products.json');

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes('--dry-run');
const IS_SANDBOX = args.includes('--sandbox');
const percentArg = args.find(a => a.startsWith('--percent='));
const DISCOUNT_PERCENT = percentArg ? Number(percentArg.split('=')[1]) : 30;
const KEEP_FACTOR = 1 - DISCOUNT_PERCENT / 100;

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

const API_KEY = IS_SANDBOX ? process.env.PADDLE_SANDBOX_API_KEY : process.env.PADDLE_API_KEY;
const API_BASE = IS_SANDBOX ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

if (!API_KEY && !IS_DRY_RUN) {
  console.error(`ERROR: ${IS_SANDBOX ? 'PADDLE_SANDBOX_API_KEY' : 'PADDLE_API_KEY'} not set.`);
  process.exit(1);
}

// Round to nearest $X.99 ending (minimum $0.99)
function round99(n) {
  if (n <= 0) return 0;
  return Math.max(0.99, Math.round(n) - 0.01);
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'Paddle-Version': '1',
};

async function patchPaddlePrice(priceId, newAmountCents) {
  const res = await fetch(`${API_BASE}/prices/${priceId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      unit_price: { amount: String(newAmountCents), currency_code: 'USD' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PATCH /prices/${priceId} → ${res.status}\n${body}`);
  }
  return res.json();
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const changes = [];

  for (const p of manifest.products) {
    if (p.status !== 'live') continue;
    const oldPrice = Number(p.price_usd || 0);
    if (oldPrice <= 0) continue;

    const newPrice = round99(oldPrice * KEEP_FACTOR);
    if (newPrice === oldPrice) continue;

    changes.push({
      product: p,
      oldPrice,
      newPrice,
      priceId: p.paddle && p.paddle.price_id,
    });
  }

  console.log(`\nPLAN: ${DISCOUNT_PERCENT}% off across ${changes.length} paid products\n`);
  changes.forEach(c => {
    const pct = Math.round((1 - c.newPrice / c.oldPrice) * 100);
    console.log(`  ${c.product.name.padEnd(22)}  $${c.oldPrice.toFixed(2).padStart(6)} → $${c.newPrice.toFixed(2).padStart(6)}  (-${pct}%)  ${c.priceId || '(no paddle)'}`);
  });

  if (IS_DRY_RUN) {
    console.log('\n(dry run — no Paddle PATCH, no writes)');
    return;
  }

  // 1. Patch Paddle prices
  console.log('\n→ Patching Paddle prices…');
  let patched = 0, failed = 0;
  for (const c of changes) {
    if (!c.priceId) {
      console.log(`  ~ skip ${c.product.id} (no paddle.price_id)`);
      continue;
    }
    try {
      const cents = Math.round(c.newPrice * 100);
      await patchPaddlePrice(c.priceId, cents);
      console.log(`  ✓ ${c.product.id}  $${c.oldPrice.toFixed(2)} → $${c.newPrice.toFixed(2)}`);
      patched++;
    } catch (e) {
      console.warn(`  ✗ ${c.product.id}: ${e.message.slice(0, 180)}`);
      failed++;
    }
  }
  console.log(`  patched: ${patched} · failed: ${failed}`);

  // 2. Update local products.json
  console.log('\n→ Updating products.json…');
  for (const c of changes) {
    c.product.price_usd = c.newPrice;
    c.product.price_label = `$${c.newPrice.toFixed(2)}`;
  }
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  ✓ wrote ${changes.length} price updates`);

  // 3. Refresh checkout URLs (fresh transactions use new prices)
  console.log('\n→ Regenerating checkout URLs via sync-from-paddle.js…');
  const syncArgs = IS_SANDBOX ? ['scripts/sync-from-paddle.js', '--sandbox'] : ['scripts/sync-from-paddle.js'];
  const sync = spawnSync(process.execPath, syncArgs, { stdio: 'inherit', cwd: ROOT, env: process.env });
  if (sync.status !== 0) console.warn('  ! sync-from-paddle exited non-zero');

  // 4. Regenerate product detail pages (price labels are baked into HTML)
  console.log('\n→ Regenerating product detail pages…');
  const gen = spawnSync(process.execPath, ['scripts/generate-product-pages.js'], { stdio: 'inherit', cwd: ROOT, env: process.env });
  if (gen.status !== 0) console.warn('  ! generate-product-pages exited non-zero');

  console.log('\n✓ Done.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

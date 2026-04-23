#!/usr/bin/env node
/**
 * push-icons-to-paddle.js
 *
 * For every live product that has:
 *   - paddle.product_id set
 *   - assets.icon set
 *
 * PATCH /products/{id} with image_url = <siteUrl>/<assets.icon>
 * so the Paddle checkout overlay shows the same branded icon.
 *
 * Run this AFTER committing + pushing so the icon URLs are publicly fetchable
 * by Paddle's image crawler.
 *
 * Usage:
 *   node scripts/push-icons-to-paddle.js                    # live
 *   node scripts/push-icons-to-paddle.js --sandbox          # sandbox
 *   node scripts/push-icons-to-paddle.js --dry-run          # preview
 *   node scripts/push-icons-to-paddle.js --site=https://... # override base URL
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT, 'products.json');

const args = process.argv.slice(2);
const IS_SANDBOX = args.includes('--sandbox');
const IS_DRY_RUN = args.includes('--dry-run');
const siteArg = args.find(a => a.startsWith('--site='));
const SITE_URL = (siteArg ? siteArg.split('=')[1] : 'https://shadowkidsstudios.com').replace(/\/$/, '');

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
  console.error(`ERROR: ${IS_SANDBOX ? 'PADDLE_SANDBOX_API_KEY' : 'PADDLE_API_KEY'} not set`);
  process.exit(1);
}

async function patchProduct(productId, imageUrl) {
  const res = await fetch(`${API_BASE}/products/${productId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const targets = manifest.products.filter(p =>
    p.status === 'live' &&
    p.paddle && p.paddle.product_id &&
    p.assets && p.assets.icon
  );

  console.log(`\nPush icons to Paddle ${IS_SANDBOX ? 'sandbox' : 'production'}`);
  console.log(`  base URL: ${SITE_URL}`);
  console.log(`  products with both paddle.product_id AND assets.icon: ${targets.length}\n`);

  let ok = 0, fail = 0;
  for (const p of targets) {
    const imageUrl = SITE_URL + p.assets.icon;
    process.stdout.write(`  ${p.id.padEnd(22)} → ${imageUrl}  `);
    if (IS_DRY_RUN) { console.log('(dry run)'); ok++; continue; }
    try {
      await patchProduct(p.paddle.product_id, imageUrl);
      console.log('✓');
      ok++;
    } catch (e) {
      console.log(`✗ ${e.message.slice(0, 120)}`);
      fail++;
    }
  }

  console.log(`\nResult: ${ok} ok · ${fail} failed`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

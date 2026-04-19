#!/usr/bin/env node
/**
 * Misfits Studios — Paddle bulk product creator
 *
 * For each product in products.json that doesn't yet have a paddle.price_id,
 * this creates (1) a Paddle Product, (2) a Price, and (3) a Transaction to
 * get a reusable checkout URL — then writes all three back to products.json.
 *
 * Unlike Lemon Squeezy, Paddle Billing HAS a Create-Product API endpoint, so
 * we don't need a paste sheet here. This is full end-to-end automation.
 *
 * What Paddle does NOT do automatically:
 *   - Host your .cs download files (you deliver via webhook after purchase)
 *   - Generate license keys (you mint them in your webhook handler)
 * Those are separate workflows — see DEPLOY.md for the webhook pattern.
 *
 * Usage:
 *   cp scripts/.env.example scripts/.env
 *   # set PADDLE_API_KEY (live) or PADDLE_SANDBOX_API_KEY in scripts/.env
 *   node scripts/bulk-create-paddle-products.js            # live
 *   node scripts/bulk-create-paddle-products.js --sandbox  # sandbox
 *   node scripts/bulk-create-paddle-products.js --dry-run  # preview only
 *
 * Node 18+ (built-in fetch).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT, 'products.json');

const args = process.argv.slice(2);
const IS_SANDBOX = args.includes('--sandbox');
const IS_DRY_RUN = args.includes('--dry-run');
const ONLY_ID = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;

// --- Tiny .env loader (no dotenv dependency) ---
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

if (!API_KEY) {
  console.error(`ERROR: ${IS_SANDBOX ? 'PADDLE_SANDBOX_API_KEY' : 'PADDLE_API_KEY'} not set.`);
  console.error('Create one at https://vendors.paddle.com/ → Developer tools → Authentication');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'Paddle-Version': '1',
};

async function req(method, endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!res.ok) {
    throw new Error(`${method} ${endpoint} → ${res.status} ${res.statusText}\n${text}`);
  }
  return json;
}

async function createProduct(p) {
  const body = {
    name: p.name,
    description: p.long_description || p.short_description || p.tagline || '',
    type: 'standard',
    tax_category: 'standard', // Rust plugins aren't a SaaS; "standard" is safer than "digital-goods" until you confirm Paddle's tax mapping for your jurisdiction.
    custom_data: {
      slug: p.slug,
      misfits_id: p.id,
      misfits_version: p.version,
      misfits_category: p.category,
      misfits_cs_author: p.cs_info_author || '',
    },
  };
  if (IS_DRY_RUN) return { data: { id: 'pro_DRY_' + p.id } };
  const res = await req('POST', '/products', body);
  return res;
}

async function createPrice(productId, p) {
  const cents = Math.round((p.price_usd || 0) * 100);
  if (cents === 0) return null; // skip free products — no checkout needed
  const body = {
    product_id: productId,
    description: `${p.name} — perpetual license`,
    unit_price: {
      amount: String(cents),
      currency_code: 'USD',
    },
    // one-time purchase: omit billing_cycle
    tax_mode: 'account_setting',
    quantity: { minimum: 1, maximum: 1 },
  };
  if (IS_DRY_RUN) return { data: { id: 'pri_DRY_' + p.id } };
  const res = await req('POST', '/prices', body);
  return res;
}

async function createCheckoutTransaction(priceId, p) {
  if (!priceId) return null;
  const body = {
    items: [{ price_id: priceId, quantity: 1 }],
  };
  if (IS_DRY_RUN) return { data: { id: 'txn_DRY_' + p.id, checkout: { url: `https://checkout.example.com/?_ptxn=txn_DRY_${p.id}` } } };
  const res = await req('POST', '/transactions', body);
  return res;
}

(async () => {
  console.log(`→ Mode: ${IS_DRY_RUN ? 'DRY RUN' : 'LIVE'} · ${IS_SANDBOX ? 'SANDBOX' : 'PRODUCTION'} · API: ${API_BASE}`);
  const manifest = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  let created = 0, skipped = 0, failed = 0;

  for (const p of manifest.products) {
    if (ONLY_ID && p.id !== ONLY_ID) continue;
    const alreadyDone = p.paddle && p.paddle.price_id;
    if (alreadyDone) {
      skipped++;
      console.log(`  ~ skip ${p.id} (already has paddle.price_id)`);
      continue;
    }
    if (p.status !== 'live') {
      skipped++;
      continue;
    }

    try {
      console.log(`\n→ ${p.id} · ${p.name} · ${p.price_label}`);

      const prod = await createProduct(p);
      const prodId = prod.data.id;
      console.log(`  ✓ product   ${prodId}`);

      const price = await createPrice(prodId, p);
      const priceId = price ? price.data.id : null;
      if (priceId) console.log(`  ✓ price     ${priceId} (${Math.round((p.price_usd || 0) * 100)}¢)`);
      else console.log(`  ~ price     skipped (free product, no price record needed)`);

      let checkoutUrl = null;
      if (priceId) {
        const txn = await createCheckoutTransaction(priceId, p);
        checkoutUrl = txn && txn.data && txn.data.checkout ? txn.data.checkout.url : null;
        if (checkoutUrl) console.log(`  ✓ checkout  ${checkoutUrl}`);
      }

      p.paddle = {
        product_id: prodId,
        price_id: priceId,
        checkout_url: checkoutUrl,
        environment: IS_SANDBOX ? 'sandbox' : 'live',
      };

      created++;
    } catch (e) {
      failed++;
      console.error(`  ✗ FAILED ${p.id}: ${e.message}`);
    }
  }

  if (!IS_DRY_RUN) {
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\n✓ Wrote ${PRODUCTS_PATH}`);
  } else {
    console.log('\n(dry run — no writes)');
  }
  console.log(`\nResult: created ${created} · skipped ${skipped} · failed ${failed}`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

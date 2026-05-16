#!/usr/bin/env node
/**
 * bulk-create-lemonsqueezy-products.js
 *
 * For every paid product in products.json that has no LS variant_id yet,
 * create a matching LS product + variant via the API and write the new
 * variant_id + buy_url back into products.json.
 *
 * Run with:
 *   node scripts/bulk-create-lemonsqueezy-products.js              (all paid, missing only)
 *   node scripts/bulk-create-lemonsqueezy-products.js --only=slug  (single product)
 *   node scripts/bulk-create-lemonsqueezy-products.js --dry        (no API writes)
 *
 * Idempotent: skips any product that already has lemonsqueezy.variant_id set.
 * Free products (price_usd === 0) are always skipped.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT, 'products.json');

// --- env loader ---
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;
if (!API_KEY || !STORE_ID) {
  console.error('Missing LEMONSQUEEZY_API_KEY or LEMONSQUEEZY_STORE_ID in scripts/.env');
  process.exit(1);
}

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry');
const onlyArg = ARGS.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length) : null;

const BASE = 'https://api.lemonsqueezy.com/v1';
const HEADERS = {
  'Authorization': 'Bearer ' + API_KEY,
  'Accept': 'application/vnd.api+json',
  'Content-Type': 'application/vnd.api+json'
};

async function lsCall(method, urlPath, body) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error('LS API ' + method + ' ' + urlPath + ' → ' + res.status);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function buyUrlForSlug(productSlug) {
  // LS hosted-checkout URLs follow https://<store_slug>.lemonsqueezy.com/buy/<variant_id>
  // but we store the variant.attributes.buy_now_url (canonical short URL with the variant uuid).
  return null; // we'll read from the variant response directly
}

async function createOne(p) {
  console.log('→ creating LS product:', p.id, '(', p.name, '$' + p.price_usd, ')');
  if (DRY) { console.log('  [dry] would POST product + variant'); return; }

  // 1. Create product (draft until variant exists)
  const productBody = {
    data: {
      type: 'products',
      attributes: {
        name: p.name,
        description: p.short_description || p.tagline || '',
        status: 'draft'
      },
      relationships: {
        store: { data: { type: 'stores', id: String(STORE_ID) } }
      }
    }
  };
  const prodRes = await lsCall('POST', '/products', productBody);
  const productId = prodRes.data.id;
  console.log('  · product id:', productId);

  // 2. Create variant
  const variantBody = {
    data: {
      type: 'variants',
      attributes: {
        name: 'License',
        description: p.short_description || p.tagline || '',
        price: Math.round(Number(p.price_usd) * 100), // cents
        is_subscription: false,
        interval: null,
        interval_count: null,
        has_free_trial: false,
        status: 'published'
      },
      relationships: {
        product: { data: { type: 'products', id: String(productId) } }
      }
    }
  };
  const varRes = await lsCall('POST', '/variants', variantBody);
  const variantId = varRes.data.id;
  const variantAttrs = varRes.data.attributes || {};
  const buyUrl = variantAttrs.buy_now_url || ('https://shadowkidsstudios.lemonsqueezy.com/buy/' + variantId);
  console.log('  · variant id:', variantId, '· buy_url:', buyUrl);

  // 3. Publish the product
  await lsCall('PATCH', '/products/' + productId, {
    data: {
      type: 'products',
      id: String(productId),
      attributes: { status: 'published' }
    }
  });
  console.log('  · product published ✓');

  return { variant_id: variantId, buy_url: buyUrl, product_id: productId };
}

async function main() {
  const db = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const all = db.products || [];
  let touched = 0, created = 0, failed = 0;

  for (const p of all) {
    if (ONLY && p.id !== ONLY && p.slug !== ONLY) continue;
    if (Number(p.price_usd) <= 0) continue;
    if (p.lemonsqueezy && p.lemonsqueezy.variant_id) {
      console.log('skip (already has variant):', p.id);
      continue;
    }

    touched++;
    try {
      const res = await createOne(p);
      if (res) {
        if (!p.lemonsqueezy) p.lemonsqueezy = {};
        p.lemonsqueezy.variant_id = res.variant_id;
        p.lemonsqueezy.buy_url    = res.buy_url;
        p.lemonsqueezy.product_id = res.product_id;
        p.lemonsqueezy.overlay_enabled = true;
        created++;
        // Write after EACH success so a failure mid-run doesn't lose state
        fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(db, null, 2) + '\n');
      }
    } catch (e) {
      failed++;
      console.error('  ✗ failed:', e.message);
      if (e.body) console.error('    body:', JSON.stringify(e.body));
    }

    // Gentle pacing: LS allows ~120 req/min, we do ~3 calls per product
    await new Promise(r => setTimeout(r, 700));
  }

  console.log('\nSummary — touched:', touched, '· created:', created, '· failed:', failed);
}

main().catch(e => { console.error(e); process.exit(1); });

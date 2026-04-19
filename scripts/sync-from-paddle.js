#!/usr/bin/env node
/**
 * Misfits Studios — Paddle → products.json sync
 *
 * Pulls all Paddle products and their prices, then updates products.json with:
 *   - paddle.product_id
 *   - paddle.price_id (first active price matched by product name)
 *   - paddle.checkout_url (generated via a fresh transaction)
 *   - price_usd + price_label (if they differ from what's in Paddle)
 *
 * Products are matched by name (case-insensitive) against products.json.
 * Paddle doesn't have a slug field, so we also check custom_data.slug.
 *
 * Usage:
 *   cp scripts/.env.example scripts/.env
 *   node scripts/sync-from-paddle.js
 *   node scripts/sync-from-paddle.js --sandbox
 *
 * Node 18+ required.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT, 'products.json');

const args = process.argv.slice(2);
const IS_SANDBOX = args.includes('--sandbox');

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
  console.error(`ERROR: ${IS_SANDBOX ? 'PADDLE_SANDBOX_API_KEY' : 'PADDLE_API_KEY'} not set in scripts/.env`);
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'Paddle-Version': '1',
};

async function getJSON(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${endpoint} → ${res.status} ${res.statusText}\n${body}`);
  }
  return res.json();
}

async function postJSON(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`POST ${endpoint} → ${res.status}\n${t}`);
  }
  return res.json();
}

async function listAllProductsWithPrices() {
  const all = [];
  let endpoint = '/products?include=prices&per_page=200';
  while (endpoint) {
    const page = await getJSON(endpoint);
    all.push(...(page.data || []));
    const nextAfter = page.meta && page.meta.pagination && page.meta.pagination.has_more ? (page.data[page.data.length - 1] || {}).id : null;
    endpoint = nextAfter ? `/products?include=prices&per_page=200&after=${nextAfter}` : null;
  }
  return all;
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findLocal(localProducts, paddleProduct) {
  const nName = normalize(paddleProduct.name);
  const slug = paddleProduct.custom_data && paddleProduct.custom_data.slug;
  const misfitsId = paddleProduct.custom_data && paddleProduct.custom_data.misfits_id;
  return localProducts.find(p =>
    (misfitsId && p.id === misfitsId) ||
    (slug && normalize(p.slug) === normalize(slug)) ||
    normalize(p.name) === nName
  );
}

(async () => {
  console.log(`→ Syncing from Paddle ${IS_SANDBOX ? 'sandbox' : 'production'}…`);
  const manifest = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const local = manifest.products || [];

  const paddleProducts = await listAllProductsWithPrices();
  console.log(`  found ${paddleProducts.length} Paddle product(s)`);

  let matched = 0, appended = 0;

  for (const pp of paddleProducts) {
    if (pp.status !== 'active') continue;

    const localMatch = findLocal(local, pp);
    const activePrice = (pp.prices || []).find(pr => pr.status === 'active') || (pp.prices || [])[0];

    // Generate a reusable checkout URL via a transaction
    let checkoutUrl = null;
    if (activePrice) {
      try {
        const txn = await postJSON('/transactions', { items: [{ price_id: activePrice.id, quantity: 1 }] });
        checkoutUrl = txn.data && txn.data.checkout ? txn.data.checkout.url : null;
      } catch (e) {
        console.warn(`  (could not generate checkout URL for ${pp.name}: ${e.message})`);
      }
    }

    const priceUSD = activePrice && activePrice.unit_price && activePrice.unit_price.amount
      ? Number(activePrice.unit_price.amount) / 100
      : 0;
    const priceLabel = priceUSD === 0 ? 'FREE' : `$${priceUSD.toFixed(2)}`;

    if (localMatch) {
      localMatch.price_usd = priceUSD;
      localMatch.price_label = priceLabel;
      localMatch.paddle = {
        product_id: pp.id,
        price_id: activePrice ? activePrice.id : null,
        checkout_url: checkoutUrl,
        environment: IS_SANDBOX ? 'sandbox' : 'live',
      };
      matched++;
      console.log(`  ✓ matched "${pp.name}" → ${localMatch.id}`);
    } else {
      const id = (pp.custom_data && pp.custom_data.slug) || normalize(pp.name) || ('paddle-' + pp.id);
      local.push({
        id,
        slug: id,
        name: pp.name,
        version: '0.0.0',
        category: (pp.custom_data && pp.custom_data.misfits_category) || 'unsorted',
        status: 'live',
        tagline: '',
        short_description: (pp.description || '').slice(0, 200),
        price_usd: priceUSD,
        price_label: priceLabel,
        paddle: {
          product_id: pp.id,
          price_id: activePrice ? activePrice.id : null,
          checkout_url: checkoutUrl,
          environment: IS_SANDBOX ? 'sandbox' : 'live',
        },
        tags: [],
        _warning: 'Appended by sync — edit category, tagline, features, then remove _warning.',
      });
      appended++;
      console.log(`  + appended "${pp.name}"`);
    }
  }

  manifest.products = local;
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n✓ ${matched} matched · ${appended} appended · wrote ${PRODUCTS_PATH}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

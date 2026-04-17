#!/usr/bin/env node
/**
 * Misfits Studios — Lemon Squeezy → products.json sync
 *
 * Pulls every published product from your Lemon Squeezy store and merges the
 * live price + buy_url + variant_id into the existing products.json.
 *
 * Products are matched by slug first, then by case-insensitive name.
 * - If a local product is found in LS → its price_usd, price_label, and
 *   lemonsqueezy.{variant_id, buy_url} are updated.
 * - If a local product is NOT found in LS → it stays untouched (buy_url null).
 * - If an LS product is NOT in products.json → it gets appended with a warning
 *   so you can edit the copy and move it into the right category.
 *
 * Usage:
 *   LEMONSQUEEZY_API_KEY=eyJ0eXAi... node scripts/sync-from-lemonsqueezy.js
 *
 * Or with a .env file next to this script:
 *   LEMONSQUEEZY_API_KEY=...
 *   LEMONSQUEEZY_STORE_ID=12345   (optional — filters to one store)
 *
 * No external dependencies. Node 18+ (for built-in fetch).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT, 'products.json');

// --- tiny .env loader (no dependency on dotenv) ---
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const STORE_ID = process.env.LEMONSQUEEZY_STORE_ID || '';

if (!API_KEY) {
  console.error('ERROR: LEMONSQUEEZY_API_KEY not set. Add it to scripts/.env or export it.');
  console.error('Create one at https://app.lemonsqueezy.com/settings/api');
  process.exit(1);
}

const API_BASE = 'https://api.lemonsqueezy.com/v1';
const headers = {
  'Accept': 'application/vnd.api+json',
  'Content-Type': 'application/vnd.api+json',
  'Authorization': 'Bearer ' + API_KEY,
};

async function getJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}\n${body}`);
  }
  return res.json();
}

async function listAllProducts() {
  const all = [];
  let url = `${API_BASE}/products?page[size]=100` + (STORE_ID ? `&filter[store_id]=${STORE_ID}` : '');
  while (url) {
    const page = await getJSON(url);
    all.push(...(page.data || []));
    url = page.links && page.links.next ? page.links.next : null;
  }
  return all;
}

async function listVariantsForProduct(productId) {
  const res = await getJSON(`${API_BASE}/variants?filter[product_id]=${productId}`);
  return res.data || [];
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findLocal(localProducts, lsProduct) {
  const slug = lsProduct.attributes.slug || '';
  const name = lsProduct.attributes.name || '';
  const nslug = normalize(slug);
  const nname = normalize(name);
  return localProducts.find(p => normalize(p.slug) === nslug || normalize(p.name) === nname);
}

(async () => {
  console.log('→ Loading local products.json…');
  if (!fs.existsSync(PRODUCTS_PATH)) {
    console.error(`ERROR: ${PRODUCTS_PATH} not found.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const localProducts = manifest.products || [];

  console.log('→ Fetching products from Lemon Squeezy…');
  const lsProducts = await listAllProducts();
  console.log(`  found ${lsProducts.length} product(s) in LS`);

  let matched = 0;
  let appended = 0;

  for (const ls of lsProducts) {
    const attrs = ls.attributes || {};
    const local = findLocal(localProducts, ls);

    // Pick a sensible default variant (first one).
    let variantId = null;
    try {
      const variants = await listVariantsForProduct(ls.id);
      if (variants.length) variantId = variants[0].id;
    } catch (e) {
      console.warn(`  (could not fetch variants for "${attrs.name}": ${e.message})`);
    }

    const priceUSD = typeof attrs.price === 'number' ? attrs.price / 100 : 0;

    if (local) {
      local.price_usd = priceUSD;
      local.price_label = priceUSD === 0 ? 'FREE' : attrs.price_formatted || `$${priceUSD.toFixed(2)}`;
      local.lemonsqueezy = Object.assign({}, local.lemonsqueezy, {
        variant_id: variantId,
        buy_url: attrs.buy_now_url || null,
        overlay_enabled: local.lemonsqueezy ? local.lemonsqueezy.overlay_enabled !== false : true,
      });
      if (attrs.thumb_url && (!local.assets || !local.assets.icon)) {
        local.assets = local.assets || {};
        local.assets.icon = attrs.thumb_url;
      }
      matched++;
      console.log(`  ✓ matched "${attrs.name}" → ${local.id}`);
    } else {
      // Unknown LS product — append with a warning flag
      const id = attrs.slug || normalize(attrs.name) || ('ls-' + ls.id);
      localProducts.push({
        id,
        slug: attrs.slug || id,
        name: attrs.name,
        version: '0.0.0',
        category: 'unsorted',
        status: attrs.status || 'published',
        tagline: '',
        short_description: (attrs.description || '').replace(/<[^>]+>/g, '').slice(0, 200),
        long_description: '',
        features: [],
        price_usd: priceUSD,
        price_label: priceUSD === 0 ? 'FREE' : attrs.price_formatted || `$${priceUSD.toFixed(2)}`,
        lemonsqueezy: {
          variant_id: variantId,
          buy_url: attrs.buy_now_url || null,
          overlay_enabled: true,
        },
        assets: {
          icon: attrs.thumb_url || null,
          banner: null,
          screenshots: [],
        },
        tags: [],
        _warning: 'Appended by sync — edit category, tagline, description, features, then remove _warning.',
      });
      appended++;
      console.log(`  + appended new LS product "${attrs.name}" (review category/copy)`);
    }
  }

  manifest.products = localProducts;

  // Pretty-print with 2-space indent, preserve trailing newline
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n✓ Done. Updated ${matched} local product(s), appended ${appended} new one(s).`);
  console.log(`✓ Wrote ${PRODUCTS_PATH}`);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

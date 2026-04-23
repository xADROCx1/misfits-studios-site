#!/usr/bin/env node
/**
 * inject-paddle-token.js
 *
 * Sets window.__sks_paddle_token on every HTML page that loads store.js
 * or cart.js so the Paddle.js overlay knows which account to open for.
 *
 * Usage:
 *   node scripts/inject-paddle-token.js <CLIENT_TOKEN>
 *
 * Or pulls from scripts/.env (PADDLE_CLIENT_TOKEN=live_... or test_...)
 * Idempotent: replaces any existing token, skips files already correct.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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

const token = process.argv[2] || process.env.PADDLE_CLIENT_TOKEN;
if (!token) {
  console.error('Usage: node scripts/inject-paddle-token.js <CLIENT_TOKEN>');
  console.error('Or set PADDLE_CLIENT_TOKEN in scripts/.env');
  process.exit(1);
}

if (!/^(live|test)_[A-Za-z0-9_-]+$/.test(token)) {
  console.warn(`[warn] Token doesn't match expected format (live_... or test_...). Proceeding anyway.`);
}

// Marker comment to let us find + replace safely
const MARKER_OPEN = '<!-- PADDLE_CLIENT_TOKEN:START -->';
const MARKER_CLOSE = '<!-- PADDLE_CLIENT_TOKEN:END -->';
const block = `${MARKER_OPEN}\n<script>window.__sks_paddle_token = ${JSON.stringify(token)};</script>\n${MARKER_CLOSE}`;

// Files to update: all top-level HTML + product detail pages
function listHTML() {
  const top = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(ROOT, f));
  const productsDir = path.join(ROOT, 'products');
  const products = fs.existsSync(productsDir)
    ? fs.readdirSync(productsDir)
        .filter(f => f.endsWith('.html'))
        .map(f => path.join(productsDir, f))
    : [];
  return [...top, ...products];
}

let updated = 0, skipped = 0;
for (const file of listHTML()) {
  let html = fs.readFileSync(file, 'utf8');

  // Skip admin helpers + the 404 page (no Paddle on those)
  if (/admin\//.test(file)) { skipped++; continue; }

  // Remove any existing block
  const re = new RegExp(`[\\s\\t]*${MARKER_OPEN}[\\s\\S]*?${MARKER_CLOSE}\\n?`, 'g');
  const cleaned = html.replace(re, '');

  // Insert before </head>
  const headClose = cleaned.lastIndexOf('</head>');
  if (headClose < 0) { skipped++; continue; }

  const next = cleaned.slice(0, headClose) + block + '\n' + cleaned.slice(headClose);

  if (next !== html) {
    fs.writeFileSync(file, next);
    updated++;
  } else {
    skipped++;
  }
}

console.log(`✓ Injected Paddle client token into ${updated} file(s). Skipped ${skipped}.`);

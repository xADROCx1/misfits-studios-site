#!/usr/bin/env node
/**
 * generate-product-icons-flux.js
 *
 * Generates a 512x512 cyberpunk-themed icon for every live product via
 * Replicate's FLUX Schnell model. Saves PNGs into /assets/products/<slug>.png
 * and writes the icon path back into products.json (assets.icon).
 *
 * Needs REPLICATE_API_KEY in scripts/.env (or passed as env).
 *
 * Usage:
 *   node scripts/generate-product-icons-flux.js                  # all missing icons
 *   node scripts/generate-product-icons-flux.js --force          # regenerate all
 *   node scripts/generate-product-icons-flux.js --only=airbags   # single product
 *   node scripts/generate-product-icons-flux.js --dry-run        # show prompts only
 *
 * Idempotent: skips products that already have a valid file at
 * assets/products/<slug>.png unless --force is passed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT, 'products.json');
const ASSETS_DIR = path.join(ROOT, 'assets', 'products');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').split('=')[1];

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

const REPLICATE_KEY = process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN;
if (!REPLICATE_KEY && !DRY_RUN) {
  console.error('ERROR: REPLICATE_API_KEY not set in scripts/.env');
  console.error('  Get one at https://replicate.com/account/api-tokens');
  process.exit(1);
}

// ---- prompt engineering ----
// Category accent maps to dominant color. Category also picks a visual motif.
const CATEGORY_PALETTE = {
  plugin:  { dom: 'magenta pink',  accent: 'electric cyan' },
  library: { dom: 'electric cyan', accent: 'mint green' },
  app:     { dom: 'mint green',    accent: 'magenta pink' },
  unsorted:{ dom: 'electric cyan', accent: 'magenta pink' },
};

// Tag-driven visual motifs. Picks the first matching tag.
const TAG_MOTIFS = [
  ['weapons',    'stylized neon gun silhouette, energy muzzle flash'],
  ['explosives', 'abstract detonator with pulsing core, neon radial lines'],
  ['nitro',      'speed lines, glowing exhaust, chrome chevron'],
  ['vehicle',    'low-poly vehicle wireframe in neon outline'],
  ['boat',       'sleek boat hull silhouette, water ripple rings'],
  ['submarine',  'submarine outline, sonar ping rings'],
  ['helicopter', 'helicopter rotor with motion blur, neon tracer'],
  ['plane',      'sharp jet fighter silhouette, slipstream'],
  ['admin',      'minimal shield glyph with scan grid inside'],
  ['monitoring', 'radar sweep with target dot, hud corners'],
  ['discord',    'chat bubble rendered as neon HUD panel'],
  ['raid',       'glowing crosshair over abstract base outline'],
  ['pvp',        'two clashing neon blades, hit spark'],
  ['sharks',     'abstract shark fin silhouette, neon undertow'],
  ['chickens',   'chicken silhouette rendered in pixelated neon'],
  ['bees',       'hexagonal honeycomb grid with glowing cell'],
  ['farming',    'minimal plant sprout glyph with neon outline'],
  ['armor',      'abstract armor plate with energy weave'],
  ['ui',         'stacked HUD panels, scanline pattern'],
  ['backpack',   'compact backpack silhouette with oxygen gauge'],
  ['diving',     'oxygen tank + bubble trail, underwater cyan'],
  ['fire',       'minimal flame icon rendered as cyan plasma'],
  ['loot',       'abstract crate with neon aura lines'],
  ['economy',    'stacked credit chips glowing'],
  ['trading',    'two-way arrow exchange glyph, neon'],
  ['chat',       'speech bubble made of code brackets'],
  ['rcon',       'terminal prompt icon, blinking cursor'],
  ['turrets',    'auto-turret silhouette, targeting line'],
  ['teams',      'three stacked figure silhouettes in neon'],
  ['terrain',    'pickaxe glyph with mineral glow'],
  ['logging',    'abstract log tree / scroll with dashed entries'],
  ['spawn',      'radial spawn-point pattern, concentric rings'],
  ['rss',        'wave-form broadcast icon, neon'],
  ['automation', 'abstract gear + lightning bolt'],
  ['server',     'server rack outline with status LED'],
];

function pickMotif(p) {
  const tags = (p.tags || []).map(t => String(t).toLowerCase());
  for (const [key, motif] of TAG_MOTIFS) {
    if (tags.includes(key)) return motif;
  }
  // Fallback: build motif from the product name
  const nameHint = p.name.replace(/[^a-z ]/gi, ' ').trim();
  return `abstract neon glyph suggesting "${nameHint}"`;
}

function buildPrompt(p) {
  const palette = CATEGORY_PALETTE[p.category] || CATEGORY_PALETTE.plugin;
  const motif = pickMotif(p);
  return [
    'cyberpunk product icon, 512x512 square composition,',
    motif + ',',
    `centered on pure black background,`,
    `dominant ${palette.dom} glow, accent ${palette.accent}, yellow highlight,`,
    'thin neon outline stroke, minimal vector style, sharp edges, high contrast,',
    'subtle scanline texture, film grain, crt monitor vibe,',
    'no typography, no letters, no text, no words, no logo,',
    'professional app icon quality, centered 80% fill, symmetric balance',
  ].join(' ');
}

// ---- Replicate API ----
async function replicateCreate(prompt) {
  const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait=60',
    },
    body: JSON.stringify({
      input: {
        prompt,
        aspect_ratio: '1:1',
        output_format: 'png',
        output_quality: 90,
        num_outputs: 1,
        num_inference_steps: 4,
        go_fast: true,
        disable_safety_checker: false,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Replicate ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function replicateGet(id) {
  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { 'Authorization': `Bearer ${REPLICATE_KEY}` },
  });
  if (!res.ok) throw new Error(`GET prediction ${id} → ${res.status}`);
  return res.json();
}

async function waitForPrediction(id, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = await replicateGet(id);
    if (p.status === 'succeeded') return p;
    if (p.status === 'failed' || p.status === 'canceled') {
      throw new Error(`Prediction ${id} ${p.status}: ${p.error || ''}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Prediction ${id} timed out after ${timeoutMs}ms`);
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

// ---- main ----
(async () => {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const products = manifest.products.filter(p => p.status === 'live');

  const toRun = products.filter(p => {
    if (onlyArg && p.id !== onlyArg) return false;
    const dest = path.join(ASSETS_DIR, `${p.slug}.png`);
    const hasFile = fs.existsSync(dest);
    return FORCE || !hasFile;
  });

  console.log(`\nFLUX Schnell icon generation`);
  console.log(`  total live products:  ${products.length}`);
  console.log(`  to generate:          ${toRun.length}${onlyArg ? ` (only: ${onlyArg})` : ''}`);
  console.log(`  mode:                 ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  if (DRY_RUN) {
    for (const p of toRun) {
      console.log(`[${p.id}]`);
      console.log(`  prompt: ${buildPrompt(p)}\n`);
    }
    return;
  }

  let done = 0, failed = 0;
  for (const p of toRun) {
    const idx = toRun.indexOf(p) + 1;
    const prompt = buildPrompt(p);
    const dest = path.join(ASSETS_DIR, `${p.slug}.png`);
    process.stdout.write(`  [${idx}/${toRun.length}] ${p.id.padEnd(22)} `);
    try {
      const pred = await replicateCreate(prompt);
      // Fast path: Prefer: wait might return finished inline
      let finished = pred;
      if (pred.status !== 'succeeded' && pred.id) {
        finished = await waitForPrediction(pred.id);
      }
      const outputs = Array.isArray(finished.output) ? finished.output : [finished.output];
      const imgUrl = outputs[0];
      if (!imgUrl) throw new Error('no output URL');
      const bytes = await downloadImage(imgUrl, dest);

      // Update products.json
      p.assets = p.assets || {};
      p.assets.icon = `/assets/products/${p.slug}.png`;
      done++;
      console.log(`✓ ${(bytes / 1024).toFixed(0)}kb`);
    } catch (e) {
      failed++;
      console.log(`✗ ${e.message.slice(0, 100)}`);
    }
  }

  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nResult: ${done} generated · ${failed} failed · wrote products.json`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

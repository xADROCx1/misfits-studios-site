#!/usr/bin/env node
/**
 * generate-product-pages.js
 * Reads products.json and emits one /products/<slug>.html per live product.
 * Pure Node.js 18+ (fs + path only). Idempotent — overwrites existing files.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_JSON = path.join(ROOT, 'products.json');
const OUT_DIR = path.join(ROOT, 'products');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const SITE = 'https://misfits-studios.com';
const TODAY = new Date().toISOString().slice(0, 10);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = (s) => esc(s);
const jsonSafe = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

function buyButton(p) {
  const ls = p.lemonsqueezy && p.lemonsqueezy.buy_url;
  const pd = p.paddle && p.paddle.price_id;
  let buy = '';
  if (ls) {
    buy = `<a href="${attr(p.lemonsqueezy.buy_url)}" class="lemonsqueezy-button buy-btn" data-slug="${attr(p.slug)}">BUY ${esc(p.price_label)} →</a>`;
  } else if (pd) {
    const items = JSON.stringify([{ priceId: p.paddle.price_id, quantity: 1 }]);
    buy = `<a href="#" class="paddle_button buy-btn" data-items='${attr(items)}' data-slug="${attr(p.slug)}">BUY ${esc(p.price_label)} →</a>`;
  } else {
    buy = `<span class="buy-btn buy-btn-disabled" aria-disabled="true">Checkout coming soon</span>`;
  }
  // Add to cart button (paid products only; free products skip the cart)
  const cartBtn = (p.price_usd && p.price_usd > 0)
    ? `<button type="button" data-add-to-cart="${attr(p.id)}" class="cart-btn" aria-label="Add ${attr(p.name)} to cart">+ CART</button>`
    : '';
  return `<div class="buy-row">${buy}${cartBtn}</div>`;
}

function relatedCards(current, all) {
  const tags = new Set(current.tags || []);
  const matches = all.filter(x => x.slug !== current.slug && x.status === 'live' && (x.tags || []).some(t => tags.has(t)));
  const picks = matches.slice(0, 3);
  if (!picks.length) return '';
  return `
  <section class="mt-16">
    <p class="ob-data-label mb-3">// related</p>
    <h2 class="msfts-display text-3xl md:text-4xl font-black uppercase mb-6">You_Might_Also_Like</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${picks.map(r => `
      <a href="/products/${attr(r.slug)}.html" class="related-card block">
        <p class="ob-data-label mb-1">// ${esc(r.category || 'plugin')}</p>
        <h3 class="font-headline text-xl font-black uppercase mb-2">${esc(r.name)}</h3>
        <p class="text-sm text-muted mb-3">${esc(r.tagline || '')}</p>
        <span class="font-mono text-xs text-accent">${esc(r.price_label)}  →</span>
      </a>`).join('')}
    </div>
  </section>`;
}

function featuresBlock(p) {
  if (!p.features || !p.features.length) return '';
  return `
  <section class="content-card">
    <h2>Features</h2>
    <ul>${p.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
  </section>`;
}

function longDescBlock(p) {
  if (!p.long_description) return '';
  return `<p class="long-desc">${esc(p.long_description)}</p>`;
}

function tagsChips(p) {
  return (p.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('');
}

function renderPage(p, all) {
  const title = `${p.name} — Misfits Studios`;
  const desc = p.short_description || p.tagline || '';
  const canonical = `${SITE}/products/${p.slug}.html`;
  const ogImage = `${SITE}/NewLogo.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: desc,
    sku: p.id,
    brand: { '@type': 'Brand', name: 'Misfits Studios' },
    category: 'Software > Rust Plugin',
    offers: {
      '@type': 'Offer',
      price: String(p.price_usd ?? 0),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: canonical
    }
  };

  return `<!DOCTYPE html>
<html class="dark" lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}"/>
<link rel="canonical" href="${attr(canonical)}"/>
<link rel="icon" href="/NewLogo.png"/>
<meta property="og:title" content="${attr(title)}"/>
<meta property="og:description" content="${attr(desc)}"/>
<meta property="og:image" content="${attr(ogImage)}"/>
<meta property="og:type" content="product"/>
<meta property="og:url" content="${attr(canonical)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${attr(title)}"/>
<meta name="twitter:description" content="${attr(desc)}"/>
<meta name="twitter:image" content="${attr(ogImage)}"/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@400;500;700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet"/>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="/assets/theme.css"/>
<script src="/assets/analytics.js" defer></script>
<script src="/assets/theme.js" defer></script>
<script src="/assets/boot-sequence.js" defer></script>
<script src="/assets/cart.js" defer></script>
<script src="https://app.lemonsqueezy.com/js/lemon.js" defer></script>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js" defer></script>
<script>
  tailwind.config = {
    darkMode: "class",
    theme: { extend: {
      colors: { "bg":"#060e20","surface":"#091328","surface-hi":"#141f38","paper":"#dee5ff","muted":"#a3aac4","primary":"#cc97ff","accent":"#53ddfc","tertiary":"#ff86c3" },
      borderRadius: { DEFAULT:"0.125rem", sm:"0.125rem", md:"0.375rem", lg:"0.5rem" },
      fontFamily: { headline:["Space Grotesk","sans-serif"], body:["Inter","sans-serif"], mono:["JetBrains Mono","monospace"] }
    }}
  };
</script>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
  html, body { background:#060e20; color:#dee5ff; }
  .ob-data-label { font-family:'Space Grotesk',sans-serif; text-transform:uppercase; letter-spacing:.25em; font-size:10px; color:#a3aac4; }
  .content-card { background:#091328; border-left:4px solid #cc97ff; padding:24px 28px; margin-bottom:20px; }
  .content-card h2 { font-family:'Space Grotesk',sans-serif; font-size:22px; font-weight:900; color:#dee5ff; text-transform:uppercase; letter-spacing:.05em; margin-bottom:10px; }
  .content-card p, .content-card li { font-size:14px; line-height:1.7; color:rgba(222,229,255,.88); }
  .content-card ul { list-style:disc; padding-left:22px; margin:8px 0; }
  .content-card a { color:#53ddfc; text-decoration:underline; text-underline-offset:3px; }
  .content-card a:hover { color:#cc97ff; }
  .hero-card { background:linear-gradient(135deg,#091328 0%,#141f38 100%); border-left:6px solid #ff86c3; padding:40px 36px; margin-bottom:28px; position:relative; overflow:hidden; }
  .hero-card::after { content:''; position:absolute; right:-60px; top:-60px; width:200px; height:200px; background:radial-gradient(circle,#cc97ff33 0%,transparent 70%); pointer-events:none; }
  .chip { display:inline-block; padding:4px 10px; margin:0 6px 6px 0; background:#141f38; border:1px solid #141f38; border-radius:2px; font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:#a3aac4; }
  .chip-accent { color:#53ddfc; border-color:#53ddfc55; }
  .chip-tertiary { color:#ff86c3; border-color:#ff86c355; }
  .price-huge { font-family:'Space Grotesk',sans-serif; font-weight:900; font-size:72px; line-height:1; color:#cc97ff; text-shadow:0 0 24px #cc97ff55; }
  .buy-row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:18px; }
  .buy-btn { display:inline-block; padding:16px 32px; background:#53ddfc; color:#060e20; font-family:'Space Grotesk',sans-serif; font-weight:900; text-transform:uppercase; letter-spacing:.15em; font-size:14px; border:0; cursor:pointer; transition:all .2s; }
  .buy-btn:hover { background:#cc97ff; color:#060e20; transform:translate(-2px,-2px); box-shadow:4px 4px 0 #ff86c3; }
  .buy-btn-disabled { background:#141f38; color:#a3aac4; cursor:not-allowed; }
  .buy-btn-disabled:hover { background:#141f38; color:#a3aac4; transform:none; box-shadow:none; }
  .cart-btn { padding:16px 22px; background:transparent; border:2px solid #00ffa3; color:#00ffa3; font-family:'Space Grotesk',sans-serif; font-weight:900; text-transform:uppercase; letter-spacing:.1em; font-size:14px; cursor:pointer; transition:all .2s; }
  .cart-btn:hover { background:#00ffa3; color:#060e20; box-shadow:0 0 24px rgba(0,255,163,.5); transform:translateY(-1px); }
  .long-desc { font-size:16px; line-height:1.8; color:rgba(222,229,255,.92); margin-top:14px; }
  .related-card { background:#091328; border-left:3px solid #53ddfc; padding:18px 20px; transition:all .2s; text-decoration:none; }
  .related-card:hover { border-left-color:#ff86c3; background:#141f38; transform:translate(-2px,-2px); }
  .tech-row { display:flex; justify-content:space-between; border-bottom:1px dashed #141f38; padding:10px 0; font-size:13px; }
  .tech-row .k { font-family:'Space Grotesk',sans-serif; text-transform:uppercase; letter-spacing:.15em; color:#a3aac4; font-size:11px; }
  .tech-row .v { font-family:'JetBrains Mono',monospace; color:#dee5ff; }
  .back-link { font-family:'JetBrains Mono',monospace; font-size:12px; color:#a3aac4; text-transform:uppercase; letter-spacing:.2em; }
  .back-link:hover { color:#53ddfc; }
</style>
</head>
<body class="bg-bg text-paper font-body">

<header class="sticky top-0 z-40 bg-bg/95 backdrop-blur border-b border-surface-hi">
  <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
    <a href="/index.html" class="flex items-center gap-3">
      <img src="/NewLogo.png" alt="Misfits Studios" class="h-10 w-auto object-contain" onerror="this.style.display='none'"/>
      <span class="font-headline text-lg font-black tracking-tight">MISFITS_STUDIOS</span>
    </a>
    <nav class="hidden md:flex items-center gap-8 text-sm font-headline tracking-widest">
      <a class="text-muted hover:text-accent transition-all" href="/index.html">HOME</a>
      <a class="text-primary border-b-2 border-primary pb-1" href="/plugins.html">PLUGINS</a>
      <a class="text-muted hover:text-accent transition-all" href="/apps.html">APPS</a>
      <a class="text-muted hover:text-accent transition-all" href="/about.html">ABOUT</a>
      <a class="text-muted hover:text-accent transition-all" href="/support.html">SUPPORT</a>
      <a class="text-muted hover:text-accent transition-all" href="/terms.html">LEGAL</a>
    </nav>
  </div>
</header>

<main class="max-w-5xl mx-auto px-6 py-12">

  <!-- Hidden JSON blob for cart.js to resolve this product -->
  <script type="application/json" data-product-manifest="${attr(p.id)}" data-product-json='${attr(JSON.stringify({
    id: p.id, slug: p.slug, name: p.name, category: p.category,
    price_usd: p.price_usd, price_label: p.price_label,
    paddle: p.paddle || null, lemonsqueezy: p.lemonsqueezy || null,
  }))}'>product-manifest</script>

  <a href="/plugins.html" class="back-link">[ ← back to plugins ]</a>

  <section class="hero-card msfts-hud-4 mt-4">
    <p class="ob-data-label mb-2">// ${esc(p.category || 'plugin')}  ·  v${esc(p.version)}</p>
    <h1 class="msfts-display msfts-glow-mint text-5xl md:text-7xl font-black uppercase mb-3">${esc(p.name)}</h1>
    <p class="text-lg md:text-xl text-paper/90 mb-5">${esc(p.tagline || '')}</p>
    <div class="mb-5">
      <span class="msfts-chip msfts-chip--live">v${esc(p.version)}</span>
      <span class="msfts-chip msfts-chip--punk">${esc(p.category || 'plugin')}</span>
      ${(p.tags || []).slice(0, 4).map(t => `<span class="msfts-chip msfts-chip--cool">${esc(t)}</span>`).join('')}
    </div>
    <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mt-8">
      <div>
        <p class="ob-data-label mb-1">// price</p>
        <p class="price-huge">${esc(p.price_label)}</p>
      </div>
      <div>${buyButton(p)}</div>
    </div>
  </section>

  <section class="content-card">
    <h2>Overview</h2>
    <p style="font-size:16px; color:#dee5ff;">${esc(p.short_description || '')}</p>
    ${longDescBlock(p)}
  </section>

  ${featuresBlock(p)}

  <section class="content-card">
    <h2>What you get</h2>
    <ul>
      <li>The <code class="font-mono text-accent">${esc(p.name)}.cs</code> plugin file, ready to drop into <code class="font-mono">oxide/plugins/</code> or <code class="font-mono">carbon/plugins/</code>.</li>
      <li>Lifetime updates — every future version, free.</li>
      <li>Discord support from the Misfits Studios community.</li>
      <li>Per-server license — install on all the servers you run.</li>
    </ul>
  </section>

  <section class="content-card">
    <h2>Technical details</h2>
    <div class="tech-row"><span class="k">ID</span><span class="v">${esc(p.id)}</span></div>
    <div class="tech-row"><span class="k">Slug</span><span class="v">${esc(p.slug)}</span></div>
    <div class="tech-row"><span class="k">Version</span><span class="v">${esc(p.version)}</span></div>
    <div class="tech-row"><span class="k">Category</span><span class="v">${esc(p.category || 'plugin')}</span></div>
    <div class="tech-row"><span class="k">Author</span><span class="v">${esc(p.cs_info_author || 'Misfits Studios')}</span></div>
    <div class="tech-row"><span class="k">Tags</span><span class="v">${(p.tags || []).join(', ') || '—'}</span></div>
  </section>

  ${relatedCards(p, all)}

</main>

<footer class="bg-ink px-6 py-12 border-t border-surface-hi mt-12">
  <div class="max-w-7xl mx-auto text-center text-xs text-muted font-mono tracking-widest uppercase">
    © 2026 Misfits Studios · <a href="/terms.html" class="hover:text-accent">Terms</a> · <a href="/privacy.html" class="hover:text-accent">Privacy</a> · <a href="/refund.html" class="hover:text-accent">Refund</a>
  </div>
</footer>

<script>
  // Paddle init — no-op if token isn't set on the window.
  (function () {
    if (window.Paddle && typeof window.Paddle.Initialize === 'function' && window.__misfits_paddle_token) {
      try { window.Paddle.Initialize({ token: window.__misfits_paddle_token }); } catch (e) { console.warn('Paddle init failed', e); }
    } else if (window.__misfits_paddle_token) {
      // Paddle script loads async — retry once it's ready.
      document.addEventListener('DOMContentLoaded', function () {
        if (window.Paddle && window.Paddle.Initialize) {
          try { window.Paddle.Initialize({ token: window.__misfits_paddle_token }); } catch (e) {}
        }
      });
    }
  })();
</script>

</body>
</html>
`;
}

function updateSitemap(products) {
  if (!fs.existsSync(SITEMAP_PATH)) return;
  const existing = fs.readFileSync(SITEMAP_PATH, 'utf8');
  // Strip any existing product entries (so re-runs don't duplicate).
  const stripped = existing.replace(/\s*<url>\s*<loc>[^<]*\/products\/[^<]+<\/loc>[\s\S]*?<\/url>/g, '');
  const entries = products.map(p => `  <url>
    <loc>${SITE}/products/${p.slug}.html</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');
  const updated = stripped.replace('</urlset>', entries + '\n</urlset>');
  fs.writeFileSync(SITEMAP_PATH, updated);
}

function main() {
  const raw = fs.readFileSync(PRODUCTS_JSON, 'utf8');
  const data = JSON.parse(raw);
  const products = (data.products || []);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const live = products.filter(p => p.status === 'live');
  const skipped = products.filter(p => p.status !== 'live').map(p => ({ slug: p.slug, reason: `status=${p.status || 'missing'}` }));

  let totalBytes = 0;
  let count = 0;
  for (const p of live) {
    const html = renderPage(p, live);
    const out = path.join(OUT_DIR, `${p.slug}.html`);
    fs.writeFileSync(out, html);
    totalBytes += Buffer.byteLength(html, 'utf8');
    count++;
  }

  updateSitemap(live);

  const sizeKB = (totalBytes / 1024).toFixed(1);
  console.log(`Generated ${count} product pages (${sizeKB} KB total).`);
  console.log(`Sample URL: products/${live[0] ? live[0].slug : 'none'}.html`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    skipped.forEach(s => console.log(`  - ${s.slug}: ${s.reason}`));
  } else {
    console.log('Skipped: 0');
  }
  console.log(`Sitemap updated: ${SITEMAP_PATH}`);
}

main();

/* Misfits Studios storefront — product loader + Lemon Squeezy overlay wiring
 *
 * What it does:
 *   1. Fetches products.json (single source of truth)
 *   2. Renders cards into any <div id="product-grid" data-category="plugin|app|all"> element on the page
 *   3. Wires BUY buttons to Lemon Squeezy overlay checkout via class="lemonsqueezy-button"
 *
 * Editing products = edit products.json (or run scripts/sync-from-lemonsqueezy.js to pull from LS API).
 */
(function () {
  'use strict';

  var PRODUCTS_URL = 'products.json';

  function fmtPrice(p) {
    if (p.price_label) return p.price_label;
    if (p.price_usd === 0) return 'FREE';
    return '$' + Number(p.price_usd).toFixed(2);
  }

  function cardHTML(p) {
    // Prefer Paddle if wired; fall back to Lemon Squeezy. Cards render regardless.
    var paddlePriceId = p.paddle && p.paddle.price_id;
    var paddleUrl = p.paddle && p.paddle.checkout_url;
    var lsUrl = p.lemonsqueezy && p.lemonsqueezy.buy_url;
    var hasBuyUrl = !!(paddleUrl || lsUrl);
    var isPaddle = !!paddleUrl;

    // Paddle.js attaches to class="paddle_button" with data-items; Lemon.js attaches to class="lemonsqueezy-button" with href.
    var classAttr, dataAttr = '', href;
    if (isPaddle) {
      classAttr = 'paddle_button';
      dataAttr = ' data-display-mode="overlay" data-items=\'' + JSON.stringify([{ priceId: paddlePriceId, quantity: 1 }]).replace(/'/g, '&#39;') + '\'';
      href = paddleUrl;
    } else {
      classAttr = (p.lemonsqueezy && p.lemonsqueezy.overlay_enabled !== false) ? 'lemonsqueezy-button' : '';
      href = lsUrl || '#';
    }

    var cta = p.price_usd === 0 ? 'DOWNLOAD →' : 'BUY →';
    var disabledNote = hasBuyUrl ? '' : '<div class="text-xs text-muted mt-2 font-mono uppercase tracking-wider">Checkout wiring pending</div>';

    return (
      '<article class="bg-surface p-6 flex flex-col gap-3" data-product-id="' + p.id + '">' +
        '<div class="flex items-start justify-between gap-4">' +
          '<div>' +
            '<h3 class="font-headline text-2xl font-black text-paper">' + escapeHTML(p.name) + '</h3>' +
            '<div class="ob-data-label mt-1">v' + escapeHTML(p.version) + ' · ' + escapeHTML(p.category.toUpperCase()) + '</div>' +
          '</div>' +
          '<span class="ob-chip">' + escapeHTML(p.status.toUpperCase()) + '</span>' +
        '</div>' +
        '<p class="font-body text-paper/80 text-sm">' + escapeHTML(p.short_description) + '</p>' +
        (p.features && p.features.length ? (
          '<ul class="text-xs text-muted font-mono space-y-1 mt-1">' +
            p.features.slice(0, 4).map(function (f) {
              return '<li>▸ ' + escapeHTML(f) + '</li>';
            }).join('') +
          '</ul>'
        ) : '') +
        '<div class="flex items-center justify-between mt-auto pt-4 border-t border-surface-hi">' +
          '<div class="font-headline text-3xl font-black text-accent neon-green-glow">' + fmtPrice(p) + '</div>' +
          '<a class="' + classAttr + ' bg-primary text-bg border-2 border-primary font-black px-5 py-2 hover:bg-accent hover:border-accent active:translate-y-1 text-sm" href="' + href + '"' + dataAttr + '>' + cta + '</a>' +
        '</div>' +
        disabledNote +
      '</article>'
    );
  }

  function escapeHTML(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function renderInto(container, products) {
    var cat = container.getAttribute('data-category') || 'all';
    var filtered = cat === 'all' ? products : products.filter(function (p) { return p.category === cat; });
    container.innerHTML = filtered.map(cardHTML).join('');
    // Re-initialize Lemon.js in case it loaded before our buttons rendered.
    if (window.createLemonSqueezy) { window.createLemonSqueezy(); }
    // Re-scan for Paddle.js buttons. Paddle auto-scans on init, but we re-render cards after fetch.
    if (window.Paddle && typeof window.Paddle.Initialize === 'function' && window.__misfits_paddle_token && !window.__misfits_paddle_init) {
      try { window.Paddle.Initialize({ token: window.__misfits_paddle_token }); window.__misfits_paddle_init = true; } catch (_) {}
    }
  }

  function load() {
    return fetch(PRODUCTS_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('products.json fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var grids = document.querySelectorAll('[id="product-grid"], .product-grid');
        grids.forEach(function (el) { renderInto(el, data.products || []); });
        // Also expose the manifest for other scripts.
        window.MisfitsProducts = data;
        document.dispatchEvent(new CustomEvent('misfits:products-loaded', { detail: data }));
      })
      .catch(function (err) {
        console.error('[Misfits] product manifest failed to load:', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();

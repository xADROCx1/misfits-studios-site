/* ============================================================================
 * SHADOW KIDS STUDIOS — Shopping Cart
 * ----------------------------------------------------------------------------
 * Client-side cart with localStorage persistence, slide-in drawer UI,
 * and Paddle / Lemon Squeezy checkout integration.
 *
 * Public API (window.MisfitsCart):
 *   .add(product)         — add a product (product = entry from products.json)
 *   .remove(id)           — remove by product id
 *   .clear()              — empty the cart
 *   .items()              — current items array
 *   .count()              — item count
 *   .total()              — USD subtotal (float)
 *   .open()               — open the drawer
 *   .close()              — close the drawer
 *   .checkout()           — start checkout (Paddle multi-item or LS per-item)
 *
 * Events fired on document:
 *   misfits:cart-changed  — detail: { items, count, total }
 *   misfits:cart-opened
 *   misfits:cart-closed
 * ============================================================================ */

(function () {
  'use strict';

  var STORAGE_KEY = 'misfits_cart_v1';

  // --- State ---
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }
  function save(items) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (_) {}
  }

  var items = load();

  function notify() {
    document.dispatchEvent(new CustomEvent('misfits:cart-changed', {
      detail: { items: items.slice(), count: count(), total: total() },
    }));
    render();
  }

  function add(p) {
    if (!p || !p.id) return;
    if (items.some(function (i) { return i.id === p.id; })) {
      pulseIcon();
      return; // already in cart
    }
    items.push({
      id: p.id,
      slug: p.slug || p.id,
      name: p.name,
      price_usd: Number(p.price_usd || 0),
      price_label: p.price_label || ('$' + (p.price_usd || 0).toFixed(2)),
      paddle_price_id: p.paddle && p.paddle.price_id,
      paddle_checkout_url: p.paddle && p.paddle.checkout_url,
      lemonsqueezy_buy_url: p.lemonsqueezy && p.lemonsqueezy.buy_url,
      category: p.category || 'plugin',
    });
    save(items);
    notify();
    pulseIcon();
    toast('Added: ' + p.name);
  }

  function remove(id) {
    items = items.filter(function (i) { return i.id !== id; });
    save(items);
    notify();
  }

  function clear() { items = []; save(items); notify(); }
  function count() { return items.length; }
  function total() { return items.reduce(function (a, i) { return a + i.price_usd; }, 0); }

  // --- Checkout ---
  function ensurePaddleInitialized() {
    // store.js initializes Paddle after products.json loads, but pages without
    // store.js (legal pages, product detail pages without a grid) still need
    // Paddle.Initialize before Checkout.open works. Idempotent — guarded by
    // window.__misfits_paddle_init.
    //
    // Token format guard: Paddle Billing v2 client-side tokens must start with
    // `live_pct_` or `test_pct_`. Anything else (legacy / API key / mistake)
    // makes Initialize() pop the SDK error overlay on every page load.
    // Skip silently in that case — checkout will fall back to LS / toast.
    if (window.__misfits_paddle_init) return true;
    if (!(window.Paddle && typeof window.Paddle.Initialize === 'function')) return false;
    var t = window.__sks_paddle_token;
    // Paddle Billing v2 client-side tokens have shape `live_<alphanumeric>`
    // (sometimes `live_apikey_<id>_<secret>` for longer ones). Loose prefix
    // check; if Initialize still throws, the user has a deeper Paddle dashboard
    // configuration problem (e.g. the site domain isn't in Approved domains).
    if (!t || !/^(live|test)_[A-Za-z0-9_-]{8,}$/.test(t)) return false;
    try {
      window.Paddle.Initialize({ token: t });
      window.__misfits_paddle_init = true;
      return true;
    } catch (e) { console.warn('Paddle init from cart failed:', e); return false; }
  }

  function checkout() {
    if (!items.length) { toast('Cart is empty.'); return; }

    // Pure Paddle flow — only when Initialize succeeded. ensurePaddleInitialized()
    // returns false if the client-side token isn't a valid v2 format, in which
    // case we MUST skip Paddle entirely — calling Checkout.open without a
    // successful Initialize pops the SDK error overlay.
    var allPaddle = items.every(function (i) { return !!i.paddle_price_id; });
    var paddleReady = ensurePaddleInitialized();
    if (paddleReady && allPaddle && window.Paddle && window.Paddle.Checkout) {
      try {
        window.Paddle.Checkout.open({
          items: items.map(function (i) { return { priceId: i.paddle_price_id, quantity: 1 }; }),
        });
        return;
      } catch (e) { console.warn('Paddle checkout failed:', e); }
    }

    // Fallback: open Lemon Squeezy overlay for first item, inform user about the others.
    var firstLS = items.find(function (i) { return i.lemonsqueezy_buy_url; });
    if (firstLS && window.createLemonSqueezy) {
      if (items.length > 1) {
        toast('Checkout supports one item at a time for now. Starting with "' + firstLS.name + '".');
      }
      window.location.href = firstLS.lemonsqueezy_buy_url;
      return;
    }

    // No integration wired yet — show a useful message.
    toast('Checkout not wired yet. Email misfits.support@proton.me to complete the order.');
  }

  // ==========================================================================
  // UI — drawer + nav trigger + toast
  // ==========================================================================

  function injectStyles() {
    if (document.getElementById('misfits-cart-style')) return;
    var css = [
      '#misfits-cart-trigger{display:inline-flex;align-items:center;gap:10px;padding:14px 20px;background:rgba(0,255,163,0.12);border:2px solid #00ffa3;color:#00ffa3;font-family:"Rubik Mono One",sans-serif;font-size:15px;letter-spacing:.05em;text-decoration:none;cursor:pointer;transition:all .2s ease;box-shadow:0 0 18px rgba(0,255,163,.35);position:relative}',
      '#misfits-cart-trigger:hover{background:rgba(0,255,163,.25);box-shadow:0 0 28px rgba(0,255,163,.6);transform:translateY(-1px)}',
      '#misfits-cart-trigger .count-badge{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;background:#000;color:#00ffa3;border:1px solid #00ffa3;border-radius:999px;font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;line-height:1}',
      '#misfits-cart-trigger.empty .count-badge{opacity:.35}',
      '#misfits-cart-trigger.pulse{animation:misfits-cart-pulse .5s ease}',
      '@keyframes misfits-cart-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15);box-shadow:0 0 40px rgba(0,255,163,1)}}',

      '#misfits-cart-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:100000;opacity:0;pointer-events:none;transition:opacity .25s ease}',
      '#misfits-cart-backdrop.open{opacity:1;pointer-events:auto}',

      '#misfits-cart-drawer{position:fixed;top:0;right:-520px;bottom:0;width:min(520px,92vw);background:#02020a;color:#f0f7ff;z-index:100001;display:flex;flex-direction:column;border-left:2px solid #00ffa3;box-shadow:-20px 0 60px rgba(0,255,163,.2);transition:right .3s cubic-bezier(.2,.9,.3,1);font-family:"Inter",sans-serif}',
      '#misfits-cart-drawer.open{right:0}',

      '#misfits-cart-drawer .cart-head{padding:24px 28px;border-bottom:1px solid rgba(0,255,163,.25);display:flex;justify-content:space-between;align-items:center;gap:12px;background:linear-gradient(180deg,rgba(0,255,163,.08),transparent)}',
      '#misfits-cart-drawer .cart-head h2{margin:0;font-family:"Rubik Mono One",sans-serif;font-size:26px;letter-spacing:-.02em;color:#00ffa3;text-shadow:0 0 12px rgba(0,255,163,.5)}',
      '#misfits-cart-drawer .cart-head .cart-close{background:transparent;border:1px solid rgba(240,247,255,.25);color:#f0f7ff;padding:8px 14px;font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.15em;cursor:pointer;transition:all .2s ease}',
      '#misfits-cart-drawer .cart-head .cart-close:hover{border-color:#ff1a8f;color:#ff1a8f}',

      '#misfits-cart-drawer .cart-body{flex:1;overflow-y:auto;padding:16px 20px}',

      '#misfits-cart-drawer .cart-empty{padding:60px 24px;text-align:center;color:#8c95a8;font-family:"JetBrains Mono",monospace;font-size:14px;letter-spacing:.1em}',
      '#misfits-cart-drawer .cart-empty strong{display:block;font-size:18px;color:#f0f7ff;margin-bottom:8px;font-family:"Rubik Mono One",sans-serif}',

      '#misfits-cart-drawer .cart-item{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:center;padding:16px 12px;border-bottom:1px dashed rgba(0,242,255,.15)}',
      '#misfits-cart-drawer .cart-item:last-child{border-bottom:none}',
      '#misfits-cart-drawer .cart-item .name{font-family:"Rubik Mono One",sans-serif;font-size:17px;color:#f0f7ff;letter-spacing:-.01em;line-height:1.15}',
      '#misfits-cart-drawer .cart-item .meta{display:block;margin-top:4px;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#8c95a8}',
      '#misfits-cart-drawer .cart-item .price{font-family:"Rubik Mono One",sans-serif;font-size:17px;color:#00ffa3;white-space:nowrap}',
      '#misfits-cart-drawer .cart-item .remove{background:transparent;border:1px solid rgba(255,26,143,.45);color:#ff1a8f;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-size:16px;line-height:1;transition:all .2s ease}',
      '#misfits-cart-drawer .cart-item .remove:hover{background:rgba(255,26,143,.15);border-color:#ff1a8f}',

      '#misfits-cart-drawer .cart-foot{padding:20px 28px;border-top:2px solid #00ffa3;background:rgba(0,0,0,.6);display:flex;flex-direction:column;gap:14px}',
      '#misfits-cart-drawer .cart-row{display:flex;justify-content:space-between;align-items:center;font-family:"JetBrains Mono",monospace;font-size:13px;letter-spacing:.15em;text-transform:uppercase;color:#8c95a8}',
      '#misfits-cart-drawer .cart-row.subtotal{color:#f0f7ff;font-size:14px;padding-top:2px}',
      '#misfits-cart-drawer .cart-row .v{font-family:"Rubik Mono One",sans-serif;font-size:22px;color:#00ffa3;text-shadow:0 0 14px rgba(0,255,163,.5)}',
      '#misfits-cart-drawer .checkout-btn{display:flex;align-items:center;justify-content:center;gap:10px;padding:20px;background:#00ffa3;color:#000;border:none;font-family:"Rubik Mono One",sans-serif;font-size:18px;letter-spacing:.08em;cursor:pointer;text-decoration:none;box-shadow:0 0 30px rgba(0,255,163,.6);transition:all .2s ease;animation:misfits-cart-breathe 2.4s ease-in-out infinite}',
      '#misfits-cart-drawer .checkout-btn:hover{background:#ff1a8f;color:#000;box-shadow:0 0 50px rgba(255,26,143,.7);transform:translateY(-2px)}',
      '#misfits-cart-drawer .checkout-btn:disabled{background:#1a1a1a;color:#8c95a8;cursor:not-allowed;box-shadow:none;animation:none}',
      '@keyframes misfits-cart-breathe{0%,100%{box-shadow:0 0 22px rgba(0,255,163,.5)}50%{box-shadow:0 0 44px rgba(0,255,163,.9)}}',
      '#misfits-cart-drawer .cart-note{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.15em;color:#8c95a8;text-align:center;margin:0}',

      '#misfits-toast{position:fixed;bottom:28px;right:28px;background:#02020a;border:2px solid #00ffa3;color:#f0f7ff;padding:14px 20px;font-family:"JetBrains Mono",monospace;font-size:13px;letter-spacing:.1em;z-index:100002;opacity:0;transform:translateY(20px);transition:all .25s ease;pointer-events:none;box-shadow:0 0 28px rgba(0,255,163,.4);max-width:360px}',
      '#misfits-toast.show{opacity:1;transform:translateY(0)}',
      '#misfits-toast::before{content:"▸ ";color:#00ffa3;font-weight:700}',

      '@media (max-width:640px){#misfits-cart-trigger{padding:10px 14px;font-size:13px}}',
      '@media (prefers-reduced-motion: reduce){#misfits-cart-drawer,#misfits-cart-backdrop,#misfits-cart-trigger,#misfits-cart-drawer .checkout-btn{transition:none!important;animation:none!important}}',
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'misfits-cart-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function render() {
    // Badge in nav trigger
    var trig = document.getElementById('misfits-cart-trigger');
    if (trig) {
      var badge = trig.querySelector('.count-badge');
      if (badge) badge.textContent = String(count());
      trig.classList.toggle('empty', count() === 0);
    }

    // Drawer body
    var body = document.querySelector('#misfits-cart-drawer .cart-body');
    if (!body) return;

    if (!items.length) {
      body.innerHTML = '<div class="cart-empty"><strong>CART_EMPTY</strong>// nothing_staged_for_uplink</div>';
    } else {
      body.innerHTML = items.map(function (i) {
        return (
          '<div class="cart-item" data-id="' + escapeHTML(i.id) + '">' +
            '<div>' +
              '<div class="name">' + escapeHTML(i.name) + '</div>' +
              '<span class="meta">' + escapeHTML(i.category) + ' · ' + escapeHTML(i.id) + '</span>' +
            '</div>' +
            '<div class="price">' + escapeHTML(i.price_label || ('$' + i.price_usd.toFixed(2))) + '</div>' +
            '<button class="remove" aria-label="Remove ' + escapeHTML(i.name) + '" data-remove="' + escapeHTML(i.id) + '">×</button>' +
          '</div>'
        );
      }).join('');
    }

    // Footer totals
    var subEl = document.querySelector('#misfits-cart-drawer .subtotal .v');
    if (subEl) subEl.textContent = '$' + total().toFixed(2);

    var countEl = document.querySelector('#misfits-cart-drawer .count-line .v');
    if (countEl) countEl.textContent = String(count()).padStart(2, '0');

    var checkoutBtn = document.querySelector('#misfits-cart-drawer .checkout-btn');
    if (checkoutBtn) checkoutBtn.disabled = (count() === 0);
  }

  function buildTrigger() {
    // Inject trigger into v5-nav if present; else append a floating button
    if (document.getElementById('misfits-cart-trigger')) return;

    var trigger = document.createElement('a');
    trigger.id = 'misfits-cart-trigger';
    trigger.href = '#cart';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', 'Open shopping cart');
    trigger.className = count() === 0 ? 'empty' : '';
    trigger.innerHTML = '<span aria-hidden="true">⛊</span> CART <span class="count-badge">' + count() + '</span>';
    trigger.addEventListener('click', function (e) { e.preventDefault(); open(); });

    var navList = document.querySelector('.v5-nav-list');
    if (navList) {
      var li = document.createElement('li');
      li.appendChild(trigger);
      navList.appendChild(li);
    } else {
      // Floating fallback — bottom-right on pages without V5 nav
      trigger.style.position = 'fixed';
      trigger.style.bottom = '24px';
      trigger.style.right = '24px';
      trigger.style.zIndex = '99999';
      document.body.appendChild(trigger);
    }
  }

  function buildDrawer() {
    if (document.getElementById('misfits-cart-drawer')) return;

    var backdrop = document.createElement('div');
    backdrop.id = 'misfits-cart-backdrop';
    backdrop.addEventListener('click', close);
    document.body.appendChild(backdrop);

    var drawer = document.createElement('aside');
    drawer.id = 'misfits-cart-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Shopping cart');
    drawer.innerHTML = [
      '<div class="cart-head">',
        '<h2>▸ YOUR_BAG</h2>',
        '<button class="cart-close" aria-label="Close cart">[ CLOSE ]</button>',
      '</div>',
      '<div class="cart-body"></div>',
      '<div class="cart-foot">',
        '<div class="cart-row count-line"><span>▸ ITEMS</span><span class="v" style="font-size:14px;color:#f0f7ff;">00</span></div>',
        '<div class="cart-row subtotal"><span>▸ SUBTOTAL</span><span class="v">$0.00</span></div>',
        '<button class="checkout-btn" type="button">▸ CHECKOUT</button>',
        '<p class="cart-note">// digital goods · secure checkout via Lemon Squeezy / Paddle</p>',
      '</div>',
    ].join('');
    document.body.appendChild(drawer);

    drawer.querySelector('.cart-close').addEventListener('click', close);
    drawer.querySelector('.checkout-btn').addEventListener('click', checkout);

    drawer.addEventListener('click', function (e) {
      var rem = e.target.closest('[data-remove]');
      if (rem) remove(rem.getAttribute('data-remove'));
    });

    // ESC closes drawer
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    });
  }

  function open() {
    var d = document.getElementById('misfits-cart-drawer');
    var b = document.getElementById('misfits-cart-backdrop');
    if (!d || !b) return;
    d.classList.add('open');
    b.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.dispatchEvent(new CustomEvent('misfits:cart-opened'));
  }
  function close() {
    var d = document.getElementById('misfits-cart-drawer');
    var b = document.getElementById('misfits-cart-backdrop');
    if (!d || !b) return;
    d.classList.remove('open');
    b.classList.remove('open');
    document.body.style.overflow = '';
    document.dispatchEvent(new CustomEvent('misfits:cart-closed'));
  }

  function pulseIcon() {
    var trig = document.getElementById('misfits-cart-trigger');
    if (!trig) return;
    trig.classList.remove('pulse');
    void trig.offsetWidth; // reflow to restart animation
    trig.classList.add('pulse');
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('misfits-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'misfits-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function init() {
    injectStyles();
    buildTrigger();
    buildDrawer();
    render();

    // Delegate: any element with [data-add-to-cart] adds the product by id
    document.addEventListener('click', function (e) {
      var addBtn = e.target.closest('[data-add-to-cart]');
      if (!addBtn) return;
      e.preventDefault();
      var productId = addBtn.getAttribute('data-add-to-cart');
      var product = findProduct(productId);
      if (product) add(product);
      else toast('Product not found: ' + productId);
    });

    // Paddle-button fallback: when Paddle isn't initialized (no valid v2 token),
    // intercept .paddle_button clicks BEFORE the browser navigates to the
    // checkout_url href. Without this, clicks fall through to
    // shadowkidsstudios.com/?_ptxn=<stale-txn-id> which triggers Paddle's
    // "Something went wrong" overlay on the home page. Add the product to
    // the cart instead and toast a clear status.
    document.addEventListener('click', function (e) {
      var paddleBtn = e.target.closest('.paddle_button');
      if (!paddleBtn) return;
      // If Paddle Initialize succeeded, let Paddle's own handler run.
      if (window.__misfits_paddle_init) return;
      e.preventDefault();
      e.stopPropagation();
      var slug = paddleBtn.getAttribute('data-slug') || paddleBtn.getAttribute('data-product-id');
      var product = slug ? findProduct(slug) : null;
      // Try to derive product from data-items priceId if no slug
      if (!product) {
        try {
          var items = JSON.parse(paddleBtn.getAttribute('data-items') || '[]');
          if (items[0] && items[0].priceId && window.MisfitsProducts) {
            product = (window.MisfitsProducts.products || []).find(function (p) {
              return p.paddle && p.paddle.price_id === items[0].priceId;
            });
          }
        } catch (_) {}
      }
      if (product) {
        add(product);
        open();
      } else {
        toast('Checkout is being configured — please try again shortly.');
      }
    }, true);
  }

  function findProduct(id) {
    // Try window.MisfitsProducts first (loaded by store.js)
    if (window.MisfitsProducts && Array.isArray(window.MisfitsProducts.products)) {
      return window.MisfitsProducts.products.find(function (p) { return p.id === id; });
    }
    // Fallback: scrape from DOM data attributes on the current page
    var el = document.querySelector('[data-product-manifest="' + id + '"]');
    if (el) {
      try { return JSON.parse(el.getAttribute('data-product-json')); } catch (_) {}
    }
    return null;
  }

  // Public API
  window.MisfitsCart = {
    add: add, remove: remove, clear: clear,
    items: function () { return items.slice(); },
    count: count, total: total,
    open: open, close: close, checkout: checkout,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

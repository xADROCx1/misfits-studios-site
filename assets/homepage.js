/*
 * Misfits Studios — Homepage Content Renderer
 *
 * Reads data.homepage from /products.json (or window.MisfitsProducts if already
 * loaded by assets/store.js) and applies editable text to DOM elements via
 * data-hp="key.path" attributes.
 *
 * First paint uses the hardcoded HTML fallback text; this script swaps it in
 * after fetch. If homepage{} is missing or a field is empty, the hardcoded
 * text remains.
 *
 * Wave 2 — extracted by admin editor Homepage view. Safe to include with
 * `defer` on any page, but it only does work if it finds elements with
 * `data-hp` attributes.
 */
(function () {
  'use strict';

  var PRODUCTS_URL = '/products.json';

  // Walk `obj` by dot-path "a.b.c" or "a.0" (array index). Returns undefined if
  // any segment is missing. Works on primitives — returns the value.
  function getByPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // Apply a single text value to an element, preserving whitespace. Leaves
  // element alone if val is nullish / empty string — hardcoded fallback wins.
  function applyText(el, val) {
    if (val == null) return;
    var s = String(val);
    if (!s.length) return;
    el.textContent = s;
  }

  // Rebuild the top HUD ticker marquee from an array. The original markup has
  // two <span> halves (duplicated for seamless CSS marquee). We regenerate the
  // joined string as "// ITEM // ITEM // ... //" and put it in both halves.
  function applyTicker(containerEl, arr) {
    if (!containerEl || !Array.isArray(arr) || !arr.length) return;
    var joined = '// ' + arr.join(' // ') + ' //';
    var halves = containerEl.querySelectorAll('span');
    halves.forEach(function (span) {
      // Preserve original text-accent class; just rewrite text.
      span.textContent = joined;
    });
  }

  function apply(homepage) {
    if (!homepage || typeof homepage !== 'object') return;

    // Generic data-hp="key.path" sweep — simple text swap.
    var nodes = document.querySelectorAll('[data-hp]');
    nodes.forEach(function (el) {
      var key = el.getAttribute('data-hp');
      if (!key) return;

      // Ticker strip is special: the attribute points at an array; we rebuild
      // the full marquee from it rather than a single span swap.
      if (key === 'ticker_strip') {
        applyTicker(el, homepage.ticker_strip);
        return;
      }

      var val = getByPath(homepage, key);

      // Support array-of-strings fields that were given their own per-index
      // data-hp (e.g. tagline_strip.0). getByPath already handles that.
      if (val == null) return;

      // Skip arrays / objects for generic swap — caller must target leaves.
      if (typeof val === 'object') return;

      applyText(el, val);
    });
  }

  function init() {
    // If store.js already fetched the manifest, reuse it.
    if (window.MisfitsProducts && window.MisfitsProducts.homepage) {
      apply(window.MisfitsProducts.homepage);
      return;
    }

    // Otherwise, listen for store.js's load event (it fires on the document).
    var handled = false;
    document.addEventListener('misfits:products-loaded', function (ev) {
      if (handled) return;
      handled = true;
      var data = (ev && ev.detail) || window.MisfitsProducts || {};
      apply(data.homepage);
    });

    // And also fetch independently in case store.js isn't on this page.
    fetch(PRODUCTS_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('products.json fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (handled) return;
        handled = true;
        apply(data && data.homepage);
      })
      .catch(function (err) {
        console.warn('[Misfits homepage] manifest fetch failed, keeping fallback text:', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

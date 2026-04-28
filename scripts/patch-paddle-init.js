#!/usr/bin/env node
/* one-shot: replace the legacy Paddle init IIFE in product pages with one
 * that requires a Billing-v2 token format (`live_pct_...` / `test_pct_...`)
 * before calling Initialize. Idempotent — already-patched files stay untouched. */
const fs = require('fs');
const path = require('path');

const NEW_BLOCK = `<script>
  // Paddle init — no-op unless a Billing-v2 client-side token is set.
  // Token format: live_pct_... / test_pct_... — anything else triggers the
  // SDK error overlay so we silently skip until inject-paddle-token.js
  // stamps in a valid one.
  (function () {
    var t = window.__sks_paddle_token;
    if (!t || !/^(live|test)_/.test(t)) return;
    function go() {
      if (window.Paddle && typeof window.Paddle.Initialize === 'function') {
        try { window.Paddle.Initialize({ token: t }); } catch (e) { console.warn('Paddle init failed', e); }
      }
    }
    if (window.Paddle && typeof window.Paddle.Initialize === 'function') go();
    else document.addEventListener('DOMContentLoaded', go);
  })();
</script>`;

const OLD_RE = /<script>\s*\n\s*\/\/ Paddle init — no-op if token isn't set on the window\.[\s\S]*?\}\)\(\);\s*\n\s*<\/script>/;

const root = path.resolve(__dirname, '..');
const productsDir = path.join(root, 'products');
const files = fs.readdirSync(productsDir).filter(f => f.endsWith('.html'));
let patched = 0, alreadyDone = 0;
for (const f of files) {
  const p = path.join(productsDir, f);
  const src = fs.readFileSync(p, 'utf8');
  if (src.includes('Paddle init — no-op unless a Billing-v2')) { alreadyDone++; continue; }
  if (!OLD_RE.test(src)) {
    console.warn('[skip] no match in', f);
    continue;
  }
  const out = src.replace(OLD_RE, NEW_BLOCK);
  fs.writeFileSync(p, out);
  patched++;
}
console.log(`patched ${patched} files; ${alreadyDone} already done`);

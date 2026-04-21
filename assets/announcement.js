/*
 * Misfits Studios — Announcement ribbon
 * ------------------------------------------------------------
 * Fetches /products.json and, if announcement.enabled && announcement.text,
 * injects a ribbon at the top of <body>. Supports styles: neon | alert | info.
 * Dismissal is stored per-session in localStorage (keyed on text hash) so a
 * brand-new announcement reappears even if the last one was dismissed.
 * ------------------------------------------------------------
 * Drop this at the bottom of every page:
 *   <script src="/assets/announcement.js" defer></script>
 */
(function () {
  'use strict';
  var DISMISS_KEY = '__misfits_announcement_dismissed_v1';

  function hashString(s) {
    var h = 0, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h = ((h << 5) - h) + c; h |= 0; }
    return String(h);
  }
  function isDismissed(key) {
    try { return localStorage.getItem(DISMISS_KEY) === key; } catch (_) { return false; }
  }
  function setDismissed(key) {
    try { localStorage.setItem(DISMISS_KEY, key); } catch (_) {}
  }

  function inject(a) {
    var key = hashString((a.text || '') + '|' + (a.link || '') + '|' + (a.style || ''));
    if (isDismissed(key)) return;

    var style = (a.style || 'neon').toLowerCase();
    var bar = document.createElement('div');
    bar.className = 'misfits-announcement misfits-announcement--' + style;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Site announcement');

    var inner = document.createElement('div');
    inner.className = 'misfits-announcement__inner';

    var textSpan = document.createElement('span');
    textSpan.className = 'misfits-announcement__text';
    textSpan.textContent = a.text;
    inner.appendChild(textSpan);

    if (a.link && a.link_label) {
      var link = document.createElement('a');
      link.className = 'misfits-announcement__cta';
      link.href = a.link;
      link.textContent = a.link_label;
      if (/^https?:\/\//i.test(a.link)) { link.target = '_blank'; link.rel = 'noopener'; }
      inner.appendChild(link);
    }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'misfits-announcement__close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss announcement');
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', function () {
      setDismissed(key);
      bar.remove();
      document.documentElement.style.removeProperty('--misfits-announcement-h');
    });

    bar.appendChild(inner);
    bar.appendChild(closeBtn);

    // Styles — kept inline so the script is drop-in with no external CSS dep.
    var css = '\
.misfits-announcement{position:relative;z-index:9999;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 44px 10px 16px;font-family:"Space Grotesk","Inter",system-ui,sans-serif;font-size:13px;letter-spacing:.02em;line-height:1.3;text-align:center}\
.misfits-announcement__inner{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;max-width:1200px}\
.misfits-announcement__cta{font-weight:700;text-transform:uppercase;letter-spacing:.1em;font-size:11px;padding:4px 10px;border:1px solid currentColor;border-radius:3px;text-decoration:none;color:inherit;transition:background .15s}\
.misfits-announcement__cta:hover{background:rgba(0,0,0,.25)}\
.misfits-announcement__close{position:absolute;top:50%;right:10px;transform:translateY(-50%);width:26px;height:26px;background:transparent;border:1px solid currentColor;border-radius:3px;color:inherit;font-size:12px;cursor:pointer;opacity:.7;transition:opacity .15s}\
.misfits-announcement__close:hover{opacity:1}\
.misfits-announcement--neon{background:linear-gradient(90deg,#ff1a8f,#00f2ff);color:#000;font-weight:700;text-shadow:0 0 6px rgba(255,255,255,.3)}\
.misfits-announcement--alert{background:#ff4757;color:#fff;font-weight:700}\
.misfits-announcement--info{background:#0c0c18;color:#00f2ff;border-bottom:1px solid rgba(0,242,255,.35)}';
    var styleTag = document.createElement('style');
    styleTag.setAttribute('data-misfits-announcement', '1');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);

    document.body.insertBefore(bar, document.body.firstChild);
    // Expose height to the page in case layouts want to compensate.
    document.documentElement.style.setProperty('--misfits-announcement-h', bar.offsetHeight + 'px');
  }

  function boot() {
    fetch('/products.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.announcement) return;
        var a = data.announcement;
        if (!a.enabled || !a.text) return;
        inject(a);
      })
      .catch(function () { /* silent — ribbon is non-critical */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* ============================================================================
 * SHADOW KIDS STUDIOS — App Page template renderer
 * ----------------------------------------------------------------------------
 * Pure function: takes a data object describing an app's marketing page and
 * returns a complete, self-contained HTML string ready to be committed to
 * apps/<slug>/index.html via the editor's existing staged-file flow.
 *
 * Schema lives in products.json under apps_pages[<slug>]. See the rustcon
 * entry for the canonical example.
 *
 * Public API:
 *   window.SKSAppPage.render(data)  -> string (full HTML document)
 *   window.SKSAppPage.escapeHtml(s) -> string (helper)
 *
 * Output is intentionally close to the original hand-coded apps/rustcon/
 * page so existing screenshots, embeds, and SEO continue to work after the
 * migration.
 * ============================================================================ */

(function () {
  'use strict';

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // For attributes like canonical URLs / image src — same rules but kept
  // separate so we can swap to a stricter URL sanitizer later if needed.
  function escapeAttr(s) { return escapeHtml(s); }

  function renderJsonLd(data) {
    var ld = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: data.app_name || data.slug,
      operatingSystem: data.os || 'Android, iOS',
      applicationCategory: 'UtilitiesApplication',
      applicationSubCategory: data.schema_app_subcategory || 'Mobile Application',
      description: data.meta_description || '',
      url: data.canonical_url || '',
      image: data.canonical_url ? (data.canonical_url.replace(/\/?$/, '/') + (data.app_icon || '')) : '',
      publisher: {
        '@type': 'Organization',
        name: 'Shadow Kids Studios',
        url: 'https://shadowkidsstudios.com/'
      }
    };
    if (data.download_url) {
      ld.offers = { '@type': 'Offer', price: '0', priceCurrency: 'USD' };
      ld.downloadUrl = [data.download_url];
    } else {
      ld.offers = [
        { '@type': 'Offer', name: 'Monthly', price: data.pricing && data.pricing.monthly_price || '', priceCurrency: 'USD' },
        { '@type': 'Offer', name: 'Yearly',  price: data.pricing && data.pricing.yearly_price  || '', priceCurrency: 'USD' }
      ];
      ld.downloadUrl = [
        data.store_links && data.store_links.play_store_url,
        data.store_links && data.store_links.app_store_url
      ].filter(Boolean);
    }
    return JSON.stringify(ld, null, 2);
  }

  function renderFeatures(features) {
    if (!Array.isArray(features) || !features.length) return '';
    return features.map(function (f) {
      var color = f.color || 'cyan';
      return (
        '<div class="rc-card rc-c-' + escapeAttr(color) + '">' +
          '<div class="rc-glyph">' + escapeHtml(f.glyph || '›') + '</div>' +
          '<h3>' + escapeHtml(f.title || '') + '</h3>' +
          '<p>' + escapeHtml(f.description || '') + '</p>' +
          (f.route ? '<div class="rc-route">' + escapeHtml(f.route) + '</div>' : '') +
        '</div>'
      );
    }).join('\n        ');
  }

  function renderScreenshots(shots) {
    if (!Array.isArray(shots) || !shots.length) return '';
    return shots.map(function (s) {
      var color = s.color || 'cyan';
      return (
        '<figure class="rc-shot rc-c-' + escapeAttr(color) + '">' +
          '<img src="' + escapeAttr(s.src || '') + '" alt="' + escapeAttr(s.alt || s.caption || '') + '" loading="lazy">' +
          '<figcaption><strong>' + escapeHtml(s.title || '') + '</strong>' + escapeHtml(s.caption || '') + '</figcaption>' +
        '</figure>'
      );
    }).join('\n        ');
  }

  function renderFaqs(faqs) {
    if (!Array.isArray(faqs) || !faqs.length) return '';
    return faqs.map(function (f) {
      return (
        '<details>' +
          '<summary>' + escapeHtml(f.q || '') + '</summary>' +
          '<p>' + escapeHtml(f.a || '') + '</p>' +
        '</details>'
      );
    }).join('\n        ');
  }

  function pricingTagLine(pricing) {
    if (!pricing) return '';
    var line = pricing.tag_line || 'Free trial · then {monthly} or {yearly} · cancel anytime';
    return line
      .replace('{monthly}', '<code>' + escapeHtml(pricing.monthly_label || ('$' + pricing.monthly_price + '/mo')) + '</code>')
      .replace('{yearly}',  '<code>' + escapeHtml(pricing.yearly_label  || ('$' + pricing.yearly_price  + '/yr')) + '</code>');
  }

  // Render the primary CTA button row used in the hero + closing CTA stripe.
  // Free desktop downloads use `data.download_url`; mobile apps use `store_links`.
  // When download_url is set it takes precedence over store buttons.
  function renderCtaButtons(data, indent) {
    var pad = indent || '            ';
    var store = data.store_links || {};
    if (data.download_url) {
      var label = data.download_button_label || 'DOWNLOAD';
      return pad + '<a class="rc-btn" href="' + escapeAttr(data.download_url) + '" download>' + escapeHtml(label) + '</a>\n';
    }
    return (
      (store.play_store_url ? pad + '<a class="rc-btn" href="' + escapeAttr(store.play_store_url) + '" rel="noopener">GOOGLE_PLAY</a>\n' : '') +
      (store.app_store_url  ? pad + '<a class="rc-btn rc-btn-pink" href="' + escapeAttr(store.app_store_url)  + '" rel="noopener">APP_STORE</a>\n'  : '')
    );
  }

  function render(data) {
    if (!data || !data.slug) throw new Error('renderAppPage: data.slug required');
    var hero = data.hero || {};
    var pricing = data.pricing || {};
    var store = data.store_links || {};

    return (
'<!doctype html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>' + escapeHtml(data.title || data.app_name || data.slug) + '</title>\n' +
'<meta name="description" content="' + escapeAttr(data.meta_description || '') + '">\n' +
'<link rel="canonical" href="' + escapeAttr(data.canonical_url || '') + '">\n' +
'<meta name="robots" content="index, follow, max-image-preview:large">\n' +
'<meta name="theme-color" content="#050a13">\n' +
'\n' +
'<!-- Open Graph -->\n' +
'<meta property="og:type" content="website">\n' +
'<meta property="og:title" content="' + escapeAttr(data.og_title || data.title || '') + '">\n' +
'<meta property="og:description" content="' + escapeAttr(data.og_description || data.meta_description || '') + '">\n' +
'<meta property="og:url" content="' + escapeAttr(data.canonical_url || '') + '">\n' +
'<meta property="og:image" content="' + escapeAttr(data.og_image || '') + '">\n' +
'<meta property="og:site_name" content="Shadow Kids Studios">\n' +
'\n' +
'<!-- Twitter -->\n' +
'<meta name="twitter:card" content="summary_large_image">\n' +
'<meta name="twitter:title" content="' + escapeAttr(data.og_title || data.title || '') + '">\n' +
'<meta name="twitter:description" content="' + escapeAttr(data.og_description || '') + '">\n' +
'<meta name="twitter:image" content="' + escapeAttr(data.og_image || '') + '">\n' +
'\n' +
'<link rel="icon" type="image/png" href="' + escapeAttr(data.app_icon || '') + '">\n' +
'<link rel="apple-touch-icon" href="' + escapeAttr(data.app_icon || '') + '">\n' +
'\n' +
'<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'<link href="https://fonts.googleapis.com/css2?family=Bungee&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">\n' +
'\n' +
'<script type="application/ld+json">\n' + renderJsonLd(data) + '\n</script>\n' +
'\n' +
'<style>\n' + APP_PAGE_CSS + '</style>\n' +
'</head>\n' +
'<body>\n' +
'<div class="rc-scope">\n' +
'\n' +
'  <!-- Marquee strap -->\n' +
'  <div class="rc-marquee" aria-hidden="true">\n' +
'    <div class="rc-marquee-track">\n' +
'      <span>// MOBILE_APP //</span><span>SHADOW_KIDS //</span><span>BUILT_SOLO //</span>\n' +
'      <span>FREE_TRIAL //</span><span>// MOBILE_APP //</span><span>SHADOW_KIDS //</span>\n' +
'      <span>BUILT_SOLO //</span><span>FREE_TRIAL //</span><span>// MOBILE_APP //</span>\n' +
'      <span>SHADOW_KIDS //</span><span>BUILT_SOLO //</span><span>FREE_TRIAL //</span>\n' +
'    </div>\n' +
'  </div>\n' +
'\n' +
'  <header class="rc-studio">\n' +
'    <img class="rc-mark" src="' + escapeAttr(data.app_icon || '') + '" alt="' + escapeAttr(data.app_name || '') + ' icon">\n' +
'    <div class="rc-studio-name">SHADOW &nbsp; KIDS &nbsp; STUDIOS</div>\n' +
'  </header>\n' +
'\n' +
'  <main class="rc-wrap">\n' +
'\n' +
'    <div class="rc-app-bar">\n' +
'      <img class="rc-app-icon" src="' + escapeAttr(data.app_icon || '') + '" alt="' + escapeAttr(data.app_name || '') + ' app icon">\n' +
'      <div>\n' +
'        <h2>' + escapeHtml(data.app_handle || data.app_name || '') + '</h2>\n' +
'        <div class="rc-jp">' + escapeHtml(data.app_subtitle || '') + '</div>\n' +
'      </div>\n' +
'    </div>\n' +
'\n' +
'    <nav class="rc-subnav" aria-label="Sub-navigation">\n' +
'      <a class="rc-tab" href="/"><span class="dot"></span>HOME</a>\n' +
'      <a class="rc-tab" href="/plugins.html"><span class="dot"></span>PLUGINS</a>\n' +
'      <a class="rc-tab active" href="/apps.html"><span class="dot"></span>APPS</a>\n' +
'      <a class="rc-tab" href="/changelog.html"><span class="dot"></span>CHANGELOG</a>\n' +
'      <a class="rc-tab" href="/support.html"><span class="dot"></span>SUPPORT</a>\n' +
'    </nav>\n' +
'\n' +
'    <section class="rc-hero">\n' +
'      <div class="rc-hero-grid">\n' +
'        <div>\n' +
'          <div class="rc-strap">' + escapeHtml(hero.strap || '') + '</div>\n' +
'          <h1>' + escapeHtml(hero.headline_main || '') + '<br><span class="accent">' + escapeHtml(hero.headline_accent || '') + '</span>.</h1>\n' +
'          <p class="rc-lead">' + escapeHtml(hero.lead || '') + '</p>\n' +
'          <div class="rc-btns">\n' +
renderCtaButtons(data, '            ') +
'            <a class="rc-btn rc-btn-ghost" href="#features">FEATURES</a>\n' +
'          </div>\n' +
(data.free_tag_line
  ? '          <p class="rc-pricing-line">' + escapeHtml(data.free_tag_line) + '</p>\n'
  : (pricing && (pricing.monthly_label || pricing.monthly_price)
      ? '          <p class="rc-pricing-line">' + pricingTagLine(pricing) + '</p>\n'
      : '')
) +
'        </div>\n' +
'        <div class="rc-hero-art">\n' +
'          <img class="rc-phone" src="' + escapeAttr(data.phone_screenshot || '') + '" alt="' + escapeAttr(data.app_name || '') + ' app screenshot" width="320" height="694" loading="eager">\n' +
'        </div>\n' +
'      </div>\n' +
(data.banner ? '      <img class="rc-banner" src="' + escapeAttr(data.banner) + '" alt="' + escapeAttr((data.app_name || '') + ' banner') + '" loading="lazy">\n' : '') +
'    </section>\n' +
'\n' +
'    <section class="rc-section" id="features">\n' +
'      <div class="rc-section-head">\n' +
'        <h2 class="rc-h2">' + escapeHtml(data.features_heading || 'FEATURES') + '</h2>\n' +
'        <p class="rc-sub">' + escapeHtml(data.features_sub || '') + '</p>\n' +
'      </div>\n' +
'      <div class="rc-features">\n        ' + renderFeatures(data.features) + '\n      </div>\n' +
'    </section>\n' +
'\n' +
'    <section class="rc-section" id="shots">\n' +
'      <div class="rc-section-head">\n' +
'        <h2 class="rc-h2">' + escapeHtml(data.shots_heading || 'SCREENSHOTS') + '</h2>\n' +
'        <p class="rc-sub">' + escapeHtml(data.shots_sub || '') + '</p>\n' +
'      </div>\n' +
'      <div class="rc-shots">\n        ' + renderScreenshots(data.screenshots) + '\n      </div>\n' +
'    </section>\n' +
'\n' +
'    <section class="rc-section" id="faq">\n' +
'      <div class="rc-section-head">\n' +
'        <h2 class="rc-h2">' + escapeHtml(data.faq_heading || 'FAQ') + '</h2>\n' +
'        <p class="rc-sub">' + escapeHtml(data.faq_sub || '') + '</p>\n' +
'      </div>\n' +
'      <div class="rc-faq">\n        ' + renderFaqs(data.faqs) + '\n      </div>\n' +
'    </section>\n' +
'\n' +
'  </main>\n' +
'\n' +
'  <section class="rc-cta">\n' +
'    <div class="rc-wrap">\n' +
'      <h2>' + escapeHtml(data.cta_heading || 'READY_TO_DEPLOY?') + '</h2>\n' +
'      <p>' + escapeHtml(data.cta_sub || '') + '</p>\n' +
'      <div class="rc-btns">\n' +
renderCtaButtons(data, '        ') +
'      </div>\n' +
'    </div>\n' +
'  </section>\n' +
'\n' +
'  <p class="rc-foot">crafted_in_the_shadows &nbsp;·&nbsp; <a href="/">shadowkidsstudios.com</a> &nbsp;·&nbsp; ' + escapeHtml(data.slug) + '_v1</p>\n' +
'\n' +
'</div>\n' +
'</body>\n' +
'</html>\n'
    );
  }

  /* The full CSS for an app marketing page. Mirrors apps/rustcon/index.html
   * intentionally so existing live pages stay visually identical when
   * regenerated through the template. Update this string to retheme every
   * app page at once. */
  var APP_PAGE_CSS = [
    ':root {',
    '  --rc-bg: #050a13; --rc-bg-1: #0a1124; --rc-bg-card: #0d1730; --rc-bg-card-hov: #11203f;',
    '  --rc-cyan: #00e5ff; --rc-pink: #ff1c8d; --rc-green: #00ff88; --rc-yellow: #ffe000;',
    '  --rc-purple: #b76eff; --rc-orange: #ff8c1c; --rc-red: #ff4d6d;',
    '  --rc-text: #e8edf5; --rc-text-mid: #aab2c0; --rc-text-mute: #7280a0; --rc-text-mono: #00ff88;',
    '  --rc-border: #1a2444; --rc-border-soft: #11193a;',
    '  --rc-mono: \'JetBrains Mono\', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
    '  --rc-display: \'Bungee\', Impact, \'Arial Black\', sans-serif;',
    '  --rc-body: \'JetBrains Mono\', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
    '  --rc-max: 1240px;',
    '}',
    'html, body { background: var(--rc-bg); color: var(--rc-text); margin: 0; padding: 0; }',
    '.rc-scope * { box-sizing: border-box; }',
    '.rc-scope { font-family: var(--rc-body); background: var(--rc-bg); color: var(--rc-text); font-size: 15px; line-height: 1.7; -webkit-font-smoothing: antialiased; }',
    '.rc-scope img { max-width: 100%; display: block; }',
    '.rc-scope a { color: var(--rc-cyan); text-decoration: none; transition: color .15s ease, opacity .15s ease; }',
    '.rc-scope a:hover { opacity: .85; }',
    '.rc-scope code { font-family: var(--rc-mono); background: var(--rc-bg-card); padding: .1em .4em; border: 1px solid var(--rc-border); color: var(--rc-green); font-size: .9em; }',
    '.rc-wrap { max-width: var(--rc-max); margin: 0 auto; padding: 0 1.4rem; }',
    '.rc-marquee { overflow: hidden; padding: .55rem 0; border-bottom: 1px solid var(--rc-border-soft); background: linear-gradient(180deg, rgba(255,28,141,.08), transparent); }',
    '.rc-marquee-track { display: inline-flex; gap: 2.4rem; white-space: nowrap; animation: rc-mq 38s linear infinite; padding-left: 100%; }',
    '.rc-marquee span { font-family: var(--rc-mono); font-size: .78rem; letter-spacing: .25em; text-transform: uppercase; color: var(--rc-text-mute); }',
    '.rc-marquee span:nth-child(6n+2) { color: var(--rc-cyan); }',
    '.rc-marquee span:nth-child(6n+3) { color: var(--rc-pink); }',
    '.rc-marquee span:nth-child(6n+4) { color: var(--rc-green); }',
    '@keyframes rc-mq { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }',
    '.rc-studio { display: flex; flex-direction: column; align-items: center; padding: 2.4rem 1rem 1.4rem; gap: .8rem; border-bottom: 1px solid var(--rc-border-soft); }',
    '.rc-studio .rc-mark { width: 80px; height: 80px; border-radius: 18px; box-shadow: 0 0 0 1px var(--rc-pink), 0 0 30px rgba(255,28,141,.35); }',
    '.rc-studio .rc-studio-name { margin-top: 1rem; font-family: var(--rc-mono); font-size: .82rem; letter-spacing: .35em; color: var(--rc-text-mid); text-transform: uppercase; }',
    '.rc-app-bar { display: flex; gap: 1.2rem; align-items: center; padding: 2rem 0 1.4rem; border-bottom: 1px solid var(--rc-border-soft); }',
    '.rc-app-bar .rc-app-icon { width: 56px; height: 56px; border-radius: 12px; box-shadow: 0 0 0 1px var(--rc-cyan), 0 0 30px rgba(0,229,255,.35); }',
    '.rc-app-bar h2 { font-family: var(--rc-mono); font-weight: 800; font-size: 1.55rem; letter-spacing: .04em; margin: 0; color: var(--rc-text); }',
    '.rc-app-bar .rc-jp { font-family: var(--rc-mono); color: var(--rc-cyan); font-size: .78rem; letter-spacing: .12em; margin-top: .2rem; }',
    '.rc-subnav { display: flex; flex-wrap: wrap; gap: .8rem; padding: 1.2rem 0 1.6rem; }',
    '.rc-tab { display: inline-flex; align-items: center; gap: .55rem; padding: .55rem .95rem; font-family: var(--rc-mono); font-size: .78rem; letter-spacing: .15em; text-transform: uppercase; border: 1px solid var(--rc-border); color: var(--rc-text); background: rgba(13,23,48,.55); transition: all .12s ease; }',
    '.rc-tab .dot { width: 6px; height: 6px; background: currentColor; }',
    '.rc-tab:hover { color: #fff; border-color: var(--rc-cyan); }',
    '.rc-tab.active { color: var(--rc-bg); background: var(--rc-green); border-color: var(--rc-green); font-weight: 800; }',
    '.rc-section { padding: 4rem 0 3rem; border-bottom: 1px solid var(--rc-border-soft); }',
    '.rc-section-head { margin-bottom: 2rem; }',
    '.rc-h2 { font-family: var(--rc-display); font-size: clamp(2rem, 5vw, 3.4rem); letter-spacing: .03em; margin: 0 0 .3rem; color: var(--rc-text); text-shadow: 3px 0 0 var(--rc-pink), -3px 0 0 var(--rc-cyan); }',
    '.rc-sub { font-family: var(--rc-mono); color: var(--rc-green); font-size: .88rem; letter-spacing: .12em; margin: 0 0 2rem; }',
    '.rc-sub::before { content: "// "; color: var(--rc-text-mute); }',
    '.rc-hero { padding: 3rem 0 4rem; }',
    '.rc-hero .rc-hero-grid { display: grid; grid-template-columns: 1fr; gap: 2.4rem; align-items: center; }',
    '@media (min-width: 880px) { .rc-hero .rc-hero-grid { grid-template-columns: 1.1fr 1fr; gap: 3rem; } }',
    '.rc-hero h1 { font-family: var(--rc-display); font-size: clamp(2.6rem, 7.5vw, 5.4rem); line-height: .95; margin: 0 0 1.2rem; letter-spacing: .01em; color: var(--rc-text); text-shadow: 4px 0 0 var(--rc-pink), -4px 0 0 var(--rc-cyan); }',
    '.rc-hero h1 .accent { color: var(--rc-pink); text-shadow: 4px 0 0 var(--rc-yellow), -4px 0 0 var(--rc-cyan); }',
    '.rc-hero .rc-strap { font-family: var(--rc-mono); color: var(--rc-cyan); font-size: .85rem; letter-spacing: .15em; text-transform: uppercase; margin-bottom: 1.1rem; }',
    '.rc-hero .rc-strap::before { content: ">> "; color: var(--rc-text-mute); }',
    '.rc-hero .rc-strap::after { content: " <<"; color: var(--rc-text-mute); }',
    '.rc-hero p.rc-lead { font-family: var(--rc-mono); color: var(--rc-text); font-size: 1rem; max-width: 580px; margin: 0 0 1.8rem; line-height: 1.7; }',
    '.rc-hero-art { display: flex; justify-content: center; }',
    '.rc-phone { max-width: 320px; width: 100%; box-shadow: 0 0 0 2px var(--rc-cyan), 0 0 60px rgba(0,229,255,.3), 0 30px 80px rgba(0,0,0,.7); }',
    '.rc-banner { width: 100%; margin-top: 3rem; border: 1px solid var(--rc-border); }',
    '.rc-btns { display: flex; flex-wrap: wrap; gap: .9rem; }',
    '.rc-btn { display: inline-flex; align-items: center; gap: .6rem; padding: .9rem 1.4rem; font-family: var(--rc-mono); font-weight: 800; font-size: .92rem; text-transform: uppercase; letter-spacing: .12em; color: var(--rc-bg); background: var(--rc-green); border: 2px solid var(--rc-green); transition: all .12s ease; cursor: pointer; text-shadow: none; }',
    '.rc-btn::before { content: "▸"; color: currentColor; }',
    '.rc-btn:hover { background: #00cc6e; border-color: #00cc6e; color: var(--rc-bg); box-shadow: 0 0 30px rgba(0,255,136,.55); }',
    '.rc-btn-pink { background: var(--rc-pink); color: var(--rc-bg); border-color: var(--rc-pink); }',
    '.rc-btn-pink:hover { background: #ff4ba2; border-color: #ff4ba2; color: var(--rc-bg); box-shadow: 0 0 30px rgba(255,28,141,.55); }',
    '.rc-btn-ghost { background: transparent; color: var(--rc-text); border-color: var(--rc-border); }',
    '.rc-btn-ghost:hover { color: var(--rc-cyan); border-color: var(--rc-cyan); background: transparent; }',
    '.rc-pricing-line { font-family: var(--rc-mono); font-size: .8rem; color: var(--rc-text-mute); margin-top: 1.3rem; letter-spacing: .03em; }',
    '.rc-pricing-line code { color: var(--rc-yellow); border-color: var(--rc-border); background: rgba(255,224,0,.08); }',
    '.rc-features { display: grid; grid-template-columns: 1fr; gap: 1rem; }',
    '@media (min-width: 720px) { .rc-features { grid-template-columns: 1fr 1fr; } }',
    '@media (min-width: 1080px) { .rc-features { grid-template-columns: 1fr 1fr 1fr 1fr; } }',
    '.rc-card { padding: 1.4rem 1.2rem; background: rgba(13,23,48,.7); border: 1px solid var(--card-color, var(--rc-cyan)); transition: transform .12s ease, box-shadow .15s ease; }',
    '.rc-card:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px var(--card-color, var(--rc-cyan)), 0 12px 40px rgba(0,0,0,.45); }',
    '.rc-card .rc-glyph { font-family: var(--rc-mono); font-size: 1.6rem; color: var(--card-color, var(--rc-cyan)); margin-bottom: .8rem; line-height: 1; }',
    '.rc-card h3 { font-family: var(--rc-mono); font-size: .95rem; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 .5rem; color: var(--rc-text); }',
    '.rc-card p { font-size: .92rem; color: var(--rc-text-mid); margin: 0; line-height: 1.6; }',
    '.rc-card .rc-route { margin-top: .7rem; font-family: var(--rc-mono); font-size: .72rem; letter-spacing: .12em; color: var(--card-color, var(--rc-cyan)); opacity: .8; }',
    '.rc-c-cyan { --card-color: var(--rc-cyan); }',
    '.rc-c-pink { --card-color: var(--rc-pink); }',
    '.rc-c-green { --card-color: var(--rc-green); }',
    '.rc-c-yellow { --card-color: var(--rc-yellow); }',
    '.rc-c-purple { --card-color: var(--rc-purple); }',
    '.rc-c-orange { --card-color: var(--rc-orange); }',
    '.rc-c-red { --card-color: var(--rc-red); }',
    '.rc-shots { display: grid; grid-template-columns: 1fr; gap: 1rem; }',
    '@media (min-width: 720px) { .rc-shots { grid-template-columns: 1fr 1fr; } }',
    '@media (min-width: 1080px) { .rc-shots { grid-template-columns: 1fr 1fr 1fr; } }',
    '.rc-shot { margin: 0; padding: 1rem; background: rgba(13,23,48,.65); border: 1px solid var(--card-color, var(--rc-cyan)); display: flex; flex-direction: column; gap: 1rem; transition: transform .12s ease, box-shadow .15s ease; }',
    '.rc-shot:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px var(--card-color, var(--rc-cyan)), 0 12px 40px rgba(0,0,0,.45); }',
    '.rc-shot img { width: 100%; aspect-ratio: 9 / 19.5; object-fit: cover; object-position: top center; border: 1px solid var(--rc-border); background: #000; }',
    '.rc-shot figcaption { font-family: var(--rc-mono); font-size: .82rem; color: var(--rc-text-mid); }',
    '.rc-shot figcaption strong { display: block; color: var(--card-color, var(--rc-cyan)); font-weight: 700; margin-bottom: .35rem; letter-spacing: .12em; text-transform: uppercase; }',
    '.rc-faq details { background: rgba(13,23,48,.55); border: 1px solid var(--rc-border); padding: 1rem 1.2rem; margin-bottom: .65rem; transition: border-color .12s ease; }',
    '.rc-faq details[open] { border-color: var(--rc-cyan); }',
    '.rc-faq summary { cursor: pointer; font-family: var(--rc-mono); font-size: .92rem; letter-spacing: .03em; color: var(--rc-text); list-style: none; }',
    '.rc-faq summary::-webkit-details-marker { display: none; }',
    '.rc-faq summary::before { content: "+"; color: var(--rc-cyan); display: inline-block; margin-right: .6rem; font-weight: 700; }',
    '.rc-faq details[open] summary::before { content: "−"; }',
    '.rc-faq p { color: var(--rc-text-mid); font-size: .95rem; margin: .8rem 0 0; line-height: 1.7; }',
    '.rc-cta { padding: 4rem 0; border-top: 1px solid var(--rc-border-soft); border-bottom: 1px solid var(--rc-border-soft); background: linear-gradient(135deg, rgba(0,229,255,.06), rgba(255,28,141,.06)); text-align: center; }',
    '.rc-cta h2 { font-family: var(--rc-display); font-size: clamp(1.8rem, 4vw, 2.8rem); letter-spacing: .03em; margin: 0 0 .5rem; text-shadow: 3px 0 0 var(--rc-pink), -3px 0 0 var(--rc-cyan); }',
    '.rc-cta p { font-family: var(--rc-mono); color: var(--rc-text-mid); margin: 0 auto 1.8rem; max-width: 540px; font-size: .92rem; }',
    '.rc-cta .rc-btns { justify-content: center; }',
    '.rc-foot { text-align: center; padding: 2rem 1rem 3rem; font-family: var(--rc-mono); font-size: .76rem; letter-spacing: .15em; color: var(--rc-text-mute); }',
    ''
  ].join('\n  ');

  window.SKSAppPage = { render: render, escapeHtml: escapeHtml };
})();

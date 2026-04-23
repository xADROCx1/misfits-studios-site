/* Shadow Kids Studios — lightweight analytics loader
 *
 * Loads PostHog if a project key is configured (privacy-respecting, cookieless mode).
 * Safe to include on every page. No-op if no key is set.
 *
 * To activate: set window.__MISFITS_POSTHOG_KEY and optionally __MISFITS_POSTHOG_HOST
 * in a <script> tag BEFORE this file loads, or edit POSTHOG_KEY below.
 *
 * Free at https://us.i.posthog.com (generous free tier, 1M events/month).
 */
(function () {
  'use strict';

  // Set this to your PostHog project API key when you're ready to activate.
  // Format: phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  var POSTHOG_KEY = window.__MISFITS_POSTHOG_KEY || '';
  var POSTHOG_HOST = window.__MISFITS_POSTHOG_HOST || 'https://us.i.posthog.com';

  if (!POSTHOG_KEY) {
    // Silent no-op. Provide a stub so later code doesn't break.
    window.posthog = window.posthog || {
      capture: function () {},
      identify: function () {},
      reset: function () {},
      __stub: true,
    };
    return;
  }

  // Standard PostHog snippet (async init).
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  window.posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only', // privacy — only create profiles for logged-in users
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: true, // flip to false later if you want session replay
    autocapture: {
      css_selector_allowlist: ['.lemonsqueezy-button', '.paddle_button', '[data-track]'],
    },
  });

  // Auto-track BUY button intent (click on any LS or Paddle overlay trigger)
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.lemonsqueezy-button, .paddle_button');
    if (!btn) return;
    var card = btn.closest('[data-product-id]');
    var productId = card ? card.getAttribute('data-product-id') : null;
    window.posthog.capture('checkout_clicked', {
      product_id: productId,
      provider: btn.classList.contains('paddle_button') ? 'paddle' : 'lemonsqueezy',
      page: location.pathname,
    });
  }, true);
})();

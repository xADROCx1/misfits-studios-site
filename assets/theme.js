/* MISFITS STUDIOS — V2 theme enhancer
 * Injects:
 *   1. Hazard tape ticker at the top of every page
 *   2. Adds .msfts-v2 to <body> so CSS padding kicks in
 *   3. Upgrades existing product cards with HUD brackets (non-destructive)
 */
(function () {
  'use strict';

  var HAZARD_SEGMENTS = [
    '// MISFITS STUDIOS',
    'RUST ECOSYSTEM',
    'ORIGINAL WORK',
    'OXIDE + CARBON',
    'PER-SERVER LICENSE',
    'LIFETIME UPDATES',
    'DIRECT DEV SUPPORT',
    'NO RESELLING',
    'ZERO GHOSTING',
    'V.2_PROTOCOL_ACTIVE',
  ];

  function injectHazardTape() {
    if (document.querySelector('.msfts-hazard-tape')) return;
    var tape = document.createElement('div');
    tape.className = 'msfts-hazard-tape';
    var track = document.createElement('div');
    track.className = 'msfts-hazard-tape__track';
    // Two copies for seamless loop
    var html = '';
    for (var i = 0; i < 2; i++) {
      for (var j = 0; j < HAZARD_SEGMENTS.length; j++) {
        html += '<span>' + HAZARD_SEGMENTS[j] + ' //</span>';
      }
    }
    track.innerHTML = html;
    tape.appendChild(track);
    document.body.insertBefore(tape, document.body.firstChild);
    document.body.classList.add('msfts-v2');
  }

  function upgradeProductCards() {
    // Any <article data-product-id> from store.js gets HUD bracket decoration
    var cards = document.querySelectorAll('article[data-product-id]');
    cards.forEach(function (card) {
      if (card.classList.contains('msfts-hud')) return;
      card.classList.add('msfts-hud');
    });
  }

  function run() {
    try { injectHazardTape(); } catch (_) {}
    try { upgradeProductCards(); } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // Upgrade cards again after dynamic product grid loads
  document.addEventListener('misfits:products-loaded', function () {
    setTimeout(upgradeProductCards, 50);
  });
})();

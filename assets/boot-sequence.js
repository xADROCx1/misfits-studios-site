/* ==========================================================================
 * boot-sequence.js — Misfits Studios first-visit terminal boot animation
 * --------------------------------------------------------------------------
 * Fires once per session on the user's first page load. Displays a fake
 * terminal boot log (VT323 green-on-black, scanlines, CRT flicker) and then
 * fades away to reveal the site. Dismisses on keypress, click, skip link,
 * the 1.5s grace after the last line, or a 7s hard safety cap.
 *
 * Safe by design: if anything throws, sessionStorage is flagged so we don't
 * retry on the next navigation, and the site continues to function normally.
 *
 * To re-test during dev:   sessionStorage.removeItem('misfits_booted')
 * ========================================================================== */

(function () {
  'use strict';

  try {
    // ---- 1. GUARDS -------------------------------------------------------
    // Only fire on the FIRST page view of a browser session.
    if (sessionStorage.getItem('misfits_booted') === '1') return;

    // Respect prefers-reduced-motion. No animation for sensitive users.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sessionStorage.setItem('misfits_booted', '1');
      return;
    }

    // Wait for DOM if not ready.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  } catch (e) {
    // Never let the boot sequence break the site. Flag and move on.
    try { sessionStorage.setItem('misfits_booted', '1'); } catch (_) {}
    // eslint-disable-next-line no-console
    if (window.console) console.warn('[misfits boot] aborted:', e);
  }

  // ---- 2. CADENCE CONFIG (tweak here) ------------------------------------
  // Each line: { text, delayBefore, charSpeed, pauseBeforeOK, big }
  // - charSpeed is [min, max] ms per character (randomized)
  // - pauseBeforeOK: if set, we pause this long before rendering " OK" at end
  // - big: render line in slightly larger mint style (welcome line)
  var LINES = [
    { text: '> MISFITS_STUDIOS · boot sequence initialized...', delayBefore: 120, charSpeed: [18, 32] },
    { text: '> mounting /catalog...', delayBefore: 160, charSpeed: [20, 35], pauseBeforeOK: 250, append: ' OK' },
    { text: '> loading 48 products from manifest.json...', delayBefore: 140, charSpeed: [18, 30], pauseBeforeOK: 280, append: ' OK' },
    { text: '> verifying SSL handshake on misfits-studios.com...', delayBefore: 140, charSpeed: [16, 28], pauseBeforeOK: 320, append: ' OK' },
    { text: '> attaching lemon.js overlay...', delayBefore: 150, charSpeed: [20, 32], pauseBeforeOK: 220, append: ' OK' },
    { text: '> attaching paddle.js overlay...', delayBefore: 130, charSpeed: [20, 32], pauseBeforeOK: 220, append: ' OK' },
    { text: '> sync agent: ARMED (cron: weekly)', delayBefore: 180, charSpeed: [18, 30] },
    { text: '> brand protocol: V.2_ACTIVE', delayBefore: 160, charSpeed: [20, 35] },
    { text: '> ', delayBefore: 200, charSpeed: [0, 0], progressBar: true }, // filled by renderProgressBar
    { text: '> welcome to the underground.', delayBefore: 220, charSpeed: [28, 48], big: true },
    { text: '> [PRESS_ANY_KEY_TO_ENTER] or wait 1.5s...', delayBefore: 200, charSpeed: [18, 30] }
  ];

  var PROGRESS_CHUNKS = 7;    // number of progress-bar updates
  var PROGRESS_CHUNK_MS = 80; // delay between progress updates
  var PROGRESS_TOTAL = 22;    // total █ blocks in the full bar
  var AUTO_DISMISS_AFTER_LAST = 1500; // 1.5s grace after final line
  var HARD_CAP_MS = 7000;     // safety cap — always dismiss by this point
  var FADE_MS = 300;          // overlay fade-out duration

  // ---- 3. MAIN -----------------------------------------------------------
  function run() {
    try {
      injectStyles();
      var overlay = buildOverlay();
      document.body.appendChild(overlay);

      // Lock scroll while booting.
      var prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      var dismissed = false;
      var logEl = overlay.querySelector('.mf-boot-log');

      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        try { sessionStorage.setItem('misfits_booted', '1'); } catch (_) {}
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          document.body.style.overflow = prevOverflow;
        }, FADE_MS);
      }

      // Dismiss handlers — any keypress, any click on overlay, skip link.
      document.addEventListener('keydown', dismiss, { once: true });
      overlay.addEventListener('click', dismiss, { once: true });
      overlay.querySelector('.mf-boot-skip').addEventListener('click', function (e) {
        e.stopPropagation();
        dismiss();
      });

      // Hard safety cap.
      setTimeout(dismiss, HARD_CAP_MS);

      // Start the typing sequence.
      typeLines(logEl, 0, function onAllDone() {
        setTimeout(dismiss, AUTO_DISMISS_AFTER_LAST);
      });
    } catch (e) {
      try { sessionStorage.setItem('misfits_booted', '1'); } catch (_) {}
      if (window.console) console.warn('[misfits boot] runtime error:', e);
    }
  }

  // ---- 4. STYLE INJECTION ------------------------------------------------
  function injectStyles() {
    if (document.getElementById('mf-boot-styles')) return;
    var css = [
      '.mf-boot-overlay{position:fixed;inset:0;background:#060e20;z-index:100000;',
      'overflow:hidden;pointer-events:auto;transition:opacity ' + FADE_MS + 'ms ease;',
      'font-family:"VT323","JetBrains Mono",monospace;color:#00ffa3;',
      'animation:mf-boot-flicker 200ms infinite alternate ease-in-out;}',
      '.mf-boot-overlay::before{content:"";position:absolute;inset:0;pointer-events:none;',
      'background:repeating-linear-gradient(0deg,rgba(0,255,163,0.03) 0 1px,transparent 1px 3px);z-index:1;}',
      '.mf-boot-term{max-width:720px;margin:0 auto;padding:32px;position:relative;z-index:2;',
      'font-size:20px;line-height:1.5;min-height:100vh;box-sizing:border-box;}',
      '.mf-boot-log{white-space:pre-wrap;word-break:break-word;}',
      '.mf-boot-log .mf-line{display:block;}',
      '.mf-boot-log .mf-line.mf-big{font-size:28px;color:#00ffa3;text-shadow:0 0 8px rgba(0,255,163,0.6);letter-spacing:0.04em;margin:8px 0;}',
      '.mf-boot-cursor{display:inline-block;width:0.6em;animation:mf-boot-blink 600ms steps(1) infinite;}',
      '.mf-boot-skip{position:fixed;top:16px;right:20px;z-index:3;color:#00ffa3;',
      'font-family:"VT323","JetBrains Mono",monospace;font-size:16px;cursor:pointer;',
      'opacity:0.7;text-decoration:none;letter-spacing:0.05em;}',
      '.mf-boot-skip:hover{opacity:1;text-shadow:0 0 6px rgba(0,255,163,0.8);}',
      '@keyframes mf-boot-blink{0%,50%{opacity:1}50.01%,100%{opacity:0}}',
      '@keyframes mf-boot-flicker{0%{opacity:0.96}100%{opacity:1}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'mf-boot-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---- 5. OVERLAY DOM ----------------------------------------------------
  function buildOverlay() {
    var overlay = document.createElement('div');
    overlay.className = 'mf-boot-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Misfits Studios boot sequence');

    var skip = document.createElement('a');
    skip.href = '#';
    skip.className = 'mf-boot-skip';
    skip.textContent = '[ skip \u2192 ]';

    var term = document.createElement('div');
    term.className = 'mf-boot-term';
    var log = document.createElement('div');
    log.className = 'mf-boot-log';
    term.appendChild(log);

    overlay.appendChild(skip);
    overlay.appendChild(term);
    return overlay;
  }

  // ---- 6. TYPING ENGINE --------------------------------------------------
  // Recursively renders LINES[i], then calls done() after the last one.
  function typeLines(logEl, i, done) {
    if (i >= LINES.length) { done(); return; }
    var spec = LINES[i];

    setTimeout(function () {
      var lineEl = document.createElement('span');
      lineEl.className = 'mf-line' + (spec.big ? ' mf-big' : '');
      logEl.appendChild(lineEl);

      // Progress bar is a special case — fills in chunks.
      if (spec.progressBar) {
        renderProgressBar(lineEl, function () {
          logEl.appendChild(document.createTextNode('\n'));
          typeLines(logEl, i + 1, done);
        });
        return;
      }

      typeChars(lineEl, spec.text, spec.charSpeed, function () {
        if (spec.pauseBeforeOK && spec.append) {
          setTimeout(function () {
            typeChars(lineEl, spec.append, [14, 22], afterLine);
          }, spec.pauseBeforeOK);
        } else {
          afterLine();
        }
      });

      function afterLine() {
        logEl.appendChild(document.createTextNode('\n'));
        typeLines(logEl, i + 1, done);
      }
    }, spec.delayBefore || 0);
  }

  // Types chars one at a time into target with randomized per-char delay.
  function typeChars(target, text, speedRange, cb) {
    var idx = 0;
    var min = speedRange[0], max = speedRange[1];
    function step() {
      if (idx >= text.length) { cb(); return; }
      target.appendChild(document.createTextNode(text.charAt(idx)));
      idx++;
      var delay = min + Math.random() * (max - min);
      setTimeout(step, delay);
    }
    if (min === 0 && max === 0) { target.appendChild(document.createTextNode(text)); cb(); return; }
    step();
  }

  // Progress bar: "> [████████░░░░░░] N%" filling in chunks.
  function renderProgressBar(target, cb) {
    target.appendChild(document.createTextNode('> '));
    var barSpan = document.createElement('span');
    var pctSpan = document.createElement('span');
    target.appendChild(barSpan);
    target.appendChild(document.createTextNode(' '));
    target.appendChild(pctSpan);

    var step = 0;
    function tick() {
      var progress = step / PROGRESS_CHUNKS;
      var filled = Math.round(PROGRESS_TOTAL * progress);
      var bar = '';
      for (var j = 0; j < PROGRESS_TOTAL; j++) bar += (j < filled ? '\u2588' : '\u2591');
      barSpan.textContent = bar;
      pctSpan.textContent = Math.round(progress * 100) + '%';
      step++;
      if (step > PROGRESS_CHUNKS) { cb(); return; }
      setTimeout(tick, PROGRESS_CHUNK_MS);
    }
    tick();
  }
})();

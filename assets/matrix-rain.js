/* Misfits Studios — Matrix katakana rain background
 * Attaches to any <canvas class="v5-matrix-canvas"> element on the page.
 * Lightweight, pauses when tab is hidden, respects prefers-reduced-motion.
 */
(function () {
  'use strict';

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Katakana + numbers + technical glyphs — brand-appropriate characters
  var CHARS = 'ミスフィッツスタジオ0123456789ABCDEF∅⌬⌖⏣∎'.split('');

  function start(canvas) {
    if (canvas.__running) return;
    canvas.__running = true;

    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    var cols, drops, fontSize = 18;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.scale(dpr, dpr);
      cols = Math.floor(rect.width / fontSize);
      drops = Array(cols).fill(0).map(function () { return Math.random() * -100; });
    }
    resize();

    var ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }

    var visible = true;
    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
    });

    var frame = 0;
    function tick() {
      if (!visible) { requestAnimationFrame(tick); return; }
      frame++;

      var rect = canvas.getBoundingClientRect();
      // Fade existing with slight translucent black
      ctx.fillStyle = 'rgba(2, 2, 8, 0.08)';
      ctx.fillRect(0, 0, rect.width, rect.height);

      ctx.font = fontSize + "px 'JetBrains Mono', monospace";
      ctx.textAlign = 'left';

      for (var i = 0; i < cols; i++) {
        var x = i * fontSize;
        var y = drops[i] * fontSize;

        // Head char — mint, bright, glowing
        if (frame % 2 === 0 || Math.random() > 0.5) {
          var ch = CHARS[Math.floor(Math.random() * CHARS.length)];
          ctx.fillStyle = 'rgba(0, 255, 163, 0.9)';
          ctx.shadowColor = 'rgba(0, 255, 163, 0.7)';
          ctx.shadowBlur = 8;
          ctx.fillText(ch, x, y);
          ctx.shadowBlur = 0;
        }

        // Trailing char — cyan, dimmer
        if (drops[i] > 1) {
          var trail = CHARS[Math.floor(Math.random() * CHARS.length)];
          ctx.fillStyle = 'rgba(0, 242, 255, 0.4)';
          ctx.fillText(trail, x, y - fontSize);
        }

        // Reset drop when it reaches bottom, random chance
        if (y > rect.height && Math.random() > 0.97) {
          drops[i] = Math.random() * -20;
        }
        drops[i] += 0.5 + Math.random() * 0.3;
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function init() {
    var canvases = document.querySelectorAll('canvas.v5-matrix-canvas');
    canvases.forEach(start);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

(function () {
  'use strict';
  const key = document.body && document.body.getAttribute('data-page-key');
  if (!key) return;
  const target = document.getElementById('prose-body');
  if (!target) return;

  fetch('/products.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      const page = data && data.pages && data.pages[key];
      if (!page || !page.body_md) return; // keep fallback HTML
      const html = miniMD(page.body_md);
      const stamp = page.last_updated
        ? '<p class="prose-last-updated">Last updated: <time>' + esc(page.last_updated) + '</time></p>'
        : '';
      target.innerHTML = html + stamp;
    })
    .catch(() => { /* keep fallback HTML */ });

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      (_, t, u) => '<a href="' + u.replace(/"/g, '&quot;') + '" rel="noopener">' + t + '</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return s;
  }
  function miniMD(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inCode = false, codeBuf = [], listType = null, listBuf = [],
        paraBuf = [], inQuote = false, quoteBuf = [];
    const flushPara = () => { if (paraBuf.length) { out.push('<p>' + inline(paraBuf.join(' ').trim()) + '</p>'); paraBuf = []; } };
    const flushList = () => { if (listBuf.length) { const t = listType === 'ol' ? 'ol' : 'ul'; out.push('<' + t + '>' + listBuf.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + t + '>'); listBuf = []; listType = null; } };
    const flushQuote = () => { if (quoteBuf.length) { out.push('<blockquote>' + quoteBuf.map(x => '<p>' + inline(x) + '</p>').join('') + '</blockquote>'); quoteBuf = []; inQuote = false; } };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i], line = raw.replace(/\s+$/, '');
      if (/^```/.test(line)) {
        if (inCode) { out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); codeBuf = []; inCode = false; }
        else { flushPara(); flushList(); flushQuote(); inCode = true; }
        continue;
      }
      if (inCode) { codeBuf.push(raw); continue; }
      if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
      if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) { flushPara(); flushList(); flushQuote(); out.push('<hr/>'); continue; }
      const h = /^(#{1,4})\s+(.+)$/.exec(line);
      if (h) { flushPara(); flushList(); flushQuote(); out.push('<h' + h[1].length + '>' + inline(h[2].trim()) + '</h' + h[1].length + '>'); continue; }
      const bq = /^>\s?(.*)$/.exec(line);
      if (bq) { flushPara(); flushList(); inQuote = true; quoteBuf.push(bq[1]); continue; }
      else if (inQuote) { flushQuote(); }
      const ul = /^[-*+]\s+(.+)$/.exec(line);
      if (ul) { flushPara(); flushQuote(); if (listType && listType !== 'ul') flushList(); listType = 'ul'; listBuf.push(ul[1]); continue; }
      const ol = /^\d+\.\s+(.+)$/.exec(line);
      if (ol) { flushPara(); flushQuote(); if (listType && listType !== 'ol') flushList(); listType = 'ol'; listBuf.push(ol[1]); continue; }
      else if (listType) { flushList(); }
      paraBuf.push(line.trim());
    }
    if (inCode) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
    flushPara(); flushList(); flushQuote();
    return out.join('\n');
  }
})();

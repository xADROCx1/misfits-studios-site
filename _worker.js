/**
 * _worker.js — top-level Worker for the Shadow Kids Studios site.
 *
 * Internal Cloudflare Worker script name remains `misfits-studios-site` (the
 * name is immutable — renaming would require a full deploy dance and secret
 * re-entry; not worth it for an invisible internal label). Public brand is
 * Shadow Kids Studios, served from shadowkidsstudios.com.
 *
 * The site uses the Workers-with-Assets format. In that format, Pages-style
 * /functions/ auto-discovery is gone; the project needs a single _worker.js
 * that either handles the request or falls through to the static-asset
 * bindings.
 *
 * Routes handled here:
 *   misfits-studios.com/*  → 301 redirect to shadowkidsstudios.com (legacy
 *                            domain kept ≥12 months for SEO + email continuity)
 *   /api/paddle/*          → server-side proxy to Paddle REST API (CORS
 *                            workaround + secret key protection); whitelisted
 *                            to safe endpoints, requires X-Admin-Secret header.
 *
 * Everything else → env.ASSETS.fetch(request) so static HTML/JS/CSS/images
 * continue to be served as before.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Legacy-domain redirect: 301 misfits-studios.com → shadowkidsstudios.com
    if (url.hostname === 'misfits-studios.com' || url.hostname === 'www.misfits-studios.com') {
      return Response.redirect('https://shadowkidsstudios.com' + url.pathname + url.search, 301);
    }

    if (url.pathname.startsWith('/api/paddle/') || url.pathname === '/api/paddle') {
      return handlePaddleProxy(request, env);
    }

    // Default: let the static-asset binding serve the file or 404.
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};

async function handlePaddleProxy(request, env) {
  // 1. Access control
  const sent = request.headers.get('x-admin-secret') || '';
  const expected = env.EDITOR_ADMIN_SECRET || '';
  if (!expected || sent !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.PADDLE_API_KEY) {
    return json({ error: 'PADDLE_API_KEY not configured on Cloudflare' }, 500);
  }

  // 2. Compute upstream path (strip the /api/paddle/ prefix)
  const url = new URL(request.url);
  const remaining = url.pathname.replace(/^\/api\/paddle\/?/, '');
  const targetPath = remaining || '';

  // 3. Method whitelist — GET (reads), POST (creates — only on write-enabled endpoints),
  //    PATCH (updates — only on write-enabled endpoints). PUT / DELETE still refused.
  const method = request.method;
  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
    return json({ error: 'method not allowed' }, 405);
  }

  // 4. Endpoint whitelist
  //    - Read-only endpoints: safe to expose to admin UI via GET only.
  //    - Write-enabled endpoints: admin UI may also POST / PATCH. Still Bearer-
  //      protected server-side; leaked admin secret still can't hit anything outside
  //      this list.
  const readOnly = ['transactions', 'products', 'prices', 'customers', 'subscriptions', 'reports'];
  const writable = ['discounts'];
  const firstSeg = targetPath.split('/')[0].split('?')[0];
  const isReadOnly = readOnly.includes(firstSeg);
  const isWritable = writable.includes(firstSeg);
  if (!isReadOnly && !isWritable) {
    return json({ error: 'endpoint not allowed: ' + (targetPath || '(empty)') }, 403);
  }
  if ((method === 'POST' || method === 'PATCH') && !isWritable) {
    return json({ error: 'write method not allowed on endpoint: ' + firstSeg }, 403);
  }

  // 5. Forward to Paddle
  const target = 'https://api.paddle.com/' + targetPath + url.search;
  const fwdHeaders = {
    Authorization: 'Bearer ' + env.PADDLE_API_KEY,
    Accept: 'application/json',
    'Paddle-Version': '1',
  };
  const fwdInit = { method, headers: fwdHeaders };
  if (method === 'POST' || method === 'PATCH') {
    fwdHeaders['Content-Type'] = request.headers.get('content-type') || 'application/json';
    // Read the body as text so we can forward it verbatim to Paddle.
    fwdInit.body = await request.text();
  }
  const upstream = await fetch(target, fwdInit);
  const body = await upstream.text();
  // Only cache GETs; POST/PATCH must be fresh.
  const cacheCtl = method === 'GET' ? 'private, max-age=15' : 'no-store';
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': cacheCtl,
    },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

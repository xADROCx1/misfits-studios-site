/**
 * _worker.js — top-level Worker for the misfits-studios-site project
 *
 * The site was migrated from Cloudflare Pages to the new Workers-with-Assets
 * format. In that format, Pages-style /functions/ auto-discovery is gone;
 * the project needs a single _worker.js that either handles the request or
 * falls through to the static-asset bindings.
 *
 * Routes handled here:
 *   /api/paddle/*   → server-side proxy to Paddle REST API (CORS workaround +
 *                     secret key protection); whitelisted to safe read-only
 *                     endpoints and requires X-Admin-Secret header.
 *
 * Everything else → env.ASSETS.fetch(request) so static HTML/JS/CSS/images
 * continue to be served as before.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

  // 3. Method whitelist
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  // 4. Endpoint whitelist — can only hit read-only Paddle endpoints
  const allowed = ['transactions', 'products', 'prices', 'customers', 'subscriptions', 'reports'];
  const firstSeg = targetPath.split('/')[0].split('?')[0];
  if (!allowed.includes(firstSeg)) {
    return json({ error: 'endpoint not allowed: ' + (targetPath || '(empty)') }, 403);
  }

  // 5. Forward to Paddle
  const target = 'https://api.paddle.com/' + targetPath + url.search;
  const upstream = await fetch(target, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + env.PADDLE_API_KEY,
      Accept: 'application/json',
      'Paddle-Version': '1',
    },
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'private, max-age=15',
    },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

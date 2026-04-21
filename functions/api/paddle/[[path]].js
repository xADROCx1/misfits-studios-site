/**
 * Cloudflare Pages Function — Paddle API proxy
 * Matches any /api/paddle/<anything> → https://api.paddle.com/<anything>
 *
 * Why this exists:
 *   Paddle's REST API does NOT send CORS headers, so the browser cannot call
 *   it directly from admin/editor.html. This function runs server-side on
 *   Cloudflare's edge with the secret key stored as an env var, and forwards
 *   the request to Paddle. The key never touches the client.
 *
 * Access control:
 *   The editor page is password-gated client-side, but this endpoint is
 *   also protected by an X-Admin-Secret header comparison with an env var
 *   so random public hits can't drain your Paddle API quota.
 *
 * Required env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   PADDLE_API_KEY       — server API key from Paddle (pdl_live_apikey_...)
 *   EDITOR_ADMIN_SECRET  — any random string the editor sends in X-Admin-Secret
 */
export async function onRequest(context) {
  const { request, env, params } = context;

  // 1. Access control: editor must send a matching secret header.
  const sent = request.headers.get('x-admin-secret') || '';
  const expected = env.EDITOR_ADMIN_SECRET || '';
  if (!expected || sent !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 2. Reject if the server isn't configured with a Paddle key.
  if (!env.PADDLE_API_KEY) {
    return new Response(JSON.stringify({ error: 'PADDLE_API_KEY not configured on Cloudflare' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 3. Build target URL. `params.path` is the array of segments after /api/paddle/.
  const segments = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const targetPath = segments.join('/');
  const incoming = new URL(request.url);
  const target = new URL('https://api.paddle.com/' + targetPath + incoming.search);

  // 4. Whitelist — only allow GETs to known read-only endpoints so this proxy
  //    cannot be weaponized to mutate your Paddle account even if EDITOR_ADMIN_SECRET
  //    leaked.
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }
  const allowedPrefixes = ['transactions', 'products', 'prices', 'customers', 'subscriptions', 'reports'];
  if (!allowedPrefixes.some((p) => targetPath === p || targetPath.startsWith(p + '/') || targetPath.startsWith(p + '?'))) {
    return new Response(JSON.stringify({ error: 'endpoint not allowed: ' + targetPath }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 5. Forward to Paddle with the server key.
  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + env.PADDLE_API_KEY,
      Accept: 'application/json',
      'Paddle-Version': '1',
    },
  });

  // Stream the upstream body back, preserving status + content type.
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      // Let the editor cache briefly to avoid hammering Paddle on every render
      'cache-control': 'private, max-age=15',
    },
  });
}

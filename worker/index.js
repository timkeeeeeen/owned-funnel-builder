function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchAsset(env, request) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return new Response('Static asset binding is unavailable.', { status: 500 });
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await fetchAsset(env, request);

    if (response.status !== 404) {
      return withSecurityHeaders(response);
    }

    const lastSegment = url.pathname.split('/').pop() ?? '';
    const looksLikeFile = lastSegment.includes('.');

    if (!looksLikeFile && !url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
      return Response.redirect(url.toString(), 308);
    }

    const notFoundUrl = new URL('/404.html', request.url);
    const notFoundResponse = await fetchAsset(env, new Request(notFoundUrl, request));

    return withSecurityHeaders(
      new Response(notFoundResponse.body, {
        status: 404,
        headers: notFoundResponse.headers,
      })
    );
  },
};

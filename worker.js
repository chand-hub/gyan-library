export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const json = (data, status = 200) => Response.json(data, { status });

    if (path === '/api/public/library-info' && request.method === 'GET') {
      return json({ ok: true, name: 'Gyan Adda Library', location: 'Mirzapur Chowk, Darbhanga' });
    }

    if (path === '/api/admin/auth/status' && request.method === 'GET') {
      return json({ ok: true, authenticated: false });
    }

    if ((path === '/api/admin/auth/login' || path === '/api/admin/login') && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Invalid request' }, 400);
      }

      const { mobile, password } = body || {};
      if (!mobile || !password) {
        return json({ ok: false, error: 'Enter mobile and password' }, 400);
      }

      if (!env.ADMIN_PASSWORD) {
        return json({ ok: false, error: 'Admin password not set on server' }, 500);
      }

      if (password === env.ADMIN_PASSWORD) {
        return json({ ok: true, authenticated: true });
      }

      return json({ ok: false, error: 'Wrong mobile or password' }, 401);
    }

    if (path.startsWith('/api/')) {
      return json({ ok: false, error: 'API route not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

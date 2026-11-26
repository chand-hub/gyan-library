export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const json = (data, status = 200) => Response.json(data, { status });

    // Library info for the public website
    if (path === '/api/public/library-info' && request.method === 'GET') {
      return json({ ok: true, name: 'Gyan Adda Library', location: 'Mirzapur Chowk, Darbhanga' });
    }

    // Tell the page that the admin is already set up (so it shows Sign In, not Setup)
    if (path === '/api/admin/auth/status' && request.method === 'GET') {
      return json({
        ok: true,
        authenticated: false,
        configured: true,
        adminConfigured: true,
        hasAdmin: true,
        setupRequired: false,
        needsSetup: false
      });
    }

    // Block the setup form so nobody can create a second admin
    if (path.startsWith('/api/admin/auth/setup') || path === '/api/admin/setup') {
      return json({ ok: false, error: 'Admin is already set up. Please use Sign In.' }, 409);
    }

    // Admin login using the ADMIN_PASSWORD secret
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

    // Any other unknown API address
    if (path.startsWith('/api/')) {
      return json({ ok: false, error: 'API route not found' }, 404);
    }

    // Everything else: show the website
    return env.ASSETS.fetch(request);
  }
};

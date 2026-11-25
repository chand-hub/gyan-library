export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: 'Invalid request' }, { status: 400 });
      }

      const { mobile, password } = body;
      if (!mobile || !password) {
        return Response.json({ ok: false, error: 'Enter mobile and password' }, { status: 400 });
      }

      if (password === env.ADMIN_PASSWORD) {
        return Response.json({ ok: true });
      }

      return Response.json({ ok: false, error: 'Wrong mobile or password' }, { status: 401 });
    }

    return env.ASSETS.fetch(request);
  }
};

// Cloudflare Worker: sirve la app (assets estáticos) y un par de endpoints propios.
//  - GET  /config.js        -> configuración pública generada desde variables de entorno
//  - POST /api/admin-users  -> un admin crea usuarios (usa la service key, que nunca llega al navegador)
export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string; // secreto: wrangler secret put SUPABASE_SERVICE_ROLE_KEY
  NOMBRE_NEGOCIO?: string;
  RUC?: string;
  DIRECCION?: string;
  TELEFONO?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/config.js') {
      const cfg = {
        supabaseUrl: env.SUPABASE_URL || '',
        supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
        nombreNegocio: env.NOMBRE_NEGOCIO || 'Lubricentro Ramos',
        ruc: env.RUC || '',
        direccion: env.DIRECCION || 'Juliaca - Puno',
        telefono: env.TELEFONO || '',
      };
      return new Response(`window.APP_CONFIG = ${JSON.stringify(cfg)};\n`, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
      });
    }

    if (url.pathname === '/api/admin-users') {
      if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
      return crearUsuario(req, env);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'No encontrado' }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

async function crearUsuario(req: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el Worker' }, 501);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'No autenticado' }, 401);

  // 1) ¿Quién llama? (valida el JWT con Supabase)
  const quien = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!quien.ok) return json({ error: 'Sesión inválida' }, 401);
  const { id } = (await quien.json()) as { id: string };

  const svc = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  // 2) ¿Es admin activo?
  const pr = await fetch(`${env.SUPABASE_URL}/rest/v1/perfiles?id=eq.${encodeURIComponent(id)}&select=rol,activo`, { headers: svc });
  const [perfil] = (await pr.json()) as { rol: string; activo: boolean }[];
  if (!perfil || perfil.rol !== 'admin' || !perfil.activo) return json({ error: 'Solo un administrador puede crear usuarios' }, 403);

  // 3) Validar datos
  const b = (await req.json().catch(() => ({}))) as { nombre?: string; email?: string; password?: string; rol?: string };
  const nombre = (b.nombre || '').trim(), email = (b.email || '').trim().toLowerCase(), password = b.password || '';
  const rol = ['admin', 'vendedor', 'mecanico'].includes(b.rol || '') ? b.rol : 'mecanico';
  if (!nombre || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) return json({ error: 'Nombre, correo válido y contraseña de 6+ caracteres son obligatorios' }, 400);

  // 4) Crear en Auth (confirmado) y activar su perfil con el rol elegido
  const cr = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: svc, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { nombre } }),
  });
  const nuevo = (await cr.json()) as { id?: string; msg?: string; message?: string };
  if (!cr.ok || !nuevo.id) return json({ error: nuevo.msg || nuevo.message || 'No se pudo crear el usuario' }, 400);
  const up = await fetch(`${env.SUPABASE_URL}/rest/v1/perfiles?id=eq.${nuevo.id}`, {
    method: 'PATCH', headers: { ...svc, Prefer: 'return=minimal' }, body: JSON.stringify({ rol, activo: true, nombre }),
  });
  if (!up.ok) return json({ error: 'Usuario creado, pero no se pudo activar su perfil. Actívalo en Usuarios.' }, 500);
  return json({ ok: true, id: nuevo.id });
}

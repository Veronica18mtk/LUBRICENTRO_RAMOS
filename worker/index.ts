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
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    const m = url.pathname.match(/^\/api\/codigo\/(\d{8,14})$/);
    if (m && req.method === 'GET') return buscarCodigo(m[1], ctx);

    if (url.pathname.startsWith('/api/')) return json({ error: 'No encontrado' }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

// ---------- Búsqueda de productos por código de barras en bases públicas ----------
interface Hallazgo { nombre: string; marca: string | null; cantidad: string | null; categorias: string; fuente: string }

async function buscarCodigo(codigo: string, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const clave = new Request(`https://cache.local/codigo/${codigo}`);
  const guardado = await cache.match(clave);
  if (guardado) return guardado;

  const h = (await openProducts(codigo)) || (await upcItemDb(codigo));
  const res = json({ codigo, encontrado: !!h, ...(h || {}), pais: paisGs1(codigo) });
  // Encontrados: 30 días; no encontrados: 1 día (puede que lo agreguen luego)
  res.headers.set('Cache-Control', `public, max-age=${h ? 2592000 : 86400}`);
  ctx.waitUntil(cache.put(clave, res.clone()));
  return res;
}

async function openProducts(codigo: string): Promise<Hallazgo | null> {
  try {
    const r = await fetch(`https://world.openproductsfacts.org/api/v2/product/${codigo}.json?fields=product_name,product_name_es,brands,quantity,categories_tags`,
      { headers: { 'User-Agent': 'LubricentroERP/1.0' }, signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { status?: number; product?: Record<string, unknown> };
    const p = j.product;
    const nombre = String(p?.product_name_es || p?.product_name || '').trim();
    if (j.status !== 1 || !nombre) return null;
    return { nombre, marca: String(p?.brands || '').split(',')[0].trim() || null, cantidad: (p?.quantity as string) || null,
      categorias: ((p?.categories_tags as string[]) || []).join(' '), fuente: 'Open Products Facts' };
  } catch { return null; }
}

async function upcItemDb(codigo: string): Promise<Hallazgo | null> {
  try {
    const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${codigo}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { items?: { title?: string; brand?: string; category?: string; size?: string }[] };
    const it = j.items?.[0];
    if (!it?.title) return null;
    return { nombre: it.title.trim(), marca: it.brand || null, cantidad: it.size || null, categorias: it.category || '', fuente: 'UPCitemdb' };
  } catch { return null; }
}

// País de registro del código (prefijo GS1), útil cuando no hay datos
function paisGs1(c: string): string | null {
  const e = c.padStart(13, '0');
  const p3 = +e.slice(0, 3);
  if (e.startsWith('775')) return 'Perú';
  if (p3 <= 139) return 'EE. UU. / Canadá';
  if (p3 >= 750 && p3 <= 759) return 'México';
  if (e.startsWith('779')) return 'Argentina';
  if (e.startsWith('780')) return 'Chile';
  if (e.startsWith('789') || e.startsWith('790')) return 'Brasil';
  if (e.startsWith('770') || e.startsWith('771')) return 'Colombia';
  if (e.startsWith('786')) return 'Ecuador';
  if (p3 >= 400 && p3 <= 440) return 'Alemania';
  if (p3 >= 450 && p3 <= 459 || p3 >= 490 && p3 <= 499) return 'Japón';
  if (p3 >= 690 && p3 <= 699) return 'China';
  if (p3 >= 300 && p3 <= 379) return 'Francia';
  if (p3 >= 840 && p3 <= 849) return 'España';
  if (e.startsWith('880')) return 'Corea del Sur';
  return null;
}

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

// Cloudflare Worker: sirve la app (assets estáticos) y un par de endpoints propios.
//  - GET  /config.js        -> configuración pública generada desde variables de entorno
//  - POST /api/admin-users  -> un admin crea usuarios (usa la service key, que nunca llega al navegador)
export interface Env {
  ASSETS: Fetcher;
  AI: Ai; // Workers AI (visión) para reconocer etiquetas
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

    if (url.pathname === '/api/reconocer') {
      if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
      return reconocerEtiqueta(req, env);
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

// ---------- Reconocimiento de etiquetas con IA (Workers AI, plan gratuito) ----------
const MODELO_VISION = '@cf/meta/llama-4-scout-17b-16e-instruct';
const CATEGORIAS = ['Aceite de motor', 'Aceite de caja / transmisión', 'Filtro de aceite', 'Filtro de aire', 'Filtro de combustible',
  'Filtro de cabina', 'Aditivo', 'Refrigerante', 'Líquido de frenos', 'Grasa', 'Accesorios', 'Otros'];
const ESQUEMA = {
  type: 'object',
  properties: {
    es_producto: { type: 'boolean' },
    nombre: { type: 'string' },
    marca: { type: 'string' },
    categoria: { type: 'string', enum: CATEGORIAS },
    unidad: { type: 'string', enum: ['UND', 'GAL', 'QT', 'L', 'KG', 'JGO'] },
    viscosidad: { type: 'string' },
    presentacion: { type: 'string' },
    norma: { type: 'string' },
    codigo_barras: { type: 'string' },
  },
  required: ['es_producto', 'nombre', 'marca', 'categoria', 'unidad', 'viscosidad', 'presentacion', 'norma', 'codigo_barras'],
};
const INSTRUCCIONES = `Eres el asistente de inventario de un lubricentro en Perú. Mira la foto de UN producto (aceite, filtro, aditivo, refrigerante, grasa, etc.) y extrae solo lo que se lee en la etiqueta.
Reglas:
- nombre: nombre comercial corto en español, con viscosidad y presentación si se ven. Ej.: "Mobil Super 2000 20W-50 (1 gal)", "Filtro de aceite Wix 51348".
- marca: la marca impresa (Mobil, Chevron, Vistony, Castrol, Shell, Wix, Fleetguard...).
- unidad: GAL si es galón (3,78 L), QT si es cuarto (946 ml), L si es un envase a granel por litro, KG para grasas por kilo, JGO para juegos; si no, UND.
- viscosidad: como "20W-50"; vacío si no aplica. norma: como "API SN" o "DOT 4"; vacío si no se ve.
- codigo_barras: SOLO los dígitos del código de barras (EAN/UPC) si se leen completos y nítidos en la foto; si no se ve o está borroso, cadena vacía. Nunca inventes dígitos.
- Si un dato no se ve, devuelve cadena vacía. No inventes.
- es_producto: false si la foto no muestra un producto.`;

async function reconocerEtiqueta(req: Request, env: Env): Promise<Response> {
  // Solo usuarios con sesión activa (protege la cuota diaria gratuita)
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Inicia sesión en modo nube para usar el reconocimiento por foto' }, 401);
  const quien = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!quien.ok) return json({ error: 'Sesión inválida' }, 401);

  const b = (await req.json().catch(() => ({}))) as { imagen?: string };
  const imagen = b.imagen || '';
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(imagen)) return json({ error: 'Imagen inválida' }, 400);
  if (imagen.length > 2_500_000) return json({ error: 'La imagen es muy grande' }, 413);

  let salida: unknown;
  try {
    const r = (await env.AI.run(MODELO_VISION as keyof AiModels, {
      messages: [
        { role: 'system', content: INSTRUCCIONES },
        { role: 'user', content: [{ type: 'text', text: 'Extrae los datos de este producto.' }, { type: 'image_url', image_url: { url: imagen } }] },
      ],
      response_format: { type: 'json_schema', json_schema: ESQUEMA },
      max_tokens: 600,
      temperature: 0.1,
    } as never)) as { response?: unknown };
    salida = r?.response;
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/4006|daily free allocation|neurons/i.test(msg)) return json({ error: 'Se agotó la cuota gratuita de IA de hoy. Vuelve a intentarlo mañana o registra el producto a mano.' }, 429);
    return json({ error: 'No se pudo analizar la foto. Intenta de nuevo con mejor luz.' }, 502);
  }
  const d = interpretar(salida);
  if (!d) return json({ error: 'No se pudo leer la etiqueta. Toma la foto más de cerca y con buena luz.' }, 422);
  if (d['es_producto'] === false) return json({ error: 'No se reconoce un producto en la foto.' }, 422);

  // Doble validación del código: solo dígitos y dígito verificador correcto
  const leido = String(d['codigo_barras'] || '').replace(/\D/g, '');
  const codigoValido = leido && codigoEsValido(leido) ? leido : null;
  return json({
    nombre: limpiar(d['nombre']), marca: limpiar(d['marca']),
    categoria: CATEGORIAS.includes(String(d['categoria'])) ? d['categoria'] : 'Otros',
    unidad: ['UND', 'GAL', 'QT', 'L', 'KG', 'JGO'].includes(String(d['unidad'])) ? d['unidad'] : 'UND',
    viscosidad: limpiar(d['viscosidad']), presentacion: limpiar(d['presentacion']), norma: limpiar(d['norma']),
    codigo_barras: codigoValido,
    codigo_estado: codigoValido ? 'valido' : leido ? 'invalido' : 'no_visible',
  });
}

function interpretar(x: unknown): Record<string, unknown> | null {
  if (x && typeof x === 'object') return x as Record<string, unknown>;
  if (typeof x !== 'string') return null;
  const m = x.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}
const limpiar = (v: unknown) => String(v ?? '').trim().slice(0, 120) || null;

/** Valida EAN-8, UPC-A (12), EAN-13 y GTIN-14 por su dígito verificador */
export function codigoEsValido(c: string): boolean {
  if (![8, 12, 13, 14].includes(c.length)) return false;
  const d = c.split('').map(Number);
  const control = d.pop()!;
  const suma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10 === control;
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

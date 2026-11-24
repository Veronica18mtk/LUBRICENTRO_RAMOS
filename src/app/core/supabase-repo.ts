// Modo nube: Supabase (Postgres + Auth + Realtime).
// Todo cambio de stock pasa por funciones SQL (rpc) que validan y escriben el kardex.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Cliente, CompraResumen, Dashboard, Movimiento, NuevaCompra, NuevaVenta, Producto, Recordatorio, Reporte,
  ResultadoConteo, Usuario, Vehiculo, VentaDetalle, VentaResumen,
} from './models';
import { Repo } from './repo';
import { normPlaca } from './util';

type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ini = (d: string) => `${d}T00:00:00-05:00`;
const fin = (d: string) => `${d}T23:59:59.999-05:00`;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function ok<T>(r: { data: T; error: { message: string } | null } | { data: unknown; error: { message: string } }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

function producto(p: Fila): Producto {
  return { ...p, precio_compra: n(p['precio_compra']), precio_venta: n(p['precio_venta']), stock: n(p['stock']), stock_minimo: n(p['stock_minimo']) } as Producto;
}

export class SupabaseRepo implements Repo {
  readonly sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  // ---------- sesión ----------
  private async perfil(id: string): Promise<Usuario | null> {
    const { data } = await this.sb.from('perfiles').select('id, nombre, email, rol, activo').eq('id', id).maybeSingle();
    return (data as Usuario) || null;
  }
  async sesion() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return null;
    return this.perfil(data.session.user.id);
  }
  async ingresar(email: string, password: string) {
    const r = ok(await this.sb.auth.signInWithPassword({ email, password }));
    const p = await this.perfil(r.user!.id);
    if (!p) throw new Error('Tu usuario no tiene perfil. Ejecuta schema.sql en Supabase.');
    return p;
  }
  async registrarse(nombre: string, email: string, password: string) {
    const r = ok(await this.sb.auth.signUp({ email, password, options: { data: { nombre }, emailRedirectTo: location.origin } }));
    return { requiereConfirmacion: !r.session };
  }
  async recuperar(email: string) { ok(await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/cuenta' })); }
  async cambiarPassword(nueva: string) { ok(await this.sb.auth.updateUser({ password: nueva })); }
  async salir() { await this.sb.auth.signOut(); }

  // ---------- productos ----------
  async productos() {
    const d = ok(await this.sb.from('productos').select('*').order('categoria').order('nombre'));
    return (d as Fila[]).map(producto);
  }
  async crearProducto(p: Partial<Producto>) { return ok(await this.sb.rpc('crear_producto', { p })) as number; }
  async actualizarProducto(id: number, p: Partial<Producto>) {
    const permitidos = ['codigo_barras', 'nombre', 'marca', 'categoria', 'unidad', 'precio_compra', 'precio_venta', 'stock_minimo', 'ubicacion', 'activo'] as const;
    const cambios: Fila = { actualizado_en: new Date().toISOString() };
    for (const k of permitidos) if (p[k] !== undefined) cambios[k] = typeof p[k] === 'string' ? (p[k] as string).trim() || null : p[k];
    ok(await this.sb.from('productos').update(cambios).eq('id', id));
  }
  private mov(m: Fila): Movimiento {
    return { ...m, cantidad: n(m['cantidad']), stock_resultante: n(m['stock_resultante']), producto: m['productos']?.nombre,
      unidad: m['productos']?.unidad, usuario: m['perfiles']?.nombre || null } as Movimiento;
  }
  async kardex(productoId: number) {
    const d = ok(await this.sb.from('movimientos').select('*, perfiles(nombre)').eq('producto_id', productoId).order('id', { ascending: false }).limit(300));
    return (d as Fila[]).map((m) => this.mov(m));
  }
  async movimientos(desde: string, hasta: string) {
    const d = ok(await this.sb.from('movimientos').select('*, productos(nombre, unidad), perfiles(nombre)')
      .gte('fecha', ini(desde)).lte('fecha', fin(hasta)).order('id', { ascending: false }).limit(1000));
    return (d as Fila[]).map((m) => this.mov(m));
  }
  async aplicarConteo(nota: string, conteos: { producto_id: number; contado: number }[]) {
    const d = ok(await this.sb.rpc('aplicar_conteo', { p: { nota, conteos } })) as Fila[];
    return d.map((x) => ({ ...x, antes: n(x['antes']), contado: n(x['contado']), diferencia: n(x['diferencia']) })) as ResultadoConteo[];
  }

  // ---------- ventas ----------
  async registrarVenta(v: NuevaVenta) { return ok(await this.sb.rpc('registrar_venta', { p: v })) as number; }

  private resumen(x: Fila): VentaResumen {
    return { id: x['id'], fecha: x['fecha'], total: n(x['total']), metodo_pago: x['metodo_pago'], estado: x['estado'], revisar: x['revisar'],
      cliente: x['clientes']?.nombre || null, placa: x['vehiculos']?.placa || null, usuario: x['usuario']?.nombre || null };
  }
  async ventas(desde: string, hasta: string) {
    const d = ok(await this.sb.from('ventas')
      .select('id, fecha, total, metodo_pago, estado, revisar, clientes(nombre), vehiculos(placa), usuario:perfiles!ventas_usuario_id_fkey(nombre)')
      .gte('fecha', ini(desde)).lte('fecha', fin(hasta)).order('fecha', { ascending: false }).limit(1000));
    return (d as Fila[]).map((x) => this.resumen(x));
  }
  async venta(id: number): Promise<VentaDetalle> {
    const x = ok(await this.sb.from('ventas')
      .select('*, clientes(*), vehiculos(*), usuario:perfiles!ventas_usuario_id_fkey(nombre), mecanico:perfiles!ventas_mecanico_id_fkey(nombre), venta_items(*, productos(unidad))')
      .eq('id', id).single()) as Fila;
    const v = x['vehiculos'];
    return {
      ...this.resumen(x), subtotal: n(x['subtotal']), descuento: n(x['descuento']), km_actual: x['km_actual'], km_proximo: x['km_proximo'],
      fecha_proxima: x['fecha_proxima'], observaciones: x['observaciones'], motivo_anulacion: x['motivo_anulacion'],
      mecanico: x['mecanico']?.nombre || null, cliente_doc: x['clientes']?.doc_numero || null,
      cliente_doc_tipo: x['clientes']?.doc_tipo || null, cliente_telefono: x['clientes']?.telefono || null,
      vehiculo: v ? [v.marca, v.modelo, v.anio].filter(Boolean).join(' ') : null,
      items: (x['venta_items'] as Fila[]).sort((a, b) => a['id'] - b['id']).map((i) => ({
        producto_id: i['producto_id'], descripcion: i['descripcion'], cantidad: n(i['cantidad']),
        precio_unitario: n(i['precio_unitario']), subtotal: n(i['subtotal']), unidad: i['productos']?.unidad })),
    };
  }
  async anularVenta(id: number, motivo: string) { ok(await this.sb.rpc('anular_venta', { p_id: id, p_motivo: motivo })); }

  // ---------- vehículos / clientes ----------
  async vehiculoPorPlaca(placa: string) {
    const v = ok(await this.sb.from('vehiculos').select('*, clientes(*)').eq('placa', normPlaca(placa)).maybeSingle()) as Fila | null;
    if (!v) return null;
    const h = ok(await this.sb.from('ventas').select('id, fecha, km_actual, km_proximo, total, estado, venta_items(descripcion, cantidad)')
      .eq('vehiculo_id', v['id']).order('fecha', { ascending: false }).limit(50)) as Fila[];
    return {
      ...(v as Vehiculo), cliente: v['clientes'] || null,
      historial: h.map((x) => ({ id: x['id'], fecha: x['fecha'], km_actual: x['km_actual'], km_proximo: x['km_proximo'], total: n(x['total']),
        estado: x['estado'], detalle: (x['venta_items'] as Fila[]).map((i) => `${i['descripcion']} x${n(i['cantidad'])}`).join(' · ') })),
    };
  }
  async vehiculos(q: string) {
    let query = this.sb.from('vehiculos').select('*, clientes(*), ventas(fecha)').order('creado_en', { ascending: false }).limit(100);
    const t = q.trim().replace(/[,()]/g, ' ');
    if (t) query = query.or(`placa.ilike.%${normPlaca(t) || t}%,marca.ilike.%${t}%,modelo.ilike.%${t}%`);
    const d = ok(await query) as Fila[];
    return d.map((v) => ({ ...(v as Vehiculo), cliente: v['clientes'] || null,
      ultimo_servicio: (v['ventas'] as Fila[]).map((x) => x['fecha'] as string).sort().pop() || null }))
      .sort((a, b) => (b.ultimo_servicio || '').localeCompare(a.ultimo_servicio || ''));
  }
  async clientes(q: string) {
    let query = this.sb.from('clientes').select('*, vehiculos(placa)').order('nombre').limit(100);
    const t = q.trim().replace(/[,()]/g, ' ');
    if (t) query = query.or(`nombre.ilike.%${t}%,doc_numero.ilike.%${t}%,telefono.ilike.%${t}%`);
    const d = ok(await query) as Fila[];
    return d.map((c) => ({ ...(c as Cliente), placas: (c['vehiculos'] as Fila[]).map((v) => v['placa']).join(', ') }));
  }
  async actualizarCliente(id: number, c: Partial<Cliente>) {
    ok(await this.sb.from('clientes').update({ doc_tipo: c.doc_tipo, doc_numero: c.doc_numero?.trim() || null, nombre: c.nombre?.trim(), telefono: c.telefono?.trim() || null }).eq('id', id));
  }

  // ---------- compras ----------
  async proveedores() { return ok(await this.sb.from('proveedores').select('*').order('nombre')) as { id: number; nombre: string; ruc: string | null }[]; }
  async registrarCompra(c: NuevaCompra) { return ok(await this.sb.rpc('registrar_compra', { p: c })) as number; }
  private compraVista(c: Fila): CompraResumen {
    const items = (c['compra_items'] as Fila[]) || [];
    return { id: c['id'], fecha: c['fecha'], comprobante: c['comprobante'], total: n(c['total']), anulada: c['anulada'],
      proveedor: c['proveedores']?.nombre || null, usuario: c['perfiles']?.nombre || null,
      n_items: items[0]?.['count'] ?? items.length,
      items: items.filter((i) => i['producto_id']).map((i) => ({ producto_id: i['producto_id'], nombre: i['productos']?.nombre, unidad: i['productos']?.unidad,
        cantidad: n(i['cantidad']), costo_unitario: n(i['costo_unitario']), subtotal: n(i['subtotal']) })) };
  }
  async compras() {
    const d = ok(await this.sb.from('compras').select('*, proveedores(nombre), perfiles(nombre), compra_items(count)').order('id', { ascending: false }).limit(200)) as Fila[];
    return d.map((c) => this.compraVista(c));
  }
  async compra(id: number) {
    return this.compraVista(ok(await this.sb.from('compras').select('*, proveedores(nombre), perfiles(nombre), compra_items(*, productos(nombre, unidad))').eq('id', id).single()) as Fila);
  }
  async anularCompra(id: number) { ok(await this.sb.rpc('anular_compra', { p_id: id })); }

  // ---------- tablero / reportes ----------
  async dashboard() { return ok(await this.sb.rpc('dashboard')) as Dashboard; }
  async recordatorios(dias: number) { return ok(await this.sb.rpc('recordatorios', { p_dias: dias })) as Recordatorio[]; }
  async reporte(desde: string, hasta: string) { return ok(await this.sb.rpc('reporte', { p_desde: desde, p_hasta: hasta })) as Reporte; }

  // ---------- usuarios ----------
  async usuarios() { return ok(await this.sb.from('perfiles').select('id, nombre, email, rol, activo').order('activo', { ascending: false }).order('nombre')) as Usuario[]; }
  async personal() { return ok(await this.sb.from('perfiles').select('id, nombre, rol').eq('activo', true).order('nombre')) as { id: string; nombre: string; rol: string }[]; }
  async actualizarUsuario(id: string, u: Partial<Usuario>) {
    const cambios: Fila = {};
    for (const k of ['nombre', 'rol', 'activo'] as const) if (u[k] !== undefined) cambios[k] = u[k];
    ok(await this.sb.from('perfiles').update(cambios).eq('id', id));
  }
  /** Crea un usuario desde el panel (requiere el Worker de Cloudflare con la service key) */
  async crearUsuario(u: { nombre: string; email: string; password: string; rol: string }) {
    const { data } = await this.sb.auth.getSession();
    const r = await fetch('/api/admin-users', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` }, body: JSON.stringify(u),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo crear el usuario (¿está configurado el Worker?)');
  }

  alCambiar(cb: (tabla: string) => void) {
    const canal = this.sb.channel('cambios-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => cb('productos'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas' }, () => cb('ventas'))
      .subscribe();
    return () => { this.sb.removeChannel(canal); };
  }
}

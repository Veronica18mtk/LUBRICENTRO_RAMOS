// Modo local: todo se guarda en este navegador (IndexedDB). Sin cuenta, ideal para probar.
// Replica las mismas reglas que las funciones SQL de Supabase.
import {
  Cliente, CompraResumen, Dashboard, HistorialServicio, Movimiento, NuevaCompra, NuevaVenta, Producto,
  Recordatorio, Reporte, ResultadoConteo, Usuario, Vehiculo, VentaDetalle, VentaResumen, METODOS_PAGO,
} from './models';
import { Repo } from './repo';
import { kvGet, kvSet } from './kv';
import { diaLima, hoy, normPlaca, numeroCO, numeroOS, r2, r3 } from './util';

const CLAVE = 'estado';
const USUARIO_LOCAL: Usuario = { id: 'local', nombre: 'Administrador (local)', rol: 'admin', activo: true };

interface VentaRow {
  id: number; client_uuid?: string; fecha: string; cliente_id: number | null; vehiculo_id: number | null;
  km_actual: number | null; km_proximo: number | null; fecha_proxima: string | null; metodo_pago: string;
  subtotal: number; descuento: number; total: number; observaciones: string | null; usuario_id: string;
  mecanico_id: string | null; estado: 'pagada' | 'anulada'; revisar: boolean; motivo_anulacion: string | null;
  items: { producto_id: number; descripcion: string; cantidad: number; precio_unitario: number; costo_unitario: number; subtotal: number }[];
}
interface CompraRow {
  id: number; proveedor_id: number | null; comprobante: string | null; fecha: string; total: number;
  usuario_id: string; anulada: boolean; items: { producto_id: number; cantidad: number; costo_unitario: number; subtotal: number }[];
}
interface Estado {
  seq: Record<string, number>;
  productos: Producto[];
  clientes: Cliente[];
  vehiculos: Vehiculo[];
  proveedores: { id: number; nombre: string; ruc: string | null }[];
  ventas: VentaRow[];
  compras: CompraRow[];
  movimientos: (Omit<Movimiento, 'producto' | 'unidad' | 'usuario'> & { usuario_id: string; costo_unitario: number })[];
}

const vacio = (): Estado => ({ seq: {}, productos: [], clientes: [], vehiculos: [], proveedores: [], ventas: [], compras: [], movimientos: [] });
const txt = (v: unknown) => (v === undefined || v === null ? null : String(v).trim() || null);
const entero = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d ? parseInt(d, 10) : null; };
const enRango = (iso: string, desde: string, hasta: string) => { const d = diaLima(iso); return d >= desde && d <= hasta; };

export class LocalRepo implements Repo {
  private s: Estado = vacio();
  private listo: Promise<void>;
  private oyentes = new Set<(t: string) => void>();

  constructor() {
    this.listo = kvGet<Estado>(CLAVE).then((e) => { if (e) this.s = { ...vacio(), ...e }; });
  }

  private sig(tabla: string) { this.s.seq[tabla] = (this.s.seq[tabla] || 0) + 1; return this.s.seq[tabla]; }
  private async guardar(tabla: string) { await kvSet(CLAVE, this.s); this.oyentes.forEach((cb) => cb(tabla)); }
  /** Ejecuta un cambio "transaccional": si falla, se restaura el estado anterior */
  private async tx<T>(tabla: string, fn: () => T): Promise<T> {
    await this.listo;
    const copia = structuredClone(this.s);
    try { const r = fn(); await this.guardar(tabla); return r; } catch (e) { this.s = copia; throw e; }
  }
  private prod(id: number) {
    const p = this.s.productos.find((x) => x.id === Number(id));
    if (!p) throw new Error('Producto no encontrado');
    return p;
  }
  private mover(p: Producto, cantidad: number, tipo: Movimiento['tipo'], referencia: string | null, nota: string | null, costo?: number) {
    if (p.es_servicio) return;
    p.stock = r3(p.stock + cantidad);
    this.s.movimientos.push({
      id: this.sig('movimientos'), fecha: new Date().toISOString(), producto_id: p.id, tipo, cantidad: r3(cantidad),
      stock_resultante: p.stock, referencia, nota, usuario_id: 'local', costo_unitario: costo ?? p.precio_compra,
    });
  }

  // ---------- sesión ----------
  async sesion() { return USUARIO_LOCAL; }
  async ingresar() { return USUARIO_LOCAL; }
  async registrarse(): Promise<{ requiereConfirmacion: boolean }> { throw new Error('En modo local no hay cuentas'); }
  async recuperar() { /* no aplica */ }
  async cambiarPassword() { throw new Error('En modo local no hay contraseña'); }
  async salir() { /* no aplica */ }

  // ---------- productos ----------
  async productos() {
    await this.listo;
    return [...this.s.productos].sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));
  }

  crearProducto(p: Partial<Producto> & { stock?: number }) {
    return this.tx('productos', () => {
      const nombre = txt(p.nombre);
      if (!nombre) throw new Error('El nombre es obligatorio');
      const codigo = txt(p.codigo_barras);
      if (codigo && this.s.productos.some((x) => x.codigo_barras === codigo)) throw new Error('Ya existe otro producto con ese código de barras');
      const nuevo: Producto = {
        id: this.sig('productos'), codigo_barras: codigo, nombre, marca: txt(p.marca), categoria: txt(p.categoria) || 'Otros',
        unidad: txt(p.unidad) || 'UND', es_servicio: !!p.es_servicio, precio_compra: r2(Math.max(0, Number(p.precio_compra) || 0)),
        precio_venta: r2(Math.max(0, Number(p.precio_venta) || 0)), stock: 0, stock_minimo: r3(Math.max(0, Number(p.stock_minimo) || 0)),
        ubicacion: txt(p.ubicacion), activo: true,
      };
      this.s.productos.push(nuevo);
      const ini = nuevo.es_servicio ? 0 : r3(Math.max(0, Number(p.stock) || 0));
      if (ini > 0) this.mover(nuevo, ini, 'INICIAL', null, 'Stock inicial');
      return nuevo.id;
    });
  }

  async actualizarProducto(id: number, p: Partial<Producto>) {
    await this.tx('productos', () => {
      const actual = this.prod(id);
      const codigo = p.codigo_barras === undefined ? actual.codigo_barras : txt(p.codigo_barras);
      if (codigo && this.s.productos.some((x) => x.codigo_barras === codigo && x.id !== id)) throw new Error('Ya existe otro producto con ese código de barras');
      const { stock: _ignorado, id: _id, es_servicio: _s, ...resto } = p;
      Object.assign(actual, resto, { codigo_barras: codigo });
      if (resto.nombre !== undefined && !txt(resto.nombre)) throw new Error('El nombre es obligatorio');
    });
  }

  async kardex(productoId: number) {
    await this.listo;
    return this.s.movimientos.filter((m) => m.producto_id === productoId).reverse().slice(0, 300)
      .map((m) => ({ ...m, usuario: 'Local' }));
  }

  async movimientos(desde: string, hasta: string) {
    await this.listo;
    return this.s.movimientos.filter((m) => enRango(m.fecha, desde, hasta)).reverse().map((m) => {
      const p = this.s.productos.find((x) => x.id === m.producto_id);
      return { ...m, producto: p?.nombre, unidad: p?.unidad, usuario: 'Local' };
    });
  }

  aplicarConteo(nota: string, conteos: { producto_id: number; contado: number }[]) {
    return this.tx('productos', () => conteos.map((c) => {
      const p = this.prod(c.producto_id);
      if (p.es_servicio) throw new Error('Producto inválido');
      const contado = r3(Number(c.contado));
      if (!Number.isFinite(contado) || contado < 0) throw new Error(`Cantidad contada inválida para "${p.nombre}"`);
      const antes = p.stock, dif = r3(contado - p.stock);
      if (dif !== 0) this.mover(p, dif, 'AJUSTE', null, `${nota || 'Conteo físico'} (sistema: ${antes}, contado: ${contado})`);
      return { producto_id: p.id, nombre: p.nombre, antes, contado, diferencia: dif };
    }));
  }

  // ---------- clientes / vehículos ----------
  private upsertCliente(c: Partial<Cliente> | null | undefined): number | null {
    if (!c) return null;
    if (c.id) return Number(c.id);
    const doc = txt(c.doc_numero), nombre = txt(c.nombre);
    if (doc) {
      const ex = this.s.clientes.find((x) => x.doc_numero === doc);
      if (ex) { ex.nombre = nombre || ex.nombre; ex.telefono = txt(c.telefono) || ex.telefono; return ex.id; }
    }
    if (!nombre) return null;
    const id = this.sig('clientes');
    this.s.clientes.push({ id, doc_tipo: txt(c.doc_tipo) || (doc?.length === 11 ? 'RUC' : 'DNI'), doc_numero: doc, nombre, telefono: txt(c.telefono) });
    return id;
  }
  private upsertVehiculo(v: NuevaVenta['vehiculo'], clienteId: number | null): number | null {
    const placa = normPlaca(v?.placa);
    if (!placa || !v) return null;
    const ex = this.s.vehiculos.find((x) => x.placa === placa);
    const anio = entero(v.anio);
    if (ex) {
      ex.cliente_id = clienteId ?? ex.cliente_id; ex.marca = txt(v.marca) || ex.marca;
      ex.modelo = txt(v.modelo) || ex.modelo; ex.anio = anio ?? ex.anio;
      return ex.id;
    }
    const id = this.sig('vehiculos');
    this.s.vehiculos.push({ id, placa, cliente_id: clienteId, marca: txt(v.marca), modelo: txt(v.modelo), anio });
    return id;
  }

  async vehiculoPorPlaca(placa: string) {
    await this.listo;
    const v = this.s.vehiculos.find((x) => x.placa === normPlaca(placa));
    if (!v) return null;
    const historial: HistorialServicio[] = this.s.ventas.filter((x) => x.vehiculo_id === v.id).reverse().slice(0, 50).map((x) => ({
      id: x.id, fecha: x.fecha, km_actual: x.km_actual, km_proximo: x.km_proximo, total: x.total, estado: x.estado,
      detalle: x.items.map((i) => `${i.descripcion} x${i.cantidad}`).join(' · '),
    }));
    return { ...v, cliente: this.s.clientes.find((c) => c.id === v.cliente_id) || null, historial };
  }

  async vehiculos(q: string) {
    await this.listo;
    const t = q.trim().toLowerCase();
    return this.s.vehiculos.map((v) => {
      const cliente = this.s.clientes.find((c) => c.id === v.cliente_id) || null;
      const ult = this.s.ventas.filter((x) => x.vehiculo_id === v.id && x.estado === 'pagada').map((x) => x.fecha).sort().pop() || null;
      return { ...v, cliente, ultimo_servicio: ult };
    }).filter((v) => !t || [v.placa, v.marca, v.modelo, v.cliente?.nombre].some((x) => (x || '').toLowerCase().includes(t)))
      .sort((a, b) => (b.ultimo_servicio || '').localeCompare(a.ultimo_servicio || '')).slice(0, 100);
  }

  async clientes(q: string) {
    await this.listo;
    const t = q.trim().toLowerCase();
    return this.s.clientes.filter((c) => !t || [c.nombre, c.doc_numero, c.telefono].some((x) => (x || '').toLowerCase().includes(t)))
      .map((c) => ({ ...c, placas: this.s.vehiculos.filter((v) => v.cliente_id === c.id).map((v) => v.placa).join(', ') }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)).slice(0, 100);
  }

  async actualizarCliente(id: number, c: Partial<Cliente>) {
    await this.tx('clientes', () => {
      const ex = this.s.clientes.find((x) => x.id === id);
      if (!ex) throw new Error('Cliente no encontrado');
      const doc = txt(c.doc_numero);
      if (doc && this.s.clientes.some((x) => x.doc_numero === doc && x.id !== id)) throw new Error('Ya existe un cliente con ese documento');
      if (!txt(c.nombre)) throw new Error('El nombre es obligatorio');
      Object.assign(ex, { doc_tipo: c.doc_tipo || ex.doc_tipo, doc_numero: doc, nombre: txt(c.nombre), telefono: txt(c.telefono) });
    });
  }

  // ---------- ventas ----------
  registrarVenta(v: NuevaVenta) {
    return this.tx('ventas', () => {
      if (v.client_uuid) { const ya = this.s.ventas.find((x) => x.client_uuid === v.client_uuid); if (ya) return ya.id; }
      if (!v.items?.length) throw new Error('Agrega al menos un producto o servicio');
      const porProducto = new Map<number, number>();
      for (const it of v.items) {
        if (!(Number(it.cantidad) > 0)) throw new Error('Las cantidades deben ser mayores a 0');
        porProducto.set(Number(it.producto_id), (porProducto.get(Number(it.producto_id)) || 0) + Number(it.cantidad));
      }
      for (const [pid, c] of porProducto) {
        const p = this.prod(pid);
        if (!p.activo) throw new Error('Producto no encontrado o inactivo');
        if (!p.es_servicio && r3(p.stock - c) < 0)
          throw new Error(`Stock insuficiente de "${p.nombre}": hay ${p.stock} ${p.unidad}, se piden ${r3(c)}. Registra primero la compra o haz un ajuste.`);
      }
      const clienteId = this.upsertCliente(v.cliente);
      const vehiculoId = this.upsertVehiculo(v.vehiculo, clienteId);
      const id = this.sig('ventas');
      const ref = numeroOS(id);
      let sub = 0;
      const items = v.items.map((it) => {
        const p = this.prod(it.producto_id);
        const cantidad = r3(Number(it.cantidad));
        const precio = it.precio_unitario === undefined || it.precio_unitario === null || (it.precio_unitario as unknown) === ''
          ? p.precio_venta : r2(Math.max(0, Number(it.precio_unitario)));
        const st = r2(cantidad * precio);
        sub += st;
        const fila = { producto_id: p.id, descripcion: p.nombre, cantidad, precio_unitario: precio, costo_unitario: p.precio_compra, subtotal: st };
        this.mover(p, -cantidad, 'SALIDA', ref, null);
        return fila;
      });
      sub = r2(sub);
      const descuento = r2(Math.min(sub, Math.max(0, Number(v.descuento) || 0)));
      this.s.ventas.push({
        id, client_uuid: v.client_uuid, fecha: new Date().toISOString(), cliente_id: clienteId, vehiculo_id: vehiculoId,
        km_actual: entero(v.km_actual), km_proximo: entero(v.km_proximo), fecha_proxima: v.fecha_proxima || null,
        metodo_pago: METODOS_PAGO.includes(v.metodo_pago) ? v.metodo_pago : 'Efectivo', subtotal: sub, descuento,
        total: r2(sub - descuento), observaciones: txt(v.observaciones), usuario_id: 'local', mecanico_id: v.mecanico_id || null,
        estado: 'pagada', revisar: false, motivo_anulacion: null, items,
      });
      return id;
    });
  }

  private resumen(x: VentaRow): VentaResumen {
    return {
      id: x.id, fecha: x.fecha, total: x.total, metodo_pago: x.metodo_pago, estado: x.estado, revisar: x.revisar,
      cliente: this.s.clientes.find((c) => c.id === x.cliente_id)?.nombre || null,
      placa: this.s.vehiculos.find((v) => v.id === x.vehiculo_id)?.placa || null, usuario: 'Local',
    };
  }

  async ventas(desde: string, hasta: string) {
    await this.listo;
    return this.s.ventas.filter((x) => enRango(x.fecha, desde, hasta)).reverse().map((x) => this.resumen(x));
  }

  async venta(id: number): Promise<VentaDetalle> {
    await this.listo;
    const x = this.s.ventas.find((v) => v.id === Number(id));
    if (!x) throw new Error('Orden no encontrada');
    const c = this.s.clientes.find((k) => k.id === x.cliente_id);
    const v = this.s.vehiculos.find((k) => k.id === x.vehiculo_id);
    return {
      ...this.resumen(x), subtotal: x.subtotal, descuento: x.descuento, km_actual: x.km_actual, km_proximo: x.km_proximo,
      fecha_proxima: x.fecha_proxima, observaciones: x.observaciones, motivo_anulacion: x.motivo_anulacion, mecanico: null,
      cliente_doc: c?.doc_numero || null, cliente_doc_tipo: c?.doc_tipo || null, cliente_telefono: c?.telefono || null,
      vehiculo: v ? [v.marca, v.modelo, v.anio].filter(Boolean).join(' ') : null,
      items: x.items.map((i) => ({ ...i, unidad: this.s.productos.find((p) => p.id === i.producto_id)?.unidad })),
    };
  }

  async anularVenta(id: number, motivo: string) {
    await this.tx('ventas', () => {
      if (!txt(motivo)) throw new Error('Indica el motivo de la anulación');
      const v = this.s.ventas.find((x) => x.id === id);
      if (!v) throw new Error('Orden no encontrada');
      if (v.estado === 'anulada') throw new Error('La orden ya está anulada');
      for (const it of v.items) this.mover(this.prod(it.producto_id), it.cantidad, 'ANULACION', numeroOS(id), motivo);
      v.estado = 'anulada'; v.motivo_anulacion = motivo;
    });
  }

  // ---------- compras ----------
  async proveedores() { await this.listo; return [...this.s.proveedores].sort((a, b) => a.nombre.localeCompare(b.nombre)); }

  registrarCompra(c: NuevaCompra) {
    return this.tx('compras', () => {
      if (!c.items?.length) throw new Error('Agrega al menos un producto');
      let provId: number | null = null;
      const prov = txt(c.proveedor);
      if (prov) {
        const ex = this.s.proveedores.find((p) => p.nombre.toLowerCase() === prov.toLowerCase());
        provId = ex ? ex.id : this.sig('proveedores');
        if (!ex) this.s.proveedores.push({ id: provId, nombre: prov, ruc: txt(c.ruc) });
      }
      const id = this.sig('compras');
      const ref = numeroCO(id) + (txt(c.comprobante) ? ' / ' + txt(c.comprobante) : '');
      const items = c.items.map((it) => {
        const cantidad = r3(Number(it.cantidad)), costo = r2(Math.max(0, Number(it.costo_unitario) || 0));
        if (!(cantidad > 0)) throw new Error('Las cantidades deben ser mayores a 0');
        const p = this.prod(it.producto_id);
        if (p.es_servicio) throw new Error(`"${p.nombre}" es un servicio, no se compra`);
        const base = Math.max(0, p.stock);
        const nuevoCosto = base + cantidad > 0 ? r2((base * p.precio_compra + cantidad * costo) / (base + cantidad)) : costo;
        this.mover(p, cantidad, 'ENTRADA', ref, null, costo);
        p.precio_compra = nuevoCosto;
        if (it.precio_venta && Number(it.precio_venta) > 0) p.precio_venta = r2(Number(it.precio_venta));
        return { producto_id: p.id, cantidad, costo_unitario: costo, subtotal: r2(cantidad * costo) };
      });
      this.s.compras.push({
        id, proveedor_id: provId, comprobante: txt(c.comprobante), fecha: c.fecha || hoy(),
        total: r2(items.reduce((s, i) => s + i.subtotal, 0)), usuario_id: 'local', anulada: false, items,
      });
      return id;
    });
  }

  private compraVista(c: CompraRow): CompraResumen {
    return {
      id: c.id, fecha: c.fecha, comprobante: c.comprobante, total: c.total, anulada: c.anulada, usuario: 'Local',
      proveedor: this.s.proveedores.find((p) => p.id === c.proveedor_id)?.nombre || null, n_items: c.items.length,
      items: c.items.map((i) => { const p = this.s.productos.find((x) => x.id === i.producto_id); return { ...i, nombre: p?.nombre || '', unidad: p?.unidad || '' }; }),
    };
  }
  async compras() { await this.listo; return [...this.s.compras].reverse().slice(0, 200).map((c) => this.compraVista(c)); }
  async compra(id: number) {
    await this.listo;
    const c = this.s.compras.find((x) => x.id === Number(id));
    if (!c) throw new Error('Compra no encontrada');
    return this.compraVista(c);
  }
  async anularCompra(id: number) {
    await this.tx('compras', () => {
      const c = this.s.compras.find((x) => x.id === id);
      if (!c) throw new Error('Compra no encontrada');
      if (c.anulada) throw new Error('La compra ya está anulada');
      for (const it of c.items) {
        const p = this.prod(it.producto_id);
        if (r3(p.stock - it.cantidad) < 0) throw new Error(`No se puede anular: "${p.nombre}" ya se vendió (stock actual ${p.stock})`);
        this.mover(p, -it.cantidad, 'ANULACION', numeroCO(id), 'Anulación de compra');
      }
      c.anulada = true;
    });
  }

  // ---------- tablero / reportes ----------
  async dashboard(): Promise<Dashboard> {
    await this.listo;
    const d = hoy();
    const vh = this.s.ventas.filter((v) => v.estado === 'pagada' && diaLima(v.fecha) === d);
    const metodos = new Map<string, number>();
    vh.forEach((v) => metodos.set(v.metodo_pago, r2((metodos.get(v.metodo_pago) || 0) + v.total)));
    const activos = this.s.productos.filter((p) => p.activo && !p.es_servicio);
    return {
      fecha: d,
      ventas_hoy: { n: vh.length, total: r2(vh.reduce((s, v) => s + v.total, 0)) },
      por_metodo: [...metodos].map(([metodo_pago, total]) => ({ metodo_pago, total })).sort((a, b) => b.total - a.total),
      stock_bajo: activos.filter((p) => p.stock <= p.stock_minimo).sort((a, b) => (a.stock - a.stock_minimo) - (b.stock - b.stock_minimo)).slice(0, 30),
      n_productos: activos.length,
      por_revisar: this.s.ventas.filter((v) => v.revisar && v.estado === 'pagada').length,
      valor_inventario: r2(activos.filter((p) => p.stock > 0).reduce((s, p) => s + p.stock * p.precio_compra, 0)),
    };
  }

  async recordatorios(dias: number): Promise<Recordatorio[]> {
    await this.listo;
    const limite = hoy(dias);
    const ultima = new Map<number, VentaRow>();
    for (const v of this.s.ventas) if (v.estado === 'pagada' && v.vehiculo_id) ultima.set(v.vehiculo_id, v);
    return [...ultima.values()].filter((v) => v.fecha_proxima && v.fecha_proxima <= limite).map((v) => {
      const veh = this.s.vehiculos.find((x) => x.id === v.vehiculo_id)!;
      const c = this.s.clientes.find((x) => x.id === v.cliente_id);
      return { venta_id: v.id, fecha: v.fecha, fecha_proxima: v.fecha_proxima!, km_proximo: v.km_proximo, placa: veh.placa,
        marca: veh.marca, modelo: veh.modelo, cliente: c?.nombre || null, telefono: c?.telefono || null };
    }).sort((a, b) => a.fecha_proxima.localeCompare(b.fecha_proxima));
  }

  async reporte(desde: string, hasta: string): Promise<Reporte> {
    await this.listo;
    const vs = this.s.ventas.filter((v) => v.estado === 'pagada' && enRango(v.fecha, desde, hasta));
    const total = r2(vs.reduce((s, v) => s + v.total, 0));
    const items = vs.flatMap((v) => v.items);
    const costo = r2(items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0));
    const agrupar = <K>(arr: VentaRow[], k: (v: VentaRow) => K) => {
      const m = new Map<K, { n: number; total: number }>();
      arr.forEach((v) => { const g = m.get(k(v)) || { n: 0, total: 0 }; g.n++; g.total = r2(g.total + v.total); m.set(k(v), g); });
      return m;
    };
    const top = new Map<number, { nombre: string; unidad: string; cantidad: number; total: number; ganancia: number }>();
    items.forEach((i) => {
      const p = this.s.productos.find((x) => x.id === i.producto_id);
      const g = top.get(i.producto_id) || { nombre: p?.nombre || i.descripcion, unidad: p?.unidad || '', cantidad: 0, total: 0, ganancia: 0 };
      g.cantidad = r3(g.cantidad + i.cantidad); g.total = r2(g.total + i.subtotal); g.ganancia = r2(g.ganancia + i.subtotal - i.cantidad * i.costo_unitario);
      top.set(i.producto_id, g);
    });
    const cs = this.s.compras.filter((c) => !c.anulada && c.fecha >= desde && c.fecha <= hasta);
    return {
      resumen: { n: vs.length, total, descuentos: r2(vs.reduce((s, v) => s + v.descuento, 0)) },
      costo, ganancia: r2(total - costo),
      por_dia: [...agrupar(vs, (v) => diaLima(v.fecha))].map(([dia, g]) => ({ dia, ...g })).sort((a, b) => a.dia.localeCompare(b.dia)),
      por_metodo: [...agrupar(vs, (v) => v.metodo_pago)].map(([metodo_pago, g]) => ({ metodo_pago, ...g })).sort((a, b) => b.total - a.total),
      top_productos: [...top.values()].sort((a, b) => b.total - a.total).slice(0, 20),
      por_usuario: vs.length ? [{ nombre: 'Local', n: vs.length, total }] : [],
      compras: { n: cs.length, total: r2(cs.reduce((s, c) => s + c.total, 0)) },
    };
  }

  // ---------- usuarios ----------
  async usuarios() { return [USUARIO_LOCAL]; }
  async personal() { return [{ id: 'local', nombre: USUARIO_LOCAL.nombre, rol: 'admin' }]; }
  async actualizarUsuario() { throw new Error('En modo local hay un solo usuario'); }

  alCambiar(cb: (t: string) => void) { this.oyentes.add(cb); return () => this.oyentes.delete(cb); }

  // ---------- utilidades del modo local ----------
  async exportar(): Promise<Estado> { await this.listo; return structuredClone(this.s); }
  async borrarTodo() { await this.listo; this.s = vacio(); await this.guardar('productos'); }
  async cargarEjemplo() {
    await this.listo;
    if (this.s.productos.length) throw new Error('Ya hay productos registrados');
    const ej: (Partial<Producto> & { stock?: number })[] = [
      { nombre: 'Mobil Super 20W-50 (1 gal)', marca: 'Mobil', categoria: 'Aceite de motor', unidad: 'GAL', precio_compra: 82, precio_venta: 110, stock: 12, stock_minimo: 4, ubicacion: 'Estante A1' },
      { nombre: 'Mobil Delvac MX 15W-40 (1 gal)', marca: 'Mobil', categoria: 'Aceite de motor', unidad: 'GAL', precio_compra: 95, precio_venta: 125, stock: 8, stock_minimo: 3, ubicacion: 'Estante A1' },
      { nombre: 'Chevron Delo 400 SAE 15W-40 (1 gal)', marca: 'Chevron', categoria: 'Aceite de motor', unidad: 'GAL', precio_compra: 90, precio_venta: 120, stock: 6, stock_minimo: 3, ubicacion: 'Estante A2' },
      { nombre: 'Vistony Excel 20W-50 (1 gal)', marca: 'Vistony', categoria: 'Aceite de motor', unidad: 'GAL', precio_compra: 55, precio_venta: 75, stock: 10, stock_minimo: 4, ubicacion: 'Estante A2' },
      { nombre: 'Aceite 15W-40 a granel (cilindro)', marca: 'Mobil', categoria: 'Aceite de motor', unidad: 'L', precio_compra: 20, precio_venta: 28, stock: 208, stock_minimo: 40, ubicacion: 'Cilindro 1' },
      { nombre: 'Filtro de aceite Toyota Hilux', marca: 'Wix', categoria: 'Filtro de aceite', precio_compra: 18, precio_venta: 30, stock: 15, stock_minimo: 5, ubicacion: 'Estante B1' },
      { nombre: 'Filtro de aceite Hyundai/Kia', marca: 'Hengst', categoria: 'Filtro de aceite', precio_compra: 14, precio_venta: 25, stock: 2, stock_minimo: 5, ubicacion: 'Estante B1' },
      { nombre: 'Filtro de aire Toyota Hilux', marca: 'Wix', categoria: 'Filtro de aire', precio_compra: 35, precio_venta: 55, stock: 6, stock_minimo: 2, ubicacion: 'Estante B2' },
      { nombre: 'Filtro de combustible diésel', marca: 'Fleetguard', categoria: 'Filtro de combustible', precio_compra: 28, precio_venta: 45, stock: 5, stock_minimo: 2, ubicacion: 'Estante B3' },
      { nombre: 'Refrigerante verde (1 gal)', marca: 'Vistony', categoria: 'Refrigerante', unidad: 'GAL', precio_compra: 18, precio_venta: 28, stock: 9, stock_minimo: 3 },
      { nombre: 'Mano de obra cambio de aceite', categoria: 'Servicio', es_servicio: true, precio_venta: 15 },
      { nombre: 'Engrase general', categoria: 'Servicio', es_servicio: true, precio_venta: 20 },
      { nombre: 'Lavado de motor', categoria: 'Servicio', es_servicio: true, precio_venta: 25 },
    ];
    for (const p of ej) await this.crearProducto(p);
  }
}

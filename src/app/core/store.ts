import { Injectable, computed, signal } from '@angular/core';
import { LocalRepo } from './local-repo';
import { Modo, NuevaVenta, Producto, Usuario } from './models';
import { Repo } from './repo';
import { SupabaseRepo } from './supabase-repo';
import { kvGet, kvSet } from './kv';
import { esErrorDeRed, r3, uuid } from './util';

declare global { interface Window { APP_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string; nombreNegocio?: string; ruc?: string; direccion?: string; telefono?: string } } }

const CLAVE_MODO = 'lubricentro-modo';
const CLAVE_COLA = 'cola-ventas';
const CLAVE_CACHE = 'cache-productos';

export interface VentaPendiente { payload: NuevaVenta; creada: string; error?: string }

/** Estado global: modo, sesión, catálogo de productos en vivo y cola de ventas sin conexión */
@Injectable({ providedIn: 'root' })
export class Store {
  readonly config = window.APP_CONFIG || {};
  readonly nubeDisponible = !!(this.config.supabaseUrl && this.config.supabaseAnonKey);
  readonly negocio = {
    nombre: this.config.nombreNegocio || 'Lubricentro Ramos',
    ruc: this.config.ruc || '',
    direccion: this.config.direccion || 'Juliaca - Puno',
    telefono: this.config.telefono || '',
  };

  readonly modo = signal<Modo | null>(this.leerModo());
  readonly usuario = signal<Usuario | null>(null);
  readonly productos = signal<Producto[]>([]);
  readonly enLinea = signal(navigator.onLine);
  readonly pendientes = signal<VentaPendiente[]>([]);
  readonly cargando = signal(false);

  readonly rol = computed(() => this.usuario()?.rol);
  readonly esAdmin = computed(() => this.rol() === 'admin');
  readonly puedeGestionar = computed(() => this.rol() === 'admin' || this.rol() === 'vendedor');
  readonly productosActivos = computed(() => this.productos().filter((p) => p.activo));
  readonly stockBajo = computed(() => this.productosActivos().filter((p) => !p.es_servicio && p.stock <= p.stock_minimo).length);

  private _repo: Repo | null = null;
  private desuscribir: (() => void) | null = null;

  constructor() {
    window.addEventListener('online', () => { this.enLinea.set(true); this.enviarPendientes(); this.cargarProductos(); });
    window.addEventListener('offline', () => this.enLinea.set(false));
    kvGet<VentaPendiente[]>(CLAVE_COLA).then((c) => this.pendientes.set(c || []));
  }

  get repo(): Repo {
    if (!this._repo) {
      this._repo = this.modo() === 'nube' && this.nubeDisponible
        ? new SupabaseRepo(this.config.supabaseUrl!, this.config.supabaseAnonKey!)
        : new LocalRepo();
    }
    return this._repo;
  }
  get local(): LocalRepo | null { return this.repo instanceof LocalRepo ? this.repo : null; }

  private leerModo(): Modo | null {
    try {
      const m = localStorage.getItem(CLAVE_MODO) as Modo | null;
      if (m === 'nube' && !(window.APP_CONFIG?.supabaseUrl)) return null;
      return m;
    } catch { return null; }
  }

  elegirModo(m: Modo) {
    try { localStorage.setItem(CLAVE_MODO, m); } catch { /* sin almacenamiento */ }
    this.modo.set(m);
    this.desuscribir?.();
    this._repo = null;
  }

  /** Restaura la sesión al abrir la app */
  async iniciar(): Promise<Usuario | null> {
    if (!this.modo()) return null;
    try {
      const u = await this.repo.sesion();
      if (u && u.activo) await this.entrar(u);
      else this.usuario.set(u);
      return u;
    } catch {
      return null;
    }
  }

  async entrar(u: Usuario) {
    this.usuario.set(u);
    if (!u.activo) return;
    await this.cargarProductos();
    this.desuscribir?.();
    this.desuscribir = this.repo.alCambiar((t) => { if (t === 'productos' || t === 'ventas') this.cargarProductos(); });
    this.enviarPendientes();
  }

  async salir() {
    this.desuscribir?.();
    await this.repo.salir().catch(() => {});
    this.usuario.set(null);
    this.productos.set([]);
  }

  /** Carga el catálogo; si no hay internet usa la última copia guardada en el equipo */
  async cargarProductos() {
    if (!this.usuario()?.activo) return;
    try {
      const lista = await this.repo.productos();
      this.productos.set(lista);
      if (this.modo() === 'nube') kvSet(CLAVE_CACHE, lista);
    } catch (e) {
      if (esErrorDeRed(e)) {
        const cache = await kvGet<Producto[]>(CLAVE_CACHE);
        if (cache) this.productos.set(cache);
      } else throw e;
    }
  }

  /**
   * Registra una venta. En modo nube, si no hay conexión, la guarda en cola
   * y la envía al volver internet (marcada "offline" para revisión si deja stock negativo).
   */
  async registrarVenta(v: NuevaVenta): Promise<{ id?: number; pendiente?: boolean }> {
    const payload = { ...v, client_uuid: v.client_uuid || uuid() };
    if (this.modo() === 'nube' && !navigator.onLine) return this.encolar(payload);
    try {
      const id = await this.repo.registrarVenta(payload);
      this.cargarProductos();
      return { id };
    } catch (e) {
      if (this.modo() === 'nube' && esErrorDeRed(e)) return this.encolar(payload);
      throw e;
    }
  }

  private async encolar(payload: NuevaVenta) {
    const cola = [...this.pendientes(), { payload: { ...payload, offline: true }, creada: new Date().toISOString() }];
    this.pendientes.set(cola);
    await kvSet(CLAVE_COLA, cola);
    // Descuento optimista en la copia local para que el stock mostrado sea coherente
    const desc = new Map<number, number>();
    payload.items.forEach((i) => desc.set(i.producto_id, (desc.get(i.producto_id) || 0) + Number(i.cantidad)));
    this.productos.update((ps) => ps.map((p) => (desc.has(p.id) && !p.es_servicio ? { ...p, stock: r3(p.stock - desc.get(p.id)!) } : p)));
    kvSet(CLAVE_CACHE, this.productos());
    return { pendiente: true };
  }

  private enviando = false;
  async enviarPendientes() {
    if (this.enviando || this.modo() !== 'nube' || !navigator.onLine || !this.usuario()?.activo) return;
    this.enviando = true;
    try {
      let cola = [...this.pendientes()];
      for (const item of [...cola]) {
        try {
          await this.repo.registrarVenta(item.payload);
          cola = cola.filter((c) => c !== item);
        } catch (e) {
          if (esErrorDeRed(e)) break;
          item.error = (e as Error).message; // error de datos: queda visible para revisión
        }
      }
      this.pendientes.set(cola);
      await kvSet(CLAVE_COLA, cola);
      await this.cargarProductos();
    } finally {
      this.enviando = false;
    }
  }

  async descartarPendiente(p: VentaPendiente) {
    const cola = this.pendientes().filter((x) => x !== p);
    this.pendientes.set(cola);
    await kvSet(CLAVE_COLA, cola);
  }
}

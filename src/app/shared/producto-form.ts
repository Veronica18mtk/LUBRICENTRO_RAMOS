import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CATEGORIAS, Producto, UNIDADES } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { Scanner } from './scanner';

/** Crear o editar un producto/servicio */
@Component({
  selector: 'app-producto-form',
  imports: [FormsModule, Scanner],
  template: `
    <div class="modal-bg" (click)="cerrar.emit()">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="guardar()">
        <div class="modal-head">
          <h2>{{ producto() ? 'Editar' : 'Nuevo' }} {{ f.es_servicio ? 'servicio' : 'producto' }}</h2>
          <button type="button" class="icon-btn" (click)="cerrar.emit()" aria-label="Cerrar">✕</button>
        </div>
        @if (!producto()) {
          <label class="check field"><input type="checkbox" [(ngModel)]="f.es_servicio" name="serv"> Es un servicio (mano de obra, no tiene stock)</label>
        }
        @if (!f.es_servicio) {
            <div class="field"><label>Código de barras</label>
              <div class="row"><input class="grow" [(ngModel)]="f.codigo_barras" name="cb" placeholder="Escanéalo primero: completamos el resto" inputmode="numeric"
                  (keydown.enter)="$event.preventDefault(); buscarCodigo()" (blur)="buscarCodigo()" aria-label="Código de barras">
                <button type="button" class="btn" (click)="escaneando.set(true)" aria-label="Escanear con la cámara">📷</button></div>
              @if (buscando()) { <p class="small muted" role="status">🔎 Buscando el código en bases públicas…</p> }
              @if (aviso(); as a) { <div class="alert small" [class.info]="a.tipo === 'ok'" [class.warn]="a.tipo !== 'ok'" role="status">{{ a.texto }}</div> }
            </div>
        }
        <div class="field"><label>Nombre *</label><input [(ngModel)]="f.nombre" name="nombre" required placeholder="Ej. Mobil Super 20W-50 (1 gal)"></div>
        <div class="grid g2">
          <div class="field"><label>Marca</label><input [(ngModel)]="f.marca" name="marca" placeholder="Mobil, Chevron, Vistony…"></div>
          <div class="field"><label>Categoría</label>
            <select [(ngModel)]="f.categoria" name="cat">@for (c of categorias; track c) { <option>{{ c }}</option> }</select></div>
        </div>
        @if (!f.es_servicio) {
          <div class="grid g3">
            <div class="field"><label>Unidad</label>
              <select [(ngModel)]="f.unidad" name="u">@for (u of unidades; track u) { <option [value]="u">{{ nombreUnidad(u) }}</option> }</select></div>
            @if (!producto()) {
              <div class="field"><label>Stock inicial</label><input type="number" step="any" min="0" [(ngModel)]="f.stock" name="stock"></div>
            }
            <div class="field"><label>Stock mínimo</label><input type="number" step="any" min="0" [(ngModel)]="f.stock_minimo" name="min"></div>
          </div>
        }
        <div class="grid g2">
          @if (!f.es_servicio) {
            <div class="field"><label>Costo (S/)</label><input type="number" step="0.01" min="0" [(ngModel)]="f.precio_compra" name="pc"></div>
          }
          <div class="field"><label>Precio de venta (S/)</label><input type="number" step="0.01" min="0" [(ngModel)]="f.precio_venta" name="pv"></div>
        </div>
        @if (!f.es_servicio) {
          <div class="field"><label>Ubicación</label><input [(ngModel)]="f.ubicacion" name="ub" placeholder="Estante A1, cilindro 2…"></div>
        }
        @if (producto()) {
          <label class="check field"><input type="checkbox" [(ngModel)]="f.activo" name="act"> Activo (desmarca para ocultarlo sin borrar su historial)</label>
          <p class="muted small">El stock no se edita aquí: usa Compras para entradas o Conteo para corregir diferencias. Así todo queda en el kardex.</p>
        }
        <div class="modal-foot">
          <button type="button" class="btn" (click)="cerrar.emit()">Cancelar</button>
          <button class="btn primary" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
        </div>
      </form>
    </div>
    @if (escaneando()) {
      <app-scanner (leido)="f.codigo_barras = $event; escaneando.set(false); buscarCodigo()" (cerrar)="escaneando.set(false)" />
    }`,
})
export class ProductoForm implements OnInit {
  private store = inject(Store);
  private ui = inject(Ui);
  readonly producto = input<Producto | null>(null);
  readonly codigoInicial = input<string>('');
  readonly guardado = output<number>();
  readonly cerrar = output<void>();
  readonly guardando = signal(false);
  readonly escaneando = signal(false);
  readonly buscando = signal(false);
  readonly aviso = signal<{ tipo: 'ok' | 'warn'; texto: string } | null>(null);
  private ultimoBuscado = '';
  categorias = CATEGORIAS; unidades = UNIDADES;
  f: Partial<Producto> & { stock?: number } = {};

  nombreUnidad(u: string) {
    return ({ UND: 'Unidad', GAL: 'Galón', L: 'Litro (granel)', QT: 'Cuarto (QT)', KG: 'Kilo', JGO: 'Juego' } as Record<string, string>)[u] || u;
  }

  ngOnInit() {
    const p = this.producto();
    this.f = p ? { ...p } : { categoria: 'Aceite de motor', unidad: 'UND', es_servicio: false, stock: 0, stock_minimo: 2, precio_compra: 0, precio_venta: 0, codigo_barras: this.codigoInicial() || null };
    if (!p && this.codigoInicial()) this.buscarCodigo();
  }

  /**
   * Al ingresar un código en un producto NUEVO: primero revisa si ya existe en el inventario;
   * si no, lo busca en bases públicas (vía el Worker) y completa nombre, marca, categoría y unidad.
   */
  async buscarCodigo() {
    const codigo = String(this.f.codigo_barras || '').trim();
    if (this.producto() || !/^\d{8,14}$/.test(codigo) || codigo === this.ultimoBuscado) return;
    this.ultimoBuscado = codigo;
    this.aviso.set(null);
    const existente = this.store.productos().find((x) => x.codigo_barras === codigo);
    if (existente) return this.aviso.set({ tipo: 'warn', texto: `Este código ya está registrado como “${existente.nombre}”. Para sumar stock usa Compras.` });
    this.buscando.set(true);
    try {
      const r = await fetch(`/api/codigo/${codigo}`);
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { encontrado: boolean; nombre?: string; marca?: string | null; cantidad?: string | null; categorias?: string; fuente?: string; pais?: string | null };
      if (d.encontrado && d.nombre) {
        const nombre = d.cantidad && !d.nombre.toLowerCase().includes(String(d.cantidad).toLowerCase()) ? `${d.nombre} (${d.cantidad})` : d.nombre;
        if (!this.f.nombre?.trim()) this.f.nombre = nombre;
        if (!this.f.marca?.trim() && d.marca) this.f.marca = d.marca;
        const texto = `${nombre} ${d.categorias || ''}`;
        this.f.categoria = adivinarCategoria(texto) || this.f.categoria;
        this.f.unidad = adivinarUnidad(`${d.cantidad || ''} ${nombre}`) || this.f.unidad;
        this.aviso.set({ tipo: 'ok', texto: `✓ Datos encontrados en ${d.fuente}. Revisa nombre, categoría y unidad, y completa precios y stock.` });
      } else {
        this.aviso.set({ tipo: 'warn', texto: `No está en las bases públicas${d.pais ? ` (código registrado en ${d.pais})` : ''}. Complétalo una vez a mano: desde ahora el sistema lo reconocerá al escanearlo.` });
      }
    } catch {
      this.aviso.set({ tipo: 'warn', texto: 'No se pudo consultar el código (sin conexión o no disponible). Completa los datos a mano.' });
    } finally { this.buscando.set(false); }
  }

  async guardar() {
    if (!this.f.nombre?.trim()) return this.ui.error('El nombre es obligatorio');
    if (this.f.es_servicio) this.f.categoria = this.f.categoria === 'Aceite de motor' ? 'Servicio' : this.f.categoria;
    this.guardando.set(true);
    try {
      const p = this.producto();
      let id: number;
      if (p) { await this.store.repo.actualizarProducto(p.id, this.f); id = p.id; }
      else id = await this.store.repo.crearProducto(this.f);
      await this.store.cargarProductos();
      this.ui.ok('Producto guardado');
      this.guardado.emit(id);
    } catch (e) { this.ui.error(e); } finally { this.guardando.set(false); }
  }
}

/** Deduce la categoría a partir del nombre/categorías (español o inglés) */
export function adivinarCategoria(t: string): string | null {
  const x = t.toLowerCase();
  if (/filtro de aire|air filter|filtro aire/.test(x)) return 'Filtro de aire';
  if (/filtro de aceite|oil filter|filtro aceite/.test(x)) return 'Filtro de aceite';
  if (/combustible|fuel filter|gasolina|petr[oó]leo|diesel filter/.test(x)) return 'Filtro de combustible';
  if (/cabina|cabin/.test(x)) return 'Filtro de cabina';
  if (/refrigerante|coolant|anticongelante|antifreeze/.test(x)) return 'Refrigerante';
  if (/freno|brake|dot ?[345]/.test(x)) return 'Líquido de frenos';
  if (/grasa|grease/.test(x)) return 'Grasa';
  if (/aditivo|additive|limpia ?inyector|injector|tratamiento/.test(x)) return 'Aditivo';
  if (/transmisi|caja|gear|atf|transmission|80w|85w|75w/.test(x)) return 'Aceite de caja / transmisión';
  if (/aceite|motor oil|oil|lubricante|\b\d{1,2}w-?\d{2}\b/.test(x)) return 'Aceite de motor';
  return null;
}

/** Deduce la unidad de venta a partir de la presentación */
export function adivinarUnidad(t: string): string | null {
  const x = t.toLowerCase();
  if (/gal[oó]n|gallon|\bgal\b|3[.,]78 ?l|3[.,]785/.test(x)) return 'GAL';
  if (/\bqt\b|quart|946 ?ml|0[.,]946/.test(x)) return 'QT';
  if (/\bkg\b|kilo/.test(x)) return 'KG';
  return 'UND';
}

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
        <div class="field"><label>Nombre *</label><input [(ngModel)]="f.nombre" name="nombre" required placeholder="Ej. Mobil Super 20W-50 (1 gal)"></div>
        <div class="grid g2">
          <div class="field"><label>Marca</label><input [(ngModel)]="f.marca" name="marca" placeholder="Mobil, Chevron, Vistony…"></div>
          <div class="field"><label>Categoría</label>
            <select [(ngModel)]="f.categoria" name="cat">@for (c of categorias; track c) { <option>{{ c }}</option> }</select></div>
        </div>
        @if (!f.es_servicio) {
          <div class="field"><label>Código de barras</label>
            <div class="row"><input class="grow" [(ngModel)]="f.codigo_barras" name="cb" placeholder="Escanéalo o escríbelo" inputmode="numeric">
              <button type="button" class="btn" (click)="escaneando.set(true)">📷</button></div></div>
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
      <app-scanner (leido)="f.codigo_barras = $event; escaneando.set(false)" (cerrar)="escaneando.set(false)" />
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
  categorias = CATEGORIAS; unidades = UNIDADES;
  f: Partial<Producto> & { stock?: number } = {};

  nombreUnidad(u: string) {
    return ({ UND: 'Unidad', GAL: 'Galón', L: 'Litro (granel)', QT: 'Cuarto (QT)', KG: 'Kilo', JGO: 'Juego' } as Record<string, string>)[u] || u;
  }

  ngOnInit() {
    const p = this.producto();
    this.f = p ? { ...p } : { categoria: 'Aceite de motor', unidad: 'UND', es_servicio: false, stock: 0, stock_minimo: 2, precio_compra: 0, precio_venta: 0, codigo_barras: this.codigoInicial() || null };
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

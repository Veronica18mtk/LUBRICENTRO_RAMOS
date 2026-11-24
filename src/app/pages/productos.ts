import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CATEGORIAS, Movimiento, Producto } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { cant, fechaHora, r2, soles } from '../core/util';
import { exportarExcel } from '../shared/excel';
import { ProductoForm } from '../shared/producto-form';
import { Scanner } from '../shared/scanner';

@Component({
  selector: 'app-productos',
  imports: [FormsModule, ProductoForm, Scanner],
  template: `
    <div class="page-head">
      <div><h1>Inventario</h1><div class="muted small">{{ filtrados().length }} productos
        @if (!esMecanico()) { · valorizado {{ soles(valor()) }} }</div></div>
      <div class="row">
        @if (store.puedeGestionar()) {
          <button class="btn" (click)="excel()">⬇ Excel</button>
          <button class="btn primary" (click)="editando.set('nuevo')">➕ Nuevo producto</button>
        }
      </div>
    </div>
    <div class="card">
      <div class="row">
        <input class="grow" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Buscar por nombre, marca o código" aria-label="Buscar">
        <button class="btn" (click)="escaneando.set(true)">📷</button>
      </div>
      <div class="chips" style="margin-top:10px">
        <button class="chip" [class.on]="!cat() && !bajo()" (click)="cat.set(''); bajo.set(false)">Todos</button>
        <button class="chip" [class.on]="bajo()" (click)="bajo.set(!bajo())">⚠️ Stock bajo ({{ store.stockBajo() }})</button>
        @for (c of categoriasUsadas(); track c) { <button class="chip" [class.on]="cat() === c" (click)="cat.set(cat() === c ? '' : c)">{{ c }}</button> }
        <button class="chip" [class.on]="inactivos()" (click)="inactivos.set(!inactivos())">Inactivos</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Producto</th><th>Categoría</th><th class="right">Stock</th><th class="right">Precio</th>
            @if (!esMecanico()) { <th class="right">Costo</th> }<th>Ubicación</th></tr></thead>
          <tbody>
            @for (p of filtrados(); track p.id) {
              <tr class="click" (click)="ver(p)">
                <td><b>{{ p.nombre }}</b>@if (!p.activo) { <span class="badge">inactivo</span> }<div class="muted small">{{ p.marca || '' }} {{ p.codigo_barras ? '· ' + p.codigo_barras : '' }}</div></td>
                <td class="small">{{ p.categoria }}</td>
                <td class="right nowrap">
                  @if (p.es_servicio) { <span class="badge">servicio</span> }
                  @else { <span [class]="p.stock <= 0 ? 'badge bad' : p.stock <= p.stock_minimo ? 'badge warn' : 'badge ok'">{{ cant(p.stock) }} {{ p.unidad }}</span> }
                </td>
                <td class="right nowrap">{{ soles(p.precio_venta) }}</td>
                @if (!esMecanico()) { <td class="right nowrap muted">{{ p.es_servicio ? '' : soles(p.precio_compra) }}</td> }
                <td class="small muted">{{ p.ubicacion || '' }}</td>
              </tr>
            } @empty { <tr><td colspan="6" class="empty">No hay productos. @if (store.puedeGestionar()) { Crea el primero con “Nuevo producto”. }</td></tr> }
          </tbody>
        </table>
      </div>
    </div>

    @if (detalle(); as p) {
      <div class="modal-bg" (click)="detalle.set(null)">
        <div class="modal wide" (click)="$event.stopPropagation()">
          <div class="modal-head"><h2>{{ p.nombre }}</h2><button class="icon-btn" (click)="detalle.set(null)" aria-label="Cerrar">✕</button></div>
          <div class="grid g4">
            <div><div class="muted small">Stock</div><b>{{ p.es_servicio ? '—' : cant(p.stock) + ' ' + p.unidad }}</b></div>
            <div><div class="muted small">Mínimo</div><b>{{ cant(p.stock_minimo) }}</b></div>
            <div><div class="muted small">Precio</div><b>{{ soles(p.precio_venta) }}</b></div>
            @if (!esMecanico()) { <div><div class="muted small">Costo prom.</div><b>{{ soles(p.precio_compra) }}</b></div> }
          </div>
          @if (store.puedeGestionar()) {
            <div class="row" style="margin:14px 0">
              <button class="btn" (click)="editando.set(p); detalle.set(null)">✏️ Editar</button>
            </div>
            <h2>Kardex (movimientos)</h2>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Tipo</th><th class="right">Cant.</th><th class="right">Saldo</th><th>Referencia</th><th>Usuario</th></tr></thead>
                <tbody>
                  @for (m of kardex(); track m.id) {
                    <tr>
                      <td class="small nowrap">{{ fechaHora(m.fecha) }}</td>
                      <td><span [class]="'badge ' + claseTipo(m.tipo)">{{ m.tipo }}</span></td>
                      <td class="right" [style.color]="m.cantidad < 0 ? 'var(--bad)' : 'var(--ok)'">{{ m.cantidad > 0 ? '+' : '' }}{{ cant(m.cantidad) }}</td>
                      <td class="right"><b>{{ cant(m.stock_resultante) }}</b></td>
                      <td class="small">{{ m.referencia || '' }} <span class="muted">{{ m.nota || '' }}</span></td>
                      <td class="small">{{ m.usuario || '' }}</td>
                    </tr>
                  } @empty { <tr><td colspan="6" class="empty">Sin movimientos</td></tr> }
                </tbody>
              </table>
            </div>
          }
        </div>
      </div>
    }

    @if (editando()) {
      <app-producto-form [producto]="editando() === 'nuevo' ? null : $any(editando())" [codigoInicial]="codigoNuevo"
        (guardado)="editando.set(null); codigoNuevo = ''" (cerrar)="editando.set(null); codigoNuevo = ''" />
    }
    @if (escaneando()) { <app-scanner (leido)="escaneado($event)" (cerrar)="escaneando.set(false)" /> }`,
})
export class Productos {
  readonly store = inject(Store);
  private ui = inject(Ui);
  soles = soles; cant = cant; fechaHora = fechaHora;
  readonly q = signal('');
  readonly cat = signal('');
  readonly bajo = signal(false);
  readonly inactivos = signal(false);
  readonly detalle = signal<Producto | null>(null);
  readonly kardex = signal<Movimiento[]>([]);
  readonly editando = signal<Producto | 'nuevo' | null>(null);
  readonly escaneando = signal(false);
  codigoNuevo = '';
  readonly esMecanico = computed(() => this.store.rol() === 'mecanico');

  readonly categoriasUsadas = computed(() => CATEGORIAS.filter((c) => this.store.productos().some((p) => p.categoria === c)));
  readonly filtrados = computed(() => {
    const palabras = this.q().toLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.store.productos().filter((p) =>
      (this.inactivos() ? !p.activo : p.activo) &&
      (!this.cat() || p.categoria === this.cat()) &&
      (!this.bajo() || (!p.es_servicio && p.stock <= p.stock_minimo)) &&
      palabras.every((w) => p.codigo_barras === w || `${p.nombre} ${p.marca || ''}`.toLowerCase().includes(w)));
  });
  readonly valor = computed(() => r2(this.filtrados().filter((p) => !p.es_servicio && p.stock > 0).reduce((s, p) => s + p.stock * p.precio_compra, 0)));

  async ver(p: Producto) {
    this.detalle.set(p);
    this.kardex.set([]);
    if (this.store.puedeGestionar()) {
      try { this.kardex.set(await this.store.repo.kardex(p.id)); } catch (e) { this.ui.error(e); }
    }
  }

  escaneado(codigo: string) {
    this.escaneando.set(false);
    const p = this.store.productos().find((x) => x.codigo_barras === codigo);
    if (p) this.ver(p);
    else if (this.store.puedeGestionar() && this.ui.confirmar(`El código ${codigo} no está registrado. ¿Crear producto?`)) { this.codigoNuevo = codigo; this.editando.set('nuevo'); }
    else this.q.set(codigo);
  }

  claseTipo(t: string) { return ({ ENTRADA: 'ok', INICIAL: 'ok', SALIDA: '', AJUSTE: 'warn', ANULACION: 'bad' } as Record<string, string>)[t] || ''; }

  excel() {
    exportarExcel(`inventario_${new Date().toISOString().slice(0, 10)}`, 'Inventario', [
      { h: 'Código', k: 'codigo_barras', w: 16 }, { h: 'Producto', k: 'nombre', w: 36 }, { h: 'Marca', k: 'marca', w: 14 },
      { h: 'Categoría', k: 'categoria', w: 20 }, { h: 'Unidad', k: 'unidad', w: 8 }, { h: 'Stock', k: 'stock', num: true },
      { h: 'Mínimo', k: 'stock_minimo', num: true }, { h: 'Costo', k: 'precio_compra', money: true }, { h: 'Precio', k: 'precio_venta', money: true },
      { h: 'Valorizado', k: 'valor', money: true }, { h: 'Ubicación', k: 'ubicacion', w: 16 },
    ], this.filtrados().map((p) => ({ ...p, valor: p.es_servicio ? null : r2(p.stock * p.precio_compra) })));
  }
}

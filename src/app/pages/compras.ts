import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CompraResumen, Producto } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { cant, fecha, hoy, numeroCO, r2, soles } from '../core/util';
import { ProductoForm } from '../shared/producto-form';
import { ProductoPicker } from '../shared/producto-picker';

interface LineaCompra { producto: Producto; cantidad: number; costo: number; precio: number | null }

/** Compras = entradas de mercadería. Es la única forma normal de subir el stock. */
@Component({
  selector: 'app-compras',
  imports: [FormsModule, ProductoPicker, ProductoForm],
  template: `
    <div class="page-head">
      <div><h1>Compras (entradas)</h1><div class="muted small">Registra aquí cada factura o guía del proveedor para sumar stock</div></div>
      @if (!nueva()) { <button class="btn primary" (click)="nueva.set(true)">➕ Registrar compra</button> }
    </div>

    @if (nueva()) {
      <div class="card">
        <div class="grid g4">
          <div class="field"><label>Proveedor</label><input [(ngModel)]="proveedor" list="provs" placeholder="Distribuidora…"></div>
          <datalist id="provs">@for (p of proveedores(); track p.id) { <option [value]="p.nombre"></option> }</datalist>
          <div class="field"><label>RUC proveedor</label><input [(ngModel)]="ruc" inputmode="numeric" maxlength="11"></div>
          <div class="field"><label>N° factura / guía</label><input [(ngModel)]="comprobante" placeholder="F001-000123"></div>
          <div class="field"><label>Fecha</label><input type="date" [(ngModel)]="fechaCompra"></div>
        </div>
        <app-producto-picker [soloInventario]="true" (elegido)="agregar($event)" (noEncontrado)="codigoNuevo.set($event)" placeholder="Escanea o busca cada producto que llegó…" />
        @if (lineas().length) {
          <div class="table-wrap" style="margin-top:12px">
            <table>
              <thead><tr><th>Producto</th><th style="width:90px">Cantidad</th><th style="width:110px">Costo unit.</th><th style="width:110px">Nuevo precio venta</th><th class="right">Subtotal</th><th></th></tr></thead>
              <tbody>
                @for (l of lineas(); track l.producto.id; let i = $index) {
                  <tr>
                    <td>{{ l.producto.nombre }}<div class="muted small">Stock actual: {{ cant(l.producto.stock) }} {{ l.producto.unidad }}</div></td>
                    <td><input type="number" step="any" min="0" [ngModel]="l.cantidad" (ngModelChange)="set(i, 'cantidad', $event)" aria-label="Cantidad"></td>
                    <td><input type="number" step="0.01" min="0" [ngModel]="l.costo" (ngModelChange)="set(i, 'costo', $event)" aria-label="Costo"></td>
                    <td><input type="number" step="0.01" min="0" [ngModel]="l.precio" (ngModelChange)="set(i, 'precio', $event)" [placeholder]="l.producto.precio_venta.toFixed(2)" aria-label="Precio de venta"></td>
                    <td class="right nowrap">{{ soles(l.cantidad * l.costo) }}</td>
                    <td><button class="icon-btn" (click)="quitar(i)" aria-label="Quitar">✕</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <div class="total-bar"><span>Total compra</span><span>{{ soles(total()) }}</span></div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" (click)="cancelar()">Cancelar</button>
          <button class="btn primary" [disabled]="guardando() || !lineas().length" (click)="guardar()">{{ guardando() ? 'Guardando…' : '✔ Guardar compra y sumar stock' }}</button>
        </div>
      </div>
    }

    <div class="card">
      <h2>Últimas compras</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th class="right">Ítems</th><th class="right">Total</th><th></th></tr></thead>
          <tbody>
            @for (c of lista(); track c.id) {
              <tr class="click" (click)="ver(c)">
                <td>{{ numeroCO(c.id) }}</td><td class="nowrap">{{ fecha(c.fecha) }}</td><td>{{ c.proveedor || '—' }}</td>
                <td>{{ c.comprobante || '' }}</td><td class="right">{{ c.n_items }}</td><td class="right nowrap">{{ soles(c.total) }}</td>
                <td>@if (c.anulada) { <span class="badge bad">Anulada</span> }</td>
              </tr>
            } @empty { <tr><td colspan="7" class="empty">Aún no hay compras registradas</td></tr> }
          </tbody>
        </table>
      </div>
    </div>

    @if (detalle(); as c) {
      <div class="modal-bg" (click)="detalle.set(null)">
        <div class="modal wide" (click)="$event.stopPropagation()">
          <div class="modal-head"><h2>Compra {{ numeroCO(c.id) }}</h2><button class="icon-btn" (click)="detalle.set(null)" aria-label="Cerrar">✕</button></div>
          <p>{{ fecha(c.fecha) }} · {{ c.proveedor || 'Sin proveedor' }} · {{ c.comprobante || '' }} · registrada por {{ c.usuario }}</p>
          <table>
            <thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">Costo</th><th class="right">Subtotal</th></tr></thead>
            <tbody>@for (i of c.items || []; track $index) { <tr><td>{{ i.nombre }}</td><td class="right">{{ cant(i.cantidad) }} {{ i.unidad }}</td><td class="right">{{ soles(i.costo_unitario) }}</td><td class="right">{{ soles(i.subtotal) }}</td></tr> }</tbody>
          </table>
          <div class="total-bar"><span>Total</span><span>{{ soles(c.total) }}</span></div>
          @if (store.esAdmin() && !c.anulada) { <div class="modal-foot"><button class="btn danger" (click)="anular(c)">Anular compra (resta el stock)</button></div> }
        </div>
      </div>
    }
    @if (codigoNuevo() !== null) {
      <app-producto-form [codigoInicial]="codigoNuevo()!" (guardado)="creado($event)" (cerrar)="codigoNuevo.set(null)" />
    }`,
})
export class Compras implements OnInit {
  readonly store = inject(Store);
  private ui = inject(Ui);
  soles = soles; cant = cant; fecha = fecha; numeroCO = numeroCO;
  readonly nueva = signal(false);
  readonly lista = signal<CompraResumen[]>([]);
  readonly proveedores = signal<{ id: number; nombre: string; ruc: string | null }[]>([]);
  readonly lineas = signal<LineaCompra[]>([]);
  readonly guardando = signal(false);
  readonly detalle = signal<CompraResumen | null>(null);
  readonly codigoNuevo = signal<string | null>(null);
  readonly total = computed(() => r2(this.lineas().reduce((s, l) => s + r2(l.cantidad * l.costo), 0)));
  proveedor = ''; ruc = ''; comprobante = ''; fechaCompra = hoy();

  ngOnInit() { this.cargar(); }
  async cargar() {
    try {
      const [c, p] = await Promise.all([this.store.repo.compras(), this.store.repo.proveedores()]);
      this.lista.set(c); this.proveedores.set(p);
    } catch (e) { this.ui.error(e); }
  }

  agregar(p: Producto) {
    const ls = [...this.lineas()];
    const i = ls.findIndex((l) => l.producto.id === p.id);
    if (i >= 0) ls[i] = { ...ls[i], cantidad: ls[i].cantidad + 1 };
    else ls.push({ producto: p, cantidad: 1, costo: p.precio_compra, precio: null });
    this.lineas.set(ls);
  }
  set(i: number, campo: 'cantidad' | 'costo' | 'precio', v: number) {
    const ls = [...this.lineas()];
    ls[i] = { ...ls[i], [campo]: campo === 'precio' && (v === null || (v as unknown) === '') ? null : Math.max(0, Number(v) || 0) };
    this.lineas.set(ls);
  }
  quitar(i: number) { this.lineas.set(this.lineas().filter((_, k) => k !== i)); }
  creado(id: number) { this.codigoNuevo.set(null); const p = this.store.productos().find((x) => x.id === id); if (p) this.agregar(p); }
  cancelar() { this.nueva.set(false); this.lineas.set([]); this.proveedor = this.ruc = this.comprobante = ''; this.fechaCompra = hoy(); }

  async guardar() {
    if (this.lineas().some((l) => !(l.cantidad > 0))) return this.ui.error('Revisa las cantidades');
    this.guardando.set(true);
    try {
      await this.store.repo.registrarCompra({
        proveedor: this.proveedor, ruc: this.ruc, comprobante: this.comprobante, fecha: this.fechaCompra,
        items: this.lineas().map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad, costo_unitario: l.costo, precio_venta: l.precio })),
      });
      this.ui.ok('Compra registrada: stock actualizado');
      this.cancelar();
      await Promise.all([this.store.cargarProductos(), this.cargar()]);
    } catch (e) { this.ui.error(e); } finally { this.guardando.set(false); }
  }

  async ver(c: CompraResumen) {
    try { this.detalle.set(await this.store.repo.compra(c.id)); } catch (e) { this.ui.error(e); }
  }
  async anular(c: CompraResumen) {
    if (!this.ui.confirmar(`¿Anular la compra ${numeroCO(c.id)}? Se restará el stock que ingresó.`)) return;
    try {
      await this.store.repo.anularCompra(c.id);
      this.ui.ok('Compra anulada');
      this.detalle.set(null);
      await Promise.all([this.store.cargarProductos(), this.cargar()]);
    } catch (e) { this.ui.error(e); }
  }
}

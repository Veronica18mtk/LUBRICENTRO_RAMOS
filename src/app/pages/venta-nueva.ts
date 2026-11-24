import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HistorialServicio, METODOS_PAGO, Producto } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { cant, fecha, hoy, normPlaca, r2, r3, soles, sumarMeses, verPlaca } from '../core/util';
import { ProductoForm } from '../shared/producto-form';
import { ProductoPicker } from '../shared/producto-picker';

interface Linea { producto: Producto; cantidad: number; precio: number }

@Component({
  selector: 'app-venta-nueva',
  imports: [FormsModule, ProductoPicker, ProductoForm, RouterLink],
  template: `
    <div class="page-head"><div><h1>Nueva orden de servicio</h1><div class="muted small">Cambio de aceite, filtros, venta de productos</div></div></div>

    <div class="grid g2 stack" style="align-items:start">
      <div>
        <div class="card">
          <h2>🚗 Vehículo</h2>
          <div class="row field">
            <input class="big grow" [(ngModel)]="placa" (keydown.enter)="buscarPlaca()" (blur)="buscarPlaca()" placeholder="PLACA" aria-label="Placa" maxlength="8">
            <button class="btn" type="button" (click)="buscarPlaca()">Buscar</button>
          </div>
          @if (historial().length) {
            <div class="alert info small">
              <b>Último servicio:</b> {{ fecha(historial()[0].fecha) }}@if (historial()[0].km_actual) { · {{ historial()[0].km_actual!.toLocaleString('es-PE') }} km }<br>
              {{ historial()[0].detalle }}
              @if (historial().length > 1) { <br><a [routerLink]="['/vehiculos']" [queryParams]="{ placa: normPlaca(placa) }">Ver historial completo ({{ historial().length }})</a> }
            </div>
          } @else if (placaNueva()) { <p class="muted small">Placa nueva: se registrará al guardar.</p> }
          <div class="grid g3">
            <div class="field"><label>Marca</label><input [(ngModel)]="veh.marca" placeholder="Toyota"></div>
            <div class="field"><label>Modelo</label><input [(ngModel)]="veh.modelo" placeholder="Hilux"></div>
            <div class="field"><label>Año</label><input [(ngModel)]="veh.anio" inputmode="numeric" maxlength="4"></div>
          </div>
          <div class="grid g2">
            <div class="field"><label>Kilometraje actual</label><input [(ngModel)]="kmActual" (ngModelChange)="sugerirKm()" inputmode="numeric" placeholder="85000"></div>
            <div class="field"><label>Próximo cambio (km)</label><input [(ngModel)]="kmProximo" inputmode="numeric"></div>
          </div>
          <div class="row small" style="margin:-4px 0 10px">
            <span class="muted">Intervalo:</span>
            @for (k of [3000, 5000, 10000]; track k) { <button type="button" class="chip" [class.on]="intervalo === k" (click)="intervalo = k; sugerirKm(true)">+{{ k.toLocaleString('es-PE') }}</button> }
          </div>
          <div class="field"><label>Fecha próximo cambio (para recordatorio)</label><input type="date" [(ngModel)]="fechaProxima"></div>
        </div>

        <div class="card">
          <h2>👤 Cliente <span class="muted small">(opcional)</span></h2>
          <div class="grid g2">
            <div class="field"><label>DNI / RUC</label><input [(ngModel)]="cli.doc_numero" inputmode="numeric" maxlength="11"></div>
            <div class="field"><label>Celular</label><input [(ngModel)]="cli.telefono" inputmode="tel" placeholder="951 234 567"></div>
          </div>
          <div class="field"><label>Nombre / Razón social</label><input [(ngModel)]="cli.nombre"></div>
        </div>
      </div>

      <div>
        <div class="card">
          <h2>🛢️ Productos y servicios</h2>
          @if (servicios().length) {
            <div class="chips field">
              @for (s of servicios(); track s.id) { <button type="button" class="chip" (click)="agregar(s)">+ {{ s.nombre }}</button> }
            </div>
          }
          <app-producto-picker (elegido)="agregar($event)" (noEncontrado)="codigoNuevo($event)" />

          @if (lineas().length) {
            <div class="table-wrap" style="margin-top:12px">
              <table>
                <thead><tr><th>Producto</th><th style="width:90px">Cant.</th><th style="width:100px">Precio</th><th class="right">Subtotal</th><th></th></tr></thead>
                <tbody>
                  @for (l of lineas(); track l.producto.id; let i = $index) {
                    <tr>
                      <td>{{ l.producto.nombre }}
                        @if (!l.producto.es_servicio) {
                          <div class="small" [class.muted]="l.cantidad <= l.producto.stock" [style.color]="l.cantidad > l.producto.stock ? 'var(--bad)' : ''">
                            Stock: {{ cant(l.producto.stock) }} {{ l.producto.unidad }}</div>
                        }
                      </td>
                      <td><input type="number" step="any" min="0" [ngModel]="l.cantidad" (ngModelChange)="cambiar(i, 'cantidad', $event)" [attr.aria-label]="'Cantidad ' + l.producto.nombre"></td>
                      <td><input type="number" step="0.01" min="0" [ngModel]="l.precio" (ngModelChange)="cambiar(i, 'precio', $event)" [readonly]="esMecanico()" [attr.aria-label]="'Precio ' + l.producto.nombre"></td>
                      <td class="right nowrap">{{ soles(l.cantidad * l.precio) }}</td>
                      <td><button class="icon-btn" type="button" (click)="quitar(i)" aria-label="Quitar">✕</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else { <div class="empty">Agrega productos buscándolos, escaneando su código o con los botones de servicios.</div> }
        </div>

        <div class="card">
          <div class="field"><label>Método de pago</label>
            <div class="chips">@for (m of metodos; track m) { <button type="button" class="chip" [class.on]="metodo === m" (click)="metodo = m">{{ m }}</button> }</div>
          </div>
          <div class="grid g2">
            @if (!esMecanico()) {
              <div class="field"><label>Descuento (S/)</label><input type="number" step="0.01" min="0" [ngModel]="descuento() || null" (ngModelChange)="descuento.set(+$event || 0)"></div>
            }
            <div class="field"><label>Atendido por (mecánico)</label>
              <select [(ngModel)]="mecanicoId"><option [ngValue]="null">—</option>@for (p of personal(); track p.id) { <option [ngValue]="p.id">{{ p.nombre }}</option> }</select>
            </div>
          </div>
          <div class="field"><label>Observaciones</label><textarea rows="2" [(ngModel)]="observaciones" placeholder="Ej. se recomienda cambiar filtro de aire la próxima"></textarea></div>
          @if (descuentoValido() > 0) { <div class="row muted" style="justify-content:space-between"><span>Subtotal</span><span>{{ soles(subtotal()) }}</span></div>
            <div class="row muted" style="justify-content:space-between"><span>Descuento</span><span>- {{ soles(descuentoValido()) }}</span></div> }
          <div class="total-bar"><span>Total</span><span>{{ soles(total()) }}</span></div>
          <button class="btn primary block" style="min-height:52px;font-size:1.05rem" [disabled]="guardando() || !lineas().length" (click)="guardar()">
            {{ guardando() ? 'Guardando…' : '✔ Guardar y cobrar' }}</button>
        </div>
      </div>
    </div>

    @if (nuevoCodigo() !== null) {
      <app-producto-form [codigoInicial]="nuevoCodigo()!" (guardado)="creado($event)" (cerrar)="nuevoCodigo.set(null)" />
    }`,
})
export class VentaNueva implements OnInit {
  readonly store = inject(Store);
  private ui = inject(Ui);
  private router = inject(Router);
  soles = soles; cant = cant; fecha = fecha; normPlaca = normPlaca;
  metodos = METODOS_PAGO;

  placa = ''; private placaBuscada = '';
  veh: { marca?: string; modelo?: string; anio?: string } = {};
  cli: { id?: number; doc_numero?: string; nombre?: string; telefono?: string } = {};
  kmActual = ''; kmProximo = ''; intervalo = 5000; fechaProxima = sumarMeses(hoy(), 3);
  metodo = 'Efectivo'; mecanicoId: string | null = null; observaciones = '';

  readonly lineas = signal<Linea[]>([]);
  readonly historial = signal<HistorialServicio[]>([]);
  readonly placaNueva = signal(false);
  readonly personal = signal<{ id: string; nombre: string }[]>([]);
  readonly guardando = signal(false);
  readonly nuevoCodigo = signal<string | null>(null);
  readonly esMecanico = computed(() => this.store.rol() === 'mecanico');
  readonly servicios = computed(() => this.store.productosActivos().filter((p) => p.es_servicio).slice(0, 8));
  readonly subtotal = computed(() => r2(this.lineas().reduce((s, l) => s + r2(l.cantidad * l.precio), 0)));
  readonly descuento = signal(0);
  readonly descuentoValido = computed(() => this.esMecanico() ? 0 : Math.min(this.subtotal(), Math.max(0, this.descuento())));
  readonly total = computed(() => r2(this.subtotal() - this.descuentoValido()));

  ngOnInit() {
    this.store.repo.personal().then((p) => this.personal.set(p)).catch(() => {});
    if (this.esMecanico()) this.mecanicoId = this.store.usuario()!.id;
  }

  async buscarPlaca() {
    const p = normPlaca(this.placa);
    if (!p || p === this.placaBuscada) return;
    this.placaBuscada = p;
    this.placa = verPlaca(p);
    try {
      const v = await this.store.repo.vehiculoPorPlaca(p);
      this.placaNueva.set(!v);
      this.historial.set(v?.historial.filter((h) => h.estado === 'pagada') || []);
      if (v) {
        this.veh = { marca: v.marca || '', modelo: v.modelo || '', anio: v.anio ? String(v.anio) : '' };
        if (v.cliente) this.cli = { id: v.cliente.id, doc_numero: v.cliente.doc_numero || '', nombre: v.cliente.nombre, telefono: v.cliente.telefono || '' };
      }
    } catch { /* sin conexión: se registra igual */ }
  }

  sugerirKm(forzar = false) {
    const km = parseInt(String(this.kmActual).replace(/\D/g, ''), 10);
    if (km && (forzar || !this.kmProximo || this.kmAuto)) { this.kmProximo = String(km + this.intervalo); this.kmAuto = true; }
  }
  private kmAuto = false;

  agregar(p: Producto) {
    const ls = [...this.lineas()];
    const i = ls.findIndex((l) => l.producto.id === p.id);
    if (i >= 0) ls[i] = { ...ls[i], cantidad: r3(ls[i].cantidad + 1) };
    else ls.push({ producto: p, cantidad: 1, precio: p.precio_venta });
    this.lineas.set(ls);
    if (!p.es_servicio && p.stock <= 0) this.ui.error(`Sin stock de "${p.nombre}". Registra la compra primero.`);
  }
  cambiar(i: number, campo: 'cantidad' | 'precio', v: number) {
    const ls = [...this.lineas()];
    ls[i] = { ...ls[i], [campo]: Math.max(0, Number(v) || 0) };
    this.lineas.set(ls);
  }
  quitar(i: number) { this.lineas.set(this.lineas().filter((_, k) => k !== i)); }

  codigoNuevo(codigo: string) {
    if (this.store.puedeGestionar() && this.ui.confirmar(`No hay producto con el código ${codigo}. ¿Registrarlo ahora?`)) this.nuevoCodigo.set(codigo);
    else this.ui.error(`Código ${codigo} no registrado`);
  }
  creado(id: number) {
    this.nuevoCodigo.set(null);
    const p = this.store.productos().find((x) => x.id === id);
    if (p) this.agregar(p);
  }

  async guardar() {
    const ls = this.lineas().filter((l) => l.cantidad > 0);
    if (!ls.length) return this.ui.error('Agrega al menos un producto o servicio');
    const falta = ls.find((l) => !l.producto.es_servicio && l.cantidad > l.producto.stock);
    if (falta && this.store.enLinea()) return this.ui.error(`Stock insuficiente de "${falta.producto.nombre}" (hay ${cant(falta.producto.stock)} ${falta.producto.unidad})`);
    this.guardando.set(true);
    try {
      const tieneCliente = this.cli.id || this.cli.nombre?.trim() || this.cli.doc_numero?.trim();
      const r = await this.store.registrarVenta({
        cliente: tieneCliente ? this.cli : null,
        vehiculo: normPlaca(this.placa) ? { placa: this.placa, ...this.veh } : null,
        km_actual: this.kmActual || null, km_proximo: this.kmProximo || null,
        fecha_proxima: normPlaca(this.placa) ? this.fechaProxima || null : null,
        metodo_pago: this.metodo, descuento: this.descuentoValido(), observaciones: this.observaciones,
        mecanico_id: this.mecanicoId,
        items: ls.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad, ...(this.esMecanico() ? {} : { precio_unitario: l.precio }) })),
      });
      if (r.pendiente) {
        this.ui.ok('Sin conexión: la venta se guardó y se enviará al volver internet');
        this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => this.router.navigateByUrl('/venta'));
      } else {
        this.ui.ok('Orden registrada');
        this.router.navigate(['/ticket', r.id]);
      }
    } catch (e) { this.ui.error(e); } finally { this.guardando.set(false); }
  }
}

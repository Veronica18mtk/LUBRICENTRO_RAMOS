import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Cliente, HistorialServicio, Vehiculo } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { fecha, numeroOS, soles, verPlaca, whatsapp } from '../core/util';

@Component({
  selector: 'app-vehiculos',
  imports: [FormsModule],
  template: `
    <div class="page-head"><div><h1>Vehículos y clientes</h1><div class="muted small">Historial de servicios por placa</div></div>
      <div class="chips"><button class="chip" [class.on]="tab() === 'v'" (click)="tab.set('v'); buscar()">Vehículos</button>
        <button class="chip" [class.on]="tab() === 'c'" (click)="tab.set('c'); buscar()">Clientes</button></div></div>
    <div class="card">
      <input [(ngModel)]="q" (ngModelChange)="buscar()" [placeholder]="tab() === 'v' ? 'Placa, marca, modelo…' : 'Nombre, DNI/RUC o celular'" aria-label="Buscar">
    </div>
    <div class="card">
      @if (tab() === 'v') {
        @for (v of vehiculos(); track v.id) {
          <div class="list-item click" style="cursor:pointer" (click)="abrir(v.placa)">
            <span><b>{{ verPlaca(v.placa) }}</b> {{ v.marca || '' }} {{ v.modelo || '' }} {{ v.anio || '' }}<br><span class="muted small">{{ v.cliente?.nombre || 'Sin cliente' }}</span></span>
            <span class="muted small right">{{ v.ultimo_servicio ? 'Último: ' + fecha(v.ultimo_servicio) : '' }}</span>
          </div>
        } @empty { <div class="empty">Sin vehículos registrados. Se registran solos al crear una orden con placa.</div> }
      } @else {
        @for (c of clientes(); track c.id) {
          <div class="list-item">
            <span><b>{{ c.nombre }}</b> <span class="muted small">{{ c.doc_tipo }} {{ c.doc_numero || '' }}</span><br>
              <span class="small">{{ c.telefono || '' }} @if (c.placas) { · 🚗 {{ c.placas }} }</span></span>
            <span class="row">
              @if (wa(c.telefono, c.nombre); as l) { <a class="btn small" [href]="l" target="_blank" rel="noopener">WhatsApp</a> }
              @if (store.puedeGestionar()) { <button class="btn small" (click)="editarCliente(c)">Editar</button> }
            </span>
          </div>
        } @empty { <div class="empty">Sin clientes</div> }
      }
    </div>

    @if (sel(); as v) {
      <div class="modal-bg" (click)="sel.set(null)">
        <div class="modal wide" (click)="$event.stopPropagation()">
          <div class="modal-head"><h2>🚗 {{ verPlaca(v.placa) }} · {{ v.marca || '' }} {{ v.modelo || '' }} {{ v.anio || '' }}</h2>
            <button class="icon-btn" (click)="sel.set(null)" aria-label="Cerrar">✕</button></div>
          @if (v.cliente) { <p>👤 {{ v.cliente.nombre }} · {{ v.cliente.doc_numero || '' }} · {{ v.cliente.telefono || '' }}</p> }
          <table>
            <thead><tr><th>Fecha</th><th>Km</th><th>Servicio</th><th class="right">Total</th></tr></thead>
            <tbody>
              @for (h of v.historial; track h.id) {
                <tr class="click" (click)="router.navigate(['/ticket', h.id])" [style.opacity]="h.estado === 'anulada' ? .5 : 1">
                  <td class="nowrap small">{{ fecha(h.fecha) }}<br><span class="muted">{{ numeroOS(h.id) }}</span></td>
                  <td class="nowrap">{{ h.km_actual?.toLocaleString('es-PE') || '' }}</td>
                  <td class="small">{{ h.detalle }} @if (h.estado === 'anulada') { <span class="badge bad">anulada</span> }</td>
                  <td class="right nowrap">{{ soles(h.total) }}</td>
                </tr>
              } @empty { <tr><td colspan="4" class="empty">Sin servicios</td></tr> }
            </tbody>
          </table>
        </div>
      </div>
    }

    @if (cli(); as c) {
      <div class="modal-bg" (click)="cli.set(null)">
        <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="guardarCliente()">
          <div class="modal-head"><h2>Editar cliente</h2><button type="button" class="icon-btn" (click)="cli.set(null)" aria-label="Cerrar">✕</button></div>
          <div class="grid g2">
            <div class="field"><label>Tipo</label><select [(ngModel)]="c.doc_tipo" name="t"><option>DNI</option><option>RUC</option><option>CE</option></select></div>
            <div class="field"><label>Número</label><input [(ngModel)]="c.doc_numero" name="d"></div>
          </div>
          <div class="field"><label>Nombre</label><input [(ngModel)]="c.nombre" name="n" required></div>
          <div class="field"><label>Celular</label><input [(ngModel)]="c.telefono" name="tel"></div>
          <div class="modal-foot"><button type="button" class="btn" (click)="cli.set(null)">Cancelar</button><button class="btn primary">Guardar</button></div>
        </form>
      </div>
    }`,
})
export class Vehiculos implements OnInit {
  readonly store = inject(Store);
  readonly router = inject(Router);
  private ui = inject(Ui);
  private route = inject(ActivatedRoute);
  fecha = fecha; soles = soles; verPlaca = verPlaca; numeroOS = numeroOS;
  q = '';
  readonly tab = signal<'v' | 'c'>('v');
  readonly vehiculos = signal<Vehiculo[]>([]);
  readonly clientes = signal<(Cliente & { placas: string })[]>([]);
  readonly sel = signal<(Vehiculo & { historial: HistorialServicio[] }) | null>(null);
  readonly cli = signal<Cliente | null>(null);
  private t?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    this.buscar();
    const placa = this.route.snapshot.queryParamMap.get('placa');
    if (placa) this.abrir(placa);
  }
  buscar() {
    clearTimeout(this.t);
    this.t = setTimeout(async () => {
      try {
        if (this.tab() === 'v') this.vehiculos.set(await this.store.repo.vehiculos(this.q));
        else this.clientes.set(await this.store.repo.clientes(this.q));
      } catch (e) { this.ui.error(e); }
    }, 250);
  }
  async abrir(placa: string) {
    try { this.sel.set(await this.store.repo.vehiculoPorPlaca(placa)); } catch (e) { this.ui.error(e); }
  }
  wa(tel: string | null, nombre: string) { return whatsapp(tel, `Hola ${nombre}, le saludamos de ${this.store.negocio.nombre}.`); }
  editarCliente(c: Cliente) { this.cli.set({ ...c }); }
  async guardarCliente() {
    const c = this.cli()!;
    try { await this.store.repo.actualizarCliente(c.id, c); this.cli.set(null); this.ui.ok('Cliente actualizado'); this.buscar(); }
    catch (e) { this.ui.error(e); }
  }
}

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { VentaResumen } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { fechaHora, hoy, numeroOS, r2, soles, verPlaca } from '../core/util';
import { exportarExcel } from '../shared/excel';

@Component({
  selector: 'app-ventas',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div><h1>Ventas y órdenes</h1><div class="muted small">{{ filtradas().length }} órdenes · {{ soles(totalPagado()) }}</div></div>
      <div class="row">
        @if (store.puedeGestionar()) { <button class="btn" (click)="excel()">⬇ Excel</button> }
        <a class="btn accent" routerLink="/venta">➕ Nueva</a>
      </div>
    </div>
    <div class="card">
      <div class="row">
        <div><label>Desde</label><input type="date" [(ngModel)]="desde" (change)="cargar()"></div>
        <div><label>Hasta</label><input type="date" [(ngModel)]="hasta" (change)="cargar()"></div>
        <div class="grow"><label>Buscar</label><input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Placa, cliente, N° de orden"></div>
      </div>
      <div class="chips" style="margin-top:10px">
        @for (r of rangos; track r.t) { <button class="chip" (click)="rango(r.d)">{{ r.t }}</button> }
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>N°</th><th>Fecha</th><th>Placa</th><th>Cliente</th><th>Pago</th><th class="right">Total</th><th></th></tr></thead>
          <tbody>
            @for (v of filtradas(); track v.id) {
              <tr class="click" (click)="abrir(v)">
                <td class="nowrap">{{ numeroOS(v.id) }}</td>
                <td class="nowrap small">{{ fechaHora(v.fecha) }}</td>
                <td class="nowrap"><b>{{ verPlaca(v.placa) }}</b></td>
                <td>{{ v.cliente || '—' }}</td>
                <td>{{ v.metodo_pago }}</td>
                <td class="right nowrap">{{ soles(v.total) }}</td>
                <td>
                  @if (v.estado === 'anulada') { <span class="badge bad">Anulada</span> }
                  @if (v.revisar) { <span class="badge warn">Revisar</span> }
                </td>
              </tr>
            } @empty { <tr><td colspan="7" class="empty">No hay ventas en este rango</td></tr> }
          </tbody>
        </table>
      </div>
    </div>`,
})
export class Ventas implements OnInit {
  readonly store = inject(Store);
  private ui = inject(Ui);
  private router = inject(Router);
  soles = soles; fechaHora = fechaHora; numeroOS = numeroOS; verPlaca = verPlaca;
  desde = hoy(); hasta = hoy();
  readonly q = signal('');
  readonly lista = signal<VentaResumen[]>([]);
  rangos = [{ t: 'Hoy', d: 0 }, { t: 'Ayer', d: -1 }, { t: '7 días', d: 7 }, { t: '30 días', d: 30 }];

  readonly filtradas = computed(() => {
    const t = this.q().trim().toLowerCase().replace(/-/g, '');
    return this.lista().filter((v) => !t || [v.placa, v.cliente, numeroOS(v.id)].some((x) => (x || '').toLowerCase().replace(/-/g, '').includes(t)));
  });
  readonly totalPagado = computed(() => r2(this.filtradas().filter((v) => v.estado === 'pagada').reduce((s, v) => s + v.total, 0)));

  ngOnInit() { this.cargar(); }
  rango(d: number) {
    if (d === 0) { this.desde = this.hasta = hoy(); }
    else if (d === -1) { this.desde = this.hasta = hoy(-1); }
    else { this.desde = hoy(-d + 1); this.hasta = hoy(); }
    this.cargar();
  }
  async cargar() {
    try { this.lista.set(await this.store.repo.ventas(this.desde, this.hasta)); } catch (e) { this.ui.error(e); }
  }
  abrir(v: VentaResumen) { this.router.navigate(['/ticket', v.id]); }

  excel() {
    exportarExcel(`ventas_${this.desde}_${this.hasta}`, 'Ventas', [
      { h: 'N°', k: 'n', w: 12 }, { h: 'Fecha', k: 'fecha', w: 18 }, { h: 'Placa', k: 'placa', w: 10 }, { h: 'Cliente', k: 'cliente', w: 28 },
      { h: 'Pago', k: 'metodo_pago', w: 14 }, { h: 'Estado', k: 'estado', w: 10 }, { h: 'Total S/', k: 'total', w: 12, money: true },
    ], this.filtradas().map((v) => ({ ...v, n: numeroOS(v.id), fecha: fechaHora(v.fecha), placa: verPlaca(v.placa) })));
  }
}

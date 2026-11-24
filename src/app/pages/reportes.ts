import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Movimiento, Reporte } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { cant, fecha, fechaHora, hoy, soles } from '../core/util';
import { exportarExcel } from '../shared/excel';

type ECharts = { setOption: (o: unknown) => void; resize: () => void; dispose: () => void };

@Component({
  selector: 'app-reportes',
  imports: [FormsModule],
  template: `
    <div class="page-head"><div><h1>Reportes</h1><div class="muted small">{{ fecha(desde) }} – {{ fecha(hasta) }}</div></div>
      <div class="row"><button class="btn" (click)="excelKardex()">⬇ Kardex del periodo</button></div></div>
    <div class="card">
      <div class="row">
        <div><label>Desde</label><input type="date" [(ngModel)]="desde" (change)="cargar()"></div>
        <div><label>Hasta</label><input type="date" [(ngModel)]="hasta" (change)="cargar()"></div>
        <div class="chips" style="align-self:flex-end">
          <button class="chip" (click)="rango(0)">Hoy</button><button class="chip" (click)="rango(7)">7 días</button>
          <button class="chip" (click)="mes()">Este mes</button><button class="chip" (click)="rango(30)">30 días</button>
        </div>
      </div>
    </div>
    @if (r(); as r) {
      <div class="grid g4">
        <div class="card stat"><div class="label">Ventas</div><div class="value">{{ soles(r.resumen.total) }}</div><div class="muted small">{{ r.resumen.n }} órdenes</div></div>
        <div class="card stat"><div class="label">Ganancia bruta</div><div class="value" style="color:var(--ok)">{{ soles(r.ganancia) }}</div>
          <div class="muted small">{{ r.resumen.total ? ((r.ganancia / r.resumen.total) * 100).toFixed(1) : 0 }}% margen</div></div>
        <div class="card stat"><div class="label">Ticket promedio</div><div class="value">{{ soles(r.resumen.n ? r.resumen.total / r.resumen.n : 0) }}</div></div>
        <div class="card stat"><div class="label">Compras</div><div class="value">{{ soles(r.compras.total) }}</div><div class="muted small">{{ r.compras.n }} facturas</div></div>
      </div>
      <div class="card"><h2>Ventas por día</h2><div #chart style="height:260px"></div></div>
      <div class="grid g2 stack">
        <div class="card"><h2>Por método de pago</h2>
          @for (m of r.por_metodo; track m.metodo_pago) {
            <div class="list-item"><span>{{ m.metodo_pago }} <span class="muted small">({{ m.n }})</span></span><b>{{ soles(m.total) }}</b></div>
          } @empty { <div class="empty">Sin datos</div> }
        </div>
        <div class="card"><h2>Por usuario</h2>
          @for (u of r.por_usuario; track u.nombre) {
            <div class="list-item"><span>{{ u.nombre }} <span class="muted small">({{ u.n }})</span></span><b>{{ soles(u.total) }}</b></div>
          } @empty { <div class="empty">Sin datos</div> }
        </div>
      </div>
      <div class="card"><div class="row" style="justify-content:space-between"><h2>Productos más vendidos</h2><button class="btn small" (click)="excelTop()">⬇ Excel</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th class="right">Cantidad</th><th class="right">Ventas</th><th class="right">Ganancia</th></tr></thead>
          <tbody>@for (p of r.top_productos; track p.nombre) {
            <tr><td>{{ p.nombre }}</td><td class="right">{{ cant(p.cantidad) }} {{ p.unidad }}</td><td class="right">{{ soles(p.total) }}</td><td class="right">{{ soles(p.ganancia) }}</td></tr>
          } @empty { <tr><td colspan="4" class="empty">Sin ventas en el periodo</td></tr> }</tbody>
        </table></div>
      </div>
    }`,
})
export class Reportes implements OnInit, OnDestroy {
  readonly store = inject(Store);
  private ui = inject(Ui);
  soles = soles; cant = cant; fecha = fecha;
  desde = hoy(-6); hasta = hoy();
  readonly r = signal<Reporte | null>(null);
  private chartEl = viewChild<ElementRef<HTMLDivElement>>('chart');
  private chart: ECharts | null = null;
  private onResize = () => this.chart?.resize();

  ngOnInit() { this.cargar(); window.addEventListener('resize', this.onResize); }
  ngOnDestroy() { window.removeEventListener('resize', this.onResize); this.chart?.dispose(); }

  rango(d: number) { this.desde = hoy(-Math.max(0, d - 1)); this.hasta = hoy(); this.cargar(); }
  mes() { this.desde = hoy().slice(0, 8) + '01'; this.hasta = hoy(); this.cargar(); }

  async cargar() {
    try {
      this.r.set(await this.store.repo.reporte(this.desde, this.hasta));
      setTimeout(() => this.dibujar(), 0);
    } catch (e) { this.ui.error(e); }
  }

  private async dibujar() {
    const el = this.chartEl()?.nativeElement;
    const r = this.r();
    if (!el || !r) return;
    const [core, charts, comps, renderers] = await Promise.all([
      import('echarts/core'), import('echarts/charts'), import('echarts/components'), import('echarts/renderers')]);
    core.use([charts.BarChart, comps.GridComponent, comps.TooltipComponent, renderers.CanvasRenderer]);
    // Días completos del rango (incluye días sin ventas)
    const dias: string[] = [];
    for (let d = new Date(this.desde + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= this.hasta && dias.length < 400; d.setUTCDate(d.getUTCDate() + 1)) dias.push(d.toISOString().slice(0, 10));
    const porDia = new Map(r.por_dia.map((x) => [x.dia, Number(x.total)]));
    if (this.chart && (this.chart as unknown as { getDom: () => HTMLElement }).getDom() !== el) { this.chart.dispose(); this.chart = null; }
    this.chart ||= core.init(el) as unknown as ECharts;
    this.chart.setOption({
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => soles(v) },
      xAxis: { type: 'category', data: dias.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)), axisTick: { show: false }, axisLine: { lineStyle: { color: '#dde3ea' } }, axisLabel: { color: '#5b6b80' } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef1f5' } }, axisLabel: { color: '#5b6b80', formatter: (v: number) => 'S/ ' + v } },
      series: [{ type: 'bar', data: dias.map((d) => porDia.get(d) || 0), itemStyle: { color: '#1d4f80', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 }],
    });
  }

  excelTop() {
    const r = this.r(); if (!r) return;
    exportarExcel(`productos_vendidos_${this.desde}_${this.hasta}`, 'Más vendidos', [
      { h: 'Producto', k: 'nombre', w: 36 }, { h: 'Unidad', k: 'unidad', w: 8 }, { h: 'Cantidad', k: 'cantidad', num: true },
      { h: 'Ventas', k: 'total', money: true }, { h: 'Ganancia', k: 'ganancia', money: true },
    ], r.top_productos);
  }

  async excelKardex() {
    try {
      const m: Movimiento[] = await this.store.repo.movimientos(this.desde, this.hasta);
      exportarExcel(`kardex_${this.desde}_${this.hasta}`, 'Kardex', [
        { h: 'Fecha', k: 'f', w: 18 }, { h: 'Producto', k: 'producto', w: 36 }, { h: 'Tipo', k: 'tipo', w: 12 }, { h: 'Cantidad', k: 'cantidad', num: true },
        { h: 'Unidad', k: 'unidad', w: 8 }, { h: 'Saldo', k: 'stock_resultante', num: true }, { h: 'Referencia', k: 'referencia', w: 22 },
        { h: 'Nota', k: 'nota', w: 36 }, { h: 'Usuario', k: 'usuario', w: 18 },
      ], m.map((x) => ({ ...x, f: fechaHora(x.fecha) })));
    } catch (e) { this.ui.error(e); }
  }
}

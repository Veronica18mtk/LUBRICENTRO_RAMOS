import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Dashboard, Recordatorio } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { cant, fecha, soles, verPlaca, whatsapp } from '../core/util';

@Component({
  selector: 'app-inicio',
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <div><h1>Hola, {{ primerNombre() }}</h1><div class="muted">{{ fecha(d()?.fecha) }}</div></div>
      <a class="btn accent" routerLink="/venta">➕ Nueva orden de servicio</a>
    </div>

    @if (store.modo() === 'local' && !store.productos().length) {
      <div class="card">
        <h2>Empieza aquí</h2>
        <p>Registra tus productos en <a routerLink="/productos">Inventario</a>, o carga datos de ejemplo para conocer la app.</p>
        <button class="btn" (click)="ejemplo()">Cargar datos de ejemplo</button>
      </div>
    }

    @if (d(); as d) {
      <div class="grid g4">
        <div class="card stat"><div class="label">Ventas de hoy</div><div class="value">{{ soles(d.ventas_hoy.total) }}</div><div class="muted small">{{ d.ventas_hoy.n }} órdenes</div></div>
        <a class="card stat stat-link" routerLink="/productos" [queryParams]="{ bajo: 1 }" aria-label="Ver productos con stock bajo"><div class="label">Stock bajo ›</div><div class="value" [style.color]="d.stock_bajo.length ? 'var(--warn)' : ''">{{ d.stock_bajo.length }}</div><div class="muted small">de {{ d.n_productos }} productos</div></a>
        @if (d.valor_inventario !== null) {
          <div class="card stat"><div class="label">Inventario valorizado</div><div class="value">{{ soles(d.valor_inventario) }}</div><div class="muted small">a precio de costo</div></div>
        }
        <div class="card stat"><div class="label">Cobrado hoy por método</div>
          <div class="small" style="margin-top:6px">
            @for (m of d.por_metodo; track m.metodo_pago) { <div class="row" style="justify-content:space-between"><span>{{ m.metodo_pago }}</span><b>{{ soles(m.total) }}</b></div> }
            @empty { <span class="muted">Sin ventas aún</span> }
          </div>
        </div>
      </div>

      @if (d.por_revisar) {
        <div class="alert warn">{{ d.por_revisar }} venta(s) hechas sin conexión dejaron stock negativo. Revisa en <a routerLink="/ventas">Ventas</a> y corrige con un conteo.</div>
      }

      <div class="grid g2 stack">
        <div class="card">
          <h2>⚠️ Productos por reponer</h2>
          @for (p of d.stock_bajo; track p.id) {
            <div class="list-item">
              <span>{{ p.nombre }} <span class="muted small">{{ p.marca || '' }}</span></span>
              <span class="nowrap"><span [class]="p.stock <= 0 ? 'badge bad' : 'badge warn'">{{ cant(p.stock) }} {{ p.unidad }}</span>
                <span class="muted small"> mín. {{ cant(p.stock_minimo) }}</span></span>
            </div>
          } @empty { <div class="empty">Todo el stock está sobre el mínimo 👍</div> }
        </div>
        <div class="card">
          <h2>📅 Próximos cambios de aceite (7 días)</h2>
          @for (r of rec(); track r.venta_id) {
            <div class="list-item">
              <span><b>{{ verPlaca(r.placa) }}</b> {{ r.cliente || '' }}<br>
                <span class="muted small">{{ [r.marca, r.modelo].join(' ') }} · {{ fecha(r.fecha_proxima) }}@if (r.km_proximo) { · {{ r.km_proximo.toLocaleString('es-PE') }} km }</span></span>
              @if (wa(r); as link) { <a class="btn small" [href]="link" target="_blank" rel="noopener">WhatsApp</a> }
            </div>
          } @empty { <div class="empty">No hay recordatorios pendientes</div> }
        </div>
      </div>
    } @else {
      <div class="empty">Cargando…</div>
    }`,
})
export class Inicio implements OnInit, OnDestroy {
  readonly store = inject(Store);
  private ui = inject(Ui);
  readonly d = signal<Dashboard | null>(null);
  readonly rec = signal<Recordatorio[]>([]);
  soles = soles; cant = cant; fecha = fecha; verPlaca = verPlaca;
  private off?: () => void;

  primerNombre() { return (this.store.usuario()?.nombre || '').split(' ')[0]; }

  ngOnInit() {
    this.cargar();
    this.off = this.store.repo.alCambiar(() => this.cargar());
  }
  ngOnDestroy() { this.off?.(); }

  async cargar() {
    try {
      const [d, r] = await Promise.all([this.store.repo.dashboard(), this.store.repo.recordatorios(7)]);
      this.d.set(d); this.rec.set(r);
    } catch (e) { this.ui.error(e); }
  }

  wa(r: Recordatorio) {
    return whatsapp(r.telefono, `Hola ${r.cliente || ''}, le saludamos de ${this.store.negocio.nombre}. Su vehículo ${verPlaca(r.placa)} ya está por su próximo cambio de aceite. ¡Lo esperamos!`);
  }

  async ejemplo() {
    try { await this.store.local!.cargarEjemplo(); await this.store.cargarProductos(); await this.cargar(); this.ui.ok('Datos de ejemplo cargados'); }
    catch (e) { this.ui.error(e); }
  }
}

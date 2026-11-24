import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Producto, ResultadoConteo } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { cant, r3 } from '../core/util';
import { ProductoPicker } from '../shared/producto-picker';

interface Fila { producto: Producto; contado: number | null }

/**
 * Conteo físico: se cuenta lo que hay en el estante y el sistema calcula la diferencia.
 * Al aplicar, cada diferencia queda como AJUSTE en el kardex (con usuario y fecha).
 */
@Component({
  selector: 'app-conteo',
  imports: [FormsModule, ProductoPicker],
  template: `
    <div class="page-head"><div><h1>Conteo físico</h1>
      <div class="muted small">Recomendado: contar 10–15 productos por semana (empezando por aceites y filtros que más se venden)</div></div></div>

    <div class="card">
      <div class="chips field">
        <button class="chip" (click)="agregarCategoria('Aceite de motor')">+ Todos los aceites de motor</button>
        <button class="chip" (click)="agregarCategoria('Filtro de aceite')">+ Todos los filtros de aceite</button>
        <button class="chip" (click)="agregarBajos()">+ Productos con stock bajo</button>
      </div>
      <app-producto-picker [soloInventario]="true" (elegido)="agregar($event)" placeholder="Escanea o busca el producto que estás contando…" />
    </div>

    @if (filas().length) {
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Producto</th><th class="right">Sistema</th><th style="width:120px">Contado</th><th class="right">Diferencia</th><th></th></tr></thead>
            <tbody>
              @for (f of filas(); track f.producto.id; let i = $index) {
                <tr>
                  <td>{{ f.producto.nombre }}<div class="muted small">{{ f.producto.ubicacion || '' }}</div></td>
                  <td class="right">{{ cant(f.producto.stock) }} {{ f.producto.unidad }}</td>
                  <td><input type="number" step="any" min="0" [ngModel]="f.contado" (ngModelChange)="contar(i, $event)" [attr.aria-label]="'Contado ' + f.producto.nombre"></td>
                  <td class="right"><b [style.color]="dif(f) < 0 ? 'var(--bad)' : dif(f) > 0 ? 'var(--ok)' : ''">{{ f.contado === null ? '' : (dif(f) > 0 ? '+' : '') + cant(dif(f)) }}</b></td>
                  <td><button class="icon-btn" (click)="quitar(i)" aria-label="Quitar">✕</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="field" style="margin-top:12px"><label>Nota</label><input [(ngModel)]="nota" placeholder="Conteo semanal, merma, producto dañado…"></div>
        <p class="small muted">{{ contados() }} de {{ filas().length }} contados · {{ conDiferencia() }} con diferencia</p>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" (click)="filas.set([])">Limpiar</button>
          <button class="btn primary" [disabled]="aplicando() || !contados()" (click)="aplicar()">{{ aplicando() ? 'Aplicando…' : 'Aplicar ajustes' }}</button>
        </div>
      </div>
    }

    @if (resultado().length) {
      <div class="card">
        <h2>Resultado del último conteo</h2>
        @for (r of resultado(); track r.producto_id) {
          <div class="list-item"><span>{{ r.nombre }}</span>
            <span>{{ cant(r.antes) }} → <b>{{ cant(r.contado) }}</b>
              @if (r.diferencia !== 0) { <span [class]="r.diferencia < 0 ? 'badge bad' : 'badge ok'">{{ r.diferencia > 0 ? '+' : '' }}{{ cant(r.diferencia) }}</span> }
              @else { <span class="badge ok">cuadra</span> }</span></div>
        }
      </div>
    }`,
})
export class Conteo {
  readonly store = inject(Store);
  private ui = inject(Ui);
  cant = cant;
  nota = 'Conteo físico';
  readonly filas = signal<Fila[]>([]);
  readonly resultado = signal<ResultadoConteo[]>([]);
  readonly aplicando = signal(false);
  readonly contados = computed(() => this.filas().filter((f) => f.contado !== null).length);
  readonly conDiferencia = computed(() => this.filas().filter((f) => f.contado !== null && this.dif(f) !== 0).length);

  dif(f: Fila) { return f.contado === null ? 0 : r3(f.contado - f.producto.stock); }
  agregar(p: Producto) {
    if (this.filas().some((f) => f.producto.id === p.id)) return this.ui.ok('Ya está en la lista');
    this.filas.update((fs) => [{ producto: p, contado: null }, ...fs]);
    setTimeout(() => (document.querySelector('tbody input') as HTMLInputElement | null)?.focus(), 50);
  }
  agregarCategoria(c: string) { this.store.productosActivos().filter((p) => p.categoria === c && !p.es_servicio).forEach((p) => this.agregarSilencioso(p)); }
  agregarBajos() { this.store.productosActivos().filter((p) => !p.es_servicio && p.stock <= p.stock_minimo).forEach((p) => this.agregarSilencioso(p)); }
  private agregarSilencioso(p: Producto) { if (!this.filas().some((f) => f.producto.id === p.id)) this.filas.update((fs) => [...fs, { producto: p, contado: null }]); }
  contar(i: number, v: unknown) {
    const fs = [...this.filas()];
    fs[i] = { ...fs[i], contado: v === null || v === '' ? null : Math.max(0, Number(v)) };
    this.filas.set(fs);
  }
  quitar(i: number) { this.filas.set(this.filas().filter((_, k) => k !== i)); }

  async aplicar() {
    const conteos = this.filas().filter((f) => f.contado !== null).map((f) => ({ producto_id: f.producto.id, contado: f.contado! }));
    if (!this.ui.confirmar(`Se ajustará el stock de ${conteos.length} producto(s) según lo contado. ¿Continuar?`)) return;
    this.aplicando.set(true);
    try {
      this.resultado.set(await this.store.repo.aplicarConteo(this.nota, conteos));
      this.filas.set(this.filas().filter((f) => f.contado === null));
      await this.store.cargarProductos();
      this.ui.ok('Ajustes aplicados y registrados en el kardex');
    } catch (e) { this.ui.error(e); } finally { this.aplicando.set(false); }
  }
}

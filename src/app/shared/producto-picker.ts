import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Producto } from '../core/models';
import { Store } from '../core/store';
import { cant, soles } from '../core/util';
import { Scanner } from './scanner';

/**
 * Buscador de productos: por nombre/marca, por código (lector USB que "escribe" + Enter)
 * o con la cámara del celular.
 */
@Component({
  selector: 'app-producto-picker',
  imports: [Scanner],
  template: `
    <div class="row">
      <input class="grow" #q [placeholder]="placeholder()" [value]="texto()" (input)="texto.set(q.value)"
             (keydown.enter)="enter()" autocomplete="off" aria-label="Buscar producto">
      <button class="btn" type="button" (click)="escaneando.set(true)" title="Escanear con la cámara">📷 Escanear</button>
    </div>
    @if (texto().trim()) {
      <div class="search-results">
        @for (p of resultados(); track p.id) {
          <button type="button" (click)="elegir(p)">
            <span>
              <b>{{ p.nombre }}</b>
              <span class="muted small"> {{ p.marca || '' }} · {{ p.categoria }}</span>
            </span>
            <span class="nowrap small right">
              {{ soles(p.precio_venta) }}<br>
              @if (!p.es_servicio) {
                <span [class]="p.stock <= 0 ? 'badge bad' : p.stock <= p.stock_minimo ? 'badge warn' : 'badge ok'">{{ cant(p.stock) }} {{ p.unidad }}</span>
              } @else { <span class="badge">servicio</span> }
            </span>
          </button>
        } @empty {
          <div class="empty small">Sin resultados para “{{ texto() }}”</div>
        }
      </div>
    }
    @if (escaneando()) {
      <app-scanner (leido)="porCodigo($event)" (cerrar)="escaneando.set(false)" />
    }`,
})
export class ProductoPicker {
  private store = inject(Store);
  readonly placeholder = input('Buscar producto o escanear código…');
  readonly soloInventario = input(false);
  readonly elegido = output<Producto>();
  readonly noEncontrado = output<string>();
  readonly texto = signal('');
  readonly escaneando = signal(false);
  soles = soles; cant = cant;

  readonly resultados = computed(() => {
    const palabras = this.texto().toLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.store.productosActivos()
      .filter((p) => !(this.soloInventario() && p.es_servicio))
      .filter((p) => palabras.every((w) => p.codigo_barras === w || `${p.nombre} ${p.marca || ''} ${p.categoria}`.toLowerCase().includes(w)))
      .slice(0, 30);
  });

  enter() {
    const t = this.texto().trim();
    const porCodigo = this.store.productosActivos().find((p) => p.codigo_barras === t);
    if (porCodigo) return this.elegir(porCodigo);
    if (/^\d{6,}$/.test(t)) { this.noEncontrado.emit(t); this.texto.set(''); return; }
    const r = this.resultados();
    if (r.length === 1) this.elegir(r[0]);
  }

  porCodigo(codigo: string) {
    this.escaneando.set(false);
    const p = this.store.productosActivos().find((x) => x.codigo_barras === codigo);
    if (p) this.elegir(p); else this.noEncontrado.emit(codigo);
  }

  elegir(p: Producto) { this.elegido.emit(p); this.texto.set(''); }
}

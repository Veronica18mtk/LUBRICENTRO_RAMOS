import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VentaDetalle } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { cant, fecha, fechaHora, numeroOS, soles, verPlaca, whatsapp } from '../core/util';

/** Orden de servicio: vista imprimible (ticketera 80 mm o A4) */
@Component({
  selector: 'app-ticket',
  imports: [RouterLink],
  template: `
    <div style="padding:16px;max-width:520px;margin:0 auto">
      <div class="row no-print" style="margin-bottom:12px">
        <a class="btn" routerLink="/ventas">← Ventas</a>
        <a class="btn accent" routerLink="/venta">➕ Nueva orden</a>
        <button class="btn primary" (click)="imprimir()">🖨️ Imprimir</button>
        @if (v() && enlaceWa(); as wa) { <a class="btn" [href]="wa" target="_blank" rel="noopener">WhatsApp</a> }
      </div>
      @if (v(); as v) {
        @if (v.estado === 'anulada') { <div class="alert warn">ANULADA: {{ v.motivo_anulacion }}</div> }
        <div class="ticket card">
          <h3>{{ store.negocio.nombre }}</h3>
          <div class="c">@if (store.negocio.ruc) { RUC {{ store.negocio.ruc }}<br> }{{ store.negocio.direccion }}@if (store.negocio.telefono) { <br>Tel. {{ store.negocio.telefono }} }</div>
          <hr>
          <div class="c"><b>ORDEN DE SERVICIO {{ numeroOS(v.id) }}</b></div>
          <div>Fecha: {{ fechaHora(v.fecha) }}</div>
          @if (v.cliente) { <div>Cliente: {{ v.cliente }}</div> }
          @if (v.cliente_doc) { <div>{{ v.cliente_doc_tipo }}: {{ v.cliente_doc }}</div> }
          @if (v.placa) { <div>Placa: <b>{{ verPlaca(v.placa) }}</b> {{ v.vehiculo || '' }}</div> }
          @if (v.km_actual) { <div>Km actual: {{ v.km_actual.toLocaleString('es-PE') }}</div> }
          <hr>
          <table>
            @for (i of v.items; track $index) {
              <tr><td colspan="2">{{ i.descripcion }}</td></tr>
              <tr><td>{{ cant(i.cantidad) }} {{ i.unidad || '' }} x {{ i.precio_unitario.toFixed(2) }}</td><td style="text-align:right">{{ i.subtotal.toFixed(2) }}</td></tr>
            }
          </table>
          <hr>
          @if (v.descuento > 0) {
            <table><tr><td>Subtotal</td><td style="text-align:right">{{ v.subtotal.toFixed(2) }}</td></tr>
              <tr><td>Descuento</td><td style="text-align:right">-{{ v.descuento.toFixed(2) }}</td></tr></table>
          }
          <table><tr><td><b>TOTAL S/</b></td><td style="text-align:right"><b>{{ v.total.toFixed(2) }}</b></td></tr>
            <tr><td>Pago</td><td style="text-align:right">{{ v.metodo_pago }}</td></tr></table>
          @if (v.km_proximo || v.fecha_proxima) {
            <hr>
            <div class="c"><b>PRÓXIMO CAMBIO</b><br>
              @if (v.km_proximo) { {{ v.km_proximo.toLocaleString('es-PE') }} km }
              @if (v.km_proximo && v.fecha_proxima) { o }
              @if (v.fecha_proxima) { {{ fecha(v.fecha_proxima) }} }
            </div>
          }
          @if (v.observaciones) { <hr><div>Obs.: {{ v.observaciones }}</div> }
          <hr>
          <div class="c small">Atendido por: {{ v.mecanico || v.usuario || '' }}<br>Documento interno. Solicite su boleta o factura electrónica.<br>¡Gracias por su preferencia!</div>
        </div>
        @if (store.esAdmin() && v.estado === 'pagada') {
          <div class="no-print" style="margin-top:12px"><button class="btn danger" (click)="anular()">Anular orden (devuelve el stock)</button></div>
        }
      } @else { <div class="empty">Cargando…</div> }
    </div>`,
})
export class Ticket implements OnInit {
  readonly store = inject(Store);
  private ui = inject(Ui);
  readonly id = input.required<string>();
  readonly v = signal<VentaDetalle | null>(null);
  cant = cant; fecha = fecha; fechaHora = fechaHora; numeroOS = numeroOS; verPlaca = verPlaca;

  ngOnInit() { this.cargar(); }
  async cargar() {
    try { this.v.set(await this.store.repo.venta(Number(this.id()))); } catch (e) { this.ui.error(e); }
  }
  imprimir() { window.print(); }

  enlaceWa() {
    const v = this.v()!;
    const lineas = v.items.map((i) => `• ${i.descripcion} x${cant(i.cantidad)}: ${soles(i.subtotal)}`).join('\n');
    const prox = v.km_proximo ? `\nPróximo cambio: ${v.km_proximo.toLocaleString('es-PE')} km` + (v.fecha_proxima ? ` o ${fecha(v.fecha_proxima)}` : '') : '';
    return whatsapp(v.cliente_telefono, `*${this.store.negocio.nombre}*\nOrden ${numeroOS(v.id)} - ${fechaHora(v.fecha)}\n${v.placa ? 'Placa: ' + verPlaca(v.placa) + '\n' : ''}${lineas}\n*Total: ${soles(v.total)}*${prox}\n¡Gracias por su preferencia!`);
  }

  async anular() {
    const motivo = this.ui.pedir('Motivo de la anulación:');
    if (!motivo?.trim()) return;
    try {
      await this.store.repo.anularVenta(this.v()!.id, motivo.trim());
      await this.store.cargarProductos();
      this.ui.ok('Orden anulada y stock devuelto');
      this.cargar();
    } catch (e) { this.ui.error(e); }
  }
}

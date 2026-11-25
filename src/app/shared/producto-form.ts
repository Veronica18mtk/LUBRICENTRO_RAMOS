import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CATEGORIAS, Producto, UNIDADES } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { Scanner } from './scanner';

/** Crear o editar un producto/servicio */
@Component({
  selector: 'app-producto-form',
  imports: [FormsModule, Scanner],
  template: `
    <div class="modal-bg" (click)="cerrar.emit()">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="guardar()">
        <div class="modal-head">
          <h2>{{ producto() ? 'Editar' : 'Nuevo' }} {{ f.es_servicio ? 'servicio' : 'producto' }}</h2>
          <button type="button" class="icon-btn" (click)="cerrar.emit()" aria-label="Cerrar">✕</button>
        </div>
        @if (!producto()) {
          <label class="check field"><input type="checkbox" [(ngModel)]="f.es_servicio" name="serv"> Es un servicio (mano de obra, no tiene stock)</label>
        }
        @if (!f.es_servicio && !producto()) {
          <div class="foto-ia field">
            <label class="btn accent block" [class.disabled]="analizando()">
              {{ analizando() ? '⏳ Analizando la foto…' : '📸 Foto de la etiqueta (IA)' }}
              <input type="file" accept="image/*" capture="environment" hidden (change)="foto($event)" [disabled]="analizando()">
            </label>
            <p class="small muted">Llena nombre, marca, categoría y unidad automáticamente. Luego revisa y completa precios.</p>
          </div>
        }
        @if (!f.es_servicio) {
            <div class="field"><label>Código de barras</label>
              <div class="row"><input class="grow" [class.campo-alerta]="codigoPendiente()" [(ngModel)]="f.codigo_barras" name="cb" [placeholder]="codigoPendiente() ? 'Escanea o escribe el código del producto' : 'Escanéalo o toma la foto de la etiqueta'" inputmode="numeric"
                  (keydown.enter)="$event.preventDefault(); buscarCodigo()" (blur)="buscarCodigo()" aria-label="Código de barras">
                <button type="button" class="btn" [class.accent]="codigoPendiente()" (click)="escaneando.set(true)" aria-label="Escanear código de barras con la cámara">📷{{ codigoPendiente() ? ' Escanear' : '' }}</button></div>
              @if (buscando()) { <p class="small muted" role="status">🔎 Buscando el código en bases públicas…</p> }
              @if (aviso(); as a) { <div class="alert small" [class.info]="a.tipo === 'ok'" [class.warn]="a.tipo !== 'ok'" role="status">{{ a.texto }}</div> }
            </div>
        }
        <div class="field"><label>Nombre *</label><input [(ngModel)]="f.nombre" name="nombre" required placeholder="Ej. Mobil Super 20W-50 (1 gal)"></div>
        <div class="grid g2">
          <div class="field"><label>Marca</label><input [(ngModel)]="f.marca" name="marca" placeholder="Mobil, Chevron, Vistony…"></div>
          <div class="field"><label>Categoría</label>
            <select [(ngModel)]="f.categoria" name="cat">@for (c of categorias; track c) { <option>{{ c }}</option> }</select></div>
        </div>
        @if (!f.es_servicio) {
          <div class="grid g3">
            <div class="field"><label>Unidad</label>
              <select [(ngModel)]="f.unidad" name="u">@for (u of unidades; track u) { <option [value]="u">{{ nombreUnidad(u) }}</option> }</select></div>
            @if (!producto()) {
              <div class="field"><label>Stock inicial</label><input type="number" step="any" min="0" [(ngModel)]="f.stock" name="stock"></div>
            }
            <div class="field"><label>Stock mínimo</label><input type="number" step="any" min="0" [(ngModel)]="f.stock_minimo" name="min"></div>
          </div>
        }
        <div class="grid g2">
          @if (!f.es_servicio) {
            <div class="field"><label>Costo (S/)</label><input type="number" step="0.01" min="0" [(ngModel)]="f.precio_compra" name="pc"></div>
          }
          <div class="field"><label>Precio de venta (S/)</label><input type="number" step="0.01" min="0" [(ngModel)]="f.precio_venta" name="pv"></div>
        </div>
        @if (!f.es_servicio) {
          <div class="field"><label>Ubicación</label><input [(ngModel)]="f.ubicacion" name="ub" placeholder="Estante A1, cilindro 2…"></div>
        }
        @if (producto()) {
          <label class="check field"><input type="checkbox" [(ngModel)]="f.activo" name="act"> Activo (desmarca para ocultarlo sin borrar su historial)</label>
          <p class="muted small">El stock no se edita aquí: usa Compras para entradas o Conteo para corregir diferencias. Así todo queda en el kardex.</p>
        }
        <div class="modal-foot">
          <button type="button" class="btn" (click)="cerrar.emit()">Cancelar</button>
          <button class="btn primary" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
        </div>
      </form>
    </div>
    @if (escaneando()) {
      <app-scanner (leido)="f.codigo_barras = $event; escaneando.set(false); buscarCodigo()" (cerrar)="escaneando.set(false)" />
    }`,
})
export class ProductoForm implements OnInit {
  private store = inject(Store);
  private ui = inject(Ui);
  readonly producto = input<Producto | null>(null);
  readonly codigoInicial = input<string>('');
  readonly guardado = output<number>();
  readonly cerrar = output<void>();
  readonly guardando = signal(false);
  readonly escaneando = signal(false);
  readonly buscando = signal(false);
  readonly aviso = signal<{ tipo: 'ok' | 'warn'; texto: string } | null>(null);
  private ultimoBuscado = '';
  readonly analizando = signal(false);
  /** true cuando la foto no trajo un código válido: se resalta el campo y el botón Escanear */
  readonly codigoPendiente = signal(false);
  private datosDeIA = false;
  categorias = CATEGORIAS; unidades = UNIDADES;
  f: Partial<Producto> & { stock?: number } = {};

  nombreUnidad(u: string) {
    return ({ UND: 'Unidad', GAL: 'Galón', L: 'Litro (granel)', QT: 'Cuarto (QT)', KG: 'Kilo', JGO: 'Juego' } as Record<string, string>)[u] || u;
  }

  ngOnInit() {
    const p = this.producto();
    this.f = p ? { ...p } : { categoria: 'Aceite de motor', unidad: 'UND', es_servicio: false, stock: 0, stock_minimo: 2, precio_compra: 0, precio_venta: 0, codigo_barras: this.codigoInicial() || null };
    if (!p && this.codigoInicial()) this.buscarCodigo();
  }

  /**
   * Al ingresar un código en un producto NUEVO: primero revisa si ya existe en el inventario;
   * si no, lo busca en bases públicas (vía el Worker) y completa nombre, marca, categoría y unidad.
   */
  async buscarCodigo() {
    const codigo = String(this.f.codigo_barras || '').trim();
    if (this.producto() || !/^\d{8,14}$/.test(codigo) || codigo === this.ultimoBuscado) return;
    this.ultimoBuscado = codigo;
    this.codigoPendiente.set(false);
    this.aviso.set(null);
    if (!codigoEsValido(codigo)) {
      // Doble validación: un dígito mal escrito no pasa el dígito verificador → se pide escanearlo
      this.codigoPendiente.set(true);
      this.ultimoBuscado = '';
      return this.aviso.set({ tipo: 'warn', texto: '⚠ Este número no es un código de barras válido (falla el dígito verificador). Revisa los dígitos o escanéalo con 📷 Escanear.' });
    }
    const existente = this.store.productos().find((x) => x.codigo_barras === codigo);
    if (existente) return this.aviso.set({ tipo: 'warn', texto: `Este código ya está registrado como “${existente.nombre}”. Para sumar stock usa Compras.` });
    this.buscando.set(true);
    try {
      const r = await fetch(`/api/codigo/${codigo}`);
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { encontrado: boolean; nombre?: string; marca?: string | null; cantidad?: string | null; categorias?: string; fuente?: string; pais?: string | null };
      if (d.encontrado && d.nombre) {
        const nombre = d.cantidad && !d.nombre.toLowerCase().includes(String(d.cantidad).toLowerCase()) ? `${d.nombre} (${d.cantidad})` : d.nombre;
        if (!this.f.nombre?.trim()) this.f.nombre = nombre;
        if (!this.f.marca?.trim() && d.marca) this.f.marca = d.marca;
        const texto = `${nombre} ${d.categorias || ''}`;
        if (!this.datosDeIA) {
          this.f.categoria = adivinarCategoria(texto) || this.f.categoria;
          this.f.unidad = adivinarUnidad(`${d.cantidad || ''} ${nombre}`) || this.f.unidad;
        }
        this.aviso.set({ tipo: 'ok', texto: `✓ Datos encontrados en ${d.fuente}. Revisa nombre, categoría y unidad, y completa precios y stock.` });
      } else {
        this.aviso.set(this.datosDeIA
          ? { tipo: 'ok', texto: `✓ Código ${codigo} verificado y libre. Revisa los datos y completa precios y stock.` }
          : { tipo: 'warn', texto: `No está en las bases públicas${d.pais ? ` (código registrado en ${d.pais})` : ''}. Complétalo una vez a mano: desde ahora el sistema lo reconocerá al escanearlo.` });
      }
    } catch {
      this.aviso.set({ tipo: 'warn', texto: 'No se pudo consultar el código (sin conexión o no disponible). Completa los datos a mano.' });
    } finally { this.buscando.set(false); }
  }

  /** Foto de la etiqueta → IA (Workers AI) → completa el formulario. Doble validación del código de barras. */
  async foto(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    const token = await this.store.token();
    if (!token) return this.aviso.set({ tipo: 'warn', texto: 'El reconocimiento por foto funciona en modo nube (con tu cuenta). En modo local registra los datos a mano.' });
    this.analizando.set(true);
    this.aviso.set(null);
    try {
      const imagen = await reducirImagen(archivo, 1024);
      const r = await fetch('/api/reconocer', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ imagen }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo analizar la foto');
      this.datosDeIA = true;
      if (d.nombre) this.f.nombre = d.nombre;
      if (d.marca) this.f.marca = d.marca;
      if (d.categoria && d.categoria !== 'Otros') this.f.categoria = d.categoria;
      if (d.unidad) this.f.unidad = d.unidad;
      const extra = [d.norma].filter(Boolean).join(' · ');
      if (d.codigo_estado === 'valido') {
        this.f.codigo_barras = d.codigo_barras;
        this.aviso.set({ tipo: 'ok', texto: `✓ Datos leídos de la foto${extra ? ` (${extra})` : ''}. Código ${d.codigo_barras} verificado.` });
        await this.buscarCodigo(); // valida que no exista ya en el inventario
      } else {
        this.f.codigo_barras = null;
        this.ultimoBuscado = '';
        this.codigoPendiente.set(true);
        this.aviso.set({ tipo: 'warn', texto: d.codigo_estado === 'invalido'
          ? `✓ Datos leídos de la foto${extra ? ` (${extra})` : ''}. ⚠ El código de barras no se leyó bien: escanéalo con el botón 📷 Escanear.`
          : `✓ Datos leídos de la foto${extra ? ` (${extra})` : ''}. ⚠ No se ve el código de barras: escanéalo con el botón 📷 Escanear o escríbelo.` });
      }
    } catch (e) {
      this.aviso.set({ tipo: 'warn', texto: (e as Error).message || 'No se pudo analizar la foto' });
    } finally { this.analizando.set(false); }
  }

  async guardar() {
    if (!this.f.nombre?.trim()) return this.ui.error('El nombre es obligatorio');
    if (this.codigoPendiente() && !this.f.codigo_barras && !this.ui.confirmar('El producto no tiene código de barras. Sin código no podrás escanearlo en ventas ni en conteos. ¿Guardar igual?')) return;
    if (this.f.es_servicio) this.f.categoria = this.f.categoria === 'Aceite de motor' ? 'Servicio' : this.f.categoria;
    this.guardando.set(true);
    try {
      const p = this.producto();
      let id: number;
      if (p) { await this.store.repo.actualizarProducto(p.id, this.f); id = p.id; }
      else id = await this.store.repo.crearProducto(this.f);
      await this.store.cargarProductos();
      this.ui.ok('Producto guardado');
      this.guardado.emit(id);
    } catch (e) { this.ui.error(e); } finally { this.guardando.set(false); }
  }
}

/** Deduce la categoría a partir del nombre/categorías (español o inglés) */
export function adivinarCategoria(t: string): string | null {
  const x = t.toLowerCase();
  if (/filtro de aire|air filter|filtro aire/.test(x)) return 'Filtro de aire';
  if (/filtro de aceite|oil filter|filtro aceite/.test(x)) return 'Filtro de aceite';
  if (/combustible|fuel filter|gasolina|petr[oó]leo|diesel filter/.test(x)) return 'Filtro de combustible';
  if (/cabina|cabin/.test(x)) return 'Filtro de cabina';
  if (/refrigerante|coolant|anticongelante|antifreeze/.test(x)) return 'Refrigerante';
  if (/freno|brake|dot ?[345]/.test(x)) return 'Líquido de frenos';
  if (/grasa|grease/.test(x)) return 'Grasa';
  if (/aditivo|additive|limpia ?inyector|injector|tratamiento/.test(x)) return 'Aditivo';
  if (/transmisi|caja|gear|atf|transmission|80w|85w|75w/.test(x)) return 'Aceite de caja / transmisión';
  if (/aceite|motor oil|oil|lubricante|\b\d{1,2}w-?\d{2}\b/.test(x)) return 'Aceite de motor';
  return null;
}

/** Deduce la unidad de venta a partir de la presentación */
export function adivinarUnidad(t: string): string | null {
  const x = t.toLowerCase();
  if (/gal[oó]n|gallon|\bgal\b|3[.,]78 ?l|3[.,]785/.test(x)) return 'GAL';
  if (/\bqt\b|quart|946 ?ml|0[.,]946/.test(x)) return 'QT';
  if (/\bkg\b|kilo/.test(x)) return 'KG';
  return 'UND';
}

/** Valida EAN-8, UPC-A, EAN-13 y GTIN-14 por su dígito verificador */
export function codigoEsValido(c: string): boolean {
  if (!/^\d+$/.test(c) || ![8, 12, 13, 14].includes(c.length)) return false;
  const d = c.split('').map(Number);
  const control = d.pop()!;
  const suma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10 === control;
}

/** Reduce la foto en el celular (máx. lado en px, JPEG) para enviar menos datos y gastar menos IA */
export async function reducirImagen(archivo: File, max: number): Promise<string> {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

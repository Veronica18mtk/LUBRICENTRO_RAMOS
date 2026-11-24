import { Component, ElementRef, OnDestroy, AfterViewInit, output, signal, viewChild } from '@angular/core';

/** Lector de código de barras con la cámara del celular */
@Component({
  selector: 'app-scanner',
  template: `
    <div class="modal-bg" (click)="cerrar.emit()">
      <div class="modal scanner" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <h2>Escanear código</h2>
          <button class="icon-btn" (click)="cerrar.emit()" aria-label="Cerrar">✕</button>
        </div>
        <video #video playsinline muted></video>
        <p class="muted small">{{ estado() }}</p>
        <div class="row">
          <input class="grow" #manual placeholder="O escribe el código y presiona Enter" inputmode="numeric"
                 (keydown.enter)="manual.value.trim() && leido.emit(manual.value.trim())">
        </div>
      </div>
    </div>`,
})
export class Scanner implements AfterViewInit, OnDestroy {
  readonly leido = output<string>();
  readonly cerrar = output<void>();
  readonly estado = signal('Iniciando cámara…');
  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private detener: (() => void) | null = null;
  private terminado = false;

  async ngAfterViewInit() {
    const v = this.video().nativeElement;
    try {
      // 1) API nativa del navegador (Chrome Android): rápida y sin librerías
      const BD = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (BD) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        v.srcObject = stream;
        await v.play();
        this.detener = () => stream.getTracks().forEach((t) => t.stop());
        const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
        this.estado.set('Apunta al código de barras del producto');
        const ciclo = async () => {
          if (this.terminado) return;
          try {
            const r = await det.detect(v);
            if (r.length) return this.listo(r[0].rawValue);
          } catch { /* cuadro no listo */ }
          setTimeout(ciclo, 150);
        };
        ciclo();
        return;
      }
      // 2) Respaldo: ZXing (iPhone y otros navegadores)
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const lector = new BrowserMultiFormatReader();
      this.estado.set('Apunta al código de barras del producto');
      const controles = await lector.decodeFromConstraints({ video: { facingMode: 'environment' } }, v, (res) => {
        if (res) this.listo(res.getText());
      });
      this.detener = () => controles.stop();
    } catch (e) {
      this.estado.set('No se pudo abrir la cámara: ' + ((e as Error).message || e) + '. Escribe el código manualmente.');
    }
  }

  private listo(codigo: string) {
    if (this.terminado) return;
    this.terminado = true;
    navigator.vibrate?.(80);
    this.leido.emit(codigo);
  }

  ngOnDestroy() { this.terminado = true; this.detener?.(); }
}

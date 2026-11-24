import { Component, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/** Aviso de nueva versión de la app (service worker) */
@Component({
  selector: 'app-actualizacion',
  template: `
    @if (hay()) {
      <div class="alert info no-print" style="position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:150;box-shadow:var(--shadow);display:flex;gap:10px;align-items:center">
        Hay una nueva versión de la app
        <button class="btn small primary" (click)="recargar()">Actualizar</button>
      </div>
    }`,
})
export class ActualizacionApp {
  readonly hay = signal(false);
  private sw = inject(SwUpdate);
  constructor() {
    if (this.sw.isEnabled) {
      this.sw.versionUpdates.subscribe((e) => { if (e.type === 'VERSION_READY') this.hay.set(true); });
      setInterval(() => this.sw.checkForUpdate().catch(() => {}), 30 * 60e3);
    }
  }
  recargar() { document.location.reload(); }
}

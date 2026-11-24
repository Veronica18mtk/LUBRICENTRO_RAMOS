import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Store } from '../core/store';
import { Ui } from '../core/ui';

@Component({
  selector: 'app-cuenta',
  imports: [FormsModule],
  template: `
    <div class="page-head"><div><h1>Mi cuenta</h1><div class="muted small">{{ store.usuario()?.nombre }} · {{ store.usuario()?.email || '' }}</div></div></div>

    @if (store.modo() === 'nube') {
      <form class="card" (ngSubmit)="cambiar()" style="max-width:420px">
        <h2>Cambiar contraseña</h2>
        <div class="field"><label>Nueva contraseña</label><input type="password" [(ngModel)]="nueva" name="n" minlength="6" autocomplete="new-password" required></div>
        <button class="btn primary">Guardar</button>
      </form>
    } @else {
      <div class="card">
        <h2>Modo local</h2>
        <p class="muted">Los datos viven solo en este navegador. Descarga una copia de seguridad con frecuencia.</p>
        <div class="row">
          <button class="btn" (click)="respaldo()">⬇ Descargar respaldo (.json)</button>
          @if (store.nubeDisponible) { <button class="btn" (click)="irANube()">Pasar a la nube</button> }
          <button class="btn danger" (click)="borrar()">Borrar todos los datos</button>
        </div>
      </div>
    }
    <div class="card">
      <h2>Instalar en el celular</h2>
      <p class="muted small">Android (Chrome): menú ⋮ → “Instalar aplicación”. iPhone (Safari): compartir → “Agregar a pantalla de inicio”. Funciona sin internet para consultar stock y registrar ventas.</p>
    </div>
    <button class="btn" (click)="salir()">Cerrar sesión</button>`,
})
export class Cuenta {
  readonly store = inject(Store);
  private ui = inject(Ui);
  private router = inject(Router);
  nueva = '';

  async cambiar() {
    if (this.nueva.length < 6) return this.ui.error('Mínimo 6 caracteres');
    try { await this.store.repo.cambiarPassword(this.nueva); this.nueva = ''; this.ui.ok('Contraseña actualizada'); } catch (e) { this.ui.error(e); }
  }
  async respaldo() {
    const datos = await this.store.local!.exportar();
    const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `lubricentro_respaldo_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async borrar() {
    if (this.ui.pedir('Escribe BORRAR para eliminar todos los datos locales') !== 'BORRAR') return;
    await this.store.local!.borrarTodo(); await this.store.cargarProductos(); this.ui.ok('Datos borrados');
  }
  async irANube() { await this.store.salir(); this.store.elegirModo('nube'); this.router.navigateByUrl('/ingresar'); }
  async salir() { await this.store.salir(); this.router.navigateByUrl('/ingresar'); }
}

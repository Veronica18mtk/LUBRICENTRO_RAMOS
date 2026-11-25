import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { textoError } from '../core/util';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="login">
      <div class="card">
        <div class="brand"><svg width="40" height="40" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#0f2a44"/><path d="M32 12c-7 10-14 18-14 26a14 14 0 0 0 28 0c0-8-7-16-14-26z" fill="#f5a524"/></svg><div>{{ store.negocio.nombre }}<small>Inventario y servicios</small></div></div>

        @if (pendiente()) {
          <div class="alert warn">Tu cuenta <b>{{ pendiente() }}</b> está pendiente de activación. Pide al administrador que la active en <b>Usuarios</b>.</div>
          <button class="btn block" (click)="salir()">Volver</button>
        } @else if (store.nubeDisponible) {
          <form (ngSubmit)="enviar()">
            @if (vista() === 'registro') {
              <div class="field"><label>Tu nombre</label><input [(ngModel)]="nombre" name="nombre" required autocomplete="name"></div>
            }
            <div class="field"><label>Correo</label><input type="email" [(ngModel)]="email" name="email" required autocomplete="email"></div>
            @if (vista() !== 'recuperar') {
              <div class="field"><label>Contraseña</label><input type="password" [(ngModel)]="password" name="password" required minlength="6"
                [autocomplete]="vista() === 'registro' ? 'new-password' : 'current-password'"></div>
            }
            @if (error()) { <div class="alert warn">{{ error() }}</div> }
            @if (mensaje()) { <div class="alert info">{{ mensaje() }}</div> }
            <button class="btn primary block" [disabled]="cargando()">
              {{ cargando() ? 'Espera…' : vista() === 'ingresar' ? 'Ingresar' : vista() === 'registro' ? 'Crear cuenta' : 'Enviar enlace' }}
            </button>
          </form>
          <div class="row" style="justify-content:space-between;margin-top:12px">
            @if (vista() === 'ingresar') {
              <a href="" (click)="$event.preventDefault(); cambiar('registro')">Crear cuenta</a>
              <a href="" (click)="$event.preventDefault(); cambiar('recuperar')">¿Olvidaste tu contraseña?</a>
            } @else {
              <a href="" (click)="$event.preventDefault(); cambiar('ingresar')">← Ya tengo cuenta</a>
            }
          </div>
          <hr style="border:0;border-top:1px solid var(--border);margin:16px 0">
        } @else {
          <p class="muted small">La nube (Supabase) aún no está configurada. Puedes usar la app en este equipo con el modo local.</p>
        }
        @if (!pendiente()) {
          <button class="btn block" (click)="local()">Usar en modo local (sin cuenta)</button>
          <p class="muted small" style="margin-top:8px">Modo local: los datos se guardan solo en este navegador. Ideal para probar.</p>
        }
      </div>
    </div>`,
})
export class Login {
  readonly store = inject(Store);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly vista = signal<'ingresar' | 'registro' | 'recuperar'>('ingresar');
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly mensaje = signal('');
  readonly pendiente = signal('');
  nombre = ''; email = ''; password = '';

  constructor() {
    const u = this.store.usuario();
    if (u && !u.activo) this.pendiente.set(u.email || u.nombre);
  }

  cambiar(v: 'ingresar' | 'registro' | 'recuperar') { this.vista.set(v); this.error.set(''); this.mensaje.set(''); }

  async enviar() {
    this.error.set(''); this.mensaje.set('');
    this.store.elegirModo('nube');
    this.cargando.set(true);
    try {
      if (this.vista() === 'recuperar') {
        await this.store.repo.recuperar(this.email.trim());
        this.mensaje.set('Te enviamos un enlace para cambiar tu contraseña.');
      } else if (this.vista() === 'registro') {
        if (!this.nombre.trim()) throw new Error('Escribe tu nombre');
        const r = await this.store.repo.registrarse(this.nombre.trim(), this.email.trim(), this.password);
        if (r.requiereConfirmacion) { this.mensaje.set('Revisa tu correo para confirmar la cuenta y luego ingresa.'); this.vista.set('ingresar'); }
        else await this.ingresar();
      } else await this.ingresar();
    } catch (e) { this.error.set(textoError(e)); } finally { this.cargando.set(false); }
  }

  private async ingresar() {
    const u = await this.store.repo.ingresar(this.email.trim(), this.password);
    await this.store.entrar(u);
    if (!u.activo) { this.pendiente.set(u.email || u.nombre); return; }
    this.router.navigateByUrl('/');
  }

  async local() {
    this.store.elegirModo('local');
    const u = await this.store.repo.ingresar('', '');
    await this.store.entrar(u);
    this.ui.ok('Modo local activado');
    this.router.navigateByUrl('/');
  }

  async salir() { await this.store.salir(); this.pendiente.set(''); }
}

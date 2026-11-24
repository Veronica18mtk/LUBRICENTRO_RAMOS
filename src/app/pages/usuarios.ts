import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Rol, Usuario } from '../core/models';
import { Store } from '../core/store';
import { Ui } from '../core/ui';

@Component({
  selector: 'app-usuarios',
  imports: [FormsModule],
  template: `
    <div class="page-head"><div><h1>Usuarios</h1><div class="muted small">Quién puede usar el sistema y qué puede hacer</div></div>
      @if (store.modo() === 'nube') { <button class="btn primary" (click)="nuevo.set(true)">➕ Crear usuario</button> }</div>

    @if (store.modo() === 'local') {
      <div class="alert info">En modo local hay un solo usuario. Para trabajar en equipo (3–20 personas) configura Supabase y usa el modo nube.</div>
    } @else {
      <div class="alert info small">Cada trabajador puede crear su cuenta en la pantalla de ingreso (“Crear cuenta”); aparecerá aquí como <b>pendiente</b> hasta que la actives.</div>
    }

    <div class="card">
      @for (u of lista(); track u.id) {
        <div class="list-item">
          <span><b>{{ u.nombre }}</b> @if (!u.activo) { <span class="badge warn">pendiente / inactivo</span> }<br><span class="muted small">{{ u.email }}</span></span>
          @if (store.modo() === 'nube' && u.id !== store.usuario()?.id) {
            <span class="row">
              <select [ngModel]="u.rol" (ngModelChange)="cambiar(u, { rol: $event })" style="width:auto" [attr.aria-label]="'Rol de ' + u.nombre">
                <option value="admin">Administrador</option><option value="vendedor">Vendedor</option><option value="mecanico">Mecánico</option>
              </select>
              <button class="btn small" [class.primary]="!u.activo" (click)="cambiar(u, { activo: !u.activo })">{{ u.activo ? 'Desactivar' : 'Activar' }}</button>
            </span>
          } @else { <span class="badge">{{ nombresRol[u.rol] }}</span> }
        </div>
      }
    </div>

    <div class="card small">
      <h2>¿Qué puede hacer cada rol?</h2>
      <p><b>Administrador:</b> todo. Anula ventas y compras, hace conteos/ajustes de stock, gestiona usuarios.</p>
      <p><b>Vendedor:</b> órdenes, compras, productos y reportes. No anula ni ajusta stock.</p>
      <p><b>Mecánico:</b> registra órdenes con precio de lista (sin descuentos), consulta stock e historial. No ve costos ni reportes.</p>
    </div>

    @if (nuevo()) {
      <div class="modal-bg" (click)="nuevo.set(false)">
        <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="crear()">
          <div class="modal-head"><h2>Crear usuario</h2><button type="button" class="icon-btn" (click)="nuevo.set(false)" aria-label="Cerrar">✕</button></div>
          <div class="field"><label>Nombre</label><input [(ngModel)]="f.nombre" name="n" required></div>
          <div class="field"><label>Correo</label><input type="email" [(ngModel)]="f.email" name="e" required></div>
          <div class="field"><label>Contraseña temporal</label><input [(ngModel)]="f.password" name="p" required minlength="6"></div>
          <div class="field"><label>Rol</label><select [(ngModel)]="f.rol" name="r"><option value="mecanico">Mecánico</option><option value="vendedor">Vendedor</option><option value="admin">Administrador</option></select></div>
          <p class="muted small">Requiere el Worker de Cloudflare con la clave de servicio configurada. Si no, pide al trabajador que cree su cuenta y actívala aquí.</p>
          <div class="modal-foot"><button type="button" class="btn" (click)="nuevo.set(false)">Cancelar</button><button class="btn primary">Crear</button></div>
        </form>
      </div>
    }`,
})
export class Usuarios implements OnInit {
  readonly store = inject(Store);
  private ui = inject(Ui);
  readonly lista = signal<Usuario[]>([]);
  readonly nuevo = signal(false);
  nombresRol: Record<Rol, string> = { admin: 'Administrador', vendedor: 'Vendedor', mecanico: 'Mecánico' };
  f = { nombre: '', email: '', password: '', rol: 'mecanico' };

  ngOnInit() { this.cargar(); }
  async cargar() { try { this.lista.set(await this.store.repo.usuarios()); } catch (e) { this.ui.error(e); } }
  async cambiar(u: Usuario, c: Partial<Usuario>) {
    try { await this.store.repo.actualizarUsuario(u.id, c); this.ui.ok('Usuario actualizado'); } catch (e) { this.ui.error(e); }
    this.cargar();
  }
  async crear() {
    try {
      await this.store.repo.crearUsuario!(this.f);
      this.ui.ok('Usuario creado'); this.nuevo.set(false); this.f = { nombre: '', email: '', password: '', rol: 'mecanico' }; this.cargar();
    } catch (e) { this.ui.error(e); }
  }
}

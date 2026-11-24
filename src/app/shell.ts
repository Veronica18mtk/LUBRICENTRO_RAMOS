import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Store } from './core/store';

interface Enlace { ruta: string; texto: string; ico: string; roles?: string[] }

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgTemplateOutlet],
  template: `
    <div class="layout">
      <ng-template #nav>
        <div class="brand"><img src="icons/icono.svg" alt=""><div>{{ store.negocio.nombre }}<small>Inventario y servicios</small></div></div>
        <nav class="nav">
          @for (e of enlaces(); track e.ruta) {
            <a [routerLink]="e.ruta" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: e.ruta === '/' }" (click)="menu.set(false)">
              <span class="ico">{{ e.ico }}</span>{{ e.texto }}
              @if (e.ruta === '/productos' && store.stockBajo()) { <span class="badge warn" style="margin-left:auto">{{ store.stockBajo() }}</span> }
            </a>
          }
        </nav>
        <div class="user">
          <b>{{ store.usuario()?.nombre }}</b>{{ rolTexto() }} · {{ store.modo() === 'local' ? 'Modo local' : 'Nube' }}
        </div>
      </ng-template>

      <aside class="sidebar"><ng-container *ngTemplateOutlet="nav" /></aside>
      <header class="topbar no-print">
        <button (click)="menu.set(true)" aria-label="Menú">☰</button>
        <div class="brand"><img src="icons/icono.svg" alt="">{{ store.negocio.nombre }}</div>
        <span style="width:40px"></span>
      </header>
      @if (menu()) {
        <div class="drawer" (click)="menu.set(false)"><aside class="sidebar" (click)="$event.stopPropagation()"><ng-container *ngTemplateOutlet="nav" /></aside></div>
      }

      <main class="main">
        @if (!store.enLinea() && store.modo() === 'nube') {
          <div class="alert warn no-print">Sin conexión. Puedes registrar ventas: se enviarán solas al volver internet.</div>
        }
        @if (store.pendientes().length) {
          <div class="alert info no-print">
            {{ store.pendientes().length }} venta(s) esperando conexión.
            @for (p of conError(); track p.creada) {
              <div class="row" style="margin-top:6px"><span class="grow">⚠️ {{ p.error }}</span>
                <button class="btn small danger" (click)="store.descartarPendiente(p)">Descartar</button></div>
            }
          </div>
        }
        <router-outlet />
      </main>

      <nav class="bottomnav no-print">
        @for (e of inferior(); track e.ruta) {
          <a [routerLink]="e.ruta" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: e.ruta === '/' }"><span class="ico">{{ e.ico }}</span>{{ e.texto }}</a>
        }
      </nav>
    </div>`,
  styles: [`:host { display: block; }`],
})
export class Shell {
  readonly store = inject(Store);
  readonly router = inject(Router);
  readonly menu = signal(false);
  readonly conError = computed(() => this.store.pendientes().filter((p) => p.error));

  private todos: Enlace[] = [
    { ruta: '/', texto: 'Inicio', ico: '🏠' },
    { ruta: '/venta', texto: 'Nueva orden', ico: '➕' },
    { ruta: '/ventas', texto: 'Ventas', ico: '🧾' },
    { ruta: '/productos', texto: 'Inventario', ico: '🛢️' },
    { ruta: '/compras', texto: 'Compras', ico: '📦', roles: ['admin', 'vendedor'] },
    { ruta: '/conteo', texto: 'Conteo físico', ico: '✅', roles: ['admin'] },
    { ruta: '/vehiculos', texto: 'Vehículos y clientes', ico: '🚗' },
    { ruta: '/reportes', texto: 'Reportes', ico: '📊', roles: ['admin', 'vendedor'] },
    { ruta: '/usuarios', texto: 'Usuarios', ico: '👥', roles: ['admin'] },
    { ruta: '/cuenta', texto: 'Mi cuenta', ico: '⚙️' },
  ];
  readonly enlaces = computed(() => this.todos.filter((e) => !e.roles || e.roles.includes(this.store.rol()!)));
  readonly inferior = computed(() => {
    const quiero = ['/', '/venta', '/productos', '/ventas', '/vehiculos'];
    return this.enlaces().filter((e) => quiero.includes(e.ruta)).map((e) => ({ ...e, texto: e.texto.split(' ')[0] }));
  });
  readonly rolTexto = computed(() => ({ admin: 'Administrador', vendedor: 'Vendedor', mecanico: 'Mecánico' })[this.store.rol() || 'mecanico']);
}

import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { Rol } from './core/models';
import { Store } from './core/store';
import { Shell } from './shell';

let iniciado = false;
const sesion: CanActivateFn = async () => {
  const store = inject(Store);
  const router = inject(Router);
  if (!iniciado) { iniciado = true; await store.iniciar(); }
  const u = store.usuario();
  return u && u.activo ? true : router.parseUrl('/ingresar');
};
const roles = (...r: Rol[]): CanActivateFn => () => {
  const store = inject(Store);
  return r.includes(store.rol()!) || inject(Router).parseUrl('/');
};

export const routes: Routes = [
  { path: 'ingresar', loadComponent: () => import('./pages/login').then((m) => m.Login) },
  { path: 'ticket/:id', canActivate: [sesion], loadComponent: () => import('./pages/ticket').then((m) => m.Ticket) },
  {
    path: '', component: Shell, canActivate: [sesion],
    children: [
      { path: '', loadComponent: () => import('./pages/inicio').then((m) => m.Inicio), title: 'Inicio' },
      { path: 'venta', loadComponent: () => import('./pages/venta-nueva').then((m) => m.VentaNueva), title: 'Nueva orden' },
      { path: 'ventas', loadComponent: () => import('./pages/ventas').then((m) => m.Ventas), title: 'Ventas' },
      { path: 'productos', loadComponent: () => import('./pages/productos').then((m) => m.Productos), title: 'Inventario' },
      { path: 'compras', canActivate: [roles('admin', 'vendedor')], loadComponent: () => import('./pages/compras').then((m) => m.Compras), title: 'Compras' },
      { path: 'conteo', canActivate: [roles('admin')], loadComponent: () => import('./pages/conteo').then((m) => m.Conteo), title: 'Conteo' },
      { path: 'vehiculos', loadComponent: () => import('./pages/vehiculos').then((m) => m.Vehiculos), title: 'Vehículos' },
      { path: 'reportes', canActivate: [roles('admin', 'vendedor')], loadComponent: () => import('./pages/reportes').then((m) => m.Reportes), title: 'Reportes' },
      { path: 'usuarios', canActivate: [roles('admin')], loadComponent: () => import('./pages/usuarios').then((m) => m.Usuarios), title: 'Usuarios' },
      { path: 'cuenta', loadComponent: () => import('./pages/cuenta').then((m) => m.Cuenta), title: 'Mi cuenta' },
    ],
  },
  { path: '**', redirectTo: '' },
];

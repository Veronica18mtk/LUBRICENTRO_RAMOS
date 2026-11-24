import { Injectable, signal } from '@angular/core';
import { textoError } from './util';

export interface Aviso { id: number; texto: string; error: boolean }

/** Avisos breves (toasts) y confirmaciones */
@Injectable({ providedIn: 'root' })
export class Ui {
  readonly avisos = signal<Aviso[]>([]);
  private n = 0;

  ok(texto: string) { this.mostrar(texto, false); }
  error(e: unknown) { this.mostrar(textoError(e), true); }

  private mostrar(texto: string, error: boolean) {
    const id = ++this.n;
    this.avisos.update((a) => [...a, { id, texto, error }]);
    setTimeout(() => this.avisos.update((a) => a.filter((x) => x.id !== id)), error ? 6000 : 3000);
  }

  confirmar(texto: string) { return window.confirm(texto); }
  pedir(texto: string, valor = '') { return window.prompt(texto, valor); }
}

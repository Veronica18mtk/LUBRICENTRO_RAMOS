import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Ui } from './core/ui';
import { ActualizacionApp } from './shared/actualizacion';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ActualizacionApp],
  template: `
    <router-outlet />
    <app-actualizacion />
    <div id="toast" aria-live="polite">
      @for (a of ui.avisos(); track a.id) { <div [class.err]="a.error">{{ a.texto }}</div> }
    </div>`,
})
export class App {
  readonly ui = inject(Ui);
}

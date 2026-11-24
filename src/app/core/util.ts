// Utilidades compartidas (formato Perú)
const TZ = 'America/Lima';

export const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const r3 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

export function soles(n: number | null | undefined): string {
  return 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function cant(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 3 });
}

/** Fecha de hoy en Perú, formato YYYY-MM-DD */
export function hoy(offsetDias = 0): string {
  return new Date(Date.now() - 5 * 3600e3 + offsetDias * 86400e3).toISOString().slice(0, 10);
}

export function sumarMeses(fecha: string, meses: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

/** Fecha/hora de un ISO en hora de Perú */
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-PE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fecha(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
  return new Date(iso).toLocaleDateString('es-PE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}
/** Día (YYYY-MM-DD) en hora de Perú de un ISO */
export function diaLima(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().slice(0, 10);
}

export function normPlaca(p: string | null | undefined): string {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
/** ABC123 -> ABC-123 (formato de placa peruana) */
export function verPlaca(p: string | null | undefined): string {
  const n = normPlaca(p);
  return n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
}

export function numeroOS(id: number): string { return 'OS-' + String(id).padStart(6, '0'); }
export function numeroCO(id: number): string { return 'CO-' + String(id).padStart(6, '0'); }

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));
}

/** Enlace de WhatsApp para números peruanos */
export function whatsapp(tel: string | null | undefined, texto: string): string | null {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 9) d = '51' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

export function textoError(e: unknown): string {
  const m = (e as { message?: string })?.message || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión con el servidor';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos';
  if (/Email not confirmed/i.test(m)) return 'Confirma tu correo antes de ingresar (revisa tu bandeja)';
  if (/User already registered/i.test(m)) return 'Ese correo ya está registrado';
  if (/duplicate key.*codigo_barras/i.test(m)) return 'Ya existe otro producto con ese código de barras';
  if (/duplicate key.*doc_numero/i.test(m)) return 'Ya existe un cliente con ese documento';
  return m;
}

export function esErrorDeRed(e: unknown): boolean {
  const m = (e as { message?: string })?.message || String(e);
  return /Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test(m);
}

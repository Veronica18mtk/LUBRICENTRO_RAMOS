import {
  Cliente, CompraResumen, Dashboard, HistorialServicio, Movimiento, NuevaCompra, NuevaVenta, Producto,
  Recordatorio, Reporte, ResultadoConteo, Usuario, Vehiculo, VentaDetalle, VentaResumen,
} from './models';

/**
 * Repositorio único: la app solo habla con esta interfaz.
 * Hay dos implementaciones: LocalRepo (IndexedDB, sin cuenta) y SupabaseRepo (nube).
 */
export interface Repo {
  // Sesión
  sesion(): Promise<Usuario | null>;
  ingresar(email: string, password: string): Promise<Usuario>;
  registrarse(nombre: string, email: string, password: string): Promise<{ requiereConfirmacion: boolean }>;
  recuperar(email: string): Promise<void>;
  cambiarPassword(nueva: string): Promise<void>;
  salir(): Promise<void>;

  // Productos e inventario
  productos(): Promise<Producto[]>;
  crearProducto(p: Partial<Producto>): Promise<number>;
  actualizarProducto(id: number, p: Partial<Producto>): Promise<void>;
  kardex(productoId: number): Promise<Movimiento[]>;
  movimientos(desde: string, hasta: string): Promise<Movimiento[]>;
  aplicarConteo(nota: string, conteos: { producto_id: number; contado: number }[]): Promise<ResultadoConteo[]>;

  // Ventas / órdenes de servicio
  registrarVenta(v: NuevaVenta): Promise<number>;
  ventas(desde: string, hasta: string): Promise<VentaResumen[]>;
  venta(id: number): Promise<VentaDetalle>;
  anularVenta(id: number, motivo: string): Promise<void>;

  // Clientes y vehículos
  vehiculoPorPlaca(placa: string): Promise<(Vehiculo & { historial: HistorialServicio[] }) | null>;
  vehiculos(q: string): Promise<Vehiculo[]>;
  clientes(q: string): Promise<(Cliente & { placas: string })[]>;
  actualizarCliente(id: number, c: Partial<Cliente>): Promise<void>;

  // Compras
  proveedores(): Promise<{ id: number; nombre: string; ruc: string | null }[]>;
  registrarCompra(c: NuevaCompra): Promise<number>;
  compras(): Promise<CompraResumen[]>;
  compra(id: number): Promise<CompraResumen>;
  anularCompra(id: number): Promise<void>;

  // Tablero y reportes
  dashboard(): Promise<Dashboard>;
  recordatorios(dias: number): Promise<Recordatorio[]>;
  reporte(desde: string, hasta: string): Promise<Reporte>;

  // Usuarios
  usuarios(): Promise<Usuario[]>;
  personal(): Promise<{ id: string; nombre: string; rol: string }[]>;
  actualizarUsuario(id: string, u: Partial<Usuario>): Promise<void>;
  crearUsuario?(u: { nombre: string; email: string; password: string; rol: string }): Promise<void>;

  // Tiempo real: avisa cuando otro equipo cambia datos
  alCambiar(cb: (tabla: string) => void): () => void;
}

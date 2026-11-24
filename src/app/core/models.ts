export type Rol = 'admin' | 'vendedor' | 'mecanico';
export type Modo = 'local' | 'nube';

export interface Usuario {
  id: string;
  nombre: string;
  email?: string | null;
  rol: Rol;
  activo: boolean;
}

export interface Producto {
  id: number;
  codigo_barras: string | null;
  nombre: string;
  marca: string | null;
  categoria: string;
  unidad: string;
  es_servicio: boolean;
  precio_compra: number;
  precio_venta: number;
  stock: number;
  stock_minimo: number;
  ubicacion: string | null;
  activo: boolean;
}

export interface Cliente {
  id: number;
  doc_tipo: string;
  doc_numero: string | null;
  nombre: string;
  telefono: string | null;
}

export interface Vehiculo {
  id: number;
  placa: string;
  cliente_id: number | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  cliente?: Cliente | null;
  ultimo_servicio?: string | null;
}

export interface HistorialServicio {
  id: number;
  fecha: string;
  km_actual: number | null;
  km_proximo: number | null;
  total: number;
  estado: string;
  detalle: string;
}

export interface VentaResumen {
  id: number;
  fecha: string;
  total: number;
  metodo_pago: string;
  estado: 'pagada' | 'anulada';
  revisar: boolean;
  cliente: string | null;
  placa: string | null;
  usuario: string | null;
}

export interface VentaItem {
  producto_id: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  unidad?: string;
}

export interface VentaDetalle extends VentaResumen {
  subtotal: number;
  descuento: number;
  km_actual: number | null;
  km_proximo: number | null;
  fecha_proxima: string | null;
  observaciones: string | null;
  motivo_anulacion: string | null;
  mecanico: string | null;
  cliente_doc: string | null;
  cliente_doc_tipo: string | null;
  cliente_telefono: string | null;
  vehiculo: string | null;
  items: VentaItem[];
}

export interface NuevaVenta {
  client_uuid?: string;
  offline?: boolean;
  cliente?: Partial<Cliente> | null;
  vehiculo?: { placa?: string; marca?: string; modelo?: string; anio?: number | string } | null;
  km_actual?: number | string | null;
  km_proximo?: number | string | null;
  fecha_proxima?: string | null;
  metodo_pago: string;
  descuento?: number;
  observaciones?: string;
  mecanico_id?: string | null;
  items: { producto_id: number; cantidad: number; precio_unitario?: number }[];
}

export interface NuevaCompra {
  proveedor?: string;
  ruc?: string;
  comprobante?: string;
  fecha?: string;
  items: { producto_id: number; cantidad: number; costo_unitario: number; precio_venta?: number | null }[];
}

export interface CompraResumen {
  id: number;
  fecha: string;
  comprobante: string | null;
  proveedor: string | null;
  total: number;
  anulada: boolean;
  usuario: string | null;
  n_items: number;
  items?: { producto_id: number; nombre: string; unidad: string; cantidad: number; costo_unitario: number; subtotal: number }[];
}

export interface Movimiento {
  id: number;
  fecha: string;
  producto_id: number;
  producto?: string;
  unidad?: string;
  tipo: 'INICIAL' | 'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'ANULACION';
  cantidad: number;
  stock_resultante: number;
  referencia: string | null;
  nota: string | null;
  usuario: string | null;
}

export interface Dashboard {
  fecha: string;
  ventas_hoy: { n: number; total: number };
  por_metodo: { metodo_pago: string; total: number }[];
  stock_bajo: { id: number; nombre: string; marca: string | null; stock: number; stock_minimo: number; unidad: string }[];
  n_productos: number;
  por_revisar: number;
  valor_inventario: number | null;
}

export interface Recordatorio {
  venta_id: number;
  fecha: string;
  fecha_proxima: string;
  km_proximo: number | null;
  placa: string;
  marca: string | null;
  modelo: string | null;
  cliente: string | null;
  telefono: string | null;
}

export interface Reporte {
  resumen: { n: number; total: number; descuentos: number };
  costo: number;
  ganancia: number;
  por_dia: { dia: string; n: number; total: number }[];
  por_metodo: { metodo_pago: string; n: number; total: number }[];
  top_productos: { nombre: string; unidad: string; cantidad: number; total: number; ganancia: number }[];
  por_usuario: { nombre: string; n: number; total: number }[];
  compras: { n: number; total: number };
}

export interface ResultadoConteo {
  producto_id: number;
  nombre: string;
  antes: number;
  contado: number;
  diferencia: number;
}

export const CATEGORIAS = [
  'Aceite de motor', 'Aceite de caja / transmisión', 'Filtro de aceite', 'Filtro de aire',
  'Filtro de combustible', 'Filtro de cabina', 'Aditivo', 'Refrigerante', 'Líquido de frenos',
  'Grasa', 'Accesorios', 'Servicio', 'Otros',
];
export const UNIDADES = ['UND', 'GAL', 'L', 'QT', 'KG', 'JGO'];
export const METODOS_PAGO = ['Efectivo', 'Yape', 'Plin', 'Tarjeta', 'Transferencia', 'Crédito'];

// ═══════════════════════════════════════════════════════════════════════════
// Tipos de la app de VENTAS (modelo FEFO).
// La venta DESCUENTA stock real de los lotes de Stockly siguiendo FEFO
// (First Expired First Out) y escribe en `movimientos` para que Stockly lo vea.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tablas de Stockly compartidas ────────────────────────────────────────────
export interface Comercio {
  id: string;
  nombre: string;
  plan: string;          // trial | activo | suspendido
  trial_hasta: string;
  creado_en?: string;
}

export interface Sucursal {
  id: string;
  comercio_id: string;
  nombre: string;
  direccion?: string;
  activa: boolean;
}

export interface Miembro {
  id: string;
  user_id: string;
  comercio_id: string;
  rol: 'dueno' | 'empleado';
  nombre: string;
}

// Catálogo COMPARTIDO — la app de ventas lee precio/nombre/código.
export interface Producto {
  id: string;
  comercio_id: string;
  nombre: string;
  codigo_barras: string;
  categoria?: string;
  precio: number;
  activo: boolean;
}

// Stock físico real (de Stockly). La venta lo descuenta por FEFO.
export interface Lote {
  id: string;
  comercio_id: string;
  producto_id: string;
  sucursal_id: string;
  cantidad: number;
  fecha_vencimiento: string | null;   // ISO date
  dias_aviso?: number;
  fecha_ingreso?: string;
  proveedor?: string;
  numero_lote?: string;
  retirado: boolean;
}

// Audit log de stock (de Stockly). La venta inserta tipo='retiro_venta'.
export interface Movimiento {
  id?: string;
  comercio_id: string;
  lote_id: string;
  producto_id: string;
  sucursal_id: string;
  tipo: 'ingreso' | 'retiro_venta' | 'retiro_manual' | 'ajuste' | 'vencimiento';
  cantidad: number;
  cantidad_anterior: number;
  cantidad_nueva: number;
  usuario?: string | null;
  notas?: string;
  fecha?: string;
}

// ─── Tablas propias de ventas (ventas_*) ──────────────────────────────────────
export interface VentaItem {
  id?: string;
  comercio_id: string;
  venta_id: string;
  producto_id: string | null;
  lote_id: string | null;          // de qué lote salió (FEFO)
  nombre_producto: string;
  cantidad: number;
  precio_unit: number;
  subtotal: number;
}

export interface Venta {
  id?: string;
  comercio_id: string;
  sucursal_id: string;
  total: number;
  descuento: number;
  metodo_pago: 'efectivo' | 'tarjeta' | 'transferencia' | 'qr';
  cliente: string;
  fiado: boolean;
  usuario: string | null;
  notas?: string;
  fecha: number;
  items: VentaItem[];
}

export interface VentaDeuda {
  id?: string;
  comercio_id: string;
  venta_id?: string | null;
  cliente: string;
  monto: number;
  pagada: boolean;
  fecha: number;
}

// ─── Carrito (en memoria) ──────────────────────────────────────────────────────
export interface CartItem {
  productoId: string;
  nombre: string;
  codigoBarras: string;
  precio: number;
  qty: number;
  stockDisponible: number;   // suma de lotes; informativo (se permite vender de más)
}

// ─── Resultado de aplicar FEFO a un producto ──────────────────────────────────
export interface FefoDeduction {
  loteId: string;
  cantidadDescontada: number;
  cantidadAnterior: number;
  cantidadNueva: number;
  fechaVencimiento: string | null;
}

// ─── Outbox (offline-first) ────────────────────────────────────────────────────
export type OutboxKind = 'venta' | 'anulacion' | 'pago_fiado' | 'cierre' | 'caja_mov';

export interface OutboxItem {
  id?: number;
  kind: OutboxKind;
  payload: unknown;
  createdAt: number;
  retries: number;
  bloqueado?: boolean;   // en cuarentena: falló mucho o error permanente. NO se borra.
  error?: string;        // último error (diagnóstico/UI)
}

// ─── Misc ─────────────────────────────────────────────────────────────────────
export type Role = 'dueno' | 'empleado';
export interface HistoryFilters {
  metodoPago: string; cliente: string; dateFrom: string; dateTo: string;
}

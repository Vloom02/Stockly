// ═══════════════════════════════════════════════════════════════════════════
// Tipos generados automáticamente desde el esquema REAL de Supabase.
// NO editar a mano. Regenerar con:
//   npx supabase gen types typescript --project-id diytllvtweghnagqjnrc > src/types/database.types.ts
// (o regenerarlos con el MCP de Supabase).
// Usar estos tipos como fuente de verdad; los tipos "de dominio" (camelCase)
// viven en ./index.ts y se mapean desde acá en lib/sync.ts.
// ═══════════════════════════════════════════════════════════════════════════

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      comercios: {
        Row: {
          creado_en: string
          id: string
          nombre: string
          plan: string
          trial_hasta: string | null
        }
        Insert: {
          creado_en?: string
          id?: string
          nombre: string
          plan?: string
          trial_hasta?: string | null
        }
        Update: {
          creado_en?: string
          id?: string
          nombre?: string
          plan?: string
          trial_hasta?: string | null
        }
        Relationships: []
      }
      lotes: {
        Row: {
          cantidad: number
          comercio_id: string
          creado_en: string
          dias_aviso: number
          fecha_ingreso: string
          fecha_vencimiento: string
          id: string
          numero_lote: string | null
          producto_id: string
          proveedor: string | null
          retirado: boolean
          sucursal_id: string
        }
        Insert: {
          cantidad?: number
          comercio_id: string
          creado_en?: string
          dias_aviso?: number
          fecha_ingreso?: string
          fecha_vencimiento: string
          id?: string
          numero_lote?: string | null
          producto_id: string
          proveedor?: string | null
          retirado?: boolean
          sucursal_id: string
        }
        Update: {
          cantidad?: number
          comercio_id?: string
          creado_en?: string
          dias_aviso?: number
          fecha_ingreso?: string
          fecha_vencimiento?: string
          id?: string
          numero_lote?: string | null
          producto_id?: string
          proveedor?: string | null
          retirado?: boolean
          sucursal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lotes_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: false
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      miembros: {
        Row: {
          comercio_id: string
          creado_en: string
          id: string
          nombre: string | null
          rol: string
          user_id: string
        }
        Insert: {
          comercio_id: string
          creado_en?: string
          id?: string
          nombre?: string | null
          rol?: string
          user_id: string
        }
        Update: {
          comercio_id?: string
          creado_en?: string
          id?: string
          nombre?: string | null
          rol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "miembros_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: false
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos: {
        Row: {
          cantidad: number
          cantidad_anterior: number
          cantidad_nueva: number
          comercio_id: string
          fecha: string
          id: string
          lote_id: string | null
          notas: string | null
          producto_id: string | null
          sucursal_id: string | null
          tipo: string
          usuario: string | null
        }
        Insert: {
          cantidad?: number
          cantidad_anterior?: number
          cantidad_nueva?: number
          comercio_id: string
          fecha?: string
          id?: string
          lote_id?: string | null
          notas?: string | null
          producto_id?: string | null
          sucursal_id?: string | null
          tipo: string
          usuario?: string | null
        }
        Update: {
          cantidad?: number
          cantidad_anterior?: number
          cantidad_nueva?: number
          comercio_id?: string
          fecha?: string
          id?: string
          lote_id?: string | null
          notas?: string | null
          producto_id?: string | null
          sucursal_id?: string | null
          tipo?: string
          usuario?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: false
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          categoria: string
          codigo_barras: string | null
          comercio_id: string
          creado_en: string
          dias_aviso_default: number
          id: string
          nombre: string
          precio: number
          proveedor: string | null
        }
        Insert: {
          activo?: boolean
          categoria?: string
          codigo_barras?: string | null
          comercio_id: string
          creado_en?: string
          dias_aviso_default?: number
          id?: string
          nombre: string
          precio?: number
          proveedor?: string | null
        }
        Update: {
          activo?: boolean
          categoria?: string
          codigo_barras?: string | null
          comercio_id?: string
          creado_en?: string
          dias_aviso_default?: number
          id?: string
          nombre?: string
          precio?: number
          proveedor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: false
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
        ]
      }
      sucursales: {
        Row: {
          activa: boolean
          comercio_id: string
          creado_en: string
          direccion: string | null
          id: string
          nombre: string
        }
        Insert: {
          activa?: boolean
          comercio_id: string
          creado_en?: string
          direccion?: string | null
          id?: string
          nombre: string
        }
        Update: {
          activa?: boolean
          comercio_id?: string
          creado_en?: string
          direccion?: string | null
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "sucursales_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: false
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_config: {
        Row: {
          comercio_id: string
          pin_hash: string | null
          updated_at: string
        }
        Insert: {
          comercio_id: string
          pin_hash?: string | null
          updated_at?: string
        }
        Update: {
          comercio_id?: string
          pin_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ventas_config_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: true
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_deudas: {
        Row: {
          cliente: string
          comercio_id: string
          fecha: string
          id: string
          monto: number
          pagada: boolean
          venta_id: string | null
        }
        Insert: {
          cliente: string
          comercio_id: string
          fecha?: string
          id?: string
          monto: number
          pagada?: boolean
          venta_id?: string | null
        }
        Update: {
          cliente?: string
          comercio_id?: string
          fecha?: string
          id?: string
          monto?: number
          pagada?: boolean
          venta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_deudas_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: false
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_deudas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas_ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_items: {
        Row: {
          cantidad: number
          comercio_id: string
          id: string
          lote_id: string | null
          nombre_producto: string | null
          precio_unit: number
          producto_id: string | null
          subtotal: number
          venta_id: string
        }
        Insert: {
          cantidad: number
          comercio_id: string
          id?: string
          lote_id?: string | null
          nombre_producto?: string | null
          precio_unit: number
          producto_id?: string | null
          subtotal: number
          venta_id: string
        }
        Update: {
          cantidad?: number
          comercio_id?: string
          id?: string
          lote_id?: string | null
          nombre_producto?: string | null
          precio_unit?: number
          producto_id?: string | null
          subtotal?: number
          venta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ventas_items_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: false
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_items_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_items_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas_ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_ventas: {
        Row: {
          cliente: string | null
          comercio_id: string
          descuento: number
          fecha: string
          fiado: boolean
          id: string
          metodo_pago: string | null
          notas: string | null
          sucursal_id: string
          total: number
          usuario: string | null
        }
        Insert: {
          cliente?: string | null
          comercio_id: string
          descuento?: number
          fecha?: string
          fiado?: boolean
          id?: string
          metodo_pago?: string | null
          notas?: string | null
          sucursal_id: string
          total?: number
          usuario?: string | null
        }
        Update: {
          cliente?: string | null
          comercio_id?: string
          descuento?: number
          fecha?: string
          fiado?: boolean
          id?: string
          metodo_pago?: string | null
          notas?: string | null
          sucursal_id?: string
          total?: number
          usuario?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_ventas_comercio_id_fkey"
            columns: ["comercio_id"]
            isOneToOne: false
            referencedRelation: "comercios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_ventas_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      comercios_del_usuario: { Args: never; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]

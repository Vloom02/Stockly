// ═══════════════════════════════════════════════════════════════════════════
// Tipos generados automáticamente desde el esquema REAL de Supabase.
// NO editar a mano. Regenerar con:
//   npx supabase gen types typescript --project-id diytllvtweghnagqjnrc > src/types/database.types.ts
// (o regenerarlos con el MCP de Supabase).
// Usar estos tipos como fuente de verdad; los tipos "de dominio" (camelCase)
// viven en ./index.ts y se mapean desde acá en lib/sync.ts.
// ═══════════════════════════════════════════════════════════════════════════

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_auditoria": {
                  Row: {
                    "accion": string,"admin_id": string,"antes": Json | null,"comercio_id": string,"despues": Json | null,"fecha": string,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accion": string,"admin_id": string,"antes"?: Json | null,"comercio_id": string,"despues"?: Json | null,"fecha"?: string,"id"?: number
                  }
                  Update: {
                    "accion"?: string,"admin_id"?: string,"antes"?: Json | null,"comercio_id"?: string,"despues"?: Json | null,"fecha"?: string,"id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_auditoria_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"auth_intentos": {
                  Row: {
                    "actualizado_en": string,"bloqueado_hasta": string | null,"clave": string,"comercio_id": string,"fallos": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actualizado_en"?: string,"bloqueado_hasta"?: string | null,"clave": string,"comercio_id": string,"fallos"?: number
                  }
                  Update: {
                    "actualizado_en"?: string,"bloqueado_hasta"?: string | null,"clave"?: string,"comercio_id"?: string,"fallos"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "auth_intentos_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"comercios": {
                  Row: {
                    "creado_en": string,"id": string,"nombre": string,"plan": string,"trial_hasta": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "creado_en"?: string,"id"?: string,"nombre": string,"plan"?: string,"trial_hasta"?: string | null
                  }
                  Update: {
                    "creado_en"?: string,"id"?: string,"nombre"?: string,"plan"?: string,"trial_hasta"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"invitaciones": {
                  Row: {
                    "codigo": string,"comercio_id": string,"creada_por": string | null,"creado_en": string,"expira_en": string,"id": string,"usada_en": string | null,"usada_por": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "codigo": string,"comercio_id": string,"creada_por"?: string | null,"creado_en"?: string,"expira_en"?: string,"id"?: string,"usada_en"?: string | null,"usada_por"?: string | null
                  }
                  Update: {
                    "codigo"?: string,"comercio_id"?: string,"creada_por"?: string | null,"creado_en"?: string,"expira_en"?: string,"id"?: string,"usada_en"?: string | null,"usada_por"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitaciones_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"lotes": {
                  Row: {
                    "cantidad": number,"comercio_id": string,"creado_en": string,"dias_aviso": number,"fecha_ingreso": string,"fecha_vencimiento": string,"id": string,"numero_lote": string | null,"producto_id": string,"proveedor": string | null,"retirado": boolean,"sucursal_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cantidad"?: number,"comercio_id": string,"creado_en"?: string,"dias_aviso"?: number,"fecha_ingreso"?: string,"fecha_vencimiento": string,"id"?: string,"numero_lote"?: string | null,"producto_id": string,"proveedor"?: string | null,"retirado"?: boolean,"sucursal_id": string,"updated_at"?: string
                  }
                  Update: {
                    "cantidad"?: number,"comercio_id"?: string,"creado_en"?: string,"dias_aviso"?: number,"fecha_ingreso"?: string,"fecha_vencimiento"?: string,"id"?: string,"numero_lote"?: string | null,"producto_id"?: string,"proveedor"?: string | null,"retirado"?: boolean,"sucursal_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lotes_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lotes_producto_id_fkey"
      columns: ["producto_id"]
isOneToOne: false
      referencedRelation: "productos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lotes_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    }
                  ]
                },"miembros": {
                  Row: {
                    "comercio_id": string,"creado_en": string,"id": string,"nombre": string | null,"rol": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comercio_id": string,"creado_en"?: string,"id"?: string,"nombre"?: string | null,"rol"?: string,"user_id": string
                  }
                  Update: {
                    "comercio_id"?: string,"creado_en"?: string,"id"?: string,"nombre"?: string | null,"rol"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "miembros_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"movimientos": {
                  Row: {
                    "cantidad": number,"cantidad_anterior": number,"cantidad_nueva": number,"comercio_id": string,"creado_en": string,"fecha": string,"id": string,"lote_id": string | null,"notas": string | null,"producto_id": string | null,"sucursal_id": string | null,"tipo": string,"usuario": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cantidad"?: number,"cantidad_anterior"?: number,"cantidad_nueva"?: number,"comercio_id": string,"creado_en"?: string,"fecha"?: string,"id"?: string,"lote_id"?: string | null,"notas"?: string | null,"producto_id"?: string | null,"sucursal_id"?: string | null,"tipo": string,"usuario"?: string | null
                  }
                  Update: {
                    "cantidad"?: number,"cantidad_anterior"?: number,"cantidad_nueva"?: number,"comercio_id"?: string,"creado_en"?: string,"fecha"?: string,"id"?: string,"lote_id"?: string | null,"notas"?: string | null,"producto_id"?: string | null,"sucursal_id"?: string | null,"tipo"?: string,"usuario"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "movimientos_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "movimientos_lote_id_fkey"
      columns: ["lote_id"]
isOneToOne: false
      referencedRelation: "lotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "movimientos_producto_id_fkey"
      columns: ["producto_id"]
isOneToOne: false
      referencedRelation: "productos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "movimientos_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    }
                  ]
                },"plataforma_admins": {
                  Row: {
                    "creado_en": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "creado_en"?: string,"user_id": string
                  }
                  Update: {
                    "creado_en"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"precios_historial": {
                  Row: {
                    "cambiado_en": string,"comercio_id": string,"id": string,"precio_anterior": number,"precio_nuevo": number,"producto_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cambiado_en"?: string,"comercio_id": string,"id"?: string,"precio_anterior": number,"precio_nuevo": number,"producto_id": string
                  }
                  Update: {
                    "cambiado_en"?: string,"comercio_id"?: string,"id"?: string,"precio_anterior"?: number,"precio_nuevo"?: number,"producto_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "precios_historial_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "precios_historial_producto_id_fkey"
      columns: ["producto_id"]
isOneToOne: false
      referencedRelation: "productos"
      referencedColumns: ["id"]
    }
                  ]
                },"productos": {
                  Row: {
                    "activo": boolean,"categoria": string,"codigo_barras": string | null,"comercio_id": string,"costo": number | null,"creado_en": string,"dias_aviso_default": number,"foto_url": string | null,"id": string,"nombre": string,"precio": number,"proveedor": string | null,"stock_minimo": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activo"?: boolean,"categoria"?: string,"codigo_barras"?: string | null,"comercio_id": string,"costo"?: number | null,"creado_en"?: string,"dias_aviso_default"?: number,"foto_url"?: string | null,"id"?: string,"nombre": string,"precio"?: number,"proveedor"?: string | null,"stock_minimo"?: number,"updated_at"?: string
                  }
                  Update: {
                    "activo"?: boolean,"categoria"?: string,"codigo_barras"?: string | null,"comercio_id"?: string,"costo"?: number | null,"creado_en"?: string,"dias_aviso_default"?: number,"foto_url"?: string | null,"id"?: string,"nombre"?: string,"precio"?: number,"proveedor"?: string | null,"stock_minimo"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "productos_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"push_tokens": {
                  Row: {
                    "comercio_id": string,"plataforma": string | null,"token": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "comercio_id": string,"plataforma"?: string | null,"token": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "comercio_id"?: string,"plataforma"?: string | null,"token"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_tokens_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"sucursales": {
                  Row: {
                    "activa": boolean,"comercio_id": string,"creado_en": string,"direccion": string | null,"id": string,"nombre": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activa"?: boolean,"comercio_id": string,"creado_en"?: string,"direccion"?: string | null,"id"?: string,"nombre": string,"updated_at"?: string
                  }
                  Update: {
                    "activa"?: boolean,"comercio_id"?: string,"creado_en"?: string,"direccion"?: string | null,"id"?: string,"nombre"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sucursales_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_caja_mov": {
                  Row: {
                    "cajero_legajo": string | null,"cajero_nombre": string | null,"comercio_id": string,"fecha": string,"id": string,"monto": number,"motivo": string | null,"sucursal_id": string | null,"tipo": string,"turno_desde": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cajero_legajo"?: string | null,"cajero_nombre"?: string | null,"comercio_id": string,"fecha"?: string,"id"?: string,"monto": number,"motivo"?: string | null,"sucursal_id"?: string | null,"tipo": string,"turno_desde"?: string | null
                  }
                  Update: {
                    "cajero_legajo"?: string | null,"cajero_nombre"?: string | null,"comercio_id"?: string,"fecha"?: string,"id"?: string,"monto"?: number,"motivo"?: string | null,"sucursal_id"?: string | null,"tipo"?: string,"turno_desde"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_caja_mov_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_caja_mov_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_cierres": {
                  Row: {
                    "cajero_legajo": string | null,"cajero_nombre": string | null,"comercio_id": string,"creado_en": string,"desde": string | null,"diferencia": number,"efectivo_contado": number,"efectivo_esperado": number,"fondo_inicial": number,"hasta": string,"id": string,"metodos": NonNullable<Json>,"notas": string | null,"sucursal_id": string | null,"total": number,"ventas_cant": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cajero_legajo"?: string | null,"cajero_nombre"?: string | null,"comercio_id": string,"creado_en"?: string,"desde"?: string | null,"diferencia"?: number,"efectivo_contado"?: number,"efectivo_esperado"?: number,"fondo_inicial"?: number,"hasta"?: string,"id"?: string,"metodos"?: NonNullable<Json>,"notas"?: string | null,"sucursal_id"?: string | null,"total"?: number,"ventas_cant"?: number
                  }
                  Update: {
                    "cajero_legajo"?: string | null,"cajero_nombre"?: string | null,"comercio_id"?: string,"creado_en"?: string,"desde"?: string | null,"diferencia"?: number,"efectivo_contado"?: number,"efectivo_esperado"?: number,"fondo_inicial"?: number,"hasta"?: string,"id"?: string,"metodos"?: NonNullable<Json>,"notas"?: string | null,"sucursal_id"?: string | null,"total"?: number,"ventas_cant"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_cierres_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_cierres_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_config": {
                  Row: {
                    "comercio_id": string,"pin_hash": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comercio_id": string,"pin_hash"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "comercio_id"?: string,"pin_hash"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_config_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: true
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_deudas": {
                  Row: {
                    "cliente": string,"comercio_id": string,"fecha": string,"id": string,"monto": number,"pagada": boolean,"venta_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cliente": string,"comercio_id": string,"fecha"?: string,"id"?: string,"monto": number,"pagada"?: boolean,"venta_id"?: string | null
                  }
                  Update: {
                    "cliente"?: string,"comercio_id"?: string,"fecha"?: string,"id"?: string,"monto"?: number,"pagada"?: boolean,"venta_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_deudas_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_deudas_venta_id_fkey"
      columns: ["venta_id"]
isOneToOne: false
      referencedRelation: "ventas_ventas"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_empleados": {
                  Row: {
                    "activo": boolean,"comercio_id": string,"creado_en": string,"id": string,"legajo": string,"nombre": string,"pass_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activo"?: boolean,"comercio_id": string,"creado_en"?: string,"id"?: string,"legajo": string,"nombre": string,"pass_hash": string
                  }
                  Update: {
                    "activo"?: boolean,"comercio_id"?: string,"creado_en"?: string,"id"?: string,"legajo"?: string,"nombre"?: string,"pass_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_empleados_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_items": {
                  Row: {
                    "cantidad": number,"comercio_id": string,"costo_unit": number | null,"id": string,"lote_id": string | null,"nombre_producto": string | null,"precio_unit": number,"producto_id": string | null,"subtotal": number,"venta_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cantidad": number,"comercio_id": string,"costo_unit"?: number | null,"id"?: string,"lote_id"?: string | null,"nombre_producto"?: string | null,"precio_unit": number,"producto_id"?: string | null,"subtotal": number,"venta_id": string
                  }
                  Update: {
                    "cantidad"?: number,"comercio_id"?: string,"costo_unit"?: number | null,"id"?: string,"lote_id"?: string | null,"nombre_producto"?: string | null,"precio_unit"?: number,"producto_id"?: string | null,"subtotal"?: number,"venta_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_items_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_items_lote_id_fkey"
      columns: ["lote_id"]
isOneToOne: false
      referencedRelation: "lotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_items_producto_id_fkey"
      columns: ["producto_id"]
isOneToOne: false
      referencedRelation: "productos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_items_venta_id_fkey"
      columns: ["venta_id"]
isOneToOne: false
      referencedRelation: "ventas_ventas"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_pagos": {
                  Row: {
                    "comercio_id": string,"deuda_id": string,"fecha": string,"id": string,"monto": number,"usuario": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "comercio_id": string,"deuda_id": string,"fecha"?: string,"id"?: string,"monto": number,"usuario"?: string | null
                  }
                  Update: {
                    "comercio_id"?: string,"deuda_id"?: string,"fecha"?: string,"id"?: string,"monto"?: number,"usuario"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_pagos_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_pagos_deuda_id_fkey"
      columns: ["deuda_id"]
isOneToOne: false
      referencedRelation: "ventas_deudas"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_promos": {
                  Row: {
                    "activa": boolean,"comercio_id": string,"creado_en": string,"id": string,"min_cant": number,"pct": number,"producto_id": string,"tipo": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activa"?: boolean,"comercio_id": string,"creado_en"?: string,"id"?: string,"min_cant"?: number,"pct"?: number,"producto_id": string,"tipo": string
                  }
                  Update: {
                    "activa"?: boolean,"comercio_id"?: string,"creado_en"?: string,"id"?: string,"min_cant"?: number,"pct"?: number,"producto_id"?: string,"tipo"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_promos_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_promos_producto_id_fkey"
      columns: ["producto_id"]
isOneToOne: false
      referencedRelation: "productos"
      referencedColumns: ["id"]
    }
                  ]
                },"ventas_ventas": {
                  Row: {
                    "anulada": boolean,"anulada_en": string | null,"cliente": string | null,"comercio_id": string,"descuento": number,"fecha": string,"fiado": boolean,"id": string,"metodo_pago": string | null,"notas": string | null,"sucursal_id": string,"total": number,"usuario": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "anulada"?: boolean,"anulada_en"?: string | null,"cliente"?: string | null,"comercio_id": string,"descuento"?: number,"fecha"?: string,"fiado"?: boolean,"id"?: string,"metodo_pago"?: string | null,"notas"?: string | null,"sucursal_id": string,"total"?: number,"usuario"?: string | null
                  }
                  Update: {
                    "anulada"?: boolean,"anulada_en"?: string | null,"cliente"?: string | null,"comercio_id"?: string,"descuento"?: number,"fecha"?: string,"fiado"?: boolean,"id"?: string,"metodo_pago"?: string | null,"notas"?: string | null,"sucursal_id"?: string,"total"?: number,"usuario"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ventas_ventas_comercio_id_fkey"
      columns: ["comercio_id"]
isOneToOne: false
      referencedRelation: "comercios"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ventas_ventas_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "_auth_bloqueado":
{ Args: { "p_clave": string,"p_comercio": string }; Returns: boolean
                           },
"_auth_exito":
{ Args: { "p_clave": string,"p_comercio": string }; Returns: undefined
                           },
"_auth_fallo":
{ Args: { "p_clave": string,"p_comercio": string }; Returns: undefined
                           },
"_auth_verificar_hash":
{ Args: { "p_hash": string,"p_pass": string }; Returns: string
                           },
"admin_cambiar_plan":
{ Args: { "p": Json }; Returns: Json
                           },
"admin_listar_comercios":
{ Args: Record<PropertyKey, never>; Returns: {
              "creado_en": string,"email_dueno": string,"id": string,"lotes": number,"miembros": number,"nombre": string,"plan": string,"productos": number,"trial_hasta": string,"ultima_actividad": string,"ventas_30d": number
            }[]
                           },
"ajustar_stock":
{ Args: { "p": Json }; Returns: Json
                           },
"anular_venta":
{ Args: { "p": Json }; Returns: Json
                           },
"baja_empleado_venta":
{ Args: { "p": Json }; Returns: Json
                           },
"comercios_del_usuario":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"configurar_pin":
{ Args: { "p": Json }; Returns: Json
                           },
"es_admin_plataforma":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"guardar_empleado_venta":
{ Args: { "p": Json }; Returns: Json
                           },
"listar_empleados_venta":
{ Args: { "p": Json }; Returns: Json
                           },
"quitar_miembro":
{ Args: { "p": Json }; Returns: Json
                           },
"registrar_pago_fiado":
{ Args: { "p": Json }; Returns: Json
                           },
"registrar_venta":
{ Args: { "p": Json }; Returns: Json
                           },
"tiene_pin":
{ Args: { "p": Json }; Returns: boolean
                           },
"verificar_empleado_venta":
{ Args: { "p": Json }; Returns: Json
                           },
"verificar_pin":
{ Args: { "p": Json }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const

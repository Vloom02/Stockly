// ═══════════════════════════════════════════════════════════════════════════
// Resúmenes: ventas y mercadería de un período, en letra grande. Se pasa a Excel
// (con formato, varias hojas) y se imprime o guarda como PDF.
// Ventas: del servidor (hace falta internet). Mercadería: lo local, siempre al día.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { IonContent, useIonToast, useIonViewWillEnter } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { ArrowDownTrayIcon, PrinterIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon, WifiIcon } from '@heroicons/react/24/outline';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { todas } from '../lib/todas';
import { Periodo, PERIODOS, rangoDe, resumirVentas, perdidasEntre, controlEmpleados, fechaCorta, ResumenVentas, VentaRes, ItemRes, Fila, CierreRes } from '../lib/resumen';
import { DatosResumen, cifras, resumenAExcel, resumenAHtml } from '../lib/resumenExportar';
import { guardarYCompartir } from '../lib/archivos';
import { imprimirHtml } from '../lib/imprimir';
import { formatMoney } from '../ventas/context/VentasContext';
import { Header } from './ProductoPage';

const ESTADOS: Record<string, string> = { vencido: 'Vencido', critico: 'Crítico', urgente: 'Urgente', aviso: 'Aviso', ok: 'Bien' };

const ResumenesPage: React.FC = () => {
  const history = useHistory();
  const { comercio } = useAuth();
  const { state, resumen, productosConLotes } = useStore();
  const [presentToast] = useIonToast();
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [ventas, setVentas] = useState<ResumenVentas | null | 'cargando'>('cargando');
  const [cierres, setCierres] = useState<CierreRes[]>([]);
  const [recarga, setRecarga] = useState(0);
  const [ocupado, setOcupado] = useState<'' | 'excel' | 'imprimir'>('');
  useIonViewWillEnter(() => setRecarga(n => n + 1)); // al volver puede haber ventas nuevas

  const rango = useMemo(() => rangoDe(periodo), [periodo, recarga]);
  const sucursalId = state.sucursalActivaId;
  const sucursal = state.sucursales.find(s => s.id === sucursalId)?.nombre ?? '';

  useEffect(() => {
    let vigente = true;
    setVentas('cargando');
    (async () => {
      if (!comercio || !sucursalId || !navigator.onLine) { setVentas(null); return; }
      try {
        const desde = rango.anterior.desde.toISOString(), hasta = rango.hasta.toISOString();
        const [vs, items, cs] = await Promise.all([
          todas<VentaRes>((a, b) => supabase.from('ventas_ventas').select('*')
            .eq('comercio_id', comercio.id).eq('sucursal_id', sucursalId)
            .gte('fecha', desde).lt('fecha', hasta).order('fecha').order('id').range(a, b)),
          todas<ItemRes>((a, b) => supabase.from('ventas_items')
            .select('venta_id, producto_id, nombre_producto, cantidad, subtotal, costo_unit, ventas_ventas!inner(fecha, sucursal_id)')
            .eq('comercio_id', comercio.id).eq('ventas_ventas.sucursal_id', sucursalId)
            .gte('ventas_ventas.fecha', rango.desde.toISOString()).lt('ventas_ventas.fecha', hasta)
            .order('id').range(a, b)),
          todas<CierreRes>((a, b) => supabase.from('ventas_cierres').select('cajero_nombre, diferencia, hasta, creado_en')
            .eq('comercio_id', comercio.id).eq('sucursal_id', sucursalId)
            .gte('creado_en', rango.desde.toISOString()).order('creado_en').range(a, b)),
        ]);
        const nombres = Object.fromEntries(state.productos.map(p => [p.id, p.nombre]));
        if (vigente) { setVentas(resumirVentas(vs, items, nombres, rango)); setCierres(cs); }
      } catch {
        if (vigente) setVentas(null);
      }
    })();
    return () => { vigente = false; };
    // state.productos solo pone nombres: no hace falta volver a pedir las ventas si cambia
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comercio, sucursalId, rango]);

  const datos = useMemo((): DatosResumen => {
    const r = resumen();
    return {
      comercio: comercio?.nombre ?? 'Mi comercio',
      sucursal,
      rango,
      ventas: ventas === 'cargando' ? null : ventas,
      stock: { valorTotal: r.valorTotal, lotesVencidos: r.lotesVencidos, valorVencido: r.valorVencido, lotesPorVencer: r.lotesCriticos + r.lotesUrgentes, valorEnRiesgo: r.valorEnRiesgo, productosEnNegativo: r.productosEnNegativo, unidadesFaltantes: r.unidadesFaltantes,
        valorCosto: productosConLotes().reduce((t, p) => t + (p.cantidadTotal > 0 && p.producto.costo ? p.cantidadTotal * p.producto.costo : 0), 0) },
      perdidas: perdidasEntre(state.movimientos, state.productos, rango.desde, rango.hasta),
      empleados: controlEmpleados(ventas === 'cargando' || !ventas ? [] : ventas.porEmpleado, state.movimientos, cierres, rango.desde, rango.hasta),
      productosStock: productosConLotes().filter(p => p.cantidadTotal !== 0)
        .map(p => ({ nombre: p.producto.nombre, categoria: p.producto.categoria || '', cantidad: p.cantidadTotal, precio: p.producto.precio || 0, valor: p.valorTotal, vence: p.proximoVencimiento, estado: p.cantidadTotal < 0 ? 'Vendido sin stock' : ESTADOS[p.nivelPeor] ?? p.nivelPeor }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    };
  }, [comercio, sucursal, rango, ventas, resumen, productosConLotes, state.movimientos, state.productos]);

  // "Resumen 26-10-2026", "Resumen del 20-10-2026 al 26-10-2026", "Resumen Octubre 2026" (sin "/": no van en nombres de archivo)
  const nombreArchivo = 'Resumen ' + (rango.porTurno ? fechaCorta(rango.desde) : rango.titulo.replace(/^Del/, 'del')).replace(/\//g, '-');

  const exportarExcel = async () => {
    setOcupado('excel');
    const r = await resumenAExcel(datos)
      .then(b => guardarYCompartir(`${nombreArchivo}.xlsx`, b, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
      .catch(() => 'error' as const);
    setOcupado('');
    if (r === 'compartido') return;
    presentToast({
      message: r === 'guardado' ? `Guardado en Documentos: ${nombreArchivo}.xlsx` : r === 'descargado' ? 'Excel descargado' : 'No se pudo armar el Excel',
      duration: 3000, position: 'top', color: r === 'error' ? 'danger' : 'success',
    });
  };

  const imprimir = async () => {
    setOcupado('imprimir');
    try { await imprimirHtml(nombreArchivo, resumenAHtml(datos)); }
    catch { presentToast({ message: 'No se pudo abrir la impresión', duration: 3000, position: 'top', color: 'danger' }); }
    setOcupado('');
  };

  const cargando = ventas === 'cargando';
  const v = cargando ? null : ventas;
  const mercaderia = cifras(datos).find(b => b.titulo === 'Mercadería')!;

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: '20px 16px calc(110px + var(--sab,env(safe-area-inset-bottom)))', maxWidth: 1120, margin: '0 auto' }}>
        <Header title="Resúmenes" onBack={() => history.goBack()} />
        <p style={{ fontSize: 17, color: 'var(--text-2)', margin: '-4px 0 16px' }}>{datos.comercio}{sucursal ? ` · ${sucursal}` : ''}</p>

        {/* Período */}
        <div role="radiogroup" aria-label="Período" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
          {PERIODOS.map(p => {
            const activo = p.id === periodo;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={activo} onClick={() => setPeriodo(p.id)}
                className={`pressable ${activo ? 'boton-marca' : 'boton-blanco'}`}
                style={{ minHeight: 52, padding: '0 20px', borderRadius: 'var(--radius-full)', border: 'none', fontSize: 17, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                {p.nombre}
              </button>
            );
          })}
        </div>

        {/* Título del período + exportar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, flex: '1 1 260px' }}>{rango.titulo}</h2>
          <button type="button" onClick={exportarExcel} disabled={cargando || !!ocupado} className="pressable boton-marca"
            style={{ flex: '1 1 200px', maxWidth: 360, minHeight: 52, padding: '0 20px', borderRadius: 'var(--radius)', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 17, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', opacity: cargando ? 0.6 : 1 }}>
            <ArrowDownTrayIcon width={22} height={22} /> {ocupado === 'excel' ? 'Armando el Excel…' : 'Pasar a Excel'}
          </button>
          <button type="button" onClick={imprimir} disabled={cargando || !!ocupado} className="pressable boton-blanco"
            style={{ flex: '1 1 200px', maxWidth: 360, minHeight: 52, padding: '0 20px', borderRadius: 'var(--radius)', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 17, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', opacity: cargando ? 0.6 : 1 }}>
            <PrinterIcon width={22} height={22} /> {ocupado === 'imprimir' ? 'Abriendo…' : 'Imprimir o PDF'}
          </button>
        </div>

        {!cargando && !v && (
          <div className="tarjeta" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 16, marginBottom: 16, background: 'var(--level-aviso-bg)', color: 'var(--level-aviso-fg)' }}>
            <WifiIcon width={26} height={26} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 17, fontWeight: 600 }}>Sin internet no se pueden ver las ventas. Lo de la mercadería sí está al día.</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 16, alignItems: 'start' }}>
          {cargando ? (
            <Tarjeta titulo="Ventas"><p style={{ fontSize: 17, color: 'var(--text-2)', margin: 0 }}>Buscando las ventas…</p></Tarjeta>
          ) : v && (
            <>
              <Tarjeta titulo="Vendiste">
                <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--marca-texto)' }}>{formatMoney(Math.round(v.total))}</div>
                <p style={{ fontSize: 18, margin: '8px 0 4px' }}>en <b>{v.cantidad}</b> {v.cantidad === 1 ? 'venta' : 'ventas'}</p>
                {v.cantidad > 0 && <p style={{ fontSize: 17, color: 'var(--text-2)', margin: 0 }}>Cada venta, en promedio: <b style={{ color: 'var(--text)' }}>{formatMoney(Math.round(v.ticketPromedio))}</b></p>}
                {v.descuentos > 0 && <p style={{ fontSize: 17, color: 'var(--text-2)', margin: '4px 0 0' }}>Descuentos hechos: <b style={{ color: 'var(--text)' }}>{formatMoney(Math.round(v.descuentos))}</b></p>}
                <Comparacion total={v.total} anterior={v.totalAnterior} frase={rango.anterior.frase} />
              </Tarjeta>

              <Tarjeta titulo="Ganancia">
                {v.ganancia.vendidoConCosto === 0 ? (
                  <Vacio texto="Cargá el precio de costo en la ficha de cada producto y acá vas a ver cuánto ganás." />
                ) : (
                  <>
                    <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: v.ganancia.total >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatMoney(Math.round(v.ganancia.total))}</div>
                    <p style={{ fontSize: 18, margin: '8px 0 4px' }}>Margen: <b>{Math.round(v.ganancia.margen * 100)} %</b> de lo vendido</p>
                    {(() => {
                      const poco = v.productos.filter(p => p.ganancia != null && p.total > 0 && p.ganancia / p.total < 0.1).slice(0, 5);
                      return poco.length > 0 && (
                        <p style={{ fontSize: 16, color: 'var(--text-2)', margin: '8px 0 0' }}>
                          Dejan poco (menos de 10 %): <b style={{ color: 'var(--text)' }}>{poco.map(p => `${p.nombre} (${Math.round(p.ganancia! / p.total * 100)} %)`).join(', ')}</b>
                        </p>
                      );
                    })()}
                  </>
                )}
                {v.ganancia.unidadesSinCosto > 0 && (
                  <p style={{ fontSize: 16, color: 'var(--text-2)', margin: '10px 0 0' }}>
                    {v.ganancia.unidadesSinCosto} unid. vendidas no tienen costo cargado y no suman a la ganancia.
                  </p>
                )}
              </Tarjeta>

              <Tarjeta titulo="Cómo te pagaron">
                <Barras filas={v.porMetodo} total={v.total} vacio="Todavía no hay ventas" />
              </Tarjeta>

              <Tarjeta titulo={rango.porTurno ? 'Por turno' : 'Por día'}>
                <Barras filas={rango.porTurno ? v.porDia : v.porDia.filter(f => f.cantidad > 0)} total={Math.max(...v.porDia.map(f => f.total), 1)} vacio="Todavía no hay ventas" sinPorcentaje />
              </Tarjeta>

              <Tarjeta titulo="Lo que más se vendió">
                {v.productos.length === 0 ? <Vacio texto="Todavía no hay ventas" /> : (
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {v.productos.slice(0, 10).map((p, i) => (
                      <li key={p.nombre} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--marca-suave)', color: 'var(--marca-texto)', fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 600, overflowWrap: 'anywhere' }}>{p.nombre}</span>
                        <span style={{ fontSize: 16, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{p.cantidad} u.</span>
                        <span style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatMoney(Math.round(p.total))}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {v.productos.length > 10 && <p style={{ fontSize: 16, color: 'var(--text-2)', margin: '10px 0 0' }}>Los {v.productos.length} productos están en el Excel.</p>}
              </Tarjeta>

              {datos.empleados.length > 0 && (
                <Tarjeta titulo="Control de empleados">
                  {datos.empleados.map((e, i) => (
                    <div key={e.nombre} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 18, fontWeight: 800 }}>{e.nombre}</span>
                        <span style={{ fontSize: 16, color: 'var(--text-2)' }}>{e.ventas} {e.ventas === 1 ? 'venta' : 'ventas'}</span>
                        <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(Math.round(e.vendido))}</span>
                      </div>
                      {e.unidadesSinStock > 0 && (
                        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger)', margin: '4px 0 0' }}>Vendió {e.unidadesSinStock} unid. sin stock cargado</p>
                      )}
                      {e.cierres > 0 && (
                        <p style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 0', color: e.diferenciaCaja < 0 ? 'var(--danger)' : 'var(--text-2)' }}>
                          Caja: {e.diferenciaCaja === 0 ? 'cerró justo' : e.diferenciaCaja < 0 ? `faltaron ${formatMoney(Math.round(-e.diferenciaCaja))}` : `sobraron ${formatMoney(Math.round(e.diferenciaCaja))}`} en {e.cierres} {e.cierres === 1 ? 'cierre' : 'cierres'}
                        </p>
                      )}
                    </div>
                  ))}
                </Tarjeta>
              )}
            </>
          )}

          <Tarjeta titulo="Mercadería">
            {mercaderia.filas.map(([nombre, valor, f], i) => (
              <div key={nombre} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <span style={{ flex: 1, fontSize: 17 }}>{nombre}</span>
                <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{f === 'plata' ? formatMoney(Math.round(valor)) : valor}</span>
              </div>
            ))}
          </Tarjeta>
        </div>
      </div>
    </IonContent>
  );
};

const Tarjeta: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
  <section className="tarjeta anim-crecer" style={{ padding: 20 }}>
    <h3 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 14px' }}>{titulo}</h3>
    {children}
  </section>
);

const Vacio: React.FC<{ texto: string }> = ({ texto }) => <p style={{ fontSize: 17, color: 'var(--text-2)', margin: 0 }}>{texto}</p>;

/** Barras con nombre y monto escritos (nada de leyendas de colores). */
const Barras: React.FC<{ filas: Fila[]; total: number; vacio: string; sinPorcentaje?: boolean }> = ({ filas, total, vacio, sinPorcentaje }) => {
  if (!filas.some(f => f.total > 0)) return <Vacio texto={vacio} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {filas.map(f => {
        const pct = total > 0 ? (f.total / total) * 100 : 0;
        return (
          <div key={f.nombre}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ flex: 1, fontSize: 17, fontWeight: 600 }}>{f.nombre}</span>
              <span style={{ fontSize: 15, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{f.cantidad} {f.cantidad === 1 ? 'venta' : 'ventas'}</span>
              <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatMoney(Math.round(f.total))}</span>
              {!sinPorcentaje && <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)', minWidth: 42, textAlign: 'right' }}>{Math.round(pct)}%</span>}
            </div>
            <div style={{ height: 12, borderRadius: 999, background: 'var(--surface-3)', boxShadow: 'var(--hundido)', overflow: 'hidden' }}>
              <div style={{ width: `${f.total > 0 ? Math.max(pct, 2) : 0}%`, height: '100%', borderRadius: 999, background: 'var(--boton-marca)', transition: 'width .4s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Comparacion: React.FC<{ total: number; anterior: number; frase: string }> = ({ total, anterior, frase }) => {
  if (anterior <= 0) return total > 0 ? <p style={{ fontSize: 16, color: 'var(--text-2)', margin: '12px 0 0' }}>No hubo ventas {frase} para comparar.</p> : null;
  const dif = Math.round(((total - anterior) / anterior) * 100);
  const sube = dif >= 0;
  const Icono = sube ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 17, fontWeight: 700, margin: '12px 0 0', color: sube ? 'var(--success)' : 'var(--danger)' }}>
      <Icono width={24} height={24} style={{ flexShrink: 0 }} />
      <span>{dif === 0 ? 'Igual' : `${Math.abs(dif)}% ${sube ? 'más' : 'menos'}`} que {frase} ({formatMoney(Math.round(anterior))})</span>
    </p>
  );
};

export default ResumenesPage;

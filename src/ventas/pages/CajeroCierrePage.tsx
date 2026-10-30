// ═══════════════════════════════════════════════════════════════════════════
// Cierre de caja del CAJERO: al terminar su turno cuenta el efectivo, ve el
// resumen de SUS ventas, queda registrado (ventas_cierres) y recién ahí sale.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import { IonContent } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useEmpleado } from '../context/EmpleadoContext';
import { formatMoney } from '../context/VentasContext';
import { useConfirm } from '../../lib/useConfirm';
import { Card, Button, Skeleton } from '../components/ui';

import { parseMonto } from '../../lib/numeros';
import { totalesPorMetodo, arqueo, VentaCaja, MovCaja } from '../lib/caja';
import { openDB, idbGetAll, guardarFilaCaja, OfflineVentaPayload, OfflinePagoPayload } from '../lib/outbox';
import { OutboxItem } from '../types';
type VentaRow = VentaCaja;
type CajaMov = MovCaja;

const metodoLabel = (k: string) =>
  ({ efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', qr: 'QR', fiado: 'Fiado (no entró plata)' } as Record<string, string>)[k] ?? k;

const CajeroCierrePage: React.FC = () => {
  const history = useHistory();
  const { comercio, sucursalActiva } = useAuth();
  const { cajero, cerrarTurno } = useEmpleado();
  const confirmar = useConfirm();

  const desde = useMemo(() => {
    const d = cajero?.desde ? new Date(cajero.desde) : new Date();
    if (!cajero?.desde) d.setHours(0, 0, 0, 0); // sin marca: desde el inicio del día
    return d;
  }, [cajero?.desde]);

  const [ventas, setVentas] = useState<VentaRow[]>([]);
  const [movs, setMovs] = useState<CajaMov[]>([]);
  const [cobros, setCobros] = useState(0); // cobros de fiado del turno (entra efectivo)
  const [sinInternet, setSinInternet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fondo, setFondo] = useState('');
  const [contado, setContado] = useState('');
  const [errorContado, setErrorContado] = useState('');
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    (async () => {
      if (!comercio || !cajero) { setLoading(false); return; }
      const turnoDesde = new Date(cajero.desde ?? Date.now()).toISOString();
      // shortcut: las ventas se atribuyen por nombre (no hay id del cajero en la venta); dos cajeros
      // con el mismo nombre se sumarían. CajerosPage no deja repetir nombres.
      const [rv, rm, rp] = await Promise.all([
        supabase.from('ventas_ventas').select('total, metodo_pago, fiado, anulada')
          .eq('comercio_id', comercio.id).eq('usuario', cajero.nombre).gte('fecha', desde.toISOString()),
        supabase.from('ventas_caja_mov').select('id, tipo, monto, fecha, turno_desde')
          .eq('comercio_id', comercio.id).eq('turno_desde', turnoDesde),
        supabase.from('ventas_pagos').select('monto')
          .eq('comercio_id', comercio.id).eq('usuario', cajero.nombre).gte('fecha', desde.toISOString()),
      ]);
      // Lo guardado sin internet en este celular también es del turno.
      await openDB();
      const cola = await idbGetAll<OutboxItem>('outbox');
      const ventasCola = cola.filter(i => i.kind === 'venta').map(i => i.payload as OfflineVentaPayload)
        .filter(p => p.usuario === cajero.nombre && p.fecha >= desde.getTime())
        .map(p => ({ total: p.total, metodo_pago: p.metodoPago, fiado: p.fiado }));
      const cobrosCola = cola.filter(i => i.kind === 'pago_fiado').map(i => i.payload as OfflinePagoPayload)
        .filter(p => p.usuario === cajero.nombre && p.fecha >= desde.getTime()).reduce((s, p) => s + p.monto, 0);
      const movsCola = cola.filter(i => i.kind === 'caja_mov').map(i => i.payload as unknown as CajaMov & { id: string; turno_desde: string })
        .filter(m => m.turno_desde === turnoDesde);
      const movsServer = (rm.data ?? []) as (CajaMov & { id: string })[];
      const idsMov = new Set(movsServer.map(m => m.id));

      setSinInternet(!!(rv.error || rm.error || rp.error));
      setVentas([...((rv.data ?? []) as VentaRow[]), ...ventasCola]);
      setMovs([...movsServer, ...movsCola.filter(m => !idsMov.has(m.id))]);
      setCobros((rp.data ?? []).reduce((s: number, p: { monto: number }) => s + Number(p.monto), 0) + cobrosCola);
      setLoading(false);
    })();
  }, [comercio, cajero, desde]);

  const validas = useMemo(() => ventas.filter(v => !v.anulada), [ventas]);
  const total = useMemo(() => validas.reduce((s, v) => s + Number(v.total), 0), [validas]);
  const porMetodo = useMemo(() => totalesPorMetodo(validas), [validas]);
  // La apertura registrada manda; si no hay, se puede declarar el fondo a mano.
  const aperturaMov = movs.some(m => m.tipo === 'apertura');
  const a = arqueo(validas, movs, cobros, parseMonto(fondo) || 0);
  const { fondo: fondoNum, ventasEfectivo: efectivoVentas, ingresos, egresos, esperado } = a;
  const contadoNum = parseMonto(contado);
  const diferencia = contado.trim() === '' || !Number.isFinite(contadoNum) ? null : contadoNum - esperado;

  const cerrar = async () => {
    if (!comercio || !cajero) return;
    // Sin contar no se cierra: antes quedaba "cuadra" con $0 y un faltante pasaba de largo.
    if (diferencia === null) { setErrorContado('Contá el efectivo de la caja y anotalo acá. Si no hay nada, poné 0.'); return; }
    if (!(await confirmar('¿Cerrar la caja y salir del turno?', { okText: 'Cerrar caja' }))) return;
    setCerrando(true);
    const r = await guardarFilaCaja('cierre', {
      id: crypto.randomUUID(),
      comercio_id: comercio.id,
      sucursal_id: sucursalActiva?.id ?? null,
      cajero_legajo: cajero.legajo,
      cajero_nombre: cajero.nombre,
      desde: desde.toISOString(),
      hasta: new Date().toISOString(),
      ventas_cant: validas.length,
      total,
      fondo_inicial: fondoNum,
      efectivo_esperado: esperado,
      efectivo_contado: contadoNum,
      diferencia,
      metodos: porMetodo,
    });
    setCerrando(false);
    if (!r.ok) {
      if (!(await confirmar(`No se pudo guardar el cierre (${r.error}). ¿Salir del turno igual?`, { okText: 'Salir igual', peligro: true }))) return;
    }
    cerrarTurno();            // → vuelve a la pantalla de inicio de turno
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: 12, fontSize: 18, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text)',
    borderRadius: 'var(--radius)', outline: 'none',
  };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(40px + var(--sab,env(safe-area-inset-bottom)))', paddingTop: 'calc(var(--space-4) + var(--ion-safe-area-top, 0px))' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>Cerrar caja</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
          Turno de <b>{cajero?.nombre ?? '—'}</b> · desde {desde.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </p>

        {sinInternet && !loading && (
          <p role="status" style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>
            Sin internet: se cuenta lo guardado en este celular. Si vendiste en otro equipo, puede faltar.
          </p>
        )}
        {loading ? (
          <><Skeleton height={90} style={{ marginBottom: 8 }} /><Skeleton height={140} /></>
        ) : (
          <>
            {/* Resumen del turno */}
            <Card style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--text-2)' }}>Ventas del turno</span>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{ventas.length}</span>
              </div>
              {Object.entries(porMetodo).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
                  <span>{metodoLabel(k)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatMoney(v)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 6, borderTop: '2px solid var(--border)' }}>
                <span style={{ fontWeight: 700 }}>Total</span>
                <span style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--color-primary-dark)' }}>{formatMoney(total)}</span>
              </div>
            </Card>

            {/* Arqueo */}
            <Card>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Contar el efectivo</div>

              {aperturaMov ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-2)' }}>Apertura (fondo)</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatMoney(fondoNum)}</span>
                </div>
              ) : (
                <>
                  <label style={{ fontSize: 14, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Fondo inicial (lo que había al empezar)</label>
                  <input className="campo" type="text" inputMode="decimal" value={fondo} onChange={e => setFondo(e.target.value)} placeholder="0" style={{ ...inputStyle, marginBottom: 12 }} />
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-2)' }}>Efectivo de ventas</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(efectivoVentas)}</span>
              </div>
              {ingresos > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-2)' }}>Ingresos de caja</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-primary-dark)' }}>+{formatMoney(ingresos)}</span>
                </div>
              )}
              {egresos > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-2)' }}>Egresos de caja</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-danger)' }}>−{formatMoney(egresos)}</span>
                </div>
              )}
              {cobros > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-2)' }}>Cobros de fiado</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-primary-dark)' }}>+{formatMoney(cobros)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 10px', paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 14 }}>
                <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>Efectivo esperado</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(esperado)}</span>
              </div>

              <label htmlFor="efectivo-contado" style={{ fontSize: 15, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Efectivo contado</label>
              <input id="efectivo-contado" className="campo" type="text" inputMode="decimal" value={contado}
                onChange={e => { setContado(e.target.value); setErrorContado(''); }} placeholder="Lo que hay en la caja"
                aria-invalid={!!errorContado} aria-describedby={errorContado ? 'error-contado' : undefined} style={inputStyle} />
              {errorContado && <p id="error-contado" role="alert" style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-danger)', margin: '6px 0 0' }}>{errorContado}</p>}

              {diferencia !== null && (
                <div style={{
                  marginTop: 12, padding: '12px 14px', borderRadius: 'var(--radius)', textAlign: 'center',
                  background: Math.abs(diferencia) < 0.01 ? 'var(--color-primary-bg)' : diferencia > 0 ? 'var(--color-info-bg)' : 'var(--color-danger-bg)',
                  border: `1px solid ${Math.abs(diferencia) < 0.01 ? 'var(--color-primary-border)' : diferencia > 0 ? 'var(--color-info-border)' : 'var(--color-danger-border)'}`,
                  fontWeight: 600, fontSize: 14,
                  color: Math.abs(diferencia) < 0.01 ? 'var(--color-primary-dark)' : diferencia > 0 ? 'var(--color-info-dark)' : 'var(--color-danger-dark)',
                }}>
                  {Math.abs(diferencia) < 0.01 ? 'La caja cuadra' : diferencia > 0 ? `Sobran ${formatMoney(diferencia)}` : `Faltan ${formatMoney(Math.abs(diferencia))}`}
                </div>
              )}
            </Card>

            <Button fullWidth size="lg" onClick={cerrar} loading={cerrando} style={{ marginTop: 16 }}>
              Cerrar caja y salir
            </Button>
            <Button fullWidth variant="ghost" onClick={() => history.goBack()} style={{ marginTop: 8 }}>
              Volver
            </Button>
          </>
        )}
      </div>
    </IonContent>
  );
};

export default CajeroCierrePage;

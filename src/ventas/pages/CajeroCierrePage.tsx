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
interface VentaRow { total: number; metodo_pago: string; fiado: boolean; }
interface CajaMov { tipo: 'apertura' | 'ingreso' | 'egreso'; monto: number; }

const metodoLabel = (k: string) =>
  ({ efectivo: '💵 Efectivo', transferencia: '📱 Transferencia', tarjeta: '💳 Tarjeta', qr: '📲 QR' } as Record<string, string>)[k] ?? k;

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
  const [loading, setLoading] = useState(true);
  const [fondo, setFondo] = useState('');
  const [contado, setContado] = useState('');
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    (async () => {
      if (!comercio || !cajero) { setLoading(false); return; }
      const { data } = await supabase
        .from('ventas_ventas').select('total, metodo_pago, fiado, anulada')
        .eq('comercio_id', comercio.id)
        .eq('usuario', cajero.nombre)
        .gte('fecha', desde.toISOString());
      setVentas((data ?? []).filter((v: { anulada?: boolean }) => !v.anulada) as VentaRow[]);
      // Movimientos de caja del turno (apertura, ingresos, egresos).
      const { data: mv } = await supabase
        .from('ventas_caja_mov').select('tipo, monto')
        .eq('comercio_id', comercio.id).eq('turno_desde', new Date(cajero.desde ?? Date.now()).toISOString());
      setMovs((mv ?? []) as CajaMov[]);
      setLoading(false);
    })();
  }, [comercio, cajero, desde]);

  const total = useMemo(() => ventas.reduce((s, v) => s + v.total, 0), [ventas]);
  const porMetodo = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of ventas) m[v.metodo_pago] = (m[v.metodo_pago] ?? 0) + v.total;
    return m;
  }, [ventas]);
  const efectivoVentas = porMetodo['efectivo'] ?? 0;
  // La apertura registrada manda; si no hay, se puede declarar el fondo a mano.
  const aperturaMov = movs.find(m => m.tipo === 'apertura');
  const ingresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
  const egresos = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0);
  const fondoNum = aperturaMov ? aperturaMov.monto : (parseMonto(fondo) || 0);
  const esperado = fondoNum + efectivoVentas + ingresos - egresos;
  const contadoNum = parseMonto(contado);
  const diferencia = contado === '' || Number.isNaN(contadoNum) ? null : contadoNum - esperado;

  const cerrar = async () => {
    if (!comercio || !cajero) return;
    if (!(await confirmar('¿Cerrar la caja y salir del turno?', { okText: 'Cerrar caja' }))) return;
    setCerrando(true);
    try {
      await supabase.from('ventas_cierres').insert({
        comercio_id: comercio.id,
        sucursal_id: sucursalActiva?.id ?? null,
        cajero_legajo: cajero.legajo,
        cajero_nombre: cajero.nombre,
        desde: desde.toISOString(),
        ventas_cant: ventas.length,
        total,
        fondo_inicial: fondoNum,
        efectivo_esperado: esperado,
        efectivo_contado: Number.isNaN(contadoNum) ? 0 : contadoNum,
        diferencia: diferencia ?? 0,
        metodos: porMetodo,
      });
    } catch { /* aunque falle el registro, igual cerramos el turno */ }
    setCerrando(false);
    cerrarTurno();            // → vuelve a la pantalla de inicio de turno
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: 12, fontSize: 18, textAlign: 'center', fontFamily: 'var(--font-mono)',
    background: 'var(--surface)', color: 'var(--text)', border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius)', outline: 'none',
  };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(40px + var(--sab,env(safe-area-inset-bottom)))', paddingTop: 'calc(var(--space-4) + var(--ion-safe-area-top, 0px))' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>Cerrar caja</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
          Turno de <b>{cajero?.nombre ?? '—'}</b> · desde {desde.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </p>

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
                <span style={{ fontWeight: 700 }}>TOTAL</span>
                <span style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--color-primary-dark)' }}>{formatMoney(total)}</span>
              </div>
            </Card>

            {/* Arqueo */}
            <Card>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Contar el efectivo</div>

              {aperturaMov ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-2)' }}>🔓 Apertura (fondo)</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatMoney(fondoNum)}</span>
                </div>
              ) : (
                <>
                  <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Fondo inicial (lo que había al empezar)</label>
                  <input type="text" inputMode="decimal" value={fondo} onChange={e => setFondo(e.target.value)} placeholder="0" style={{ ...inputStyle, marginBottom: 12 }} />
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 10px', paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 14 }}>
                <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>Efectivo esperado</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(esperado)}</span>
              </div>

              <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Efectivo contado</label>
              <input type="text" inputMode="decimal" value={contado} onChange={e => setContado(e.target.value)} placeholder="0.00" style={inputStyle} />

              {diferencia !== null && (
                <div style={{
                  marginTop: 12, padding: '12px 14px', borderRadius: 'var(--radius)', textAlign: 'center',
                  background: Math.abs(diferencia) < 0.01 ? 'var(--color-primary-bg)' : diferencia > 0 ? 'var(--color-info-bg)' : 'var(--color-danger-bg)',
                  border: `1px solid ${Math.abs(diferencia) < 0.01 ? 'var(--color-primary-border)' : diferencia > 0 ? 'var(--color-info-border)' : 'var(--color-danger-border)'}`,
                  fontWeight: 600, fontSize: 14,
                  color: Math.abs(diferencia) < 0.01 ? 'var(--color-primary-dark)' : diferencia > 0 ? 'var(--color-info-dark)' : 'var(--color-danger-dark)',
                }}>
                  {Math.abs(diferencia) < 0.01 ? '✅ La caja cuadra' : diferencia > 0 ? `Sobran ${formatMoney(diferencia)}` : `Faltan ${formatMoney(Math.abs(diferencia))}`}
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

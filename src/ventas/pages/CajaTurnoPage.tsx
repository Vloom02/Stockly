// ═══════════════════════════════════════════════════════════════════════════
// Caja del turno (cajero): apertura (fondo inicial) + ingresos/egresos de
// efectivo durante el turno (con motivo). El cierre usa estos movimientos.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { IonContent, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useEmpleado } from '../context/EmpleadoContext';
import { formatMoney } from '../context/VentasContext';
import { Card, Button } from '../components/ui';

import { parseMonto } from '../../lib/numeros';
import { guardarFilaCaja, filasCajaEnCola } from '../lib/outbox';
export interface CajaMov { id: string; tipo: 'apertura' | 'ingreso' | 'egreso'; monto: number; motivo: string | null; fecha: string; }

const CajaTurnoPage: React.FC = () => {
  const history = useHistory();
  const { comercio, sucursalActiva } = useAuth();
  const { cajero } = useEmpleado();
  const turnoDesde = useMemo(() => new Date(cajero?.desde ?? Date.now()).toISOString(), [cajero?.desde]);

  const [movs, setMovs] = useState<CajaMov[]>([]);
  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('ingreso');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fondo, setFondo] = useState('');
  const [busy, setBusy] = useState(false);
  const [sinInternet, setSinInternet] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(false); // corregir el fondo: agrega una apertura nueva
  const [toast, setToast] = useState({ show: false, msg: '', color: 'success' as 'success' | 'danger' });

  // Lo del servidor + lo guardado sin internet. Si el servidor no contesta, se queda lo que ya se veía.
  const cargar = useCallback(async () => {
    if (!comercio) return;
    const { data, error } = await supabase.from('ventas_caja_mov')
      .select('id, tipo, monto, motivo, fecha')
      .eq('comercio_id', comercio.id).eq('turno_desde', turnoDesde)
      .order('fecha', { ascending: true });
    const enCola = (await filasCajaEnCola('caja_mov').catch(() => []))
      .filter(f => f.turno_desde === turnoDesde) as unknown as CajaMov[];
    setSinInternet(!!error);
    setMovs(prev => {
      const base = error ? prev : ((data ?? []) as CajaMov[]);
      const ids = new Set(base.map(m => m.id));
      return [...base, ...enCola.filter(c => !ids.has(c.id))].sort((a, b) => a.fecha.localeCompare(b.fecha));
    });
  }, [comercio, turnoDesde]);

  useEffect(() => { cargar(); }, [cargar]);

  const aperturas = movs.filter(m => m.tipo === 'apertura');
  const apertura = aperturas[aperturas.length - 1]; // la última: corregir el fondo agrega otra
  const ingresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
  const egresos = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0);
  const enCaja = Number(apertura?.monto ?? 0) + ingresos - egresos; // sin contar ventas

  const insertar = async (t: 'apertura' | 'ingreso' | 'egreso', m: number, mot: string): Promise<boolean> => {
    if (!comercio || busy) return false; // anti doble-tap: un solo movimiento por vez
    setBusy(true);
    const r = await guardarFilaCaja('caja_mov', {
      id: crypto.randomUUID(), comercio_id: comercio.id, sucursal_id: sucursalActiva?.id ?? null,
      cajero_legajo: cajero?.legajo ?? null, cajero_nombre: cajero?.nombre ?? null,
      turno_desde: turnoDesde, tipo: t, monto: m, motivo: mot || null, fecha: new Date().toISOString(),
    });
    setBusy(false);
    if (!r.ok) { setToast({ show: true, msg: `No se pudo guardar: ${r.error}`, color: 'danger' }); return false; }
    await cargar();
    setToast({ show: true, msg: r.enCola ? 'Guardado. Se manda solo cuando haya internet.' : 'Registrado', color: 'success' });
    return true;
  };

  // Lo escrito se borra recién cuando quedó guardado.
  const guardarApertura = async () => {
    const n = parseMonto(fondo);
    if (fondo.trim() === '' || !Number.isFinite(n) || n < 0) {
      setToast({ show: true, msg: 'Poné con cuánta plata arrancás. Si no hay nada, poné 0.', color: 'danger' });
      return;
    }
    if (await insertar('apertura', Math.round(n * 100) / 100, apertura ? 'Corrección del fondo' : 'Fondo inicial')) {
      setFondo(''); setCorrigiendo(false);
    }
  };

  const guardarMov = async () => {
    const m = Math.round((parseMonto(monto) || 0) * 100) / 100;
    if (m <= 0) { setToast({ show: true, msg: 'Poné un monto mayor que 0', color: 'danger' }); return; }
    if (await insertar(tipo, m, motivo.trim())) { setMonto(''); setMotivo(''); }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: 11, fontSize: 16, color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none', fontFamily: 'inherit',
  };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(40px + var(--sab,env(safe-area-inset-bottom)))', paddingTop: 'calc(var(--space-4) + var(--ion-safe-area-top, 0px))' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>Caja del turno</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>{cajero?.nombre ? `Turno de ${cajero.nombre}` : 'Entradas y salidas de plata'}</p>

        {sinInternet && (
          <p role="status" style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-warning-dark, var(--text))', margin: '0 0 12px' }}>
            Sin internet: se ve lo cargado en este celular. Lo nuevo se guarda y se manda solo.
          </p>
        )}

        {/* Apertura */}
        {!apertura || corrigiendo ? (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{apertura ? 'Corregir el fondo' : 'Apertura de caja'}</div>
            <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '0 0 10px' }}>Declará el efectivo con el que arrancás (fondo para dar cambio).</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="campo" type="text" inputMode="decimal" value={fondo} onChange={e => setFondo(e.target.value)} placeholder="Ej: 5000" aria-label="Efectivo con el que arrancás" style={{ ...inputStyle, flex: 1 }} />
              <Button onClick={guardarApertura} loading={busy}>{apertura ? 'Guardar' : 'Abrir caja'}</Button>
            </div>
          </Card>
        ) : (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: 'var(--text-2)' }}>Apertura</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(Number(apertura.monto))}</span>
              <Button variant="ghost" size="md" onClick={() => setCorrigiendo(true)}>Corregir</Button>
            </div>
          </Card>
        )}

        {/* Nuevo movimiento */}
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Registrar movimiento</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {(['ingreso', 'egreso'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                style={{ flex: 1, padding: 10, borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                  border: tipo === t ? '1.5px solid var(--color-primary)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)',
                  background: tipo === t ? 'var(--color-primary-bg)' : 'var(--surface)',
                  color: tipo === t ? 'var(--color-primary-dark)' : 'var(--text-2)' }}>
                {t === 'ingreso' ? '+ Ingreso' : '− Egreso'}
              </button>
            ))}
          </div>
          <input className="campo" type="text" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} placeholder="Monto" style={{ ...inputStyle, marginBottom: 8 }} />
          <input className="campo" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (ej: cambio, retiro, pago proveedor)" style={{ ...inputStyle, marginBottom: 10 }} />
          <Button fullWidth onClick={guardarMov} loading={busy}>Agregar {tipo}</Button>
        </Card>

        {/* Resumen + lista */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--text-2)' }}>Efectivo de movimientos</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(enCaja)}</span>
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '0 0 8px' }}>(apertura + ingresos − egresos; sin contar las ventas)</p>
          {movs.filter(m => m.tipo !== 'apertura').length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--text-3)', textAlign: 'center', padding: 10 }}>Sin movimientos todavía.</p>
          ) : movs.filter(m => m.tipo !== 'apertura').map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 600, color: m.tipo === 'ingreso' ? 'var(--color-primary-dark)' : 'var(--color-danger)' }}>
                  {m.tipo === 'ingreso' ? '+' : '−'} {m.motivo || (m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso')}
                </span>
                <div style={{ fontSize: 14, color: 'var(--text-3)' }}>{new Date(m.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: m.tipo === 'ingreso' ? 'var(--color-primary-dark)' : 'var(--color-danger)' }}>
                {m.tipo === 'ingreso' ? '+' : '−'}{formatMoney(m.monto)}
              </span>
            </div>
          ))}
        </Card>

        <Button fullWidth variant="ghost" onClick={() => history.goBack()} style={{ marginTop: 14 }}>Volver</Button>
      </div>
      <IonToast isOpen={toast.show} onDidDismiss={() => setToast(t => ({ ...t, show: false }))} message={toast.msg} duration={4500} position="top" color={toast.color} />
    </IonContent>
  );
};

export default CajaTurnoPage;

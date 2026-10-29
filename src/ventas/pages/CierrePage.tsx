// ═══════════════════════════════════════════════════════════════════════════
// Cierre de Caja por TURNOS de 8 horas:
//   Turno 1 (Mañana): 06:00 → 14:00
//   Turno 2 (Tarde):  14:00 → 22:00
//   Turno 3 (Noche):  22:00 → 06:00 del día siguiente (cruza medianoche)
// Muestra el turno actual por defecto, con botones para ver los otros dos.
// El arqueo de efectivo es POR TURNO. Solo lectura sobre ventas_ventas.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { IonContent, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useOwner } from '../context/OwnerContext';
import { openDB, getLocalSetting, setLocalSetting } from '../lib/outbox';
import { formatMoney } from '../context/VentasContext';
import { Card, StatCard, SectionTitle, EmptyState, Skeleton } from '../components/ui';
import { BanknotesIcon, ArrowPathIcon, LockClosedIcon } from '../components/ui/icons';
import PinPad from '../components/PinPad';

import { parseMonto } from '../../lib/numeros';
import { totalesPorMetodo, arqueo, MovCaja } from '../lib/caja';
import BotonVolver from '../components/BotonVolver';
import { MoonIcon as IcoMoonIcon, SunIcon as IcoSunIcon } from '@heroicons/react/24/outline';
import { ClockIcon as IcoClockIcon } from '@heroicons/react/24/outline';
interface VentaRow { id: string; total: number; metodo_pago: string; fecha: string; fiado: boolean; }
interface CierreRow { id: string; cajero_nombre: string; hasta: string; total: number; diferencia: number; efectivo_contado: number; }
type TurnoId = 'manana' | 'tarde' | 'noche';
interface Turno { id: TurnoId; nombre: string; Icono: typeof IcoSunIcon; startHour: number; endHour: number; }

// Horarios de turno CONFIGURABLES (hora de inicio de cada uno; el fin es el
// inicio del siguiente, y la noche termina donde arranca la mañana del otro día).
export interface HorasTurnos { manana: number; tarde: number; noche: number; }
export const HORAS_DEFAULT: HorasTurnos = { manana: 6, tarde: 14, noche: 22 };

export function armarTurnos(h: HorasTurnos): Turno[] {
  return [
    { id: 'manana', nombre: 'Mañana', Icono: IcoSunIcon, startHour: h.manana, endHour: h.tarde },
    { id: 'tarde',  nombre: 'Tarde',  Icono: IcoSunIcon, startHour: h.tarde,  endHour: h.noche },
    { id: 'noche',  nombre: 'Noche',  Icono: IcoMoonIcon, startHour: h.noche,  endHour: h.manana },
  ];
}

function rangoTurno(turno: Turno, ahora: Date): { inicio: Date; fin: Date } {
  const inicio = new Date(ahora);
  const fin = new Date(ahora);
  if (turno.id !== 'noche') {
    inicio.setHours(turno.startHour, 0, 0, 0);
    fin.setHours(turno.endHour, 0, 0, 0);
    return { inicio, fin };
  }
  // Noche: cruza la medianoche → [inicio noche, inicio mañana del día siguiente)
  const h = ahora.getHours();
  if (h >= turno.startHour) {
    inicio.setHours(turno.startHour, 0, 0, 0);
    fin.setDate(fin.getDate() + 1);
    fin.setHours(turno.endHour, 0, 0, 0);
  } else {
    inicio.setDate(inicio.getDate() - 1);
    inicio.setHours(turno.startHour, 0, 0, 0);
    fin.setHours(turno.endHour, 0, 0, 0);
  }
  return { inicio, fin };
}

export function turnoActual(ahora: Date, hs: HorasTurnos = HORAS_DEFAULT): TurnoId {
  const h = ahora.getHours();
  if (h >= hs.manana && h < hs.tarde) return 'manana';
  if (h >= hs.tarde && h < hs.noche) return 'tarde';
  return 'noche';
}

const metodoLabel = (k: string) =>
  ({ efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', qr: 'QR' } as Record<string, string>)[k] ?? k;

const CierrePage: React.FC = () => {
  const { comercio, sucursalActiva } = useAuth();
  const { setPin } = useOwner();
  const history = useHistory();
  const [ventas, setVentas]   = useState<VentaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [efectivoContado, setEfectivoContado] = useState('');
  const [selTurno, setSelTurno] = useState<TurnoId>(() => turnoActual(new Date()));
  const [showPinPad, setShowPinPad] = useState(false);
  const [pinToast, setPinToast] = useState(false);
  const [horas, setHoras] = useState<HorasTurnos>(HORAS_DEFAULT);
  const [editHoras, setEditHoras] = useState(false);

  // Cargar los horarios elegidos por el usuario (persisten en este dispositivo).
  useEffect(() => {
    (async () => {
      try {
        await openDB();
        const guardado = await getLocalSetting('horas-turnos');
        if (guardado) {
          const h = JSON.parse(guardado) as HorasTurnos;
          if (h.manana < h.tarde && h.tarde < h.noche) {
            setHoras(h);
            setSelTurno(turnoActual(new Date(), h));
          }
        }
      } catch { /* defaults */ }
    })();
  }, []);

  const guardarHoras = (h: HorasTurnos) => {
    setHoras(h);
    setSelTurno(turnoActual(new Date(), h));
    openDB().then(() => setLocalSetting('horas-turnos', JSON.stringify(h))).catch(() => {});
  };

  const TURNOS = useMemo(() => armarTurnos(horas), [horas]);
  const turno = TURNOS.find(t => t.id === selTurno)!;
  const { inicio, fin } = useMemo(() => rangoTurno(turno, new Date()), [turno]);

  const [movs, setMovs] = useState<MovCaja[]>([]);
  const [cobros, setCobros] = useState(0);
  const [sinInternet, setSinInternet] = useState(false);

  const load = useCallback(async () => {
    if (!comercio) { setLoading(false); return; }
    setLoading(true);
    const desdeIso = inicio.toISOString(), hastaIso = fin.toISOString();
    let q = supabase
      .from('ventas_ventas').select('id, total, metodo_pago, fecha, fiado')
      .eq('comercio_id', comercio.id).eq('anulada', false)
      .gte('fecha', desdeIso).lt('fecha', hastaIso);
    let qm = supabase.from('ventas_caja_mov').select('tipo, monto, fecha, turno_desde')
      .eq('comercio_id', comercio.id).gte('fecha', desdeIso).lt('fecha', hastaIso);
    if (sucursalActiva) { q = q.eq('sucursal_id', sucursalActiva.id); qm = qm.eq('sucursal_id', sucursalActiva.id); }
    const [rv, rm, rp] = await Promise.all([
      q.order('fecha', { ascending: false }),
      qm,
      supabase.from('ventas_pagos').select('monto').eq('comercio_id', comercio.id).gte('fecha', desdeIso).lt('fecha', hastaIso),
    ]);
    // Sin internet se deja lo que ya se veía y se avisa (antes decía "Sin ventas").
    setSinInternet(!!(rv.error || rm.error || rp.error));
    if (!rv.error) setVentas((rv.data ?? []) as VentaRow[]);
    if (!rm.error) setMovs((rm.data ?? []) as MovCaja[]);
    if (!rp.error) setCobros((rp.data ?? []).reduce((s: number, p: { monto: number }) => s + Number(p.monto), 0));
    setLoading(false);
  }, [comercio, sucursalActiva, inicio, fin]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setEfectivoContado(''); }, [selTurno]);

  // Cierres de caja de los cajeros (los registra cada uno al cerrar su turno).
  const [cierres, setCierres] = useState<CierreRow[]>([]);
  useEffect(() => {
    if (!comercio) return;
    (async () => {
      const { data } = await supabase
        .from('ventas_cierres').select('id, cajero_nombre, hasta, total, diferencia, efectivo_contado')
        .eq('comercio_id', comercio.id)
        .order('hasta', { ascending: false }).limit(10);
      setCierres((data ?? []) as CierreRow[]);
    })();
  }, [comercio, ventas]);

  const total      = useMemo(() => ventas.reduce((s, v) => s + v.total, 0), [ventas]);
  const cantidad   = ventas.length;
  const ticketProm = cantidad > 0 ? total / cantidad : 0;

  // Fiado aparte (no entró plata); el esperado suma fondo, entradas/salidas y cobros de fiado.
  const porMetodo = useMemo(() => totalesPorMetodo(ventas), [ventas]);
  const caja = useMemo(() => arqueo(ventas, movs, cobros), [ventas, movs, cobros]);
  const totalEfectivo = caja.esperado;

  const contado = parseMonto(efectivoContado) || 0;
  const diferencia = efectivoContado === '' ? null : contado - totalEfectivo;

  const esTurnoActual = selTurno === turnoActual(new Date(), horas);
  const fmtHora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <BotonVolver />
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Cerrar la caja</h1>
          <button onClick={load} aria-label="Actualizar datos" className="pressable" style={{ background: 'var(--surface-2)', border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius-full)', width: 48, height: 48, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowPathIcon size={22} color="var(--text-2)" />
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
          {sucursalActiva ? `${sucursalActiva.nombre} · ` : ''}Turno {turno.nombre.toLowerCase()} ({fmtHora(inicio)}–{fmtHora(fin)})
          {esTurnoActual && <span style={{ color: 'var(--color-primary-dark)', fontWeight: 600 }}> · en curso</span>}
        </p>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {TURNOS.map(t => {
            const activo = t.id === selTurno;
            const esActual = t.id === turnoActual(new Date(), horas);
            return (
              <button key={t.id} onClick={() => setSelTurno(t.id)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
                  border: activo ? '1.5px solid var(--color-primary)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)',
                  background: activo ? 'var(--color-primary-bg)' : 'var(--surface)',
                  color: activo ? 'var(--color-primary-dark)' : 'var(--text-2)',
                  fontWeight: 600, fontSize: 13, position: 'relative',
                }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}><t.Icono width={22} height={22} /></div>
                <div>{t.nombre}</div>
                {esActual && <div style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: 'var(--color-primary)' }} />}
              </button>
            );
          })}
        </div>

        {/* Horarios configurables */}
        <div style={{ marginBottom: 14 }}>
          <button type="button" onClick={() => setEditHoras(!editHoras)}
            style={{ background: 'none', border: 'none', fontSize: 15, color: 'var(--marca-texto)', cursor: 'pointer', fontFamily: 'inherit', padding: 0, fontWeight: 700, minHeight: 44, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IcoClockIcon width={20} height={20} /> {editHoras ? 'Cerrar editor de horarios' : 'Editar horarios de turno'}
          </button>
          {editHoras && (
            <Card style={{ marginTop: 8, padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {([['manana', 'Mañana'], ['tarde', 'Tarde'], ['noche', 'Noche']] as [keyof HorasTurnos, string][]).map(([k, lbl]) => (
                  <div key={k}>
                    <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{lbl} desde</label>
                    <select
                      value={horas[k]}
                      aria-label={`Hora de inicio de ${lbl}`}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        const next = { ...horas, [k]: v };
                        if (next.manana < next.tarde && next.tarde < next.noche) guardarHoras(next);
                      }}
                      style={{ width: '100%', padding: 8, fontSize: 14, fontFamily: 'var(--font-mono)', background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius-sm)' }}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '10px 0 0', lineHeight: 1.5 }}>
                La noche termina donde arranca la mañana del día siguiente. Los horarios deben ir en orden (mañana &lt; tarde &lt; noche); si una opción no se guarda, ajustá primero los otros turnos.
              </p>
            </Card>
          )}
        </div>

        {loading ? (
          <><Skeleton height={70} style={{ marginBottom: 8 }} /><Skeleton height={140} style={{ marginBottom: 8 }} /><Skeleton height={120} /></>
        ) : cantidad === 0 ? (
          sinInternet
            ? <EmptyState icon={<BanknotesIcon size={44} color="var(--text-3)" />} title="Sin internet" description="Las ventas del turno se ven cuando vuelva la señal. No se borró nada." />
            : <EmptyState icon={<BanknotesIcon size={44} color="var(--text-3)" />} title={`Sin ventas en el turno ${turno.nombre.toLowerCase()}`} description="Cuando haya ventas en este turno, vas a ver el cierre acá." />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
              <StatCard label="Ventas" value={cantidad} />
              <StatCard label="Total" value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 15 }}>{formatMoney(total)}</span>} color="var(--color-primary-dark)" />
              <StatCard label="Ticket prom." value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 15 }}>{formatMoney(ticketProm)}</span>} />
            </div>

            <Card style={{ marginBottom: 14 }}>
              <SectionTitle>Ingresos por método</SectionTitle>
              {Object.entries(porMetodo).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 14 }}>{k === 'fiado' ? 'Fiado (no cobrado)' : metodoLabel(k)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatMoney(v)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 4, borderTop: '2px solid var(--border)' }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>Total</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 17, color: 'var(--color-primary-dark)' }}>{formatMoney(total)}</span>
              </div>
            </Card>

            <Card>
              <SectionTitle>Contar el efectivo · turno {turno.nombre.toLowerCase()}</SectionTitle>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
                Contá el efectivo en la caja al cerrar este turno y anotalo para verificar que cuadre.
              </p>
              {([
                ['Fondo de apertura', caja.fondo], ['Ventas en efectivo', caja.ventasEfectivo],
                ['Entradas de plata', caja.ingresos], ['Salidas de plata', -caja.egresos], ['Cobros de fiado', caja.cobrosFiado],
              ] as [string, number][]).filter(([, n]) => n !== 0).map(([k, n]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-2)' }}>{k}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{n < 0 ? '−' : ''}{formatMoney(Math.abs(n))}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0 10px', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 600 }}>Efectivo esperado</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatMoney(totalEfectivo)}</span>
              </div>
              <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Efectivo contado en caja</label>
              <input className="campo" type="text" inputMode="decimal" value={efectivoContado} onChange={e => setEfectivoContado(e.target.value)}
                placeholder="0.00"
                style={{ width: '100%', padding: 12, fontSize: 18, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none' }} />

              {diferencia !== null && (
                <div style={{
                  marginTop: 12, padding: '12px 14px', borderRadius: 'var(--radius)',
                  background: Math.abs(diferencia) < 0.01 ? 'var(--color-primary-bg)' : diferencia > 0 ? 'var(--color-info-bg)' : 'var(--color-danger-bg)',
                  border: `1px solid ${Math.abs(diferencia) < 0.01 ? 'var(--color-primary-border)' : diferencia > 0 ? 'var(--color-info-border)' : 'var(--color-danger-border)'}`,
                  textAlign: 'center',
                }}>
                  {Math.abs(diferencia) < 0.01 ? (
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary-dark)' }}>La caja cuadra perfecto</span>
                  ) : diferencia > 0 ? (
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-info-dark)' }}>Sobran {formatMoney(diferencia)} en caja</span>
                  ) : (
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-danger-dark)' }}>Faltan {formatMoney(Math.abs(diferencia))} en caja</span>
                  )}
                </div>
              )}
            </Card>
          </>
        )}

        {/* Cierres de caja de los cajeros */}
        {cierres.length > 0 && (
          <Card style={{ marginTop: 14 }}>
            <SectionTitle>Cierres de cajeros</SectionTitle>
            {cierres.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < cierres.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{c.cajero_nombre || '—'}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{new Date(c.hasta).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} · {formatMoney(c.total)}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: Math.abs(c.diferencia) < 0.01 ? 'var(--color-primary-dark)' : c.diferencia < 0 ? 'var(--color-danger)' : 'var(--color-info-dark)' }}>
                  {Math.abs(c.diferencia) < 0.01 ? 'cuadra' : (c.diferencia > 0 ? '+' : '') + formatMoney(c.diferencia)}
                </span>
              </div>
            ))}
          </Card>
        )}

        {/* Seguridad: cambiar el PIN de dueño (la pestaña ya exige modo dueño) */}
        <Card style={{ marginTop: 14 }}>
          <SectionTitle>Seguridad</SectionTitle>
          <button
            type="button"
            onClick={() => setShowPinPad(true)}
            className="pressable"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <LockClosedIcon size={16} color="var(--color-primary)" /> Cambiar PIN de dueño
          </button>
          <button
            type="button"
            onClick={() => history.push('/ventas/cajeros')}
            className="pressable"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', minHeight: 48, marginTop: 8, border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Gestionar cajeros
          </button>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8, textAlign: 'center' }}>
            El PIN protege Dashboard, Caja, Historial y Deudas. Los cajeros inician turno con legajo + contraseña.
          </p>
        </Card>
      </div>

      {showPinPad && (
        <PinPad
          mode="create"
          titulo="Nuevo PIN de dueño"
          onSuccess={async (pin) => {
            const ok = await setPin(pin);
            if (ok) { setShowPinPad(false); setPinToast(true); }
            return ok;
          }}
          onCancel={() => setShowPinPad(false)}
        />
      )}
      <IonToast isOpen={pinToast} onDidDismiss={() => setPinToast(false)} message="PIN actualizado" duration={2200} position="top" color="success" />
    </IonContent>
  );
};

export default CierrePage;

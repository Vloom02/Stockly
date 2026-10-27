// ═══════════════════════════════════════════════════════════════════════════
// Deudas / Fiado — lee y actualiza ventas_deudas.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState, useMemo } from 'react';
import { IonContent, IonToast, useIonViewWillEnter } from '@ionic/react';
import { supabase } from '../lib/supabase';
import { openDB, enqueueOutbox } from '../lib/outbox';
import { uuid } from '../lib/ventas-engine';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../context/VentasContext';
import { Card, Badge, EmptyState, Skeleton } from '../components/ui';
import { useConfirm } from '../../lib/useConfirm';
import { BookOpenIcon, CheckIcon, MagnifyingGlass } from '../components/ui/icons';

import { parseMonto } from '../../lib/numeros';
import BotonVolver from '../components/BotonVolver';
import { ChatBubbleLeftRightIcon as IcoChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
interface DeudaRow { id: string; cliente: string; monto: number; pagada: boolean; fecha: string; }

const DeudasPage: React.FC = () => {
  const { comercio, miembro } = useAuth();
  const confirmar = useConfirm();
  const [deudas, setDeudas] = useState<DeudaRow[]>([]);
  const [pagos, setPagos] = useState<Record<string, number>>({}); // deuda_id → abonado
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState({ show: false, msg: '', color: 'success' as 'success' | 'danger' });

  const load = async () => {
    if (!comercio) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('ventas_deudas').select('*')
      .eq('comercio_id', comercio.id).eq('pagada', false)
      .order('fecha', { ascending: false });
    const rows = (data ?? []) as DeudaRow[];
    setDeudas(rows);
    // Pagos parciales ya registrados (para calcular saldo).
    const ids = rows.map(d => d.id);
    if (ids.length) {
      const { data: p } = await supabase.from('ventas_pagos').select('deuda_id, monto').in('deuda_id', ids);
      const m: Record<string, number> = {};
      for (const x of p ?? []) m[x.deuda_id] = (m[x.deuda_id] ?? 0) + Number(x.monto);
      setPagos(m);
    } else { setPagos({}); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [comercio]);
  // Recargar cada vez que se entra a la pestaña (puede haber nuevos fiados desde Venta).
  useIonViewWillEnter(() => { load(); });

  const saldoDe = (d: DeudaRow) => Math.max(0, d.monto - (pagos[d.id] ?? 0));

  // Registra un abono (parcial o total). monto = remaining → salda la deuda.
  // El pago lleva id generado acá: si hay que reintentar (outbox offline), el
  // server lo detecta como duplicado y no lo cobra dos veces.
  const registrarPago = async (d: DeudaRow, monto: number) => {
    if (!comercio || monto <= 0) return;
    const pagoId = uuid();
    const saldaria = monto >= saldoDe(d);

    const aplicarLocal = (msgExtra = '') => {
      if (saldaria) {
        setDeudas(x => x.filter(y => y.id !== d.id));
        setToast({ show: true, msg: `${d.cliente} saldó su deuda 🎉${msgExtra}`, color: 'success' });
      } else {
        setPagos(p => ({ ...p, [d.id]: (p[d.id] ?? 0) + monto }));
        setToast({ show: true, msg: `Pago de ${formatMoney(monto)} registrado${msgExtra}`, color: 'success' });
      }
    };

    if (navigator.onLine) {
      const { error } = await supabase.rpc('registrar_pago_fiado', {
        p: { pago_id: pagoId, deuda_id: d.id, comercio_id: comercio.id, monto, usuario: miembro?.nombre ?? null },
      });
      if (!error) { aplicarLocal(); return; }
      // Falló online: cae al outbox.
    }
    try {
      await openDB();
      await enqueueOutbox('pago_fiado', { pagoId, deudaId: d.id, comercioId: comercio.id, monto, usuario: miembro?.nombre ?? null, fecha: Date.now() });
      aplicarLocal(' (offline, se sincroniza)');
    } catch {
      setToast({ show: true, msg: 'No se pudo registrar el pago', color: 'danger' });
    }
  };

  const pedirPago = (d: DeudaRow) => {
    const saldo = saldoDe(d);
    const txt = window.prompt(`Pago de ${d.cliente}. Saldo: ${formatMoney(saldo)}.\n¿Cuánto abona?`, String(saldo));
    if (txt === null) return;
    const monto = Math.min(saldo, Math.round(parseMonto(txt) || 0));
    if (monto > 0) registrarPago(d, monto);
  };

  const saldar = async (d: DeudaRow) => {
    if (!(await confirmar(`¿Saldar la deuda de "${d.cliente}" (${formatMoney(saldoDe(d))})?`, { okText: 'Saldar' }))) return;
    registrarPago(d, saldoDe(d));
  };

  const recordar = (d: DeudaRow) => {
    const msg = `Hola ${d.cliente}! Te recuerdo que tenés una cuenta pendiente de ${formatMoney(saldoDe(d))} en ${comercio?.nombre ?? 'el almacén'}. ¡Gracias!`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  };

  const filtered = useMemo(() => deudas.filter(d => !search || d.cliente.toLowerCase().includes(search.toLowerCase())), [deudas, search]);
  const total = useMemo(() => deudas.reduce((s, d) => s + saldoDe(d), 0), [deudas, pagos]);

  // Agrupar por cliente
  const porCliente = useMemo(() => {
    const m: Record<string, { total: number; count: number }> = {};
    for (const d of filtered) { (m[d.cliente] ??= { total: 0, count: 0 }); m[d.cliente].total += d.monto; m[d.cliente].count++; }
    return m;
  }, [filtered]);

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <BotonVolver />
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Fiado</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>Clientes con fiado pendiente</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
          <Card variant="bordered" style={{ padding: 10 }}><div style={{ fontSize: 13, color: 'var(--text-2)' }}>Deudas activas</div><div style={{ fontSize: 20, fontWeight: 700 }}>{deudas.length}</div></Card>
          <Card variant="bordered" style={{ padding: 10 }}><div style={{ fontSize: 13, color: 'var(--text-2)' }}>Total adeudado</div><div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', paddingTop: 2, color: 'var(--color-danger)' }}>{formatMoney(total)}</div></Card>
        </div>

        {deudas.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}><MagnifyingGlass size={18} color="var(--text-3)" /></span>
            <input className="campo" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..."
              style={{ width: '100%', padding: '10px 14px 10px 38px', fontSize: 15, color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none' }} />
          </div>
        )}

        {loading ? (
          <><Skeleton height={70} style={{ marginBottom: 7 }} /><Skeleton height={70} /></>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<BookOpenIcon size={44} color="var(--text-3)" />} title={deudas.length === 0 ? 'Sin deudas' : 'Sin resultados'} description={deudas.length === 0 ? 'No hay fiados pendientes' : 'Probá otra búsqueda'} />
        ) : (
          filtered.map(d => {
            const abonado = pagos[d.id] ?? 0;
            const saldo = saldoDe(d);
            return (
            <Card key={d.id} variant="bordered" style={{ padding: '12px 14px', marginBottom: 7 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{d.cliente}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{new Date(d.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</div>
                  {abonado > 0 && <div style={{ fontSize: 13, color: 'var(--color-primary-dark)', marginTop: 3 }}>Abonado {formatMoney(abonado)} de {formatMoney(d.monto)}</div>}
                  {porCliente[d.cliente]?.count > 1 && <Badge color="yellow" style={{ marginTop: 4 }}>Total cliente: {formatMoney(porCliente[d.cliente].total)}</Badge>}
                </div>
                <span style={{ fontWeight: 800, fontSize: 17, color: 'var(--color-danger)', fontFamily: 'var(--font-mono)' }}>{formatMoney(saldo)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => pedirPago(d)} className="pressable" style={{ flex: 1, minHeight: 48, padding: '8px', border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>$ Pago</button>
                <button onClick={() => saldar(d)} className="pressable" style={{ flex: 1, minHeight: 48, padding: '8px', border: '1px solid var(--color-primary-border)', borderRadius: 'var(--radius)', background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><CheckIcon size={15} /> Saldar</button>
                <button onClick={() => recordar(d)} aria-label={`Recordar a ${d.cliente} por WhatsApp`} className="pressable" style={{ width: 48, minHeight: 48, padding: '8px', border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: 'var(--surface)', cursor: 'pointer', fontSize: 15 }}><IcoChatBubbleLeftRightIcon width={22} height={22} /></button>
              </div>
            </Card>
          );})
        )}
      </div>
      <IonToast isOpen={toast.show} onDidDismiss={() => setToast(t => ({ ...t, show: false }))} message={toast.msg} duration={2500} position="top" color={toast.color} />
    </IonContent>
  );
};

export default DeudasPage;

// ═══════════════════════════════════════════════════════════════════════════
// Deudas / Fiado — lee y actualiza ventas_deudas.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { IonContent, IonToast } from '@ionic/react';
import { useAlVolver } from '../../lib/useAlVolver';
import { supabase } from '../lib/supabase';
import { openDB, enqueueOutbox, idbGetAll, esErrorPermanente, OfflinePagoPayload } from '../lib/outbox';
import { OutboxItem } from '../types';
import { useAuth as useAuthStockly } from '../../context/AuthContext';
import { uuid } from '../lib/ventas-engine';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../context/VentasContext';
import { Card, EmptyState, Skeleton } from '../components/ui';
import { useConfirm, usePedirTexto } from '../../lib/useConfirm';
import { BookOpenIcon, CheckIcon, MagnifyingGlass } from '../components/ui/icons';

import { parseMonto } from '../../lib/numeros';
import BotonVolver from '../components/BotonVolver';
import AvisosDevolver from '../components/AvisosDevolver';
import { repartirPago, claveCliente as clave, diasDesde } from '../lib/fiado';
import { ChatBubbleLeftRightIcon as IcoChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
interface DeudaRow { id: string; cliente: string; monto: number; pagada: boolean; fecha: string; }

const DeudasPage: React.FC = () => {
  const { comercio, miembro, sucursalActiva } = useAuth();
  const { cajeroEnTurno } = useAuthStockly();
  const confirmar = useConfirm();
  const pedirTexto = usePedirTexto();
  const [deudas, setDeudas] = useState<DeudaRow[]>([]);
  const [pagos, setPagos] = useState<Record<string, number>>({}); // deuda_id → abonado
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sinInternet, setSinInternet] = useState(false);
  const cobrando = useRef(new Set<string>());
  const [toast, setToast] = useState({ show: false, msg: '', color: 'success' as 'success' | 'danger' });

  const load = async () => {
    if (!comercio) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('ventas_deudas').select('*')
      .eq('comercio_id', comercio.id).eq('pagada', false)
      .order('fecha', { ascending: false });
    // Sin internet se deja la lista que ya se veía (antes decía "No hay fiados pendientes").
    setSinInternet(!!error);
    if (error) { setLoading(false); return; }
    const rows = (data ?? []) as DeudaRow[];
    // Pagos parciales ya registrados (para calcular saldo), más los cobrados sin internet que
    // todavía no subieron: si no, al recargar la deuda volvía entera y se podía cobrar dos veces.
    const m: Record<string, number> = {};
    const ids = rows.map(d => d.id);
    if (ids.length) {
      const { data: p } = await supabase.from('ventas_pagos').select('deuda_id, monto').in('deuda_id', ids);
      for (const x of p ?? []) m[x.deuda_id] = (m[x.deuda_id] ?? 0) + Number(x.monto);
    }
    try {
      await openDB();
      for (const it of await idbGetAll<OutboxItem>('outbox')) {
        if (it.kind !== 'pago_fiado') continue;
        const pg = it.payload as OfflinePagoPayload;
        m[pg.deudaId] = (m[pg.deudaId] ?? 0) + Number(pg.monto);
      }
    } catch { /* sin cola local */ }
    setPagos(m);
    setDeudas(rows.filter(d => d.monto - (m[d.id] ?? 0) > 0));
    setLoading(false);
  };

  useEffect(() => { load(); }, [comercio]);
  // Recargar cada vez que se entra a la pestaña (puede haber nuevos fiados desde Venta).
  useAlVolver(() => { load(); });

  const saldoDe = (d: DeudaRow) => Math.max(0, d.monto - (pagos[d.id] ?? 0));

  // Registra un abono (parcial o total) y devuelve lo que se cobró de verdad (null si falló). No avisa:
  // avisa quien llama, una sola vez (una entrega repartida en varias deudas mostraba un cartel por cada una).
  // El pago lleva id generado acá: si hay que reintentar (outbox offline), el server lo detecta como duplicado.
  const registrarPago = async (d: DeudaRow, monto: number): Promise<{ cobrado: number; enCola: boolean } | null> => {
    if (!comercio || monto <= 0) return null;
    // Dos toques seguidos apilaban dos cobros de la misma deuda.
    if (cobrando.current.has(d.id)) return null;
    cobrando.current.add(d.id);
    try { return await registrarPagoUnaVez(d, monto); } finally { cobrando.current.delete(d.id); }
  };

  const registrarPagoUnaVez = async (d: DeudaRow, monto: number): Promise<{ cobrado: number; enCola: boolean } | null> => {
    if (!comercio) return null;
    const pagoId = uuid();
    const usuario = cajeroEnTurno ?? miembro?.nombre ?? null; // el cierre del cajero suma sus cobros

    const aplicarLocal = (cobrado: number) => {
      if (cobrado >= saldoDe(d)) setDeudas(x => x.filter(y => y.id !== d.id));
      else setPagos(p => ({ ...p, [d.id]: (p[d.id] ?? 0) + cobrado }));
    };

    if (navigator.onLine) {
      const { data, error } = await supabase.rpc('registrar_pago_fiado', {
        p: { pago_id: pagoId, deuda_id: d.id, comercio_id: comercio.id, monto, usuario, sucursal_id: sucursalActiva?.id },
      });
      if (!error) {
        // El servidor nunca cobra más que el saldo: si otro equipo ya la había cobrado, acá se cobró menos (o nada).
        const r = (data ?? {}) as { sin_saldo?: boolean; cobrado?: number; saldo?: number };
        const cobrado = r.sin_saldo ? 0 : Number(r.cobrado ?? Math.min(monto, saldoDe(d)));
        if (r.sin_saldo || r.saldo === 0) setDeudas(x => x.filter(y => y.id !== d.id));
        else aplicarLocal(cobrado);
        return { cobrado, enCola: false };
      }
      // Rechazado por el servidor: guardarlo para después solo lo mandaba a cuarentena.
      if (esErrorPermanente(error.message)) {
        console.warn('[fiado]', error.message);
        setToast({ show: true, msg: 'No se pudo anotar el pago. Probá de nuevo; si sigue, avisale al dueño.', color: 'danger' });
        return null;
      }
      // Sin señal o se cortó: cae al outbox.
    }
    try {
      await openDB();
      await enqueueOutbox('pago_fiado', { pagoId, deudaId: d.id, comercioId: comercio.id, monto, usuario, fecha: Date.now(), sucursalId: sucursalActiva?.id, cliente: d.cliente });
      aplicarLocal(monto);
      return { cobrado: monto, enCola: true };
    } catch {
      setToast({ show: true, msg: 'No se pudo registrar el pago', color: 'danger' });
      return null;
    }
  };

  // Cobro a un cliente (una parte o todo): se reparte pagando primero lo más viejo. Un solo aviso con el total.
  const cobrar = async (cliente: string, monto: number) => {
    const suyas = deudas.filter(d => clave(d.cliente) === clave(cliente));
    let cobrado = 0, enCola = false, fallo = false;
    for (const { deuda, monto: m } of repartirPago(suyas, saldoDe, monto)) {
      const r = await registrarPago(deuda, m);
      if (!r) { fallo = true; continue; }
      cobrado += r.cobrado; enCola ||= r.enCola;
    }
    if (fallo && cobrado === 0) return; // el error ya se avisó
    const devolver = Math.round((monto - cobrado) * 100) / 100;
    if (devolver > 0) {
      setToast({ show: true, color: 'danger', msg: cobrado > 0
        ? `Se anotaron ${formatMoney(cobrado)}: el resto ya lo había pagado en otro equipo. Devolvé ${formatMoney(devolver)}.`
        : `Ya estaba pagado (lo cobraron en otro equipo). Devolvé ${formatMoney(devolver)}.` });
      load();
      return;
    }
    setToast({ show: true, color: 'success', msg: `${cliente}: pago de ${formatMoney(cobrado)} anotado${enCola ? '. Se manda solo cuando haya internet.' : '.'}` });
  };

  const cobrarParte = async (cliente: string, total: number) => {
    const txt = await pedirTexto('Cobrar una parte', `${cliente} debe ${formatMoney(total)}. ¿Cuánto te da?`, '', 'Anotar pago');
    if (txt === null) return;
    // Con centavos: redondear a pesos enteros dejaba deudas de $0,50 que no se podían saldar.
    const monto = Math.min(total, Math.round((parseMonto(txt) || 0) * 100) / 100);
    if (monto > 0) cobrar(cliente, monto);
    else setToast({ show: true, color: 'danger', msg: 'Escribí cuánto te da, por ejemplo 1500' });
  };

  const saldarTodo = async (cliente: string, total: number) => {
    if (!(await confirmar(`¿${cliente} pagó todo (${formatMoney(total)})?`, { okText: 'Pagó todo' }))) return;
    cobrar(cliente, total);
  };

  const recordar = (cliente: string, total: number) => {
    const msg = `Hola ${cliente}! Te recuerdo que tenés una cuenta pendiente de ${formatMoney(total)} en ${comercio?.nombre ?? 'el almacén'}. ¡Gracias!`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  };

  const total = useMemo(() => deudas.reduce((s, d) => s + saldoDe(d), 0), [deudas, pagos]);

  // Una tarjeta por cliente: lo que todavía debe (no lo fiado), y "Marta" = "marta " (se escribe a mano en cada venta).
  const clientes = useMemo(() => {
    const m = new Map<string, { cliente: string; total: number; deudas: DeudaRow[] }>();
    for (const d of deudas) {
      if (search && !d.cliente.toLowerCase().includes(search.toLowerCase())) continue;
      const k = clave(d.cliente);
      const c = m.get(k) ?? { cliente: d.cliente.trim(), total: 0, deudas: [] };
      c.total += saldoDe(d); c.deudas.push(d);
      m.set(k, c);
    }
    for (const c of m.values()) c.deudas.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [deudas, pagos, search]);
  const nClientes = useMemo(() => new Set(deudas.map(d => clave(d.cliente))).size, [deudas]);
  const haceDias = (fecha: string) => { const n = diasDesde(fecha); return n <= 0 ? 'de hoy' : n === 1 ? 'de ayer' : `de hace ${n} días`; };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <BotonVolver />
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Fiado</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 14 }}>Clientes con fiado pendiente</p>
        <AvisosDevolver />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
          <Card variant="bordered" style={{ padding: 10 }}><div style={{ fontSize: 14, color: 'var(--text-2)' }}>Clientes que deben</div><div style={{ fontSize: 20, fontWeight: 700 }}>{nClientes}</div></Card>
          <Card variant="bordered" style={{ padding: 10 }}><div style={{ fontSize: 14, color: 'var(--text-2)' }}>Total adeudado</div><div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', paddingTop: 2, color: 'var(--color-danger)' }}>{formatMoney(total)}</div></Card>
        </div>

        {deudas.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}><MagnifyingGlass size={18} color="var(--text-3)" /></span>
            <input className="campo" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." aria-label="Buscar cliente"
              style={{ width: '100%', minHeight: 48, padding: '10px 14px 10px 38px', fontSize: 17, color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none' }} />
          </div>
        )}

        {loading ? (
          <><Skeleton height={70} style={{ marginBottom: 7 }} /><Skeleton height={70} /></>
        ) : clientes.length === 0 ? (
          <EmptyState icon={<BookOpenIcon size={44} color="var(--text-3)" />}
            title={deudas.length > 0 ? 'Sin resultados' : sinInternet ? 'Sin internet' : 'Sin deudas'}
            description={deudas.length > 0 ? 'Probá otra búsqueda' : sinInternet ? 'El fiado se ve cuando vuelva la señal. No se borró nada.' : 'No hay fiados pendientes'} />
        ) : (
          clientes.map(c => (
            <Card key={clave(c.cliente)} variant="bordered" style={{ padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{c.cliente}</div>
                <span style={{ fontWeight: 800, fontSize: 19, color: 'var(--color-danger)', fontFamily: 'var(--font-mono)' }}>{formatMoney(c.total)}</span>
              </div>
              <div style={{ marginBottom: 10 }}>
                {c.deudas.map(d => {
                  const abonado = pagos[d.id] ?? 0;
                  return (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 15, color: 'var(--text-2)', padding: '2px 0' }}>
                      <span>{new Date(d.fecha).toLocaleDateString('es-AR')} · {haceDias(d.fecha)}{abonado > 0 ? ` · pagó ${formatMoney(abonado)}` : ''}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{formatMoney(saldoDe(d))}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => cobrarParte(c.cliente, c.total)} className="pressable" style={{ flex: '1 1 130px', minHeight: 48, padding: '8px', border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 16, fontWeight: 600, fontFamily: 'inherit' }}>Cobrar una parte</button>
                <button onClick={() => saldarTodo(c.cliente, c.total)} className="pressable" style={{ flex: '1 1 130px', minHeight: 48, padding: '8px', border: '1px solid var(--color-primary-border)', borderRadius: 'var(--radius)', background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)', cursor: 'pointer', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><CheckIcon size={18} /> Pagó todo</button>
                <button onClick={() => recordar(c.cliente, c.total)} aria-label={`Recordar a ${c.cliente} por WhatsApp`} className="pressable" style={{ width: 48, minHeight: 48, padding: '8px', border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: 'var(--surface)', cursor: 'pointer' }}><IcoChatBubbleLeftRightIcon width={22} height={22} /></button>
              </div>
            </Card>
          ))
        )}
      </div>
      <IonToast isOpen={toast.show} onDidDismiss={() => setToast(t => ({ ...t, show: false }))} message={toast.msg} duration={4500} position="top" color={toast.color} />
    </IonContent>
  );
};

export default DeudasPage;

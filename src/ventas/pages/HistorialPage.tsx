// ═══════════════════════════════════════════════════════════════════════════
// Historial de ventas — lee ventas_ventas con sus items. Filtros + export CSV.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { IonContent, useIonViewWillEnter } from '@ionic/react';
import { supabase } from '../lib/supabase';
import { openDB, enqueueOutbox } from '../lib/outbox';
import { ventasACSV, guardarCSV } from '../lib/exportar';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../context/VentasContext';
import { useConfirm } from '../../lib/useConfirm';
import { Card, Badge, EmptyState, Skeleton, Button, Opciones } from '../components/ui';
import { ClipboardIcon, FunnelIcon, DocumentIcon } from '../components/ui/icons';
import { HistoryFilters } from '../types';

import BotonVolver from '../components/BotonVolver';
interface VentaRow { id: string; total: number; descuento: number; metodo_pago: string; cliente: string; fiado: boolean; usuario: string; fecha: string; anulada?: boolean; }

const SaleCard: React.FC<{ venta: VentaRow; onChanged: () => void }> = ({ venta, onChanged }) => {
  const { comercio, miembro } = useAuth();
  const confirmar = useConfirm();
  const [open, setOpen] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [anuladaLocal, setAnuladaLocal] = useState(false); // optimista (offline)
  const [items, setItems] = useState<{ cantidad: number; precio_unit: number; subtotal: number; producto_id: string }[]>([]);
  const [prods, setProds] = useState<Record<string, string>>({});
  const anulada = venta.anulada || anuladaLocal;

  // Igual que las ventas: intenta online; si no hay red o falla, encola en el
  // outbox (el RPC es idempotente por venta_id → reintentar es seguro).
  const anular = async () => {
    if (!comercio || anulada) return;
    if (!(await confirmar('¿Anular esta venta y devolver el stock a los lotes? No se puede deshacer.', { peligro: true, okText: 'Anular' }))) return;
    setAnulando(true);
    const payload = { ventaId: venta.id, comercioId: comercio.id, usuario: miembro?.nombre ?? null };
    if (navigator.onLine) {
      const { error } = await supabase.rpc('anular_venta', { p: { venta_id: venta.id, comercio_id: comercio.id, usuario: miembro?.nombre ?? null } });
      setAnulando(false);
      if (!error) { onChanged(); return; }
      // Falló online (¿red inestable?): encolar para reintentar.
    }
    try {
      await openDB();
      await enqueueOutbox('anulacion', payload);
      setAnuladaLocal(true);
      window.alert('Sin conexión: la anulación quedó guardada y se aplica al volver internet.');
    } catch {
      window.alert('No se pudo anular la venta.');
    }
    setAnulando(false);
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && items.length === 0) {
      const { data } = await supabase.from('ventas_items').select('*').eq('venta_id', venta.id);
      setItems(data ?? []);
      const ids = [...new Set((data ?? []).map(i => i.producto_id).filter(Boolean))];
      if (ids.length) {
        const { data: p } = await supabase.from('productos').select('id,nombre').in('id', ids);
        const m: Record<string, string> = {};
        for (const x of p ?? []) m[x.id] = x.nombre;
        setProds(m);
      }
    }
  };

  const time = new Date(venta.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const metodoLabel = ({ efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', qr: 'QR' } as Record<string, string>)[venta.metodo_pago] ?? venta.metodo_pago;

  return (
    <Card variant="bordered" style={{ padding: 0, overflow: 'hidden', marginBottom: 7, opacity: anulada ? 0.6 : 1 }}>
      <div onClick={toggle} className="pressable" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', cursor: 'pointer' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>🕐 {time} {venta.usuario && <Badge color="purple" style={{ marginLeft: 4, fontSize: 13 }}>{venta.usuario}</Badge>}
            {anulada && <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 700, color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-full)', padding: '1px 7px' }}>ANULADA</span>}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 1 }}>{metodoLabel}{venta.cliente ? ` · ${venta.cliente}` : ''}{venta.fiado ? ' · Fiado' : ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-primary-dark)', fontFamily: 'var(--font-mono)', textDecoration: anulada ? 'line-through' : 'none' }}>{formatMoney(venta.total)}</span>
          <span style={{ color: 'var(--text-3)', fontSize: 18, transition: 'transform .2s', transform: open ? 'rotate(90deg)' : '' }}>›</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--surface-2)' }}>
          {items.length === 0 ? <Skeleton height={14} /> : items.map((it, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
              <span>{prods[it.producto_id] ?? '—'} <span style={{ color: 'var(--text-3)' }}>x{it.cantidad}</span></span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(it.subtotal)}</span>
            </div>
          ))}
          {venta.descuento > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0', color: 'var(--color-primary-dark)' }}><span>Descuento</span><span style={{ fontFamily: 'var(--font-mono)' }}>-{formatMoney(venta.descuento)}</span></div>}
          {!anulada && (
            <button type="button" onClick={anular} disabled={anulando} className="pressable"
              style={{ marginTop: 10, width: '100%', padding: '9px', background: 'var(--color-danger-bg)', color: 'var(--color-danger)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: anulando ? 0.6 : 1 }}>
              {anulando ? 'Anulando…' : '↩ Anular venta / devolución'}
            </button>
          )}
        </div>
      )}
    </Card>
  );
};

const HistorialPage: React.FC = () => {
  const { comercio } = useAuth();
  const [ventas, setVentas] = useState<VentaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<HistoryFilters>({ metodoPago: '', cliente: '', dateFrom: '', dateTo: '' });

  const cargar = useCallback(async () => {
    if (!comercio) { setLoading(false); return; }
    setLoading(true);
    const desde = new Date(); desde.setDate(desde.getDate() - 30);
    const { data } = await supabase.from('ventas_ventas').select('*')
      .eq('comercio_id', comercio.id).gte('fecha', desde.toISOString())
      .order('fecha', { ascending: false });
    setVentas((data ?? []) as VentaRow[]);
    setLoading(false);
  }, [comercio]);

  useEffect(() => { cargar(); }, [cargar]);
  // Refrescar al volver a la pestaña (puede haber ventas nuevas).
  useIonViewWillEnter(() => { cargar(); });

  const filtered = useMemo(() => ventas
    .filter(v => !filters.metodoPago || v.metodo_pago === filters.metodoPago)
    .filter(v => !filters.cliente || (v.cliente ?? '').toLowerCase().includes(filters.cliente.toLowerCase()))
    .filter(v => !filters.dateFrom || v.fecha >= filters.dateFrom)
    .filter(v => !filters.dateTo || v.fecha <= filters.dateTo + 'T23:59:59'),
    [ventas, filters]);

  const total = useMemo(() => filtered.reduce((s, v) => s + v.total, 0), [filtered]);

  const grouped = useMemo(() => {
    const g: Record<string, VentaRow[]> = {};
    for (const v of filtered) {
      const k = new Date(v.fecha).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
      (g[k] ??= []).push(v);
    }
    return g;
  }, [filtered]);

  // CSV unificado con la lib compartida (en Android guarda en Documentos).
  const exportCSV = () => guardarCSV(`ventas-${new Date().toISOString().slice(0, 10)}.csv`, ventasACSV(filtered));

  const activeFilters = Object.values(filters).filter(Boolean).length;
  const inputStyle: React.CSSProperties = { width: '100%', padding: 9, fontSize: 13, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', outline: 'none' };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <BotonVolver />
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Ventas anteriores</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>Últimos 30 días</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 }}>
          <Card variant="bordered" style={{ padding: 10 }}><div style={{ fontSize: 13, color: 'var(--text-2)' }}>Ventas</div><div style={{ fontSize: 20, fontWeight: 700 }}>{filtered.length}</div></Card>
          <Card variant="bordered" style={{ padding: 10 }}><div style={{ fontSize: 13, color: 'var(--text-2)' }}>Total</div><div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', paddingTop: 2 }}>{formatMoney(total)}</div></Card>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button variant="secondary" onClick={exportCSV} style={{ flex: 1 }}><DocumentIcon size={16} /> CSV</Button>
          <Button variant={activeFilters > 0 ? 'primary' : 'secondary'} onClick={() => setShowFilters(!showFilters)} style={{ flex: 1 }}><FunnelIcon size={16} /> Filtros{activeFilters > 0 ? ` (${activeFilters})` : ''}</Button>
        </div>

        {showFilters && (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 8 }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Cómo pagó</label>
                <Opciones etiqueta="Cómo pagó" columnas={3} valor={filters.metodoPago} onChange={v => setFilters(f => ({ ...f, metodoPago: v }))}
                  opciones={[{ valor: '', etiqueta: 'Todos' }, { valor: 'efectivo', etiqueta: 'Efectivo' }, { valor: 'transferencia', etiqueta: 'Transferencia' }, { valor: 'tarjeta', etiqueta: 'Tarjeta' }, { valor: 'qr', etiqueta: 'QR' }]} /></div>
              <div><label style={{ fontSize: 13, color: 'var(--text-2)' }}>Cliente</label>
                <input value={filters.cliente} onChange={e => setFilters(f => ({ ...f, cliente: e.target.value }))} style={inputStyle} placeholder="Buscar..." /></div>
              <div><label style={{ fontSize: 13, color: 'var(--text-2)' }}>Desde</label>
                <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} style={inputStyle} /></div>
              <div><label style={{ fontSize: 13, color: 'var(--text-2)' }}>Hasta</label>
                <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} style={inputStyle} /></div>
            </div>
            <Button variant="ghost" size="sm" fullWidth onClick={() => setFilters({ metodoPago: '', cliente: '', dateFrom: '', dateTo: '' })}>Limpiar filtros</Button>
          </Card>
        )}

        {loading ? (
          <><Skeleton height={60} style={{ marginBottom: 7 }} /><Skeleton height={60} style={{ marginBottom: 7 }} /><Skeleton height={60} /></>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<ClipboardIcon size={44} color="var(--text-3)" />} title={activeFilters > 0 ? 'Sin resultados' : 'Sin ventas'} description={activeFilters > 0 ? 'Probá con otros filtros' : 'Todavía no registraste ventas'} />
        ) : (
          Object.entries(grouped).map(([day, vs]) => {
            const dayTotal = vs.reduce((s, v) => s + v.total, 0);
            return (
              <div key={day} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.6px' }}>{day}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary-dark)' }}>{formatMoney(dayTotal)}</span>
                </div>
                {vs.map(v => <SaleCard key={v.id} venta={v} onChanged={cargar} />)}
              </div>
            );
          })
        )}
      </div>
    </IonContent>
  );
};

export default HistorialPage;

// ═══════════════════════════════════════════════════════════════════════════
// Historial de ventas — lee ventas_ventas con sus items. Filtros + export CSV.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { fechaLocalISO } from '../../lib/vencimientos';
import { IonContent, IonToast } from '@ionic/react';
import { useAlVolver } from '../../lib/useAlVolver';
import { supabase } from '../lib/supabase';
import { todas } from '../../lib/todas';
import { openDB, enqueueOutbox, esErrorPermanente } from '../lib/outbox';
import { ventasACSV, guardarCSV } from '../lib/exportar';
import { avisoArchivo } from '../../lib/archivos';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../context/VentasContext';
import { useConfirm } from '../../lib/useConfirm';
import { Card, Badge, EmptyState, Skeleton, Button, Opciones } from '../components/ui';
import { ClipboardIcon, FunnelIcon, DocumentIcon } from '../components/ui/icons';
import { HistoryFilters } from '../types';

import BotonVolver from '../components/BotonVolver';

// Un solo formateador: toLocaleDateString con opciones arma uno nuevo en cada llamada (3.000 ventas trababan 2,6 s).
const FMT_DIA = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
const FMT_HORA = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' });

interface VentaRow { id: string; total: number; descuento: number; metodo_pago: string; cliente: string; fiado: boolean; usuario: string; fecha: string; anulada?: boolean; }

const SaleCard: React.FC<{ venta: VentaRow; onAnulada: (id: string) => void; avisar: (msg: string) => void }> = ({ venta, onAnulada, avisar }) => {
  const { comercio, miembro, sucursalActiva } = useAuth();
  const confirmar = useConfirm();
  const [open, setOpen] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [anuladaLocal, setAnuladaLocal] = useState(false); // optimista (offline)
  const [items, setItems] = useState<{ cantidad: number; precio_unit: number; subtotal: number; producto_id: string | null; nombre_producto?: string | null }[]>([]);
  const [prods, setProds] = useState<Record<string, string>>({});
  const anulada = venta.anulada || anuladaLocal;

  // Igual que las ventas: intenta online; si no hay red o falla, encola en el
  // outbox (el RPC es idempotente por venta_id → reintentar es seguro).
  const anular = async () => {
    if (!comercio || anulada) return;
    if (!(await confirmar('¿Anular esta venta y devolver la mercadería al stock? No se puede deshacer.', { peligro: true, okText: 'Anular' }))) return;
    setAnulando(true);
    const payload = { ventaId: venta.id, comercioId: comercio.id, usuario: miembro?.nombre ?? null, fecha: Date.now(), sucursalId: sucursalActiva?.id };
    if (navigator.onLine) {
      // Con señal floja no se espera 45 s mirando "Anulando…": a los 8 s va a la cola (es idempotente por venta).
      const sinRespuesta = new Promise<{ data: null; error: { message: string } }>(r =>
        setTimeout(() => r({ data: null, error: { message: 'sin respuesta del servidor' } }), 8000));
      const { data, error } = await Promise.race([
        supabase.rpc('anular_venta', { p: { venta_id: venta.id, comercio_id: comercio.id, usuario: miembro?.nombre ?? null, sucursal_id: sucursalActiva?.id } }),
        sinRespuesta,
      ]);
      setAnulando(false);
      // Sin recargar la lista: volvía al principio y se perdía el "Ver más".
      if (!error) {
        onAnulada(venta.id);
        // Efectivo: el servidor anota esa plata como salida de caja (migraciones 18 y 19).
        const devuelto = Number((data as { devuelto?: number } | null)?.devuelto ?? 0);
        avisar(devuelto > 0
          ? `Venta anulada. Devolvele ${formatMoney(devuelto)}: quedó anotado como salida de caja.`
          : 'Venta anulada. El stock volvió a la mercadería.');
        return;
      }
      // Rechazada por el servidor: encolarla solo la mandaba a cuarentena y la pantalla decía "guardada".
      if (esErrorPermanente(error.message)) { console.warn('[anular]', error.message); avisar('No se pudo anular esta venta. Probá de nuevo en un rato.'); return; }
      // Falló online (¿red inestable?): encolar para reintentar.
    }
    try {
      await openDB();
      await enqueueOutbox('anulacion', payload);
      setAnuladaLocal(true);
      avisar('Sin señal: la anulación quedó guardada y se aplica sola cuando vuelva.');
    } catch {
      avisar('No se pudo anular la venta.');
    }
    setAnulando(false);
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && items.length === 0) {
      const { data } = await supabase.from('ventas_items').select('*').eq('venta_id', venta.id);
      setItems(data ?? []);
      // El nombre guardado en la venta manda (si después se renombró o borró el producto, se ve el de ese día).
      const ids = [...new Set((data ?? []).filter(i => !i.nombre_producto).map(i => i.producto_id).filter(Boolean))];
      if (ids.length) {
        const { data: p } = await supabase.from('productos').select('id,nombre').in('id', ids);
        const m: Record<string, string> = {};
        for (const x of p ?? []) m[x.id] = x.nombre;
        setProds(m);
      }
    }
  };

  const time = FMT_HORA.format(new Date(venta.fecha));
  const metodoLabel = ({ efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', qr: 'QR' } as Record<string, string>)[venta.metodo_pago] ?? venta.metodo_pago;

  return (
    <Card variant="bordered" style={{ padding: 0, overflow: 'hidden', marginBottom: 7 }}>
      <button type="button" onClick={toggle} aria-expanded={open} className="pressable" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', minHeight: 56, cursor: 'pointer', border: 'none', background: 'none', textAlign: 'left', fontFamily: 'inherit', color: 'var(--text)' }}>
        <div>
          <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{time} {venta.usuario && <Badge color="purple" style={{ marginLeft: 4, fontSize: 14 }}>{venta.usuario}</Badge>}
            {anulada && <span style={{ marginLeft: 6, fontSize: 14, fontWeight: 700, color: 'var(--color-danger)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-full)', padding: '1px 7px' }}>ANULADA</span>}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 1 }}>{venta.fiado ? 'Fiado' : metodoLabel}{venta.cliente ? ` · ${venta.cliente}` : ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-primary-dark)', fontFamily: 'var(--font-mono)', textDecoration: anulada ? 'line-through' : 'none' }}>{formatMoney(venta.total)}</span>
          <span aria-hidden="true" style={{ color: 'var(--text-3)', fontSize: 18, transition: 'transform .2s', transform: open ? 'rotate(90deg)' : '' }}>›</span>
        </div>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--surface-2)' }}>
          {items.length === 0 ? <Skeleton height={14} /> : items.map((it, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '2px 0' }}>
              <span>{it.nombre_producto || (it.producto_id && prods[it.producto_id]) || 'Venta rápida'} <span style={{ color: 'var(--text-3)' }}>x{it.cantidad}</span></span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(it.subtotal)}</span>
            </div>
          ))}
          {venta.descuento > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '2px 0', color: 'var(--color-primary-dark)' }}><span>Descuento</span><span style={{ fontFamily: 'var(--font-mono)' }}>-{formatMoney(venta.descuento)}</span></div>}
          {!anulada && (
            <button type="button" onClick={anular} disabled={anulando} className="pressable"
              style={{ marginTop: 10, width: '100%', padding: '9px', minHeight: 48, background: 'var(--color-danger-bg)', color: 'var(--color-danger)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: anulando ? 0.6 : 1 }}>
              {anulando ? 'Anulando…' : 'Anular venta / devolución'}
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
  const [sinInternet, setSinInternet] = useState(false);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    if (!comercio) { setLoading(false); return; }
    setLoading(true);
    const desde = new Date(); desde.setDate(desde.getDate() - 30);
    // De a 1.000 (con unas 40 ventas por día se pasaba y el total quedaba corto sin avisar).
    // Sin internet se deja lo que ya se veía.
    try {
      setVentas(await todas<VentaRow>((a, b) => supabase.from('ventas_ventas').select('id, total, descuento, metodo_pago, cliente, fiado, usuario, fecha, anulada')
        .eq('comercio_id', comercio.id).gte('fecha', desde.toISOString())
        .order('fecha', { ascending: false }).order('id').range(a, b)));
      setSinInternet(false);
    } catch { setSinInternet(true); }
    setLoading(false);
  }, [comercio]);

  useEffect(() => { cargar(); }, [cargar]);
  // Refrescar al volver a la pestaña (puede haber ventas nuevas).
  useAlVolver(() => { cargar(); });

  const filtered = useMemo(() => ventas
    // Lo fiado no entró como plata, aunque quede guardado con "efectivo".
    .filter(v => !filters.metodoPago || (v.fiado ? 'fiado' : v.metodo_pago) === filters.metodoPago)
    .filter(v => !filters.cliente || (v.cliente ?? '').toLowerCase().includes(filters.cliente.toLowerCase()))
    // Por el día en hora local (la fecha guardada es UTC: una venta de las 22 h caía al día siguiente).
    .filter(v => !filters.dateFrom || fechaLocalISO(new Date(v.fecha)) >= filters.dateFrom)
    .filter(v => !filters.dateTo || fechaLocalISO(new Date(v.fecha)) <= filters.dateTo),
    [ventas, filters]);

  const total = useMemo(() => filtered.filter(v => !v.anulada).reduce((s, v) => s + Number(v.total), 0), [filtered]); // las anuladas no suman

  // De a 60: 30 días de un almacén con movimiento son miles de tarjetas dibujadas de una.
  const [cuantas, setCuantas] = useState(60);
  useEffect(() => { setCuantas(60); }, [filters]); // solo al cambiar filtros: anular una venta no vuelve al principio
  const totalDia = useMemo(() => {
    const t: Record<string, number> = {};
    for (const v of filtered) if (!v.anulada) { const d = FMT_DIA.format(new Date(v.fecha)); t[d] = (t[d] ?? 0) + Number(v.total); }
    return t;
  }, [filtered]);
  const grouped = useMemo(() => {
    const g: Record<string, VentaRow[]> = {};
    for (const v of filtered.slice(0, cuantas)) {
      const k = FMT_DIA.format(new Date(v.fecha));
      (g[k] ??= []).push(v);
    }
    return g;
  }, [filtered, cuantas]);

  // Planilla: en Android se abre "Compartir" (Drive, WhatsApp, mail).
  const exportCSV = async () => {
    const r = await guardarCSV(`ventas-${fechaLocalISO()}.csv`, ventasACSV(filtered.filter(v => !v.anulada)));
    const msg = avisoArchivo(r, 'La planilla');
    if (msg) setAviso(msg);
  };

  const activeFilters = Object.values(filters).filter(Boolean).length;
  const inputStyle: React.CSSProperties = { width: '100%', padding: 9, fontSize: 14, color: 'var(--text)', borderRadius: 'var(--radius-sm)', outline: 'none' };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <BotonVolver />
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Ventas anteriores</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 14 }}>Últimos 30 días</p>
        {sinInternet && <p role="status" style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Sin internet: las ventas se ven cuando vuelva la señal. No se borró nada.</p>}
        <IonToast isOpen={!!aviso} message={aviso} duration={6500} onDidDismiss={() => setAviso('')} position="top" />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 }}>
          <Card variant="bordered" style={{ padding: 10 }}><div style={{ fontSize: 14, color: 'var(--text-2)' }}>Ventas</div><div style={{ fontSize: 20, fontWeight: 700 }}>{filtered.length}</div></Card>
          <Card variant="bordered" style={{ padding: 10 }}><div style={{ fontSize: 14, color: 'var(--text-2)' }}>Total</div><div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', paddingTop: 2 }}>{formatMoney(total)}</div></Card>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button variant="secondary" onClick={exportCSV} style={{ flex: 1 }}><DocumentIcon size={16} /> Planilla</Button>
          <Button variant={activeFilters > 0 ? 'primary' : 'secondary'} onClick={() => setShowFilters(!showFilters)} style={{ flex: 1 }}><FunnelIcon size={16} /> Filtros{activeFilters > 0 ? ` (${activeFilters})` : ''}</Button>
        </div>

        {showFilters && (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 8 }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Cómo pagó</label>
                <Opciones etiqueta="Cómo pagó" columnas={3} valor={filters.metodoPago} onChange={v => setFilters(f => ({ ...f, metodoPago: v }))}
                  opciones={[{ valor: '', etiqueta: 'Todos' }, { valor: 'efectivo', etiqueta: 'Efectivo' }, { valor: 'transferencia', etiqueta: 'Transferencia' }, { valor: 'tarjeta', etiqueta: 'Tarjeta' }, { valor: 'qr', etiqueta: 'QR' }]} /></div>
              <div><label style={{ fontSize: 14, color: 'var(--text-2)' }}>Cliente</label>
                <input className="campo" value={filters.cliente} onChange={e => setFilters(f => ({ ...f, cliente: e.target.value }))} style={inputStyle} placeholder="Buscar..." /></div>
              <div><label style={{ fontSize: 14, color: 'var(--text-2)' }}>Desde</label>
                <input className="campo" type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} style={inputStyle} /></div>
              <div><label style={{ fontSize: 14, color: 'var(--text-2)' }}>Hasta</label>
                <input className="campo" type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} style={inputStyle} /></div>
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
            const dayTotal = totalDia[day] ?? 0;
            return (
              <div key={day} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '.6px' }}>{day}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary-dark)' }}>{formatMoney(dayTotal)}</span>
                </div>
                {vs.map(v => <SaleCard key={v.id} venta={v} avisar={setAviso}
                  onAnulada={id => setVentas(xs => xs.map(x => x.id === id ? { ...x, anulada: true } : x))} />)}
              </div>
            );
          })
        )}
        {!loading && filtered.length > cuantas && (
          <Button variant="secondary" size="lg" fullWidth onClick={() => setCuantas(n => n + 60)}>
            Ver más ({filtered.length - cuantas} ventas más)
          </Button>
        )}
      </div>
    </IonContent>
  );
};

export default HistorialPage;

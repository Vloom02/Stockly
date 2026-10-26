// ═══════════════════════════════════════════════════════════════════════════
// Dashboard de ventas del día. Lee ventas_ventas + ventas_items de la base.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState, useMemo } from 'react';
import { IonContent, useIonViewWillEnter, useIonToast } from '@ionic/react';
import { ventasACSV, guardarCSV } from '../lib/exportar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../context/VentasContext';
import { Card, StatCard, SectionTitle, EmptyState, Skeleton } from '../components/ui';
import { ChartBarIcon, ArrowPathIcon } from '../components/ui/icons';

import BotonVolver from '../components/BotonVolver';
interface VentaRow { id: string; total: number; metodo_pago: string; cliente: string; fecha: string; }
interface ItemRow  { producto_id: string; cantidad: number; subtotal: number; }

const DashboardPage: React.FC = () => {
  const { comercio } = useAuth();
  const [ventas, setVentas]   = useState<VentaRow[]>([]);
  const [items, setItems]     = useState<ItemRow[]>([]);
  const [productos, setProds] = useState<Record<string, string>>({});
  const [prevTotal, setPrevTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [range, setRange]     = useState<'hoy' | 'semana'>('hoy');
  const [presentToast] = useIonToast();

  const exportarCSV = async () => {
    if (ventas.length === 0) return;
    const nombre = `ventas_${range}_${new Date().toISOString().slice(0, 10)}.csv`;
    const r = await guardarCSV(nombre, ventasACSV(ventas));
    presentToast({
      message: r === 'guardado' ? `Guardado en Documentos: ${nombre}` : r === 'descargado' ? 'Planilla descargada' : 'No se pudo exportar',
      duration: 2500, position: 'top', color: r === 'error' ? 'danger' : 'success',
    });
  };

  const load = async () => {
    if (!comercio) { setLoading(false); return; }
    setLoading(true);
    const inicio = new Date();
    if (range === 'hoy') inicio.setHours(0, 0, 0, 0);
    else inicio.setDate(inicio.getDate() - 7);
    // Inicio del período ANTERIOR (mismo largo) para la comparativa.
    const prevInicio = new Date(inicio);
    if (range === 'hoy') prevInicio.setDate(prevInicio.getDate() - 1);
    else prevInicio.setDate(prevInicio.getDate() - 7);

    // Traemos desde el período anterior y partimos en memoria (una sola query).
    const { data: vData } = await supabase
      .from('ventas_ventas').select('*')
      .eq('comercio_id', comercio.id)
      .gte('fecha', prevInicio.toISOString())
      .order('fecha', { ascending: false });

    const todas = (vData ?? []) as VentaRow[];
    const ventasList = todas.filter(v => new Date(v.fecha) >= inicio);
    const previas    = todas.filter(v => new Date(v.fecha) < inicio);
    setVentas(ventasList);
    setPrevTotal(previas.reduce((s, v) => s + v.total, 0));

    if (ventasList.length > 0) {
      const ids = ventasList.map(v => v.id);
      const { data: iData } = await supabase
        .from('ventas_items').select('producto_id, cantidad, subtotal')
        .in('venta_id', ids);
      setItems((iData ?? []) as ItemRow[]);

      const prodIds = [...new Set((iData ?? []).map(i => i.producto_id).filter(Boolean))];
      if (prodIds.length > 0) {
        const { data: pData } = await supabase
          .from('productos').select('id, nombre').in('id', prodIds);
        const map: Record<string, string> = {};
        for (const p of pData ?? []) map[p.id] = p.nombre;
        setProds(map);
      }
    } else {
      setItems([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [comercio, range]);
  // Refrescar al volver a la pestaña (puede haber ventas nuevas).
  useIonViewWillEnter(() => { load(); });

  const total = useMemo(() => ventas.reduce((s, v) => s + v.total, 0), [ventas]);
  const ticketProm = useMemo(() => ventas.length > 0 ? total / ventas.length : 0, [total, ventas.length]);

  // Variación vs período anterior (día anterior / semana anterior).
  const deltaPct = useMemo(() => {
    if (prevTotal <= 0) return null;
    return Math.round(((total - prevTotal) / prevTotal) * 100);
  }, [total, prevTotal]);

  // Serie para el gráfico de barras: por día (semana) o por turno (hoy).
  const serie = useMemo(() => {
    const lkey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (range === 'semana') {
      const dias: { label: string; value: number; key: string }[] = [];
      const base = new Date(); base.setHours(0, 0, 0, 0);
      const nombres = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(base); d.setDate(d.getDate() - i);
        dias.push({ key: lkey(d), label: nombres[d.getDay()], value: 0 });
      }
      const idx = new Map(dias.map((d, i) => [d.key, i]));
      for (const v of ventas) {
        const i = idx.get(lkey(new Date(v.fecha)));
        if (i !== undefined) dias[i].value += v.total;
      }
      return dias;
    }
    const turnos = [
      { key: 'm', label: 'Mañana', value: 0 },
      { key: 't', label: 'Tarde', value: 0 },
      { key: 'n', label: 'Noche', value: 0 },
    ];
    for (const v of ventas) {
      const h = new Date(v.fecha).getHours();
      const i = h >= 6 && h < 14 ? 0 : h >= 14 && h < 22 ? 1 : 2;
      turnos[i].value += v.total;
    }
    return turnos;
  }, [ventas, range]);

  const serieMax = useMemo(() => Math.max(1, ...serie.map(s => s.value)), [serie]);

  const porMetodo = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of ventas) m[v.metodo_pago] = (m[v.metodo_pago] ?? 0) + v.total;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [ventas]);

  const topProductos = useMemo(() => {
    const m: Record<string, { qty: number; total: number }> = {};
    for (const it of items) {
      if (!it.producto_id) continue;
      if (!m[it.producto_id]) m[it.producto_id] = { qty: 0, total: 0 };
      m[it.producto_id].qty += it.cantidad;
      m[it.producto_id].total += it.subtotal;
    }
    return Object.entries(m).map(([id, d]) => ({ id, ...d })).sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [items]);

  const metodoLabel = (k: string) => ({ efectivo: '💵 Efectivo', transferencia: '📱 Transferencia', tarjeta: '💳 Tarjeta', qr: '📲 QR' } as Record<string, string>)[k] ?? k;

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <BotonVolver />
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Resumen del día</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={exportarCSV} disabled={ventas.length === 0} aria-label="Exportar ventas a CSV" className="pressable"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: 'var(--text-2)', fontFamily: 'inherit', opacity: ventas.length === 0 ? 0.5 : 1 }}>
              ⬇ CSV
            </button>
            <button onClick={load} aria-label="Actualizar datos" className="pressable" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', padding: 8, cursor: 'pointer', display: 'flex' }}>
              <ArrowPathIcon size={16} color="var(--text-2)" />
            </button>
          </div>
        </div>

        {/* Range toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['hoy', 'semana'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              style={{ flex: 1, padding: 8, border: range === r ? '1.5px solid var(--color-primary)' : '1px solid var(--border)', borderRadius: 'var(--radius)', background: range === r ? 'var(--color-primary-bg)' : 'var(--surface)', color: range === r ? 'var(--color-primary-dark)' : 'var(--text-2)', cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'inherit' }}>
              {r === 'hoy' ? 'Hoy' : 'Últimos 7 días'}
            </button>
          ))}
        </div>

        {loading ? (
          <><Skeleton height={70} style={{ marginBottom: 8 }} /><Skeleton height={120} style={{ marginBottom: 8 }} /><Skeleton height={120} /></>
        ) : ventas.length === 0 ? (
          <EmptyState icon={<ChartBarIcon size={44} color="var(--text-3)" />} title="Sin ventas todavía" description={range === 'hoy' ? 'No hubo ventas hoy' : 'No hubo ventas esta semana'} />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
              <StatCard label="Ventas" value={ventas.length} />
              <StatCard label="Total" value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 15 }}>{formatMoney(total)}</span>} color="var(--color-primary-dark)" />
              <StatCard label="Ticket prom." value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 15 }}>{formatMoney(ticketProm)}</span>} />
            </div>

            {/* Comparativa vs período anterior */}
            {deltaPct !== null && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '10px 12px',
                borderRadius: 'var(--radius)', background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 13,
              }}>
                <span style={{
                  fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: deltaPct >= 0 ? 'var(--color-primary-dark)' : 'var(--color-danger)',
                }}>
                  {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct)}%
                </span>
                <span style={{ color: 'var(--text-2)' }}>
                  vs {range === 'hoy' ? 'ayer' : 'la semana anterior'} ({formatMoney(prevTotal)})
                </span>
              </div>
            )}

            {/* Gráfico de barras */}
            <Card style={{ marginBottom: 14 }}>
              <SectionTitle>{range === 'semana' ? 'Ventas por día' : 'Ventas por turno'}</SectionTitle>
              <div
                role="img"
                aria-label={`${range === 'semana' ? 'Ventas por día' : 'Ventas por turno'}: ` + serie.map(s => `${s.label} ${formatMoney(s.value)}`).join(', ')}
                style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 10 }}>
                {serie.map(s => {
                  const h = Math.round((s.value / serieMax) * 88);
                  const compact = s.value >= 1000 ? `${Math.round(s.value / 1000)}k` : (s.value > 0 ? String(Math.round(s.value)) : '');
                  return (
                    <div key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', height: 12 }}>{compact}</div>
                      <div style={{ width: '100%', height: 88, display: 'flex', alignItems: 'flex-end' }}>
                        <div style={{ width: '100%', height: Math.max(2, h), background: s.value > 0 ? 'var(--color-primary)' : 'var(--surface-3)', borderRadius: '4px 4px 0 0', transition: 'height .4s' }} />
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{s.label}</div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Por método */}
            <Card style={{ marginBottom: 14 }}>
              <SectionTitle>Por método de pago</SectionTitle>
              {porMetodo.map(([k, v]) => {
                const pct = Math.round((v / total) * 100);
                return (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>{metodoLabel(k)}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatMoney(v)} <span style={{ color: 'var(--text-3)' }}>({pct}%)</span></span>
                    </div>
                    <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary)', borderRadius: 'var(--radius-full)', transition: 'width .4s' }} />
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* Top productos */}
            <Card>
              <SectionTitle>Top 5 productos</SectionTitle>
              {topProductos.length === 0 ? (
                <div style={{ color: 'var(--text-2)', fontSize: 13, padding: 12, textAlign: 'center' }}>Sin datos</div>
              ) : topProductos.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < topProductos.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
                    <div style={{ fontSize: 14, marginLeft: 10 }}>{productos[p.id] ?? '—'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{p.qty} u.</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary-dark)', fontFamily: 'var(--font-mono)' }}>{formatMoney(p.total)}</span>
                  </div>
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </IonContent>
  );
};

export default DashboardPage;

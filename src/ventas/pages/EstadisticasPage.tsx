// ═══════════════════════════════════════════════════════════════════════════
// Estadísticas (dueño): top productos vendidos y ventas por hora, últimos 30
// días. Agrega en el cliente (un almacén ronda cientos de ventas/mes).
// ponytail: cap de 2000 ventas por consulta; si un comercio supera eso, pasar
// la agregación a una RPC en el server.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { IonContent } from '@ionic/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../context/VentasContext';
import { Card, EmptyState, Skeleton } from '../components/ui';
import { ChartBarIcon } from '../components/ui/icons';

import BotonVolver from '../components/BotonVolver';
interface TopProducto { nombre: string; cantidad: number; plata: number; }

const EstadisticasPage: React.FC = () => {
  const { comercio } = useAuth();
  const [loading, setLoading] = useState(true);
  const [top, setTop] = useState<TopProducto[]>([]);
  const [porHora, setPorHora] = useState<number[]>([]);
  const [totales, setTotales] = useState({ ventas: 0, plata: 0 });

  useEffect(() => {
    if (!comercio) return;
    (async () => {
      setLoading(true);
      try {
        const desde = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: ventas } = await supabase.from('ventas_ventas')
          .select('id, fecha, total')
          .eq('comercio_id', comercio.id).eq('anulada', false)
          .gte('fecha', desde).limit(2000);
        const vs = ventas ?? [];
        setTotales({ ventas: vs.length, plata: vs.reduce((s, v) => s + Number(v.total), 0) });

        // Ventas por hora del día (0-23)
        const horas = Array(24).fill(0) as number[];
        for (const v of vs) horas[new Date(v.fecha).getHours()]++;
        setPorHora(horas);

        // Top productos (items de esas ventas)
        const ids = vs.map(v => v.id);
        const agg = new Map<string, TopProducto>();
        // in() con listas grandes falla: pedir de a 200 ids.
        for (let i = 0; i < ids.length; i += 200) {
          const { data: items } = await supabase.from('ventas_items')
            .select('nombre_producto, cantidad, subtotal')
            .in('venta_id', ids.slice(i, i + 200));
          for (const it of items ?? []) {
            const e = agg.get(it.nombre_producto) ?? { nombre: it.nombre_producto, cantidad: 0, plata: 0 };
            e.cantidad += it.cantidad;
            e.plata += Number(it.subtotal);
            agg.set(it.nombre_producto, e);
          }
        }
        setTop(Array.from(agg.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10));
      } catch { /* sin conexión: queda vacío */ }
      setLoading(false);
    })();
  }, [comercio]);

  const maxHora = Math.max(1, ...porHora);
  const maxCant = Math.max(1, ...top.map(t => t.cantidad));

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <BotonVolver />
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Lo más vendido</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>Últimos 30 días (necesita conexión)</p>

        {loading ? (
          <><Skeleton height={80} style={{ marginBottom: 8 }} /><Skeleton height={200} /></>
        ) : totales.ventas === 0 ? (
          <EmptyState icon={<ChartBarIcon size={44} color="var(--text-3)" />} title="Sin ventas este mes"
            description="Cuando registres ventas vas a ver acá los números." />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
              <Card variant="bordered" style={{ padding: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Ventas</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{totales.ventas}</div>
              </Card>
              <Card variant="bordered" style={{ padding: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Facturado</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', paddingTop: 2 }}>{formatMoney(totales.plata)}</div>
              </Card>
            </div>

            <h2 style={{ fontSize: 15, fontWeight: 700, margin: '18px 0 8px' }}>🏆 Más vendidos</h2>
            <Card variant="bordered" style={{ padding: '10px 14px' }}>
              {top.map((t, i) => (
                <div key={t.nombre} style={{ padding: '6px 0', borderBottom: i < top.length - 1 ? '1px dashed var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <b style={{ color: 'var(--text-3)', marginRight: 6 }}>{i + 1}.</b>{t.nombre}
                    </span>
                    <span style={{ flexShrink: 0, color: 'var(--text-2)' }}>
                      {t.cantidad} u · <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{formatMoney(t.plata)}</b>
                    </span>
                  </div>
                  <div style={{ height: 5, background: 'var(--surface-2, var(--border))', borderRadius: 3 }}>
                    <div style={{ height: 5, width: `${(t.cantidad / maxCant) * 100}%`, background: 'var(--color-primary)', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </Card>

            <h2 style={{ fontSize: 15, fontWeight: 700, margin: '18px 0 8px' }}>🕐 Horas pico</h2>
            <Card variant="bordered" style={{ padding: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
                {porHora.map((n, h) => (
                  <div key={h} title={`${h}:00 — ${n} venta${n !== 1 ? 's' : ''}`}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                    <div style={{
                      height: `${(n / maxHora) * 100}%`, minHeight: n > 0 ? 3 : 0,
                      background: n === maxHora ? 'var(--color-primary)' : 'var(--color-primary-bg, var(--border))',
                      borderRadius: 2,
                    }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>
                <span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span>
              </div>
            </Card>
          </>
        )}
      </div>
    </IonContent>
  );
};

export default EstadisticasPage;

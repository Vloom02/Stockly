// ═══════════════════════════════════════════════════════════════════════════
// Estadísticas (dueño): top productos vendidos y ventas por hora, últimos 30 días.
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
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!comercio) return;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        // Sumado en el servidor (migración 19): antes bajaba todas las ventas y renglones del mes, en más de 40 pedidos.
        const { data, error: err } = await supabase.rpc('estadisticas_ventas', { p_comercio: comercio.id, p_dias: 30 });
        if (err) throw err;
        const r = data as { ventas: number; plata: number; por_hora: number[]; top: TopProducto[] };
        setTotales({ ventas: Number(r.ventas), plata: Number(r.plata) });
        setPorHora(r.por_hora.map(Number));
        setTop(r.top.map(t => ({ nombre: t.nombre, cantidad: Number(t.cantidad), plata: Number(t.plata) })));
      } catch { setError(true); } // antes decía "Sin ventas este mes" aunque hubiera
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
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 14 }}>Últimos 30 días (necesita conexión)</p>

        {loading ? (
          <><Skeleton height={80} style={{ marginBottom: 8 }} /><Skeleton height={200} /></>
        ) : error ? (
          <EmptyState icon={<ChartBarIcon size={44} color="var(--text-3)" />} title="No se pudieron traer los números"
            description="Hace falta internet. Probá de nuevo en un rato: no se borró nada." />
        ) : totales.ventas === 0 ? (
          <EmptyState icon={<ChartBarIcon size={44} color="var(--text-3)" />} title="Sin ventas este mes"
            description="Cuando registres ventas vas a ver acá los números." />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
              <Card variant="bordered" style={{ padding: 10 }}>
                <div style={{ fontSize: 14, color: 'var(--text-2)' }}>Ventas</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{totales.ventas}</div>
              </Card>
              <Card variant="bordered" style={{ padding: 10 }}>
                <div style={{ fontSize: 14, color: 'var(--text-2)' }}>Facturado</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', paddingTop: 2 }}>{formatMoney(totales.plata)}</div>
              </Card>
            </div>

            <h2 style={{ fontSize: 15, fontWeight: 700, margin: '18px 0 8px' }}>Más vendidos</h2>
            <Card variant="bordered" style={{ padding: '10px 14px' }}>
              {top.map((t, i) => (
                <div key={t.nombre} style={{ padding: '6px 0', borderBottom: i < top.length - 1 ? '1px dashed var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 3 }}>
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

            <h2 style={{ fontSize: 15, fontWeight: 700, margin: '18px 0 8px' }}>Horas pico</h2>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-3)', marginTop: 6 }}>
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

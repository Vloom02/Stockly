import React, { useMemo } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  BuildingStorefrontIcon, ChevronRightIcon,
  PlusCircleIcon, ArchiveBoxIcon,
  CheckCircleIcon, ChartBarSquareIcon,
} from '@heroicons/react/24/outline';
import {
  useStore, formatearMoneda, formatearFecha, textoEstado,
  colorNivel, etiquetaNivel, ordenNivel, descuentoConfig,
} from '../context/StoreContext';
import { sugerirLiquidacion } from '../lib/liquidacion';
import { LoteConProducto, NivelAlerta } from '../types';
import Card from '../components/ui/Card';
import { NivelBadge } from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import Logo from '../components/ui/Logo';
import DonutChart from '../components/ui/DonutChart';
import { SkeletonDashboard } from '../components/ui/Skeleton';
import SyncBanner from '../components/SyncBanner';

// Paleta cálida editorial para la dona de categorías
const PALETA = ['#d8a43e', '#4fa89e', '#d07a4a', '#9aa84f', '#c46a8e', '#5b8fb0', '#cf5d4e', '#8a7bbd'];

const DashboardPage: React.FC = () => {
  const { state, resumen, lotesEnriquecidos, distribucionPorCategoria } = useStore();
  const history = useHistory();

  const res = useMemo(() => resumen(), [resumen]);
  const lotes = useMemo(() => lotesEnriquecidos(), [lotesEnriquecidos]);
  const distribucion = useMemo(() => distribucionPorCategoria(), [distribucionPorCategoria]);

  const enRiesgo = useMemo(() => {
    return lotes
      .filter(l => l.nivelAlerta !== 'ok')
      .sort((a, b) => {
        const dn = ordenNivel(a.nivelAlerta) - ordenNivel(b.nivelAlerta);
        if (dn !== 0) return dn;
        return a.fechaVencimiento.localeCompare(b.fechaVencimiento);
      })
      .slice(0, 6);
  }, [lotes]);

  const segmentos = useMemo(() =>
    distribucion.slice(0, 8).map((d, i) => ({
      label: d.categoria, valor: d.valor, color: PALETA[i % PALETA.length],
    })), [distribucion]);

  const sucursalActiva = state.sucursales.find(s => s.id === state.sucursalActivaId);
  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

  if (!state.loaded) {
    return (
      <IonPage>
        <IonContent style={{ '--background': 'var(--bg)' } as any}>
          <SkeletonDashboard />
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as any}>
        <div className="animate-fade-in" style={{
          padding: '20px 16px calc(96px + env(safe-area-inset-bottom)) 16px',
          maxWidth: 760, margin: '0 auto',
        }}>

          {/* ─── Masthead (header editorial) ──────────────────────────── */}
          <header style={{ position: 'relative', borderBottom: '3px double var(--text)', paddingBottom: 12, marginBottom: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
              fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'var(--text-2)', fontWeight: 600,
            }}>
              <span>Control de vencimientos</span>
              <button type="button" onClick={() => history.push('/sucursales')}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-full)', padding: '5px 10px 5px 9px',
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 600, color: 'var(--text)', letterSpacing: 0,
                  textTransform: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                <BuildingStorefrontIcon width={13} height={13} />
                {sucursalActiva?.nombre || '...'}
                <ChevronRightIcon width={11} height={11} style={{ color: 'var(--text-3)' }} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 0' }}>
              <Logo size={34} showText />
              <span style={{
                transform: 'rotate(-8deg)', border: '2px solid var(--level-ok-fg)', color: 'var(--level-ok-fg)',
                borderRadius: 5, padding: '3px 8px', textAlign: 'center', opacity: 0.9, lineHeight: 1,
                fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, letterSpacing: '0.03em',
              }}>AL DÍA</span>
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-2)',
              borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 8, letterSpacing: '0.03em',
            }}>
              <span>Libro de almacén</span>
              <span style={{ textTransform: 'capitalize' }}>{hoy}</span>
            </div>
          </header>

          <SyncBanner />

          {/* ─── BENTO GRID (misma ubicación, look libro) ─────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>

            {/* Hero: valor inventario (2x2) — tarjeta editorial */}
            <div style={{
              gridColumn: 'span 2', gridRow: 'span 2', position: 'relative',
              background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: 18,
              border: '1.5px solid var(--text)', boxShadow: 'var(--shadow-md)',
            }}>
              <div style={{ position: 'absolute', inset: 4, border: '1px solid var(--border)', borderRadius: 'calc(var(--radius-lg) - 4px)', pointerEvents: 'none' }} />
              <div style={{ position: 'relative' }}>
                <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-2)', fontWeight: 700 }}>Valor del inventario</span>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, margin: '6px 0 14px', letterSpacing: '-0.02em', lineHeight: 1.05, color: 'var(--text)' }}>
                  {formatearMoneda(res.valorTotal)}
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
                  <LedgerStat n={res.productosTotales} l="Productos" />
                  <LedgerStat n={res.lotesTotales} l="Lotes" />
                  <LedgerStat n={res.unidadesTotales} l="Unidades" />
                </div>
              </div>
            </div>

            {/* En riesgo (2x1) */}
            <div style={{
              gridColumn: 'span 2', background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
              padding: 16, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--level-vencido-fg)', fontWeight: 700, marginBottom: 10 }}>
                ● Valor en riesgo
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>Vencido</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--level-vencido-fg)' }}>
                    {formatearMoneda(res.valorVencido)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>En peligro</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--level-urgente-fg)' }}>
                    {formatearMoneda(res.valorEnRiesgo)}
                  </div>
                </div>
              </div>
            </div>

            <NivelChip nivel="vencido" cantidad={res.lotesVencidos} />
            <NivelChip nivel="critico" cantidad={res.lotesCriticos} />
          </div>

          {/* ─── Fila de niveles restantes ────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            <NivelChip nivel="urgente" cantidad={res.lotesUrgentes} />
            <NivelChip nivel="aviso" cantidad={res.lotesAviso} />
            <NivelChip nivel="ok" cantidad={res.lotesOk} />
          </div>

          {/* ─── Acciones rápidas ─────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
            <AccionCard icon={<PlusCircleIcon width={22} height={22} />} label="Nuevo lote" onClick={() => history.push('/lote/nuevo')} />
            <AccionCard icon={<ArchiveBoxIcon width={22} height={22} />} label="Ver stock" onClick={() => history.push('/stock')} />
            <AccionCard icon={<ChartBarSquareIcon width={22} height={22} />} label="Reportes" onClick={() => history.push('/reportes')} />
          </div>

          {/* ─── Atención inmediata ───────────────────────────────────── */}
          {enRiesgo.length > 0 ? (
            <>
              <SecHeader title="Atención inmediata" tag="FEFO" onAction={() => history.push('/stock')} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {enRiesgo.map(l => (
                  <LoteListItem key={l.id} lote={l} onClick={() => history.push(`/lote/${l.id}`)} />
                ))}
              </div>
            </>
          ) : state.productos.length > 0 ? (
            <Card padding="md" style={{ borderColor: 'var(--level-ok-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 'var(--radius)', background: 'var(--level-ok-bg)', color: 'var(--level-ok-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircleIcon width={24} height={24} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-display)' }}>Todo en orden</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>No hay productos próximos a vencer</div>
                </div>
              </div>
            </Card>
          ) : (
            <EmptyState
              icon={<ArchiveBoxIcon width={32} height={32} />}
              title="Tu stock está vacío"
              description="Empezá creando tu primer producto y cargá lotes con sus fechas de vencimiento."
              action={
                <Button variant="primary" size="md" onClick={() => history.push('/producto/nuevo')} icon={<PlusCircleIcon width={18} height={18} />}>
                  Crear primer producto
                </Button>
              }
            />
          )}

          {/* ─── Valor por categoría (dona) ───────────────────────────── */}
          {distribucion.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <SecHeader title="Valor por categoría" />
              <Card padding="md">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                  <DonutChart segmentos={segmentos} size={132} grosor={20}
                    centroValor={formatearMoneda(res.valorTotal)} centroLabel="Total" />
                  <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {distribucion.slice(0, 6).map((d, i) => {
                      const pct = res.valorTotal > 0 ? Math.round((d.valor / res.valorTotal) * 100) : 0;
                      return (
                        <div key={d.categoria} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
                          <span style={{ width: 11, height: 11, borderRadius: 3, background: PALETA[i % PALETA.length], flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.categoria}</span>
                          <b style={{ marginLeft: 'auto', color: 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{formatearMoneda(d.valor)}</b>
                          <i style={{ fontStyle: 'normal', color: 'var(--text-3)', fontSize: 11, minWidth: 32, textAlign: 'right' }}>{pct}%</i>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

// ─── Subcomponentes ─────────────────────────────────────────────────────

const LedgerStat: React.FC<{ n: number; l: string }> = ({ n, l }) => (
  <div>
    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
    <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{n}</div>
  </div>
);

const SecHeader: React.FC<{ title: string; tag?: string; onAction?: () => void }> = ({ title, tag, onAction }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
    <h2 style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 700, fontSize: 19, margin: 0, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{title}</h2>
    <span style={{ flex: 1, height: 0, borderTop: '1px solid var(--border)' }} />
    {tag && <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 9px' }}>{tag}</span>}
    {onAction && (
      <button type="button" onClick={onAction} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--brand-600)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2, fontFamily: 'inherit', padding: 0 }}>
        Ver todo <ChevronRightIcon width={14} height={14} />
      </button>
    )}
  </div>
);

const NivelChip: React.FC<{ nivel: NivelAlerta; cantidad: number }> = ({ nivel, cantidad }) => (
  <div style={{
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)', padding: '14px 6px', textAlign: 'center',
    boxShadow: 'var(--shadow-sm)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  }}>
    <div style={{ width: 9, height: 9, borderRadius: '50%', background: `var(--level-${nivel}-fg)`, marginBottom: 5, boxShadow: `0 0 0 3px var(--level-${nivel}-bg)` }} />
    <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>{cantidad}</div>
    <div style={{ fontSize: 9, color: 'var(--text-2)', marginTop: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{etiquetaNivel(nivel)}</div>
  </div>
);

const AccionCard: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> =
  ({ icon, label, onClick }) => (
    <button type="button" onClick={onClick}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '16px 8px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit',
        fontWeight: 600, fontSize: 12, letterSpacing: '-0.005em',
        boxShadow: 'var(--shadow-sm)', transition: 'all 150ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brand-300)'; e.currentTarget.style.color = 'var(--brand-700)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)'; }}
    >
      <span style={{ color: 'var(--brand-600)' }}>{icon}</span>
      {label}
    </button>
  );

export const LoteListItem: React.FC<{ lote: LoteConProducto; onClick: () => void }> = ({ lote, onClick }) => {
  const liq = sugerirLiquidacion(lote.nivelAlerta, lote.productoPrecio, descuentoConfig());
  return (
  <Card padding="sm" onClick={onClick}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', background: colorNivel(lote.nivelAlerta), flexShrink: 0, boxShadow: '0 0 0 3px var(--surface-2)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
          {lote.productoNombre}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
          <span>{lote.cantidad} unid.</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-3)' }} />
          <span>{lote.productoCategoria}</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <NivelBadge nivel={lote.nivelAlerta} />
          <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 500 }}>
            {textoEstado(lote.fechaVencimiento)}
          </span>
          {liq.aplicar && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--level-ok-fg)', border: '1px solid var(--level-ok-border)', borderRadius: 'var(--radius-full)', padding: '1px 8px', whiteSpace: 'nowrap' }}>
              💸 Liquidar {formatearMoneda(liq.precioFinal)} −{liq.pct}%
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.011em' }}>
          {formatearFecha(lote.fechaVencimiento)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
          {formatearMoneda(lote.valorLote)}
        </div>
      </div>
    </div>
  </Card>
  );
};

export default DashboardPage;

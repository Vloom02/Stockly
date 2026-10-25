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
import { SkeletonDashboard } from '../components/ui/Skeleton';
import SyncBanner from '../components/SyncBanner';

import { useContador } from '../lib/useContador';
const DashboardPage: React.FC = () => {
  const { state, resumen, lotesEnriquecidos, productosConLotes } = useStore();
  const history = useHistory();

  const res = useMemo(() => resumen(), [resumen]);
  const valorAnimado = useContador(res.valorTotal); // el valor "cuenta" al abrir
  const lotes = useMemo(() => lotesEnriquecidos(), [lotesEnriquecidos]);

  // Productos por debajo de su stock mínimo (alerta de reposición).
  const paraReponer = useMemo(() =>
    productosConLotes()
      .filter(p => (p.producto.stockMinimo ?? 0) > 0 && p.cantidadTotal < (p.producto.stockMinimo ?? 0))
      .sort((a, b) => a.cantidadTotal - b.cantidadTotal)
      .slice(0, 5),
  [productosConLotes]);

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
          padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px',
          maxWidth: 760, margin: '0 auto',
        }}>

          {/* ─── Masthead (header editorial) ──────────────────────────── */}
          <header style={{ position: 'relative', borderBottom: '3px double var(--text)', paddingBottom: 12, marginBottom: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
              fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase',
              color: 'var(--text-2)', fontWeight: 600,
            }}>
              <span>Control de vencimientos</span>
              <button type="button" onClick={() => history.push('/sucursales')}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-full)', padding: '5px 10px 5px 9px',
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: 0,
                  textTransform: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                <BuildingStorefrontIcon width={13} height={13} />
                {sucursalActiva?.nombre || '...'}
                <ChevronRightIcon width={11} height={11} style={{ color: 'var(--text-3)' }} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 0' }}>
              <Logo size={34} showText />
              {(() => {
                // Sello dinámico: refleja el estado real del stock (antes decía
                // siempre "AL DÍA" aunque hubiera vencidos → engañaba).
                const nivelSello = res.lotesVencidos > 0
                  ? { txt: `${res.lotesVencidos} VENCIDO${res.lotesVencidos > 1 ? 'S' : ''}`, color: 'var(--level-vencido-fg)' }
                  : (res.lotesCriticos + res.lotesUrgentes) > 0
                    ? { txt: 'REVISAR', color: 'var(--level-urgente-fg)' }
                    : { txt: 'AL DÍA', color: 'var(--level-ok-fg)' };
                return (
                  <span style={{
                    transform: 'rotate(-8deg)', border: `2px solid ${nivelSello.color}`, color: nivelSello.color,
                    borderRadius: 5, padding: '3px 8px', textAlign: 'center', opacity: 0.9, lineHeight: 1,
                    fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, letterSpacing: '0.03em',
                  }}>{nivelSello.txt}</span>
                );
              })()}
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)',
              borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 8, letterSpacing: '0.03em',
            }}>
              <span>Libro de almacén</span>
              <span style={{ textTransform: 'capitalize' }}>{hoy}</span>
            </div>
          </header>

          <SyncBanner />
          <AvisoDeHoy vencidos={res.lotesVencidos} pronto={res.lotesCriticos + res.lotesUrgentes}
            onVer={(nivel) => history.push(`/stock?nivel=${nivel}&vista=lotes`)} />

          {/* ─── BENTO GRID (misma ubicación, look libro) ─────────────── */}
          <div className="lista-animada" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>

            {/* Hero: valor inventario (2x2) — tarjeta editorial */}
            <div style={{
              gridColumn: 'span 2', gridRow: 'span 2', position: 'relative',
              background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: 18,
              border: '1.5px solid var(--text)', boxShadow: 'var(--shadow-md)',
            }}>
              <div style={{ position: 'absolute', inset: 4, border: '1px solid var(--border)', borderRadius: 'calc(var(--radius-lg) - 4px)', pointerEvents: 'none' }} />
              <div style={{ position: 'relative' }}>
                <span style={{ fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-2)', fontWeight: 700 }}>Valor del inventario</span>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 6.5vw, 30px)', fontWeight: 800, margin: '6px 0 14px', letterSpacing: '-0.02em', lineHeight: 1.05, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {formatearMoneda(valorAnimado)}
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
                  <LedgerStat n={res.productosTotales} l="Productos" />
                  <LedgerStat n={res.lotesTotales} l="Compras" />
                  <LedgerStat n={res.unidadesTotales} l="Unidades" />
                </div>
              </div>
            </div>

            {/* En riesgo (2x1) */}
            <div style={{
              gridColumn: 'span 2', background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
              padding: 16, border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--level-vencido-fg)', fontWeight: 700, marginBottom: 10 }}>
                ● Valor en riesgo
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Vencido</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--level-vencido-fg)' }}>
                    {formatearMoneda(res.valorVencido)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>En peligro</div>
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
          <div className="lista-animada" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            <NivelChip nivel="urgente" cantidad={res.lotesUrgentes} />
            <NivelChip nivel="aviso" cantidad={res.lotesAviso} />
            <NivelChip nivel="ok" cantidad={res.lotesOk} />
          </div>

          {/* ─── Acciones rápidas ─────────────────────────────────────── */}
          <div className="lista-animada" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
            <AccionCard icon={<PlusCircleIcon width={22} height={22} />} label="Nuevo lote" onClick={() => history.push('/lote/nuevo')} />
            <AccionCard icon={<ArchiveBoxIcon width={22} height={22} />} label="Ver stock" onClick={() => history.push('/stock')} />
            <AccionCard icon={<ChartBarSquareIcon width={22} height={22} />} label="Reportes" onClick={() => history.push('/reportes')} />
          </div>

          {/* ─── Atención inmediata ───────────────────────────────────── */}
          {enRiesgo.length > 0 ? (
            <>
              <SecHeader title="Atención inmediata" tag="Vendé esto primero" onAction={() => history.push('/stock')} />
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
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>No hay productos próximos a vencer</div>
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

          {/* ─── Para reponer (stock mínimo) ──────────────────────────── */}
          {paraReponer.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <SecHeader title="Para reponer" tag={`${paraReponer.length}`} onAction={() => history.push('/pedido')} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {paraReponer.map(p => (
                  <Card key={p.producto.id} padding="sm" onClick={() => history.push(`/producto/${p.producto.id}`)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 18, flexShrink: 0 }}>📦</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.producto.nombre}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                          Quedan <b style={{ color: 'var(--warning)' }}>{p.cantidadTotal}</b> · mínimo {p.producto.stockMinimo}
                          {p.producto.proveedor ? ` · ${p.producto.proveedor}` : ''}
                        </div>
                      </div>
                      <ChevronRightIcon width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* El desglose por categoría (dona) vive en Reportes: el Dashboard
              queda enfocado en lo accionable (vencimientos + reposición). */}
        </div>
      </IonContent>
    </IonPage>
  );
};

// ─── Subcomponentes ─────────────────────────────────────────────────────

const LedgerStat: React.FC<{ n: number; l: string }> = ({ n, l }) => (
  <div>
    <div style={{ fontSize: 13, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
    <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{n}</div>
  </div>
);

const SecHeader: React.FC<{ title: string; tag?: string; onAction?: () => void }> = ({ title, tag, onAction }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
    <h2 style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 700, fontSize: 19, margin: 0, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{title}</h2>
    <span style={{ flex: 1, height: 0, borderTop: '1px solid var(--border)' }} />
    {tag && <span style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 9px' }}>{tag}</span>}
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
    <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{etiquetaNivel(nivel)}</div>
  </div>
);

// Tarjeta "¿qué hago hoy?": un mensaje, un color y un botón. Pensada para leer de un vistazo.
const AvisoDeHoy: React.FC<{ vencidos: number; pronto: number; onVer: (nivel: 'vencido' | 'pronto') => void }> =
  ({ vencidos, pronto, onVer }) => {
    const caso = vencidos > 0
      ? { nivel: 'vencido' as const, fg: 'var(--level-vencido-fg)', bg: 'var(--level-vencido-bg)',
          titulo: `${vencidos} ${vencidos === 1 ? 'producto vencido' : 'productos vencidos'}`,
          texto: 'Sacalos de la góndola y anotalos como vencidos.', boton: 'Ver cuáles son' }
      : pronto > 0
        ? { nivel: 'pronto' as const, fg: 'var(--level-urgente-fg)', bg: 'var(--level-urgente-bg)',
            titulo: `${pronto} ${pronto === 1 ? 'producto vence' : 'productos vencen'} pronto`,
            texto: 'Vendelos primero o ponelos en oferta.', boton: 'Ver cuáles son' }
        : null;
    if (!caso) {
      return (
        <div role="status" style={{ background: 'var(--level-ok-bg)', color: 'var(--level-ok-fg)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16, fontSize: 18, fontWeight: 700 }}>
          Todo en orden: no hay nada por vencer.
        </div>
      );
    }
    return (
      <div role="alert" className="anim-pop" style={{ background: caso.bg, borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16, border: `2px solid ${caso.fg}` }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: caso.fg, lineHeight: 1.2 }}>{caso.titulo}</div>
        <div style={{ fontSize: 17, color: 'var(--text)', margin: '6px 0 12px' }}>{caso.texto}</div>
        <button type="button" className="anim-atencion pressable" onClick={() => onVer(caso.nivel)}
          style={{ width: '100%', minHeight: 52, borderRadius: 'var(--radius)', border: 'none', background: caso.fg, color: 'var(--bg)', fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {caso.boton}
        </button>
      </div>
    );
  };

const AccionCard: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> =
  ({ icon, label, onClick }) => (
    <button type="button" onClick={onClick}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '16px 8px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit',
        fontWeight: 600, fontSize: 13, letterSpacing: '-0.005em',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
          <span>{lote.cantidad} unid.</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-3)' }} />
          <span>{lote.productoCategoria}</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <NivelBadge nivel={lote.nivelAlerta} />
          <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>
            {textoEstado(lote.fechaVencimiento)}
          </span>
          {liq.aplicar && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--level-ok-fg)', border: '1px solid var(--level-ok-border)', borderRadius: 'var(--radius-full)', padding: '1px 8px', whiteSpace: 'nowrap' }}>
              💸 Liquidar {formatearMoneda(liq.precioFinal)} −{liq.pct}%
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.011em' }}>
          {formatearFecha(lote.fechaVencimiento)}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
          {formatearMoneda(lote.valorLote)}
        </div>
      </div>
    </div>
  </Card>
  );
};

export default DashboardPage;

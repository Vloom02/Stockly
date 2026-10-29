import React, { useEffect, useMemo, useState } from 'react';
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
import { useAuth } from '../context/AuthContext';
import { ExclamationTriangleIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { buscarActualizacion, Actualizacion } from '../lib/actualizacion';
import { CubeIcon as IcoCubeIcon } from '@heroicons/react/24/outline';
const DashboardPage: React.FC = () => {
  const { state, resumen, lotesEnriquecidos, productosConLotes } = useStore();
  const history = useHistory();
  const { esDueno } = useAuth();
  const [nueva, setNueva] = useState<Actualizacion | null>(null);
  useEffect(() => { buscarActualizacion().then(setNueva); }, []);

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

          {/* ─── Encabezado "Tacto": fecha, local y cómo está el stock ─── */}
          <header style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-2)', textTransform: 'capitalize' }}>{hoy}</span>
              <button type="button" onClick={() => history.push('/sucursales')} className="boton-blanco"
                style={{
                  border: 'none', borderRadius: 'var(--radius-full)', padding: '8px 12px 8px 10px', minHeight: 44,
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                <BuildingStorefrontIcon width={17} height={17} />
                {sucursalActiva?.nombre || '...'}
                <ChevronRightIcon width={13} height={13} style={{ color: 'var(--text-3)' }} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Logo size={38} showText />
              {(() => {
                // Estado real del stock en un chip (antes un sello torcido estilo libro).
                const estado = res.lotesVencidos > 0
                  ? { txt: `${res.lotesVencidos} vencido${res.lotesVencidos > 1 ? 's' : ''}`, nivel: 'vencido' }
                  : (res.lotesCriticos + res.lotesUrgentes) > 0
                    ? { txt: 'Revisar', nivel: 'urgente' }
                    : { txt: 'Al día', nivel: 'ok' };
                return (
                  <span key={estado.txt} className="anim-pop" style={{
                    background: `var(--level-${estado.nivel}-bg)`, color: `var(--level-${estado.nivel}-fg)`,
                    borderRadius: 'var(--radius-full)', padding: '7px 14px', fontWeight: 800, fontSize: 15,
                  }}>{estado.txt}</span>
                );
              })()}
            </div>
          </header>

          <SyncBanner />
          <AvisoDeHoy vencidos={res.lotesVencidos} pronto={res.lotesCriticos + res.lotesUrgentes}
            onVer={(nivel) => history.push(`/stock?nivel=${nivel}&vista=lotes`)} />

          {/* Versión nueva publicada: se baja con el navegador y Android la instala encima */}
          {esDueno && nueva && (
            <button type="button" onClick={() => { window.location.href = nueva.url; }} className="pressable tarjeta-tocable anim-bajar"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: 16, marginBottom: 16,
                border: 'none', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontFamily: 'inherit',
                background: 'var(--marca-suave)', color: 'var(--marca-texto)',
              }}>
              <ArrowDownTrayIcon width={28} height={28} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 18, fontWeight: 800 }}>Hay una versión nueva de Stockly ({nueva.version})</span>
                <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>Tocá para bajarla. Después abrila desde Descargas para instalarla.</span>
              </span>
            </button>
          )}

          {/* Vendido sin stock: lo ve el dueño para saber si se vende sin cargar la mercadería */}
          {esDueno && res.productosEnNegativo > 0 && (
            <button type="button" onClick={() => history.push('/stock?nivel=negativo')} className="pressable tarjeta-tocable anim-bajar"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: 16, marginBottom: 16,
                border: 'none', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontFamily: 'inherit',
                background: 'var(--level-vencido-bg)', color: 'var(--level-vencido-fg)',
              }}>
              <ExclamationTriangleIcon width={28} height={28} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 18, fontWeight: 800 }}>
                  {res.productosEnNegativo === 1 ? '1 producto se vendió' : `${res.productosEnNegativo} productos se vendieron`} sin stock
                </span>
                <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>
                  Faltan {res.unidadesFaltantes} unid. Se descuentan solas cuando cargues mercadería. Tocá para ver cuáles.
                </span>
              </span>
              <ChevronRightIcon width={20} height={20} style={{ flexShrink: 0 }} />
            </button>
          )}

          {/* ─── BENTO GRID (misma ubicación, look libro) ─────────────── */}
          <div className="lista-animada" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>

            {/* Hero: valor inventario (2x2) — tarjeta editorial */}
            <div style={{
              gridColumn: 'span 2', gridRow: 'span 2', position: 'relative',
              background: 'var(--surface)', borderRadius: 'var(--radius-lg)', padding: 18,
              boxShadow: 'var(--shadow-md)',
            }}>
              <div style={{ position: 'relative' }}>
                {/* La plata es del dueño: un cajero en turno ve solo cuánta mercadería hay. */}
                <span style={{ fontSize: 15, color: 'var(--text-2)', fontWeight: 700 }}>{esDueno ? 'Valor del inventario' : 'Mercadería'}</span>
                {esDueno && (
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 6.5vw, 30px)', fontWeight: 800, margin: '6px 0 14px', letterSpacing: '-0.02em', lineHeight: 1.05, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                    {formatearMoneda(valorAnimado)}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <LedgerStat n={res.productosTotales} l="Productos" />
                  <LedgerStat n={res.lotesTotales} l="Compras" />
                  <LedgerStat n={res.unidadesTotales} l="Unidades" />
                </div>
              </div>
            </div>

            {/* En riesgo (2x1) */}
            {esDueno && <div style={{
              gridColumn: 'span 2', background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
              padding: 16, boxShadow: 'var(--shadow-md)',
            }}>
              <div style={{ fontSize: 15, color: 'var(--level-vencido-fg)', fontWeight: 800, marginBottom: 10 }}>
                Valor en riesgo
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
            </div>}

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
                      <IcoCubeIcon width={22} height={22} style={{ flexShrink: 0 }} />
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
    <div style={{ fontSize: 14, color: 'var(--text-3)', fontWeight: 600 }}>{l}</div>
    <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{n}</div>
  </div>
);

const SecHeader: React.FC<{ title: string; tag?: string; onAction?: () => void }> = ({ title, tag, onAction }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, rowGap: 6, marginBottom: 12 }}>
    <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, margin: 0, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{title}</h2>
    <span style={{ flex: 1 }} />
    {tag && <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-2)', background: 'var(--surface-3)', borderRadius: 20, padding: '3px 10px' }}>{tag}</span>}
    {onAction && (
      <button type="button" onClick={onAction} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--marca-texto)', fontWeight: 800, minHeight: 44, display: 'flex', alignItems: 'center', gap: 2, fontFamily: 'inherit', padding: 0 }}>
        Ver todo <ChevronRightIcon width={14} height={14} />
      </button>
    )}
  </div>
);

const NivelChip: React.FC<{ nivel: NivelAlerta; cantidad: number }> = ({ nivel, cantidad }) => (
  <div style={{
    background: 'var(--surface)',
    borderRadius: 'var(--radius-lg)', padding: '14px 6px', textAlign: 'center',
    boxShadow: 'var(--shadow-md)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  }}>
    <div style={{ width: 9, height: 9, borderRadius: '50%', background: `var(--level-${nivel}-fg)`, marginBottom: 5, boxShadow: `0 0 0 3px var(--level-${nivel}-bg)` }} />
    <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>{cantidad}</div>
    <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 2, fontWeight: 700 }}>{etiquetaNivel(nivel)}</div>
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
    const icono = (fondo: string, color: string, trazo: React.ReactNode) => (
      <span aria-hidden="true" style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 16, background: fondo, color, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--relieve), 0 4px 10px -4px rgba(0, 0, 0, 0.35)' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">{trazo}</svg>
      </span>
    );
    if (!caso) {
      return (
        <div role="status" className="tarjeta anim-pop" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', marginBottom: 16 }}>
          {icono('linear-gradient(160deg, #4cc38a, #1f8f5c)', '#fff', <path d="m5 12 5 5 9-10" />)}
          <span style={{ fontSize: 19, fontWeight: 800 }}>Todo en orden: no hay nada por vencer.</span>
        </div>
      );
    }
    const vencido = caso.nivel === 'vencido';
    return (
      <div role="alert" className="tarjeta anim-pop" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          {vencido
            ? icono('linear-gradient(160deg, #e04e3a, #b8301c)', '#fff', <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.5" /></>)
            : icono('linear-gradient(160deg, #ffd27a, #f29a00)', '#3d2a00', <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 21, fontWeight: 800, color: caso.fg, lineHeight: 1.2 }}>{caso.titulo}</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-2)', marginTop: 2 }}>{caso.texto}</div>
          </div>
        </div>
        <button type="button" className="boton-marca anim-atencion" onClick={() => onVer(caso.nivel)}
          style={{ width: '100%', minHeight: 56, borderRadius: 'var(--radius-md)', border: 'none', fontSize: 18, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          {caso.boton}
        </button>
      </div>
    );
  };

const AccionCard: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> =
  ({ icon, label, onClick }) => (
    <button type="button" onClick={onClick} className="boton-blanco"
      style={{
        border: 'none', borderRadius: 'var(--radius-lg)', padding: '14px 8px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 15,
      }}
    >
      <span style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--marca-suave)', color: 'var(--marca-texto)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
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
              Liquidar {formatearMoneda(liq.precioFinal)} −{liq.pct}%
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

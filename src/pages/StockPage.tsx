import React, { useState, useMemo, useEffect } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  MagnifyingGlassIcon, PlusIcon, CubeIcon, TagIcon,
  XMarkIcon, ArchiveBoxIcon, QrCodeIcon,
} from '@heroicons/react/24/outline';
import {
  useStore, formatearMoneda, formatearFecha,
  colorNivel, etiquetaNivel, ordenNivel, textoEstado, descuentoConfig,
} from '../context/StoreContext';
import { ProductoConLotes, NivelAlerta, LoteConProducto } from '../types';
import { sugerirLiquidacion } from '../lib/liquidacion';
import Card from '../components/ui/Card';
import { NivelBadge } from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { Input, Opciones } from '../components/ui/Input';
import ScannerModal from '../components/ScannerModal';
import { useAuth } from '../context/AuthContext';
import { useLectorFisico } from '../lib/useLectorFisico';

type Vista = 'productos' | 'lotes';
// 'negativo' = vendido sin stock (lo usa el aviso del inicio)
type Filtro = NivelAlerta | 'todos' | 'pronto' | 'negativo';

function coincideNivel(filtro: Filtro, nivel: NivelAlerta): boolean {
  if (filtro === 'todos') return true;
  if (filtro === 'pronto') return nivel === 'critico' || nivel === 'urgente';
  return nivel === filtro;
}

const POR_PAGINA = 60;
const StockPage: React.FC = () => {
  const { productosConLotes, lotesEnriquecidos, buscarProductoPorCodigo } = useStore();
  const history = useHistory();
  const { esDueno } = useAuth();

  const [vista, setVista] = useState<Vista>('productos');
  // De a 60: con cientos de productos, dibujar todo de una trababa los celulares baratos.
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [busqueda, setBusqueda] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  // 'pronto' = crítico + urgente (lo usa la tarjeta "vencen pronto" del inicio)
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const location = useLocation();
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const nivel = q.get('nivel') as Filtro | null;
    if (nivel) setFiltro(nivel);
    else setFiltro(f => (f === 'pronto' ? 'todos' : f)); // 'pronto' no tiene chip: no dejarlo invisible
    if (q.get('vista') === 'lotes') setVista('lotes');
  }, [location.search]);
  const [filtroProveedor, setFiltroProveedor] = useState<string>('todos');

  const productos = useMemo(() => productosConLotes(), [productosConLotes]);
  const lotes = useMemo(() => lotesEnriquecidos(), [lotesEnriquecidos]);

  // Proveedores únicos cargados (para el selector de filtro).
  const proveedores = useMemo(() => {
    const set = new Set<string>();
    productos.forEach(p => { const pr = p.producto.proveedor?.trim(); if (pr) set.add(pr); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [productos]);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter(p => {
      const mb = !q || p.producto.nombre.toLowerCase().includes(q) || (p.producto.codigoBarras?.includes(busqueda.trim()));
      const mf = filtro === 'negativo' ? p.cantidadTotal < 0 : coincideNivel(filtro, p.nivelPeor);
      const mp = filtroProveedor === 'todos' || (p.producto.proveedor?.trim() ?? '') === filtroProveedor;
      return mb && mf && mp;
    }).sort((a, b) => ordenNivel(a.nivelPeor) - ordenNivel(b.nivelPeor));
  }, [productos, busqueda, filtro, filtroProveedor]);

  const lotesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lotes.filter(l => {
      const mb = !q || l.productoNombre.toLowerCase().includes(q) || (l.numeroLote?.toLowerCase().includes(q));
      const mf = filtro === 'negativo' ? l.cantidad < 0 : l.cantidad > 0 && coincideNivel(filtro, l.nivelAlerta);
      const mp = filtroProveedor === 'todos' || (l.productoProveedor?.trim() ?? '') === filtroProveedor;
      return mb && mf && mp;
    }).sort((a, b) => {
      const d = ordenNivel(a.nivelAlerta) - ordenNivel(b.nivelAlerta);
      return d !== 0 ? d : a.fechaVencimiento.localeCompare(b.fechaVencimiento);
    });
  }, [lotes, busqueda, filtro, filtroProveedor]);

  const filtros: (NivelAlerta | 'todos')[] = ['todos', 'vencido', 'critico', 'urgente', 'aviso', 'ok'];
  const enNegativo = useMemo(() => productos.filter(p => p.cantidadTotal < 0).length, [productos]);

  // Cámara o lector físico: si el código es de un producto, abrirlo; si no, dejarlo en el buscador.
  const alEscanear = (codigo: string) => {
    const prod = buscarProductoPorCodigo(codigo);
    if (prod) history.push(`/producto/${prod.id}`);
    else setBusqueda(codigo); // queda en el buscador → "Sin resultados"
  };
  const lectorRef = useLectorFisico<HTMLIonContentElement>(alEscanear);

  return (
    <IonPage>
      <IonContent ref={lectorRef} style={{ '--background': 'var(--bg)' } as any}>
        <div className="animate-fade-in" style={{
          padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px',
          maxWidth: 760, margin: '0 auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
              Mercadería
            </h1>
            {esDueno && <button
              type="button"
              onClick={() => history.push('/precios')}
              className="pressable"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 'var(--radius-full)', border: '1px solid var(--brand-200)',
                background: 'var(--brand-50)', color: 'var(--brand-700)',
                fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minHeight: 44,
              }}>
              Subir precios
            </button>}
          </div>

          {/* Switch de vista */}
          <div style={{
            display: 'flex', background: 'var(--surface-2)',
            borderRadius: 'var(--radius)', padding: 3, marginBottom: 14,
          }}>
            <SegBtn activa={vista === 'productos'} onClick={() => setVista('productos')}
              icon={<CubeIcon width={16} height={16} />}>Por producto</SegBtn>
            <SegBtn activa={vista === 'lotes'} onClick={() => setVista('lotes')}
              icon={<TagIcon width={16} height={16} />}>Por vencimiento</SegBtn>
          </div>

          {/* Búsqueda */}
          <div style={{ marginBottom: 12 }}>
            <Input
              placeholder="Buscar producto..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              leftIcon={<MagnifyingGlassIcon width={18} height={18} />}
              rightAddon={
                <div style={{ display: 'flex', gap: 6 }}>
                  {busqueda && (
                    <button type="button" onClick={() => setBusqueda('')} aria-label="Borrar búsqueda"
                      style={{
                        background: 'var(--surface-2)', border: 'none', boxShadow: 'var(--shadow-sm)',
                        borderRadius: 'var(--radius)', padding: '0 10px', cursor: 'pointer', minWidth: 44, minHeight: 44, justifyContent: 'center',
                        color: 'var(--text-2)', display: 'flex', alignItems: 'center',
                      }}>
                      <XMarkIcon width={16} height={16} />
                    </button>
                  )}
                  <button className="boton-marca" type="button" onClick={() => setShowScanner(true)}
                    title="Escanear código de barras"
                    style={{ border: '1px solid var(--brand-500)',
                      borderRadius: 'var(--radius)', padding: '0 12px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    }}>
                    <QrCodeIcon width={18} height={18} />
                  </button>
                </div>
              }
            />
          </div>

          {/* Filtro por proveedor (solo si hay alguno cargado) */}
          {proveedores.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Proveedor</div>
              <Opciones etiqueta="Proveedor" columnas={3} valor={filtroProveedor} onChange={setFiltroProveedor}
                opciones={[{ valor: 'todos', etiqueta: 'Todos' }, ...proveedores.map(pr => ({ valor: pr, etiqueta: pr }))]} />
            </div>
          )}

          {/* Chips filtro */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {filtros.map(f => (
              <FilterChip key={f} activo={filtro === f} nivel={f === 'todos' ? undefined : f}
                onClick={() => setFiltro(f)}>
                {f === 'todos' ? 'Todos' : etiquetaNivel(f)}
              </FilterChip>
            ))}
            {(enNegativo > 0 || filtro === 'negativo') && (
              <FilterChip activo={filtro === 'negativo'} nivel="vencido" onClick={() => setFiltro('negativo')}>
                Vendido sin stock ({enNegativo})
              </FilterChip>
            )}
          </div>

          {/* Lista */}
          {vista === 'productos' ? (
            productosFiltrados.length === 0 ? (
              <EmptyState icon={<ArchiveBoxIcon width={32} height={32} />} title="Sin resultados"
                description="Probá cambiar la búsqueda o los filtros." />
            ) : (
              <div className="lista-animada" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {productosFiltrados.slice(0, mostrar).map(p => (
                  <ProductoCard key={p.producto.id} p={p}
                    onClick={() => history.push(`/producto/${p.producto.id}`)} />
                ))}
                {productosFiltrados.length > mostrar && (
                  <Button variant="secondary" size="lg" fullWidth onClick={() => setMostrar(m => m + POR_PAGINA)}>
                    Ver más ({productosFiltrados.length - mostrar} más)
                  </Button>
                )}
              </div>
            )
          ) : (
            lotesFiltrados.length === 0 ? (
              <EmptyState icon={<TagIcon width={32} height={32} />} title="Sin resultados"
                description="Probá cambiar la búsqueda o los filtros." />
            ) : (
              <div className="lista-animada" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lotesFiltrados.slice(0, mostrar).map(l => (
                  <LoteRow key={l.id} lote={l} onClick={() => history.push(`/lote/${l.id}`)} />
                ))}
                {lotesFiltrados.length > mostrar && (
                  <Button variant="secondary" size="lg" fullWidth onClick={() => setMostrar(m => m + POR_PAGINA)}>
                    Ver más ({lotesFiltrados.length - mostrar} más)
                  </Button>
                )}
              </div>
            )
          )}

          {/* FAB nuevo producto (solo dueño) */}
          {esDueno && <button
            type="button"
            onClick={() => history.push('/producto/nuevo')}
            style={{
              position: 'fixed', right: 16,
              bottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))',
              minHeight: 52, padding: '0 18px 0 14px', borderRadius: 'var(--radius-full)',
              background: 'var(--surface)', border: '1px solid var(--brand-300)',
              color: 'var(--marca-texto)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
              boxShadow: 'var(--shadow-lg)', zIndex: 50,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <PlusIcon width={20} height={20} aria-hidden="true" /> Producto nuevo
          </button>}
        </div>

        {showScanner && (
          <ScannerModal
            onCodigoDetectado={(codigo) => { setShowScanner(false); alEscanear(codigo); }}
            onCancel={() => setShowScanner(false)}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

// ─── Subcomponentes ─────────────────────────────────────────────────────
const SegBtn: React.FC<{ activa: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }> =
  ({ activa, onClick, icon, children }) => (
    <button type="button" onClick={onClick}
      style={{
        flex: 1, padding: '9px 12px', minHeight: 48, border: 'none',
        background: activa ? 'var(--surface)' : 'transparent',
        color: activa ? 'var(--text)' : 'var(--text-2)',
        borderRadius: 'var(--radius-sm)', fontWeight: 700, fontSize: 15,
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        boxShadow: activa ? 'var(--shadow-xs)' : 'none',
        transition: 'all 150ms',
      }}>
      {icon}{children}
    </button>
  );

const FilterChip: React.FC<{ activo: boolean; nivel?: NivelAlerta; onClick: () => void; children: React.ReactNode }> =
  ({ activo, nivel, onClick, children }) => (
    <button type="button" onClick={onClick}
      style={{
        padding: '6px 16px', minHeight: 44, fontSize: 15, borderRadius: 'var(--radius-full)',
        border: '1px solid ' + (activo ? 'var(--brand-500)' : 'var(--border)'),
        background: activo ? 'var(--brand-500)' : 'var(--surface)',
        color: activo ? '#fff' : 'var(--text-2)',
        cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600,
        flexShrink: 0, fontFamily: 'inherit', display: 'flex',
        alignItems: 'center', gap: 6, transition: 'all 150ms',
      }}>
      {nivel && (
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: activo ? '#fff' : `var(--level-${nivel}-fg)`,
        }} />
      )}
      {children}
    </button>
  );

const ProductoCard: React.FC<{ p: ProductoConLotes; onClick: () => void }> = ({ p, onClick }) => {
  const reponer = (p.producto.stockMinimo ?? 0) > 0 && p.cantidadTotal < (p.producto.stockMinimo ?? 0);
  return (
  <Card padding="sm" onClick={onClick}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 4, height: 52, background: p.cantidadTotal < 0 ? 'var(--danger)' : colorNivel(p.nivelPeor), borderRadius: 2, flexShrink: 0 }} />
      {p.producto.fotoUrl && (
        <img src={p.producto.fotoUrl} alt="" loading="lazy" style={{
          width: 44, height: 44, objectFit: 'cover', flexShrink: 0,
          borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)',
        }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, marginBottom: 3, letterSpacing: '-0.01em' }}>
          {p.producto.nombre}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 6 }}>
          {p.producto.categoria} · {formatearMoneda(p.producto.precio)} c/u
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {p.cantidadTotal > 0 && <NivelBadge nivel={p.nivelPeor} />}
          {p.cantidadTotal < 0 ? (
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--danger)' }}>
              {p.cantidadTotal} unid · se vendió sin stock
            </span>
          ) : (
            <span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 500 }}>
              {p.cantidadTotal} unid · {p.lotes.length} lote{p.lotes.length !== 1 ? 's' : ''}
            </span>
          )}
          {reponer && (
            <span style={{
              fontSize: 14, fontWeight: 700, color: 'var(--warning)',
              border: '1px solid var(--warning)', borderRadius: 'var(--radius-full)',
              padding: '1px 8px', whiteSpace: 'nowrap',
            }}>
              Reponer (mín. {p.producto.stockMinimo})
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>
          {p.valorTotal > 0 ? formatearMoneda(p.valorTotal) : ''}
        </div>
        {p.proximoVencimiento && (
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 2 }}>
            {formatearFecha(p.proximoVencimiento)}
          </div>
        )}
      </div>
    </div>
  </Card>
  );
};

const LoteRow: React.FC<{ lote: LoteConProducto; onClick: () => void }> = ({ lote, onClick }) => {
  // Sugerencia de liquidación FEFO: vender antes de que venza con un descuento.
  const liq = sugerirLiquidacion(lote.nivelAlerta, lote.productoPrecio, descuentoConfig());
  return (
  <Card padding="sm" onClick={onClick}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 4, height: 48, background: colorNivel(lote.nivelAlerta), borderRadius: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, marginBottom: 2, letterSpacing: '-0.01em' }}>
          {lote.productoNombre}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 6 }}>
          <span style={lote.cantidad < 0 ? { color: 'var(--danger)', fontWeight: 800 } : undefined}>{lote.cantidad} unid.</span>{lote.numeroLote ? ` · Lote ${lote.numeroLote}` : ''}{lote.productoProveedor ? ` · ${lote.productoProveedor}` : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <NivelBadge nivel={lote.nivelAlerta} />
          <span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 500 }}>
            {lote.cantidad < 0 ? 'Se vendió sin stock: el próximo ingreso lo descuenta' : textoEstado(lote.fechaVencimiento)}
          </span>
          {liq.aplicar && (
            <span title={`Sugerencia: liquidá a ${formatearMoneda(liq.precioFinal)} (precio normal ${formatearMoneda(liq.precioOriginal)}) para venderlo antes de que venza`}
              style={{
                fontSize: 14, fontWeight: 700, color: 'var(--brand-600)',
                background: 'var(--brand-50, var(--surface-2))',
                border: '1px solid var(--brand-300)',
                borderRadius: 'var(--radius-full)', padding: '2px 8px',
                display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
              }}>
              Liquidar {formatearMoneda(liq.precioFinal)}
              <span style={{ opacity: 0.75, fontWeight: 600 }}>−{liq.pct}%</span>
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{formatearFecha(lote.fechaVencimiento)}</div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
          {formatearMoneda(lote.valorLote)}
        </div>
      </div>
    </div>
  </Card>
  );
};

export default StockPage;

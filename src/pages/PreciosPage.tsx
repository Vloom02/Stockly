// ═══════════════════════════════════════════════════════════════════════════
// Suba de precios rápida: buscás el producto, ves el precio actual, ponés el
// nuevo (o lo precalculás con un % de aumento) y guardás. Producto por producto
// — pensado para remarcar en góndola sin pasar por la ficha completa.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useMemo, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { MagnifyingGlassIcon, BanknotesIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useStore, formatearMoneda } from '../context/StoreContext';
import EmptyState from '../components/ui/EmptyState';
import { Input } from '../components/ui/Input';
import { Header } from './ProductoPage';

const AUMENTOS = [5, 10, 15, 20];

const PreciosPage: React.FC = () => {
  const { state, updateProducto } = useStore();
  const history = useHistory();
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null); // producto en edición
  const [nuevo, setNuevo] = useState('');                      // precio nuevo (texto)
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '' });

  const productos = useMemo(() => {
    const t = q.trim().toLowerCase();
    return state.productos
      .filter(p => p.activo)
      .filter(p => !t || p.nombre.toLowerCase().includes(t) || (p.codigoBarras ?? '').includes(q.trim()))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [state.productos, q]);

  const abrir = (id: string, precioActual: number) => {
    setAbierto(id);
    setNuevo(String(precioActual));
  };

  const guardar = async (id: string) => {
    const p = state.productos.find(x => x.id === id);
    const precio = Math.round((parseFloat(nuevo.replace(',', '.')) || 0) * 100) / 100;
    if (!p || precio <= 0) { setToast({ show: true, msg: 'Ingresá un precio válido' }); return; }
    setGuardando(true);
    await updateProducto({ ...p, precio });
    setGuardando(false);
    setAbierto(null);
    setToast({ show: true, msg: `${p.nombre}: ${formatearMoneda(p.precio)} → ${formatearMoneda(precio)}` });
  };

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
        <div style={{ padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px', maxWidth: 760, margin: '0 auto' }}>
          <Header title="Suba de precios" onBack={() => history.goBack()} />
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Buscá el producto, tocalo y poné el precio nuevo. Los chips te calculan el aumento.
          </p>

          <div style={{ marginBottom: 14 }}>
            <Input
              placeholder="Buscar producto o código…"
              value={q}
              onChange={e => setQ(e.target.value)}
              leftIcon={<MagnifyingGlassIcon width={18} height={18} />}
            />
          </div>

          {productos.length === 0 ? (
            <EmptyState icon={<BanknotesIcon width={32} height={32} />} title="Sin productos"
              description={q ? 'Probá con otra búsqueda.' : 'No hay productos activos.'} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {productos.map(p => {
                const enEdicion = abierto === p.id;
                const precioNuevo = parseFloat(nuevo.replace(',', '.')) || 0;
                const cambio = enEdicion && precioNuevo > 0 && p.precio > 0
                  ? Math.round(((precioNuevo - p.precio) / p.precio) * 100) : null;
                return (
                  <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid ' + (enEdicion ? 'var(--brand-300)' : 'var(--border)'), borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => (enEdicion ? setAbierto(null) : abrir(p.id!, p.precio))}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)', textAlign: 'left' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{formatearMoneda(p.precio)}</span>
                    </button>

                    {enEdicion && (
                      <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
                        {/* Chips de aumento rápido */}
                        <div style={{ display: 'flex', gap: 6, margin: '12px 0' }}>
                          {AUMENTOS.map(a => (
                            <button key={a} type="button"
                              onClick={() => setNuevo(String(Math.round(p.precio * (1 + a / 100) * 100) / 100))}
                              style={{ flex: 1, padding: '7px 0', borderRadius: 'var(--radius-full)', border: '1px solid var(--brand-200)', background: 'var(--brand-50)', color: 'var(--brand-700)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                              +{a}%
                            </button>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            type="number" inputMode="decimal" min={0} step="0.01"
                            aria-label={`Nuevo precio de ${p.nombre}`}
                            value={nuevo} onChange={e => setNuevo(e.target.value)}
                            autoFocus
                            style={{ flex: 1, padding: '11px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}
                          />
                          <button type="button" onClick={() => guardar(p.id!)} disabled={guardando} className="pressable"
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 18px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--brand-500)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: guardando ? 0.6 : 1 }}>
                            <CheckIcon width={16} height={16} /> Guardar
                          </button>
                        </div>
                        {cambio !== null && cambio !== 0 && (
                          <p style={{ margin: '8px 0 0', fontSize: 12, color: cambio > 0 ? 'var(--brand-600)' : 'var(--level-vencido-fg)', fontWeight: 600 }}>
                            {cambio > 0 ? '▲' : '▼'} {Math.abs(cambio)}% vs precio actual
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <IonToast isOpen={toast.show} message={toast.msg} duration={2200} onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

export default PreciosPage;

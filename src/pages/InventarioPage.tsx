// ═══════════════════════════════════════════════════════════════════════════
// Inventario físico / conteo guiado. Reconcilia el stock real vs el del sistema
// lote por lote. Al aplicar, usa updateLote (registra movimiento 'ajuste').
// ═══════════════════════════════════════════════════════════════════════════
import React, { useMemo, useState } from 'react';
import { IonContent, IonPage, IonToast, useIonViewWillEnter } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { ClipboardDocumentCheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useStore, formatearFecha } from '../context/StoreContext';
import EmptyState from '../components/ui/EmptyState';
import { Header } from './ProductoPage';
import { useLectorFisico } from '../lib/useLectorFisico';
import { useVentas } from '../ventas/context/VentasContext';

const InventarioPage: React.FC = () => {
  const { state, lotesEnriquecidos, updateLote, sincronizarAhora } = useStore();
  const { state: ventas } = useVentas();
  const history = useHistory();
  const [q, setQ] = useState('');
  const lectorRef = useLectorFisico<HTMLIonContentElement>(setQ); // lector físico: busca el producto
  const [conteo, setConteo] = useState<Record<string, string>>({});
  // Lo que decía el sistema cuando se empezó a contar cada lote: lo vendido después no se pisa.
  const [base, setBase] = useState<Record<string, number>>({});
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '' });
  // Lo que vendió el otro equipo tiene que estar antes de contar: si no, el ajuste lo restaba otra vez.
  useIonViewWillEnter(() => { sincronizarAhora().catch(() => {}); });

  const todos = useMemo(() => [...lotesEnriquecidos()]
    .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre) || a.fechaVencimiento.localeCompare(b.fechaVencimiento)),
  [lotesEnriquecidos]);
  const codigoDe = useMemo(() => new Map(state.productos.map(p => [p.id, p.codigoBarras ?? ''])), [state.productos]);

  // Por nombre o por código (el lector físico escribe el código).
  const lotes = useMemo(() => {
    const t = q.trim().toLowerCase();
    return todos.filter(l => !t || l.productoNombre.toLowerCase().includes(t) || codigoDe.get(l.productoId) === q.trim());
  }, [todos, q, codigoDe]);

  // Diferencias de TODOS los lotes contados, aunque la búsqueda los oculte (antes se perdían).
  const diferencias = useMemo(() => todos.filter(l => {
    const real = conteo[l.id!];
    return real !== undefined && real !== '' && parseInt(real, 10) !== (base[l.id!] ?? l.cantidad);
  }), [todos, conteo, base]);

  const aplicar = async () => {
    if (diferencias.length === 0) return;
    // Lo vendido sin internet todavía no está en los lotes: ajustar ahora lo restaría dos veces.
    if (ventas.outboxLen > 0) {
      setToast({ show: true, msg: `Hay ${ventas.outboxLen} venta${ventas.outboxLen !== 1 ? 's' : ''} sin mandar. Conectate a internet, esperá que se manden y volvé a tocar "Ajustar".` });
      return;
    }
    setGuardando(true);
    let ok = 0;
    for (const l of diferencias) {
      const lote = state.lotes.find(x => x.id === l.id);
      if (!lote) continue;
      const real = Math.max(0, parseInt(conteo[l.id!], 10) || 0);
      const desde = base[l.id!] ?? lote.cantidad;
      try { await updateLote({ ...lote, cantidad: lote.cantidad + (real - desde) }); ok++; } catch { /* sigue */ }
    }
    setGuardando(false);
    setConteo({});
    setBase({});
    setToast({ show: true, msg: `${ok} lote${ok !== 1 ? 's' : ''} ajustado${ok !== 1 ? 's' : ''}` });
  };

  return (
    <IonPage>
      <IonContent ref={lectorRef} style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
        <div style={{ padding: '20px 16px calc(120px + var(--sab,env(safe-area-inset-bottom))) 16px', maxWidth: 760, margin: '0 auto' }}>
          <Header title="Inventario físico" onBack={() => history.goBack()} />
          <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Contá lo que hay en góndola y anotá la cantidad real. Te marcamos las diferencias y las ajustás de una.
          </p>

          <div style={{ position: 'relative', marginBottom: 14 }}>
            <MagnifyingGlassIcon width={16} height={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-3)' }} />
            <input className="campo"
              value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto"
              style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14 }}
            />
          </div>

          {lotes.length === 0 ? (
            <EmptyState icon={<ClipboardDocumentCheckIcon width={32} height={32} />} title="Sin lotes" description="No hay stock para contar en esta sucursal." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lotes.map(l => {
                const real = conteo[l.id!];
                const diff = real !== undefined && real !== '' ? parseInt(real, 10) - l.cantidad : 0;
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid ' + (diff !== 0 ? 'var(--brand-300)' : 'var(--border)'), borderRadius: 'var(--radius)', padding: '10px 12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.productoNombre}</div>
                      <div style={{ fontSize: 14, color: 'var(--text-3)' }}>Vence {formatearFecha(l.fechaVencimiento)} · sistema: {l.cantidad}</div>
                    </div>
                    {diff !== 0 && (
                      <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: diff > 0 ? 'var(--brand-600)' : 'var(--level-vencido-fg)' }}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    )}
                    <input className="campo"
                      type="number" inputMode="numeric" min={0}
                      aria-label={`Cantidad real de ${l.productoNombre}`}
                      value={real ?? ''} placeholder={String(l.cantidad)}
                      onChange={e => {
                        setConteo(c => ({ ...c, [l.id!]: e.target.value }));
                        setBase(b => (l.id! in b ? b : { ...b, [l.id!]: l.cantidad }));
                      }}
                      style={{ width: 62, textAlign: 'center', padding: '8px 6px', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700 }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Barra fija de aplicar */}
        {diferencias.length > 0 && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + var(--sab,env(safe-area-inset-bottom)))', background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, maxWidth: 760, margin: '0 auto' }}>
            <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{diferencias.length} con diferencia</span>
            <button type="button" onClick={aplicar} disabled={guardando} className="pressable boton-marca"
              style={{ border: 'none', borderRadius: 'var(--radius)', padding: '11px 20px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: guardando ? 0.6 : 1 }}>
              {guardando ? 'Ajustando…' : 'Aplicar ajustes'}
            </button>
          </div>
        )}

        <IonToast isOpen={toast.show} message={toast.msg} duration={4500} onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

export default InventarioPage;

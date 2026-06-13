// ═══════════════════════════════════════════════════════════════════════════
// Inventario físico / conteo guiado. Reconcilia el stock real vs el del sistema
// lote por lote. Al aplicar, usa updateLote (registra movimiento 'ajuste').
// ═══════════════════════════════════════════════════════════════════════════
import React, { useMemo, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { ClipboardDocumentCheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useStore, formatearFecha } from '../context/StoreContext';
import EmptyState from '../components/ui/EmptyState';
import { Header } from './ProductoPage';

const InventarioPage: React.FC = () => {
  const { lotesEnriquecidos, updateLote } = useStore();
  const history = useHistory();
  const [q, setQ] = useState('');
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '' });

  const lotes = useMemo(() => {
    const t = q.trim().toLowerCase();
    return lotesEnriquecidos()
      .filter(l => !t || l.productoNombre.toLowerCase().includes(t))
      .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre) || a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  }, [lotesEnriquecidos, q]);

  // Lotes con diferencia entre lo contado y el sistema.
  const diferencias = useMemo(() => lotes.filter(l => {
    const real = conteo[l.id!];
    return real !== undefined && real !== '' && parseInt(real, 10) !== l.cantidad;
  }), [lotes, conteo]);

  const aplicar = async () => {
    if (diferencias.length === 0) return;
    setGuardando(true);
    let ok = 0;
    for (const l of diferencias) {
      const real = Math.max(0, parseInt(conteo[l.id!], 10) || 0);
      try { await updateLote({ ...l, cantidad: real }); ok++; } catch { /* sigue */ }
    }
    setGuardando(false);
    setConteo({});
    setToast({ show: true, msg: `${ok} lote${ok !== 1 ? 's' : ''} ajustado${ok !== 1 ? 's' : ''}` });
  };

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
        <div style={{ padding: '20px 16px calc(120px + var(--sab,env(safe-area-inset-bottom))) 16px', maxWidth: 760, margin: '0 auto' }}>
          <Header title="Inventario físico" onBack={() => history.goBack()} />
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Contá lo que hay en góndola y anotá la cantidad real. Te marcamos las diferencias y las ajustás de una.
          </p>

          <div style={{ position: 'relative', marginBottom: 14 }}>
            <MagnifyingGlassIcon width={16} height={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-3)' }} />
            <input
              value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto"
              style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14 }}
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
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Vence {formatearFecha(l.fechaVencimiento)} · sistema: {l.cantidad}</div>
                    </div>
                    {diff !== 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: diff > 0 ? 'var(--brand-600)' : 'var(--level-vencido-fg)' }}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    )}
                    <input
                      type="number" inputMode="numeric" min={0}
                      aria-label={`Cantidad real de ${l.productoNombre}`}
                      value={real ?? ''} placeholder={String(l.cantidad)}
                      onChange={e => setConteo(c => ({ ...c, [l.id!]: e.target.value }))}
                      style={{ width: 62, textAlign: 'center', padding: '8px 6px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700 }}
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
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{diferencias.length} con diferencia</span>
            <button type="button" onClick={aplicar} disabled={guardando} className="pressable"
              style={{ background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '11px 20px', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: guardando ? 0.6 : 1 }}>
              {guardando ? 'Ajustando…' : 'Aplicar ajustes'}
            </button>
          </div>
        )}

        <IonToast isOpen={toast.show} message={toast.msg} duration={2200} onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

export default InventarioPage;

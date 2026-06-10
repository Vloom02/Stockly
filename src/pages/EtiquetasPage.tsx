// ═══════════════════════════════════════════════════════════════════════════
// Etiquetas de precio imprimibles (nombre + precio + código).
// Impresión confiable con visibility en @media print: solo se imprime la grilla.
// En Android, window.print() abre el servicio de impresión del sistema (o PDF).
// ═══════════════════════════════════════════════════════════════════════════
import React, { useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { PrinterIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useStore, formatearMoneda } from '../context/StoreContext';
import EmptyState from '../components/ui/EmptyState';
import { Header } from './ProductoPage';

const EtiquetasPage: React.FC = () => {
  const { state } = useStore();
  const history = useHistory();
  const [q, setQ] = useState('');

  const productos = useMemo(() => {
    const t = q.trim().toLowerCase();
    return state.productos
      .filter(p => p.activo)
      .filter(p => !t || p.nombre.toLowerCase().includes(t) || (p.codigoBarras ?? '').includes(t))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [state.productos, q]);

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
        {/* Reglas de impresión: ocultar todo menos las etiquetas */}
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            #etiquetas-print, #etiquetas-print * { visibility: visible !important; }
            #etiquetas-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; gap: 0 !important; }
            #etiquetas-print .etiqueta { break-inside: avoid; border: 1px dashed #999 !important; box-shadow: none !important; }
            ion-tab-bar, .no-print { display: none !important; }
          }
        `}</style>

        <div style={{ padding: '20px 16px calc(96px + env(safe-area-inset-bottom)) 16px', maxWidth: 760, margin: '0 auto' }}>
          <div className="no-print">
            <Header title="Etiquetas" onBack={() => history.goBack()} />

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <MagnifyingGlassIcon width={16} height={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-3)' }} />
                <input
                  value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…"
                  aria-label="Buscar producto"
                  style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14 }}
                />
              </div>
              <button
                type="button" onClick={() => window.print()} disabled={productos.length === 0}
                className="pressable"
                style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '0 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: productos.length === 0 ? 0.5 : 1 }}>
                <PrinterIcon width={17} height={17} /> Imprimir
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 14px' }}>
              {productos.length} etiqueta{productos.length !== 1 ? 's' : ''}. Tocá Imprimir para mandar a la impresora o guardar como PDF.
            </p>
          </div>

          {productos.length === 0 ? (
            <EmptyState icon={<PrinterIcon width={32} height={32} />} title="Sin productos" description="No hay productos activos para etiquetar." />
          ) : (
            <div id="etiquetas-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {productos.map(p => (
                <div key={p.id} className="etiqueta" style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '12px 12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111' }}>
                    {p.nombre}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: '#111', marginTop: 4 }}>
                    {formatearMoneda(p.precio)}
                  </div>
                  {p.codigoBarras && (
                    <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em', color: '#555', marginTop: 6 }}>
                      {p.codigoBarras}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default EtiquetasPage;

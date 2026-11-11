// ═══════════════════════════════════════════════════════════════════════════
// Inventario físico / conteo guiado. Reconcilia el stock real vs el del sistema
// lote por lote. Al aplicar, usa updateLote (registra movimiento 'ajuste').
// ═══════════════════════════════════════════════════════════════════════════
import React, { useDeferredValue, useMemo, useState } from 'react';
import { IonContent, IonPage, IonToast, useIonViewWillEnter } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { ClipboardDocumentCheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useStore, formatearFecha } from '../context/StoreContext';
import EmptyState from '../components/ui/EmptyState';
import { Header } from './ProductoPage';
import { useLectorFisico } from '../lib/useLectorFisico';
import { useVentas } from '../ventas/context/VentasContext';

const InventarioPage: React.FC = () => {
  const { state, lotesEnriquecidos, ajustarLotes, sincronizarAhora } = useStore();
  const { state: ventas } = useVentas();
  const history = useHistory();
  const [q, setQ] = useState('');
  const lectorRef = useLectorFisico<HTMLIonContentElement>(setQ); // lector físico: busca el producto
  const [conteo, setConteo] = useState<Record<string, string>>({});
  // Lo que decía el sistema cuando se empezó a contar cada lote: lo vendido después no se pisa.
  const [base, setBase] = useState<Record<string, number>>({});
  const [guardando, setGuardando] = useState(false);
  // De a 60: con miles de lotes, cada número que se escribía redibujaba miles de filas y la pantalla se trababa.
  const [mostrar, setMostrar] = useState(60);
  const [toast, setToast] = useState({ show: false, msg: '' });
  // Lo que vendió el otro equipo tiene que estar antes de contar: si no, el ajuste lo restaba otra vez.
  useIonViewWillEnter(() => { sincronizarAhora().catch(() => {}); });

  const todos = useMemo(() => [...lotesEnriquecidos()]
    .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre) || a.fechaVencimiento.localeCompare(b.fechaVencimiento)),
  [lotesEnriquecidos]);
  const codigoDe = useMemo(() => new Map(state.productos.map(p => [p.id, p.codigoBarras ?? ''])), [state.productos]);

  // Por nombre o por código (el lector físico escribe el código). Diferido: lo que se escribe se ve enseguida.
  const buscado = useDeferredValue(q);
  const lotes = useMemo(() => {
    const t = buscado.trim().toLowerCase();
    return todos.filter(l => !t || l.productoNombre.toLowerCase().includes(t) || codigoDe.get(l.productoId) === buscado.trim());
  }, [todos, buscado, codigoDe]);

  // Diferencias de TODOS los lotes contados, aunque la búsqueda los oculte (antes se perdían).
  const diferencias = useMemo(() => todos.filter(l => {
    const real = conteo[l.id!];
    return real !== undefined && real !== '' && parseInt(real, 10) !== (base[l.id!] ?? l.cantidad);
  }), [todos, conteo, base]);

  const aplicar = async () => {
    if (diferencias.length === 0) return;
    // Lo vendido sin internet todavía no está en los lotes: ajustar ahora lo restaría dos veces.
    // Las trabadas (en cuarentena) no se mandan solas: si contaran, el conteo quedaba bloqueado para siempre.
    const sinMandar = ventas.outboxLen - ventas.bloqueados;
    if (sinMandar > 0) {
      setToast({ show: true, msg: `Hay ${sinMandar} venta${sinMandar !== 1 ? 's' : ''} sin mandar. Conectate a internet, esperá que se manden y volvé a tocar "Aplicar ajustes".` });
      return;
    }
    setGuardando(true);
    const porId = new Map(state.lotes.map(x => [x.id, x]));
    const nuevos = [];
    for (const l of diferencias) {
      const lote = porId.get(l.id);
      if (!lote) continue;
      const real = Math.max(0, parseInt(conteo[l.id!], 10) || 0);
      const desde = base[l.id!] ?? lote.cantidad;
      nuevos.push({ ...lote, cantidad: lote.cantidad + (real - desde) });
    }
    try {
      await ajustarLotes(nuevos);
      setConteo({});
      setBase({});
      setToast({ show: true, msg: `Listo: ${nuevos.length} ${nuevos.length !== 1 ? 'compras ajustadas' : 'compra ajustada'}` });
    } catch {
      setToast({ show: true, msg: 'No se pudo guardar el conteo. Probá de nuevo: lo que contaste sigue acá.' });
    }
    setGuardando(false);
  };

  return (
    <IonPage>
      <IonContent ref={lectorRef} style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
        <div style={{ padding: '20px 16px calc(190px + var(--sab,env(safe-area-inset-bottom))) 16px', maxWidth: 760, margin: '0 auto' }}>
          <Header title="Contar la mercadería" onBack={() => history.goBack()} />
          <p style={{ fontSize: 16, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Contá lo que hay en góndola y anotá la cantidad real. Te marcamos las diferencias y las ajustás de una.
          </p>

          <div style={{ position: 'relative', marginBottom: 14 }}>
            <MagnifyingGlassIcon width={16} height={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-3)' }} />
            <input className="campo"
              value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto"
              style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 16 }}
            />
          </div>

          {lotes.length === 0 ? (
            <EmptyState icon={<ClipboardDocumentCheckIcon width={32} height={32} />} title="Nada para contar" description="No hay mercadería cargada en este local." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lotes.slice(0, mostrar).map(l => {
                const real = conteo[l.id!];
                const diff = real !== undefined && real !== '' ? parseInt(real, 10) - l.cantidad : 0;
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid ' + (diff !== 0 ? 'var(--brand-300)' : 'var(--border)'), borderRadius: 'var(--radius)', padding: '10px 12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.productoNombre}</div>
                      <div style={{ fontSize: 16, color: 'var(--text-3)' }}>Vence {formatearFecha(l.fechaVencimiento)} · sistema: {l.cantidad}</div>
                    </div>
                    {diff !== 0 && (
                      <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: diff > 0 ? 'var(--marca-texto)' : 'var(--level-vencido-fg)' }}>
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
                      style={{ width: 72, minHeight: 48, textAlign: 'center', padding: '8px 6px', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700 }}
                    />
                  </div>
                );
              })}
              {lotes.length > mostrar && (
                <button type="button" onClick={() => setMostrar(m => m + 60)} className="pressable"
                  style={{ minHeight: 56, border: 'none', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', color: 'var(--text)', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Ver más ({lotes.length - mostrar} más)
                </button>
              )}
            </div>
          )}
        </div>

        {/* Barra fija de aplicar */}
        {diferencias.length > 0 && (
          // Arriba de la barra de pestañas: antes quedaba tapada por ella y el botón no se veía.
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(92px + var(--sab,env(safe-area-inset-bottom)))', zIndex: 101, padding: '12px 16px', background: 'var(--surface)', borderTop: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, maxWidth: 760, margin: '0 auto' }}>
            <span style={{ fontSize: 16, color: 'var(--text-2)' }}>{diferencias.length} con diferencia</span>
            <button type="button" onClick={aplicar} disabled={guardando} className="pressable boton-marca"
              style={{ border: 'none', borderRadius: 'var(--radius)', padding: '11px 20px', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: guardando ? 0.6 : 1 }}>
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

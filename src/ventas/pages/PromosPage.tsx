// ═══════════════════════════════════════════════════════════════════════════
// Promos (dueño): alta/baja de promociones por producto (2x1 o % por cantidad).
// Se gestionan ONLINE (tabla ventas_promos); el POS las cachea para offline.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { IonContent, IonToast } from '@ionic/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { buscarProductosPorNombre } from '../lib/ventas-engine';
import { Card, Button, EmptyState, Skeleton } from '../components/ui';
import { useConfirm } from '../../lib/useConfirm';
import { TagIcon, TrashIcon, MagnifyingGlass } from '../components/ui/icons';
import { Producto } from '../types';

import BotonVolver from '../components/BotonVolver';
import { GiftIcon as IcoGiftIcon } from '@heroicons/react/24/outline';
interface PromoRow {
  id: string; producto_id: string; tipo: '2x1' | 'pct_cantidad';
  min_cant: number; pct: number; activa: boolean; nombre?: string;
}

const PromosPage: React.FC = () => {
  const { comercio } = useAuth();
  const confirmar = useConfirm();
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, msg: '', color: 'success' as 'success' | 'danger' });

  // Alta
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Producto[]>([]);
  const [prodElegido, setProdElegido] = useState<Producto | null>(null);
  const [tipo, setTipo] = useState<'2x1' | 'pct_cantidad'>('2x1');
  const [minCant, setMinCant] = useState('3');
  const [pct, setPct] = useState('10');

  const toast$ = (msg: string, ok = true) => setToast({ show: true, msg, color: ok ? 'success' : 'danger' });

  const load = async () => {
    if (!comercio) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('ventas_promos')
      .select('id, producto_id, tipo, min_cant, pct, activa, productos(nombre)')
      .eq('comercio_id', comercio.id).order('creado_en', { ascending: false });
    setPromos((data ?? []).map((r) => ({ ...r, nombre: (r.productos as { nombre?: string } | null)?.nombre ?? '(producto)' })) as PromoRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [comercio]);

  const buscar = async (q: string) => {
    setQuery(q);
    setProdElegido(null);
    setResults(q.length >= 2 && comercio ? await buscarProductosPorNombre(comercio.id, q).catch(() => []) : []);
  };

  const guardar = async () => {
    if (!comercio || !prodElegido) { toast$('Elegí un producto', false); return; }
    const fila = {
      comercio_id: comercio.id,
      producto_id: prodElegido.id,
      tipo,
      min_cant: tipo === '2x1' ? 2 : Math.max(2, parseInt(minCant, 10) || 2),
      pct: tipo === '2x1' ? 0 : Math.min(90, Math.max(1, parseFloat(pct) || 0)),
      activa: true,
    };
    const { error } = await supabase.from('ventas_promos')
      .upsert(fila, { onConflict: 'comercio_id,producto_id' });
    if (error) { toast$(navigator.onLine ? 'No se pudo guardar la oferta. Probá de nuevo.' : 'Sin internet: las ofertas se guardan con conexión.', false); return; }
    toast$('Promo guardada');
    setQuery(''); setResults([]); setProdElegido(null);
    load();
  };

  const borrar = async (p: PromoRow) => {
    if (!(await confirmar(`¿Quitar la promo de "${p.nombre}"?`, { peligro: true, okText: 'Quitar' }))) return;
    const { error } = await supabase.from('ventas_promos').delete().eq('id', p.id);
    if (error) { toast$('No se pudo borrar', false); return; }
    setPromos(x => x.filter(y => y.id !== p.id));
  };

  const etiqueta = (p: PromoRow) =>
    p.tipo === '2x1' ? '2x1' : `−${p.pct}% llevando ${p.min_cant}+`;

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <BotonVolver />
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Ofertas</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
          2x1 o descuento por cantidad. Se aplican solas en el carrito.
        </p>

        {/* Alta */}
        <Card variant="bordered" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}>
              <MagnifyingGlass size={18} color="var(--text-3)" />
            </span>
            <input className="campo" value={prodElegido ? prodElegido.nombre : query} onChange={e => buscar(e.target.value)}
              placeholder="Buscar producto..."
              style={{ width: '100%', padding: '10px 14px 10px 38px', fontSize: 15, color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none' }} />
            {results.length > 0 && !prodElegido && (
              <div style={{ position: 'absolute', top: '105%', left: 0, right: 0, zIndex: 10, background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,.18))', overflow: 'hidden' }}>
                {results.map(r => (
                  <button key={r.id} type="button" onClick={() => { setProdElegido(r); setResults([]); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {r.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={() => setTipo('2x1')}
              style={{ padding: 10, borderRadius: 'var(--radius)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer', border: tipo === '2x1' ? '1.5px solid var(--color-primary)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)', background: tipo === '2x1' ? 'var(--color-primary-bg)' : 'var(--surface)', color: tipo === '2x1' ? 'var(--color-primary-dark)' : 'var(--text-2)' }}>
              2x1
            </button>
            <button type="button" onClick={() => setTipo('pct_cantidad')}
              style={{ padding: 10, borderRadius: 'var(--radius)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer', border: tipo === 'pct_cantidad' ? '1.5px solid var(--color-primary)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)', background: tipo === 'pct_cantidad' ? 'var(--color-primary-bg)' : 'var(--surface)', color: tipo === 'pct_cantidad' ? 'var(--color-primary-dark)' : 'var(--text-2)' }}>
              % por cantidad
            </button>
          </div>

          {tipo === 'pct_cantidad' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 3 }}>Llevando al menos</label>
                <input className="campo" type="number" value={minCant} onChange={e => setMinCant(e.target.value)}
                  style={{ width: '100%', padding: 9, fontSize: 15, textAlign: 'center', color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none' }} />
              </div>
              <div>
                <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'block', marginBottom: 3 }}>Descuento (%)</label>
                <input className="campo" type="number" value={pct} onChange={e => setPct(e.target.value)}
                  style={{ width: '100%', padding: 9, fontSize: 15, textAlign: 'center', color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none' }} />
              </div>
            </div>
          )}

          <Button fullWidth onClick={guardar} disabled={!prodElegido}>Guardar promo</Button>
        </Card>

        {/* Listado */}
        {loading ? (
          <><Skeleton height={60} style={{ marginBottom: 7 }} /><Skeleton height={60} /></>
        ) : promos.length === 0 ? (
          <EmptyState icon={<TagIcon size={44} color="var(--text-3)" />} title="Sin ofertas"
            description="Creá la primera arriba: elegí un producto y el tipo de promo." />
        ) : (
          promos.map(p => (
            <Card key={p.id} variant="bordered" style={{ padding: '12px 14px', marginBottom: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <IcoGiftIcon width={22} height={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-primary-dark)', fontWeight: 700 }}>{etiqueta(p)}</div>
                </div>
                <button onClick={() => borrar(p)} aria-label="Quitar promo" className="pressable"
                  style={{ padding: 8, border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--color-danger)', cursor: 'pointer' }}>
                  <TrashIcon size={16} />
                </button>
              </div>
            </Card>
          ))
        )}
      </div>
      <IonToast isOpen={toast.show} onDidDismiss={() => setToast(t => ({ ...t, show: false }))} message={toast.msg} duration={2500} position="top" color={toast.color} />
    </IonContent>
  );
};

export default PromosPage;

import React, { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { TruckIcon, ShareIcon } from '@heroicons/react/24/outline';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import { compartirTexto } from '../lib/compartir';
import { supabase } from '../lib/supabase';
import { todas } from '../lib/todas';
import { pedidoSugerido, ItemPedido } from '../lib/pedido';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { Header } from './ProductoPage';

// ═══════════════════════════════════════════════════════════════════════════
// Pedido a proveedores: cuánto pedir de cada producto para cubrir los días elegidos
// según lo vendido en las últimas 4 semanas (lib/pedido.ts), agrupado por proveedor,
// y el mensaje para mandar por WhatsApp. Sin internet usa solo el stock mínimo.
// ═══════════════════════════════════════════════════════════════════════════

const DIAS_VENTAS = 28;

const PedidoPage: React.FC = () => {
  const { state, productosConLotes } = useStore();
  const { comercio } = useAuth();
  const history = useHistory();
  const [toast, setToast] = useState('');
  const [dias, setDias] = useState(15);
  const [vendido, setVendido] = useState<Map<string, number> | null>(null); // null = buscando

  useEffect(() => {
    let vigente = true;
    (async () => {
      const m = new Map<string, number>();
      try {
        if (comercio && state.sucursalActivaId && navigator.onLine) {
          const desde = new Date(Date.now() - DIAS_VENTAS * 86400000).toISOString();
          const items = await todas<{ producto_id: string | null; cantidad: number }>((a, b) => supabase.from('ventas_items')
            .select('producto_id, cantidad, ventas_ventas!inner(fecha, sucursal_id, anulada)')
            .eq('comercio_id', comercio.id).eq('ventas_ventas.sucursal_id', state.sucursalActivaId)
            .eq('ventas_ventas.anulada', false).gte('ventas_ventas.fecha', desde).order('id').range(a, b));
          for (const i of items) if (i.producto_id) m.set(i.producto_id, (m.get(i.producto_id) ?? 0) + Number(i.cantidad));
        }
      } catch { /* sin datos de ventas: queda el stock mínimo */ }
      if (vigente) setVendido(m);
    })();
    return () => { vigente = false; };
  }, [comercio, state.sucursalActivaId]);

  const porProveedor = useMemo(
    () => [...pedidoSugerido(productosConLotes(), vendido ?? new Map(), DIAS_VENTAS, dias).entries()].map(([proveedor, items]) => ({ proveedor, items })),
    [productosConLotes, vendido, dias]);

  const compartirPedido = async (proveedor: string, items: ItemPedido[]) => {
    const lineas = items.map(i => `• ${i.sugerido} × ${i.nombre}`);
    const texto = `📦 Pedido de ${comercio?.nombre ?? 'mi comercio'}` +
      (proveedor !== 'Sin proveedor' ? ` para ${proveedor}` : '') +
      `:\n\n${lineas.join('\n')}\n\n(Generado con Stockly)`;
    const r = await compartirTexto(texto, `Pedido — ${proveedor}`);
    if (r === 'copiado') setToast('Pedido copiado al portapapeles');
    else if (r === 'error') setToast('No se pudo compartir el pedido');
  };

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as any}>
        <div className="animate-fade-in" style={{
          padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px',
          maxWidth: 640, margin: '0 auto',
        }}>
          <Header title="Pedido a proveedores" onBack={() => history.goBack()} />
          <p style={{ fontSize: 16, color: 'var(--text-2)', margin: '-8px 0 12px' }}>
            Cuánto pedir según lo que se vendió las últimas 4 semanas, para que te alcance:
          </p>
          <div role="radiogroup" aria-label="Para cuántos días" style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            {[7, 15, 30].map(d => (
              <button key={d} type="button" role="radio" aria-checked={dias === d} onClick={() => setDias(d)}
                className={`pressable ${dias === d ? 'boton-marca' : 'boton-blanco'}`}
                style={{ flex: 1, minHeight: 52, borderRadius: 'var(--radius-full)', border: 'none', fontSize: 17, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                {d} días
              </button>
            ))}
          </div>
          {vendido === null && <p style={{ fontSize: 16, color: 'var(--text-2)' }}>Mirando lo que se vendió…</p>}

          {porProveedor.length === 0 ? (
            <EmptyState icon={<TruckIcon width={32} height={32} />} title="Nada para pedir"
              description="Con lo que tenés alcanza para esos días. Si un producto no se vende por la app, definí su stock mínimo para que aparezca acá." />
          ) : (
            porProveedor.map(({ proveedor, items }) => (
              <Card key={proveedor} padding="md" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <TruckIcon width={18} height={18} style={{ color: 'var(--brand-600)', flexShrink: 0 }} />
                  <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, flex: 1 }}>{proveedor}</h2>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                    {items.length} producto{items.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {items.map(i => (
                    <div key={i.nombre} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 8,
                      fontSize: 16, borderBottom: '1px dashed var(--border)', paddingBottom: 8, alignItems: 'baseline',
                    }}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 700 }}>{i.nombre}</span>
                        <span style={{ fontSize: 15, color: i.tenes < 0 ? 'var(--danger)' : 'var(--text-2)' }}>
                          Tenés {i.tenes}{i.porSemana > 0 ? ` · se venden ~${i.porSemana.toLocaleString('es-AR')} por semana` : ' · bajo el mínimo'}
                        </span>
                      </span>
                      <b style={{ flexShrink: 0, fontSize: 18 }}>pedir {i.sugerido}</b>
                    </div>
                  ))}
                </div>
                <Button variant="primary" size="md" fullWidth
                  icon={<ShareIcon width={16} height={16} />}
                  onClick={() => compartirPedido(proveedor, items)}>
                  Compartir pedido
                </Button>
              </Card>
            ))
          )}
        </div>
        <IonToast isOpen={!!toast} message={toast} duration={2500} onDidDismiss={() => setToast('')} />
      </IonContent>
    </IonPage>
  );
};

export default PedidoPage;

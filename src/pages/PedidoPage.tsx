import React, { useMemo, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { TruckIcon, ShareIcon } from '@heroicons/react/24/outline';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import { compartirTexto } from '../lib/compartir';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { Header } from './ProductoPage';

// ═══════════════════════════════════════════════════════════════════════════
// Pedido a proveedores: agrupa los productos por debajo de su stock mínimo
// por proveedor y arma el mensaje de pedido para compartir por WhatsApp.
// ponytail: cantidad sugerida = llegar al DOBLE del mínimo (heurística simple);
// si algún día hace falta, hacerla configurable por producto.
// ═══════════════════════════════════════════════════════════════════════════

interface ItemPedido { nombre: string; faltan: number; sugerido: number; }

const PedidoPage: React.FC = () => {
  const { productosConLotes } = useStore();
  const { comercio } = useAuth();
  const history = useHistory();
  const [toast, setToast] = useState('');

  const porProveedor = useMemo(() => {
    const grupos = new Map<string, ItemPedido[]>();
    for (const p of productosConLotes()) {
      const min = p.producto.stockMinimo ?? 0;
      if (min <= 0 || p.cantidadTotal >= min) continue;
      const prov = p.producto.proveedor?.trim() || 'Sin proveedor';
      const item: ItemPedido = {
        nombre: p.producto.nombre,
        faltan: min - p.cantidadTotal,
        sugerido: min * 2 - p.cantidadTotal,
      };
      grupos.set(prov, [...(grupos.get(prov) ?? []), item]);
    }
    return Array.from(grupos.entries())
      .map(([proveedor, items]) => ({ proveedor, items: items.sort((a, b) => b.faltan - a.faltan) }))
      .sort((a, b) => a.proveedor.localeCompare(b.proveedor, 'es'));
  }, [productosConLotes]);

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
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '-8px 0 16px' }}>
            Productos por debajo de su stock mínimo, agrupados por proveedor.
            La cantidad sugerida repone hasta el doble del mínimo.
          </p>

          {porProveedor.length === 0 ? (
            <EmptyState icon={<TruckIcon width={32} height={32} />} title="Nada para pedir"
              description="Ningún producto está por debajo de su stock mínimo. Definí el mínimo en cada producto para que aparezca acá." />
          ) : (
            porProveedor.map(({ proveedor, items }) => (
              <Card key={proveedor} padding="md" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <TruckIcon width={18} height={18} style={{ color: 'var(--brand-600)', flexShrink: 0 }} />
                  <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, flex: 1 }}>{proveedor}</h2>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {items.length} producto{items.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {items.map(i => (
                    <div key={i.nombre} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 8,
                      fontSize: 13, borderBottom: '1px dashed var(--border)', paddingBottom: 6,
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.nombre}</span>
                      <span style={{ flexShrink: 0, color: 'var(--text-2)' }}>
                        faltan {i.faltan} · <b style={{ color: 'var(--text)' }}>pedir {i.sugerido}</b>
                      </span>
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

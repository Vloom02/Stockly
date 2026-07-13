import React, { useState, useEffect } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon, QrCodeIcon, PlusIcon, TrashIcon, CubeIcon,
} from '@heroicons/react/24/outline';
import {
  useStore, CATEGORIAS, DIAS_AVISO_DEFAULT,
  formatearFecha, colorNivel,
  calcularNivelAlerta, textoEstado,
} from '../context/StoreContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Input';
import { NivelBadge } from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import ScannerModal from '../components/ScannerModal';
import { useAuth } from '../context/AuthContext';
import { elegirYSubirFoto } from '../lib/fotos';
import { supabase } from '../lib/supabase';
import { formatearMoneda } from '../context/StoreContext';

interface RouteParams { id?: string; }

const ProductoPage: React.FC = () => {
  const { state, addProducto, updateProducto, deleteProducto, fefoSugeridos, buscarProductoPorCodigo } = useStore();
  const { comercio } = useAuth();
  const history = useHistory();
  const { id } = useParams<RouteParams>();
  const esNuevo = id === 'nuevo' || !id;
  const productoId = !esNuevo ? id : undefined;

  const productoExistente = productoId ? state.productos.find(p => p.id === productoId) : undefined;

  const [nombre, setNombre] = useState(productoExistente?.nombre || '');
  const [codigoBarras, setCodigoBarras] = useState(productoExistente?.codigoBarras || '');
  const [categoria, setCategoria] = useState(productoExistente?.categoria || '');
  const [precio, setPrecio] = useState(productoExistente?.precio.toString() || '0');
  const [proveedor, setProveedor] = useState(productoExistente?.proveedor || '');
  const [stockMinimo, setStockMinimo] = useState((productoExistente?.stockMinimo ?? 0).toString());
  const [fotoUrl, setFotoUrl] = useState(productoExistente?.fotoUrl);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [diasAviso, setDiasAviso] = useState(
    productoExistente?.diasAvisoDefault.toString() || DIAS_AVISO_DEFAULT().toString()
  );
  const [toast, setToast] = useState({ show: false, msg: '' });
  const [showScanner, setShowScanner] = useState(false);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const lotes = productoId ? fefoSugeridos(productoId) : [];

  // Historial de precios (lo registra un trigger en la DB; solo lectura, online).
  const [historialPrecios, setHistorialPrecios] = useState<
    { precio_anterior: number; precio_nuevo: number; cambiado_en: string }[]
  >([]);
  useEffect(() => {
    if (!productoId || !navigator.onLine) return;
    supabase.from('precios_historial')
      .select('precio_anterior, precio_nuevo, cambiado_en')
      .eq('producto_id', productoId)
      .order('cambiado_en', { ascending: false })
      .limit(8)
      .then(({ data }) => setHistorialPrecios(data ?? []));
  }, [productoId]);

  const handleGuardar = async () => {
    if (!nombre.trim()) { setToast({ show: true, msg: 'El nombre es obligatorio' }); return; }
    if (codigoBarras.trim()) {
      const ex = buscarProductoPorCodigo(codigoBarras.trim());
      if (ex && ex.id !== productoId) { setToast({ show: true, msg: 'Ya existe un producto con ese código' }); return; }
    }
    const datos = {
      nombre: nombre.trim(),
      codigoBarras: codigoBarras.trim() || undefined,
      categoria: categoria.trim() || 'Sin categoría',
      precio: parseFloat(precio) || 0,
      proveedor: proveedor.trim() || undefined,
      stockMinimo: Math.max(0, parseInt(stockMinimo, 10) || 0),
      diasAvisoDefault: parseInt(diasAviso, 10) || 7,
    };
    if (productoExistente) {
      await updateProducto({ ...productoExistente, ...datos });
      history.goBack();
    } else {
      const nuevoId = await addProducto(datos);
      history.replace(`/lote/nuevo?productoId=${nuevoId}`);
    }
  };

  const handleFoto = async () => {
    if (!productoExistente?.id || !comercio?.id) return;
    setSubiendoFoto(true);
    try {
      const url = await elegirYSubirFoto(comercio.id, productoExistente.id);
      if (url) {
        setFotoUrl(url);
        await updateProducto({ ...productoExistente, fotoUrl: url });
        setToast({ show: true, msg: 'Foto actualizada' });
      }
    } catch (e) {
      setToast({ show: true, msg: e instanceof Error ? e.message : 'No se pudo subir la foto' });
    }
    setSubiendoFoto(false);
  };

  const handleEliminar = async () => {
    if (!productoExistente?.id) return;
    if (lotes.length > 0) { setToast({ show: true, msg: 'Eliminá primero todos los lotes' }); return; }
    if (!confirmarBorrado) {
      setConfirmarBorrado(true);
      setToast({ show: true, msg: 'Tocá de nuevo "Eliminar" para confirmar' });
      setTimeout(() => setConfirmarBorrado(false), 4000);
      return;
    }
    await deleteProducto(productoExistente.id);
    history.goBack();
  };

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as any}>
        <div className="animate-fade-in" style={{
          padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px',
          maxWidth: 640, margin: '0 auto',
        }}>
          <Header title={esNuevo ? 'Nuevo producto' : 'Editar producto'} onBack={() => history.goBack()} />

          <Card padding="md" style={{ marginBottom: 16 }}>
            <Field label="Nombre del producto" required>
              <Input value={nombre} onChange={e => setNombre(e.target.value)}
                placeholder="Ej: Leche La Serenísima 1L" />
            </Field>

            <Field label="Código de barras">
              <Input
                value={codigoBarras}
                onChange={e => setCodigoBarras(e.target.value)}
                inputMode="numeric"
                placeholder="Opcional"
                leftIcon={<QrCodeIcon width={18} height={18} />}
                rightAddon={
                  <Button variant="primary" size="md" onClick={() => setShowScanner(true)}
                    icon={<QrCodeIcon width={18} height={18} />} style={{ padding: '0 14px' }} />
                }
              />
            </Field>

            <Field label="Categoría">
              <Select value={categoria} onChange={e => setCategoria(e.target.value)}>
                <option value="">— Sin categoría —</option>
                {CATEGORIAS().map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>

            <Field label="Proveedor" hint="Quién te lo provee">
              <Input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Opcional" />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Precio unitario ($)">
                <Input value={precio} onChange={e => setPrecio(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Días aviso default" hint="Anticipación">
                <Input value={diasAviso} onChange={e => setDiasAviso(e.target.value)} inputMode="numeric" />
              </Field>
            </div>

            <Field label="Stock mínimo" hint="Avisa para reponer si el total queda por debajo (0 = sin aviso)">
              <Input value={stockMinimo} onChange={e => setStockMinimo(e.target.value)} inputMode="numeric" />
            </Field>

            {productoExistente && (
              <Field label="Foto" hint="Se ve como miniatura en las listas">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {fotoUrl ? (
                    <img src={fotoUrl} alt={nombre} style={{
                      width: 56, height: 56, objectFit: 'cover',
                      borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                    }} />
                  ) : (
                    <div style={{
                      width: 56, height: 56, borderRadius: 'var(--radius)',
                      border: '1px dashed var(--border)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)',
                    }}>
                      <CubeIcon width={22} height={22} />
                    </div>
                  )}
                  <Button variant="secondary" size="md" onClick={handleFoto} disabled={subiendoFoto}>
                    {subiendoFoto ? 'Subiendo…' : fotoUrl ? 'Cambiar foto' : 'Agregar foto'}
                  </Button>
                </div>
              </Field>
            )}

            <Button variant="primary" size="lg" fullWidth onClick={handleGuardar}
              icon={<PlusIcon width={18} height={18} />} style={{ marginTop: 8 }}>
              {esNuevo ? 'Crear producto' : 'Guardar cambios'}
            </Button>
          </Card>

          {/* Lotes FEFO */}
          {productoExistente && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>Lotes</h2>
                <Button variant="secondary" size="sm"
                  onClick={() => history.push(`/lote/nuevo?productoId=${productoExistente.id}`)}
                  icon={<PlusIcon width={16} height={16} />}>Nuevo lote</Button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 12px' }}>
                Ordenados por FEFO · vendé primero los de arriba
              </p>

              {lotes.length === 0 ? (
                <EmptyState icon={<CubeIcon width={28} height={28} />} title="Sin lotes cargados"
                  description="Agregá un lote con su fecha de vencimiento." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {lotes.map((l, i) => {
                    const nivel = calcularNivelAlerta(l.fechaVencimiento, l.diasAviso);
                    return (
                      <Card key={l.id} padding="sm" onClick={() => history.push(`/lote/${l.id}`)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                            background: colorNivel(nivel), color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 13, flexShrink: 0,
                          }}>{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>
                              {l.cantidad} unid.{l.numeroLote ? ` · Lote ${l.numeroLote}` : ''}
                            </div>
                            <div style={{ marginTop: 4 }}>
                              <NivelBadge nivel={nivel} />
                              <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 8 }}>
                                {textoEstado(l.fechaVencimiento)}
                              </span>
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{formatearFecha(l.fechaVencimiento)}</div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}

              {historialPrecios.length > 0 && (
                <>
                  <h2 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', margin: '20px 0 4px' }}>
                    Historial de precios
                  </h2>
                  <Card padding="sm" style={{ marginBottom: 16 }}>
                    {historialPrecios.map((h, i) => {
                      const pct = h.precio_anterior > 0
                        ? Math.round(((h.precio_nuevo - h.precio_anterior) / h.precio_anterior) * 100) : 0;
                      const subio = h.precio_nuevo > h.precio_anterior;
                      return (
                        <div key={i} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          gap: 8, fontSize: 13, padding: '6px 4px',
                          borderBottom: i < historialPrecios.length - 1 ? '1px dashed var(--border)' : 'none',
                        }}>
                          <span style={{ color: 'var(--text-2)' }}>
                            {new Date(h.cambiado_en).toLocaleDateString('es-AR')}
                          </span>
                          <span>
                            {formatearMoneda(Number(h.precio_anterior))} → <b>{formatearMoneda(Number(h.precio_nuevo))}</b>
                          </span>
                          <span style={{
                            fontWeight: 700, fontSize: 12,
                            color: subio ? 'var(--danger)' : 'var(--level-ok-fg)',
                          }}>
                            {subio ? '+' : ''}{pct}%
                          </span>
                        </div>
                      );
                    })}
                  </Card>
                </>
              )}

              <Button variant="ghost" size="md" fullWidth onClick={handleEliminar}
                icon={<TrashIcon width={16} height={16} />}
                style={{ color: 'var(--danger)' }}>
                Eliminar producto
              </Button>
            </>
          )}
        </div>

        {showScanner && (
          <ScannerModal
            onCodigoDetectado={(c) => { setCodigoBarras(c); setShowScanner(false); }}
            onCancel={() => setShowScanner(false)}
          />
        )}

        <IonToast isOpen={toast.show} message={toast.msg} duration={2500}
          onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

export const Header: React.FC<{ title: string; onBack: () => void; action?: React.ReactNode }> =
  ({ title, onBack, action }) => (
    <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
      <button type="button" onClick={onBack}
        style={{
          width: 40, height: 40, borderRadius: 'var(--radius)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--text)', flexShrink: 0,
        }}>
        <ArrowLeftIcon width={20} height={20} />
      </button>
      <h1 style={{ fontSize: 20, fontWeight: 700, flex: 1, letterSpacing: '-0.02em' }}>{title}</h1>
      {action}
    </header>
  );

export default ProductoPage;

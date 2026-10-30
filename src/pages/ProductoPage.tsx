import { useConfirm } from '../lib/useConfirm';
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
import { Field, Input, Opciones } from '../components/ui/Input';
import { NivelBadge } from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import ScannerModal from '../components/ScannerModal';
import { useAuth } from '../context/AuthContext';
import { elegirYSubirFoto } from '../lib/fotos';
import { supabase } from '../lib/supabase';
import { formatearMoneda } from '../context/StoreContext';

import { parseMonto } from '../lib/numeros';
import { useLectorFisico } from '../lib/useLectorFisico';
interface RouteParams { id?: string; }

// Ionic REUTILIZA la instancia de la página cuando /producto/A y /producto/nuevo
// matchean el mismo Route: los useState iniciales del form quedaban con los datos
// del producto anterior y "Crear producto" generaba un duplicado. El key por :id
// fuerza remontar el form en cada cambio de ruta.
const ProductoPage: React.FC = () => {
  const { id } = useParams<RouteParams>();
  return <ProductoForm key={id ?? 'nuevo'} />;
};

const ProductoForm: React.FC = () => {
  const { state, addProducto, updateProducto, deleteProducto, fefoSugeridos, buscarProductoPorCodigo } = useStore();
  const { comercio, esDueno } = useAuth();
  const history = useHistory();
  const { id } = useParams<RouteParams>();
  const esNuevo = id === 'nuevo' || !id;
  const productoId = !esNuevo ? id : undefined;

  const productoExistente = productoId ? state.productos.find(p => p.id === productoId) : undefined;

  const [nombre, setNombre] = useState(productoExistente?.nombre || '');
  const [codigoBarras, setCodigoBarras] = useState(productoExistente?.codigoBarras || '');
  const lectorRef = useLectorFisico<HTMLIonContentElement>(setCodigoBarras); // lector físico completa el código
  const [categoria, setCategoria] = useState(productoExistente?.categoria || '');
  const [precio, setPrecio] = useState(productoExistente?.precio ? productoExistente.precio.toString() : '');
  const [proveedor, setProveedor] = useState(productoExistente?.proveedor || '');
  const [stockMinimo, setStockMinimo] = useState((productoExistente?.stockMinimo ?? 0).toString());
  const [costo, setCosto] = useState(productoExistente?.costo?.toString() ?? '');
  const [fotoUrl, setFotoUrl] = useState(productoExistente?.fotoUrl);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [diasAviso, setDiasAviso] = useState(
    productoExistente?.diasAvisoDefault.toString() || DIAS_AVISO_DEFAULT().toString()
  );
  const [toast, setToast] = useState({ show: false, msg: '' });
  const [showScanner, setShowScanner] = useState(false);
  const confirmar = useConfirm();
  const [guardando, setGuardando] = useState(false);

  const lotes = productoId ? fefoSugeridos(productoId) : [];
  // Vendido sin stock: lotes en negativo de este producto en el local (el próximo ingreso los cubre).
  const faltan = productoId
    ? -state.lotes.filter(l => l.productoId === productoId && l.sucursalId === state.sucursalActivaId && l.cantidad < 0).reduce((s, l) => s + l.cantidad, 0)
    : 0;

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

  const [errores, setErrores] = useState<Record<string, string>>({});

  const handleGuardar = async () => {
    if (guardando) return; // anti doble-tap: evita crear dos veces
    // Errores al lado de cada campo, en palabras simples y diciendo cómo arreglarlo.
    const err: Record<string, string> = {};
    if (!nombre.trim()) err.nombre = 'Escribí el nombre del producto.';
    if (codigoBarras.trim()) {
      const ex = buscarProductoPorCodigo(codigoBarras.trim());
      if (ex && ex.id !== productoId) err.codigo = `Ese código ya es de "${ex.nombre}". Revisalo o dejalo vacío.`;
    }
    // Al CREAR, bloquear nombre exacto repetido (otra fuente de duplicados).
    if (!productoExistente && nombre.trim()) {
      const nombreNorm = nombre.trim().toLowerCase();
      const repetido = state.productos.find(p => p.activo && p.nombre.trim().toLowerCase() === nombreNorm);
      if (repetido) err.nombre = `Ya existe "${repetido.nombre}". Buscalo en Mercadería para cambiarlo.`;
    }
    // Sin precio se vendía a $0 sin aviso; negativo, el servidor rechazaba la venta y quedaba trabada.
    const precioNum = parseMonto(precio);
    if (!precio.trim()) err.precio = 'Poné el precio de venta, por ejemplo 1.500';
    else if (Number.isNaN(precioNum)) err.precio = 'Escribí solo el número, por ejemplo 1.500';
    else if (precioNum <= 0) err.precio = 'El precio tiene que ser mayor que 0';
    if (costo.trim() && Number.isNaN(parseMonto(costo))) err.costo = 'Escribí solo el número, por ejemplo 900';
    setErrores(err);
    if (Object.keys(err).length) return;
    const datos = {
      nombre: nombre.trim(),
      codigoBarras: codigoBarras.trim() || undefined,
      categoria: categoria.trim() || 'Sin categoría',
      precio: precioNum,
      proveedor: proveedor.trim() || undefined,
      stockMinimo: Math.max(0, parseInt(stockMinimo, 10) || 0),
      costo: costo.trim() ? Math.max(0, parseMonto(costo)) : undefined,
      diasAvisoDefault: parseInt(diasAviso, 10) || 7,
    };
    setGuardando(true);
    try {
      if (productoExistente) {
        await updateProducto({ ...productoExistente, ...datos });
        history.goBack();
      } else {
        const nuevoId = await addProducto(datos);
        history.replace(`/lote/nuevo?productoId=${nuevoId}`);
      }
    } finally {
      setGuardando(false);
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
    if (!(await confirmar(`¿Eliminar "${productoExistente.nombre}"?`, { peligro: true, okText: 'Eliminar' }))) return;
    await deleteProducto(productoExistente.id);
    history.goBack();
  };

  return (
    <IonPage>
      <IonContent ref={lectorRef} style={{ '--background': 'var(--bg)' } as any}>
        <div className="animate-fade-in" style={{
          padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px',
          maxWidth: 640, margin: '0 auto',
        }}>
          <Header title={esNuevo ? 'Nuevo producto' : esDueno ? 'Editar producto' : 'Producto'} onBack={() => history.goBack()} />
          {!esDueno && (
            <p role="note" style={{ fontSize: 16, color: 'var(--text-2)', background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 12 }}>
              {esNuevo ? 'Solo el dueño puede crear productos nuevos. Pedíselo y después cargá la mercadería.' : 'Solo el dueño puede cambiar los datos o el precio del producto.'}
            </p>
          )}

          <Card padding="md" style={{ marginBottom: 16 }}>
            <Field label="Nombre del producto" required error={errores.nombre}>
              <Input value={nombre} onChange={e => { setNombre(e.target.value); setErrores(x => ({ ...x, nombre: '' })); }}
                placeholder="Ej: Leche La Serenísima 1L" />
            </Field>

            <Field label="Código de barras" error={errores.codigo}>
              <Input
                value={codigoBarras}
                onChange={e => { setCodigoBarras(e.target.value); setErrores(x => ({ ...x, codigo: '' })); }}
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
              <Opciones etiqueta="Categoría" valor={categoria} onChange={setCategoria}
                opciones={[{ valor: '', etiqueta: 'Sin categoría' },
                  ...(categoria && !CATEGORIAS().includes(categoria) ? [categoria, ...CATEGORIAS()] : CATEGORIAS())
                    .map(c => ({ valor: c, etiqueta: c }))]} />
            </Field>

            <Field label="Proveedor" hint="Quién te lo provee">
              <Input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Opcional" />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Precio de venta ($)" error={errores.precio}>
                <Input value={precio} onChange={e => { setPrecio(e.target.value); setErrores(x => ({ ...x, precio: '' })); }} inputMode="decimal" />
              </Field>
              <Field label="Avisar antes de vencer" hint="Días de anticipación">
                <Input value={diasAviso} onChange={e => setDiasAviso(e.target.value)} inputMode="numeric" />
              </Field>
            </div>

            {esDueno && (() => {
              // Ganancia por unidad a la vista mientras se escribe (solo el dueño ve el costo).
              const pv = parseMonto(precio), pc = parseMonto(costo);
              const gana = costo.trim() && pv > 0 && !Number.isNaN(pc) ? pv - pc : null;
              return (
                <Field label="Precio de costo ($)" error={errores.costo}
                  hint={gana === null ? 'Lo que te cuesta a vos. Opcional: con esto ves cuánto ganás.'
                    : gana >= 0 ? `Ganás ${formatearMoneda(gana)} por unidad (${Math.round(gana / pv * 100)} %)`
                    : `Ojo: lo vendés ${formatearMoneda(-gana)} por debajo del costo`}>
                  <Input value={costo} onChange={e => { setCosto(e.target.value); setErrores(x => ({ ...x, costo: '' })); }} inputMode="decimal" placeholder="Opcional" />
                </Field>
              );
            })()}

            <Field label="Stock mínimo" hint="Avisa para reponer si el total queda por debajo (0 = sin aviso)">
              <Input value={stockMinimo} onChange={e => setStockMinimo(e.target.value)} inputMode="numeric" />
            </Field>

            {productoExistente && (
              <Field label="Foto" hint="Se ve como miniatura en las listas">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {fotoUrl ? (
                    <img src={fotoUrl} alt={nombre} style={{
                      width: 56, height: 56, objectFit: 'cover',
                      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)',
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

            {esDueno && (
              <Button variant="primary" size="lg" fullWidth onClick={handleGuardar} disabled={guardando}
                icon={<PlusIcon width={18} height={18} />} style={{ marginTop: 8 }}>
                {guardando ? 'Guardando…' : esNuevo ? 'Crear producto' : 'Guardar cambios'}
              </Button>
            )}
          </Card>

          {/* Lotes FEFO */}
          {productoExistente && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <h2 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>Mercadería cargada</h2>
                <Button variant="secondary" size="sm"
                  onClick={() => history.push(`/lote/nuevo?productoId=${productoExistente.id}`)}
                  icon={<PlusIcon width={16} height={16} />}>Cargar más</Button>
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '0 0 12px' }}>
                Vendé primero las de arriba: son las que vencen antes
              </p>
              {faltan > 0 && (
                <p role="status" style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px', padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--level-vencido-bg)', color: 'var(--level-vencido-fg)' }}>
                  Se vendieron {faltan} sin stock cargado. Cuando cargues mercadería se descuentan solas.
                </p>
              )}

              {lotes.length === 0 ? (
                <EmptyState icon={<CubeIcon width={28} height={28} />} title="No hay mercadería cargada"
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
                            fontWeight: 700, fontSize: 14, flexShrink: 0,
                          }}>{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>
                              {l.cantidad} unid.{l.numeroLote ? ` · Lote ${l.numeroLote}` : ''}
                            </div>
                            <div style={{ marginTop: 4 }}>
                              <NivelBadge nivel={nivel} />
                              <span style={{ fontSize: 14, color: 'var(--text-2)', marginLeft: 8 }}>
                                {textoEstado(l.fechaVencimiento)}
                              </span>
                            </div>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{formatearFecha(l.fechaVencimiento)}</div>
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
                          gap: 8, fontSize: 14, padding: '6px 4px',
                          borderBottom: i < historialPrecios.length - 1 ? '1px dashed var(--border)' : 'none',
                        }}>
                          <span style={{ color: 'var(--text-2)' }}>
                            {new Date(h.cambiado_en).toLocaleDateString('es-AR')}
                          </span>
                          <span>
                            {formatearMoneda(Number(h.precio_anterior))} → <b>{formatearMoneda(Number(h.precio_nuevo))}</b>
                          </span>
                          <span style={{
                            fontWeight: 700, fontSize: 14,
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

              {esDueno && (
                <Button variant="ghost" size="md" fullWidth onClick={handleEliminar}
                  icon={<TrashIcon width={16} height={16} />}
                  style={{ color: 'var(--danger)' }}>
                  Eliminar producto
                </Button>
              )}
            </>
          )}
        </div>

        {showScanner && (
          <ScannerModal
            onCodigoDetectado={(c) => { setCodigoBarras(c); setShowScanner(false); }}
            onCancel={() => setShowScanner(false)}
          />
        )}

        <IonToast isOpen={toast.show} message={toast.msg} duration={4500}
          onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

export const Header: React.FC<{ title: string; onBack: () => void; action?: React.ReactNode }> =
  ({ title, onBack, action }) => (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, rowGap: 8, marginBottom: 20 }}>
      {/* Con la palabra y grande (48 px): una flecha sola de 40 px no se entendía ni se acertaba. */}
      <button type="button" onClick={onBack} className="pressable"
        style={{
          minHeight: 48, padding: '0 16px 0 10px', borderRadius: 'var(--radius-full)',
          background: 'var(--surface)', border: 'none', boxShadow: 'var(--shadow-sm)',
          display: 'inline-flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', color: 'var(--text)', flexShrink: 0,
          fontSize: 17, fontWeight: 600, fontFamily: 'inherit',
        }}>
        <ArrowLeftIcon width={22} height={22} aria-hidden="true" /> Volver
      </button>
      <h1 style={{ fontSize: 20, fontWeight: 700, flex: 1, minWidth: 160, letterSpacing: '-0.02em' }}>{title}</h1>
      {action}
    </header>
  );

export default ProductoPage;

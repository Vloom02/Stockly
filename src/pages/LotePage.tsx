import React, { useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory, useParams, useLocation } from 'react-router-dom';
import {
  BanknotesIcon, TrashIcon, HeartIcon, CheckIcon,
} from '@heroicons/react/24/outline';
import {
  useStore, formatearFecha, colorNivel, formatearMoneda,
  calcularNivelAlerta, textoEstado, descuentoConfig,
} from '../context/StoreContext';
import { sugerirLiquidacion } from '../lib/liquidacion';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import ScannerModal from '../components/ScannerModal';
import { NivelBadge } from '../components/ui/Badge';
import { Header } from './ProductoPage';
import { useAuth } from '../context/AuthContext';
import { TagIcon as IcoTagIcon } from '@heroicons/react/24/outline';

interface RouteParams { id?: string; }

// Mismo fix que ProductoPage: Ionic reutiliza la instancia de la página entre
// /lote/A y /lote/nuevo (mismo Route) y el form arrastraba los datos del lote
// anterior → lotes duplicados. El key por :id (+productoId del query) remonta.
const LotePage: React.FC = () => {
  const { id } = useParams<RouteParams>();
  const location = useLocation();
  return <LoteForm key={`${id ?? 'nuevo'}${location.search}`} />;
};

const LoteForm: React.FC = () => {
  const { state, addLote, updateLote, retirarLote } = useStore();
  const history = useHistory();
  const { esDueno } = useAuth();
  const location = useLocation();
  const { id } = useParams<RouteParams>();
  const esNuevo = id === 'nuevo' || !id;
  const loteId = !esNuevo ? id : undefined;

  const productoIdInicial = new URLSearchParams(location.search).get('productoId');
  const loteExistente = loteId ? state.lotes.find(l => l.id === loteId) : undefined;

  const [productoId, setProductoId] = useState<string>(
    loteExistente?.productoId ?? (productoIdInicial || '')
  );
  const [cantidad, setCantidad] = useState(loteExistente?.cantidad.toString() || '1');
  const [fechaVencimiento, setFechaVencimiento] = useState(loteExistente?.fechaVencimiento || fechaTresMeses());
  const [diasAviso, setDiasAviso] = useState(loteExistente?.diasAviso.toString() || '');
  const [numeroLote, setNumeroLote] = useState(loteExistente?.numeroLote || '');

  // Cargar mercadería nueva = asistente de 3 pasos (una pregunta por pantalla).
  const [paso, setPaso] = useState<1 | 2 | 3>(productoIdInicial ? 2 : 1);
  const [busqueda, setBusqueda] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [conNumeroLote, setConNumeroLote] = useState(false);
  const [showRetirar, setShowRetirar] = useState(false);
  const [tipoRetiro, setTipoRetiro] = useState<'retiro_venta' | 'retiro_vencido' | 'retiro_roto'>('retiro_venta');
  const [cantRetirar, setCantRetirar] = useState('');
  const [notasRetiro, setNotasRetiro] = useState('');
  const [toast, setToast] = useState({ show: false, msg: '' });
  const [procesando, setProcesando] = useState(false); // anti doble-tap (guardar y retirar)
  // Mostrar el override de días de aviso si el lote ya lo tenía seteado.
  const [mostrarAvanzado, setMostrarAvanzado] = useState(!!loteExistente?.diasAviso &&
    loteExistente.diasAviso !== state.productos.find(p => p.id === loteExistente.productoId)?.diasAvisoDefault);

  const producto = productoId ? state.productos.find(p => p.id === productoId) : undefined;
  const diasAvisoEf = diasAviso ? parseInt(diasAviso, 10) : (producto?.diasAvisoDefault || 7);
  const nivel = fechaVencimiento ? calcularNivelAlerta(fechaVencimiento, diasAvisoEf) : 'ok';
  // Compra vencida: lo que hay que hacer es sacarla, así que ese bloque va primero.
  const vencidaPrimero = !!loteExistente && nivel === 'vencido' && loteExistente.cantidad > 0;
  // Sugerencia de liquidación FEFO (si el lote está próximo a vencer y hay precio).
  const liq = producto && fechaVencimiento ? sugerirLiquidacion(nivel, producto.precio, descuentoConfig()) : null;

  const handleGuardar = async () => {
    if (!productoId) { setToast({ show: true, msg: 'Elegí un producto' }); return; }
    const cant = parseInt(cantidad, 10);
    if (!Number.isFinite(cant) || cant <= 0) { setToast({ show: true, msg: 'Cantidad inválida' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaVencimiento)) { setToast({ show: true, msg: 'Fecha inválida' }); return; }

    if (procesando) return;
    const datos = {
      productoId: productoId,
      sucursalId: state.sucursalActivaId,
      cantidad: cant,
      fechaVencimiento,
      diasAviso: diasAvisoEf,
      numeroLote: numeroLote.trim() || undefined,
    };
    setProcesando(true);
    try {
      if (loteExistente) await updateLote({ ...loteExistente, ...datos });
      else await addLote(datos);
      history.goBack();
    } finally {
      setProcesando(false);
    }
  };

  const handleRetirar = async () => {
    if (!loteExistente?.id || procesando) return;
    const cant = parseInt(cantRetirar, 10);
    if (!Number.isFinite(cant) || cant <= 0 || cant > loteExistente.cantidad) {
      setToast({ show: true, msg: 'Cantidad inválida' }); return;
    }
    setProcesando(true);
    try {
      await retirarLote(loteExistente.id, tipoRetiro, cant, notasRetiro.trim() || undefined);
      history.goBack();
    } finally {
      setProcesando(false);
    }
  };

  if (esNuevo) {
    const q = busqueda.trim().toLowerCase();
    const lista = state.productos
      .filter(p => !q || p.nombre.toLowerCase().includes(q) || (p.codigoBarras ?? '').includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .slice(0, 40);
    const cant = parseInt(cantidad, 10) || 0;
    const sumar = (n: number) => setCantidad(String(Math.max(1, cant + n)));
    const atras = () => (paso > 1 ? setPaso((paso - 1) as 1 | 2) : history.goBack());
    const titulos = { 1: '¿Qué producto entró?', 2: '¿Cuántas unidades entraron?', 3: '¿Cuándo vence?' };

    return (
      <IonPage>
        <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
          <div style={{ padding: '20px 16px calc(110px + var(--sab,env(safe-area-inset-bottom))) 16px', maxWidth: 640, margin: '0 auto' }}>
            <Header title="Cargar mercadería" onBack={atras} />

            {/* Progreso: 3 tramos y texto */}
            <div aria-label={`Paso ${paso} de 3`} style={{ marginBottom: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 6 }}>
                {[1, 2, 3].map(n => (
                  <span key={n} className="barra-paso" style={{ height: 8, borderRadius: 4, background: n <= paso ? 'var(--brand-500)' : 'var(--surface-2)' }} />
                ))}
              </div>
              <span style={{ fontSize: 15, color: 'var(--text-2)', fontWeight: 600 }}>Paso {paso} de 3</span>
            </div>

            <div key={paso} className="anim-paso">
              <h2 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px', lineHeight: 1.2 }}>{titulos[paso]}</h2>
              {paso > 1 && producto && (
                <p style={{ fontSize: 17, color: 'var(--text-2)', margin: '0 0 16px' }}>{producto.nombre}</p>
              )}

              {paso === 1 && (
                <>
                  <div style={{ display: 'flex', gap: 8, margin: '12px 0 14px' }}>
                    <div style={{ flex: 1 }}>
                      <Input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Escribí el nombre" aria-label="Buscar producto" />
                    </div>
                    <button type="button" onClick={() => setShowScanner(true)} className="pressable boton-marca" aria-label="Escanear el código"
                      style={{ minWidth: 56, minHeight: 48, borderRadius: 'var(--radius)', border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: '0 12px' }}>
                      Escanear
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {lista.map((p, i) => (
                      <button key={p.id} type="button" className="pressable anim-entrar"
                        onClick={() => { setProductoId(p.id ?? ''); setPaso(2); }}
                        style={{ '--i': Math.min(i, 10), display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minHeight: 62, padding: '10px 16px', borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--text)' } as React.CSSProperties}>
                        <span style={{ fontSize: 18, fontWeight: 700 }}>{p.nombre}</span>
                        <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{p.categoria}</span>
                      </button>
                    ))}
                    {lista.length === 0 && (
                      <p style={{ fontSize: 17, color: 'var(--text-2)', textAlign: 'center', padding: 20 }}>
                        No encontré ese producto.
                      </p>
                    )}
                  </div>
                  <p style={{ fontSize: 16, color: 'var(--text-2)', marginTop: 16, textAlign: 'center' }}>
                    {esDueno
                      ? <>¿No está? <button type="button" onClick={() => history.push('/producto/nuevo')} style={{ background: 'none', border: 'none', color: 'var(--brand-600)', fontWeight: 700, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 16, minHeight: 44 }}>Crear producto nuevo</button></>
                      : '¿No está? Pedile al dueño que cree el producto.'}
                  </p>
                </>
              )}

              {paso === 2 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '18px 0' }}>
                    <button type="button" onClick={() => sumar(-1)} className="pressable" aria-label="Una menos"
                      style={{ width: 64, height: 64, borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', fontSize: 32, fontWeight: 700, color: 'var(--text)', cursor: 'pointer' }}>−</button>
                    <input className="campo" value={cantidad} onChange={e => setCantidad(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Cantidad de unidades"
                      onFocus={e => e.target.select()}
                      style={{ width: 120, height: 72, textAlign: 'center', fontSize: 40, fontWeight: 800, borderRadius: 'var(--radius-lg)', border: '2px solid var(--brand-500)', color: 'var(--text)', fontFamily: 'inherit' }} />
                    <button type="button" onClick={() => sumar(1)} className="pressable" aria-label="Una más"
                      style={{ width: 64, height: 64, borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', fontSize: 32, fontWeight: 700, color: 'var(--text)', cursor: 'pointer' }}>+</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
                    {[6, 12, 24, 48].map(n => (
                      <button key={n} type="button" onClick={() => setCantidad(String(n))} className="pressable" aria-pressed={cant === n}
                        style={{ minHeight: 52, borderRadius: 'var(--radius)', border: cant === n ? '3px solid var(--brand-500)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)', background: cant === n ? 'var(--brand-50)' : 'var(--surface)', fontSize: 18, fontWeight: 700, color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit' }}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <Button variant="primary" size="lg" fullWidth disabled={cant <= 0} onClick={() => setPaso(3)}>Siguiente</Button>
                </>
              )}

              {paso === 3 && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '14px 0 10px' }}>
                    {ATAJOS_VENCIMIENTO.map(a => {
                      const valor = sumarFecha(a.dias, a.meses);
                      const activo = valor === fechaVencimiento;
                      return (
                        <button key={a.label} type="button" onClick={() => setFechaVencimiento(valor)} aria-pressed={activo} className="pressable"
                          style={{ minHeight: 56, borderRadius: 'var(--radius)', border: activo ? '3px solid var(--brand-500)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)', background: activo ? 'var(--brand-50)' : 'var(--surface)', color: 'var(--text)', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                  <Field label="O elegí la fecha exacta">
                    <Input type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)} />
                  </Field>
                  {fechaVencimiento && (
                    <p style={{ fontSize: 17, fontWeight: 600, color: colorNivel(nivel), margin: '4px 0 14px' }}>
                      {cant} {cant === 1 ? 'unidad' : 'unidades'} · {textoEstado(fechaVencimiento)} ({formatearFecha(fechaVencimiento)})
                    </p>
                  )}
                  {conNumeroLote ? (
                    <Field label="Número de lote del paquete (opcional)">
                      <Input value={numeroLote} onChange={e => setNumeroLote(e.target.value)} placeholder="Opcional" />
                    </Field>
                  ) : (
                    <button type="button" onClick={() => setConNumeroLote(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--brand-600)', fontWeight: 600, fontSize: 16, cursor: 'pointer', padding: '8px 0', marginBottom: 8, minHeight: 44, fontFamily: 'inherit' }}>
                      + Agregar número de lote del paquete
                    </button>
                  )}
                  <Button variant="primary" size="lg" fullWidth onClick={handleGuardar} disabled={procesando}
                    icon={<CheckIcon width={22} height={22} />}>
                    {procesando ? 'Guardando…' : 'Guardar'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {showScanner && (
            <ScannerModal
              onCodigoDetectado={(codigo) => {
                setShowScanner(false);
                const p = state.productos.find(x => x.codigoBarras === codigo);
                if (p) { setProductoId(p.id ?? ''); setPaso(2); } else { setBusqueda(codigo); setToast({ show: true, msg: 'No hay un producto con ese código' }); }
              }}
              onCancel={() => setShowScanner(false)}
            />
          )}
          <IonToast isOpen={toast.show} message={toast.msg} duration={2500}
            onDidDismiss={() => setToast({ show: false, msg: '' })} />
        </IonContent>
      </IonPage>
    );
  }

  const bloqueRetiros = (
        <>
          {loteExistente && (
            <Card padding="md" style={{ marginBottom: 12, border: vencidaPrimero ? '2px solid var(--level-vencido-fg)' : undefined }}>
              <h2 style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>{vencidaPrimero ? 'Esta mercadería está vencida' : 'Sacar mercadería'}</h2>
              <p style={{ fontSize: 16, color: 'var(--text-2)', margin: '0 0 12px' }}>
                {vencidaPrimero ? 'Sacala de la góndola y tocá "Vencido" para anotarla.' : 'Anotá si se vendió, se venció o se rompió. Queda en el historial.'}
              </p>
              {!showRetirar ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <RetiroBtn icon={<BanknotesIcon width={20} height={20} />} label="Venta" color="var(--brand-600)"
                    onClick={() => { setTipoRetiro('retiro_venta'); setShowRetirar(true); }} />
                  <RetiroBtn icon={<TrashIcon width={20} height={20} />} label="Vencido" color="var(--danger)"
                    onClick={() => { setTipoRetiro('retiro_vencido'); setCantRetirar(loteExistente.cantidad.toString()); setShowRetirar(true); }} />
                  <RetiroBtn icon={<HeartIcon width={20} height={20} />} label="Roto" color="var(--warning)"
                    onClick={() => { setTipoRetiro('retiro_roto'); setShowRetirar(true); }} />
                </div>
              ) : (
                <>
                  <Field label={`¿Cuántas unidades? (hay ${loteExistente.cantidad})`}>
                    <Input value={cantRetirar} onChange={e => setCantRetirar(e.target.value)} inputMode="numeric" />
                  </Field>
                  <Field label="Notas">
                    <Input value={notasRetiro} onChange={e => setNotasRetiro(e.target.value)}
                      placeholder="Opcional" />
                  </Field>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" size="lg" fullWidth
                      onClick={() => { setShowRetirar(false); setCantRetirar(''); setNotasRetiro(''); }}>
                      Cancelar</Button>
                    <Button variant="primary" size="lg" fullWidth onClick={handleRetirar} disabled={procesando}>
                      {procesando ? 'Guardando…' : 'Anotar'}</Button>
                  </div>
                </>
              )}
            </Card>
          )}
        </>
  );

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as any}>
        <div className="animate-fade-in" style={{
          padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px',
          maxWidth: 640, margin: '0 auto',
        }}>
          <Header title={esNuevo ? 'Cargar mercadería' : 'Compra de mercadería'} onBack={() => history.goBack()} />

          {/* Preview del nivel */}
          {fechaVencimiento && (
            <Card padding="md" style={{
              marginBottom: 16,
              background: `var(--level-${nivel}-bg)`,
              borderColor: `var(--level-${nivel}-border)`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <NivelBadge nivel={nivel} size="md" />
                  <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 6 }}>
                    {textoEstado(fechaVencimiento)}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: colorNivel(nivel), letterSpacing: '-0.02em' }}>
                  {formatearFecha(fechaVencimiento)}
                </div>
              </div>

              {liq?.aplicar && (
                <div style={{
                  marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <IcoTagIcon width={22} height={22} />
                  <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                    <strong>Para que no se venza:</strong> vendé a{' '}
                    <strong style={{ color: 'var(--brand-600)' }}>{formatearMoneda(liq.precioFinal)}</strong>{' '}
                    <span style={{ color: 'var(--text-2)' }}>
                      (−{liq.pct}%, en vez de {formatearMoneda(liq.precioOriginal)})
                    </span>
                    <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>
                      Rematalo antes de que venza para no perder el stock.
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}

          {vencidaPrimero && bloqueRetiros}

          <Card padding="md" style={{ marginBottom: 12 }}>
            <Field label="Producto">
              <div style={{ fontSize: 18, fontWeight: 700, padding: '6px 0' }}>{producto?.nombre ?? '—'}</div>
            </Field>
            {!loteExistente && !esDueno && (
              <p style={{ fontSize: 15, color: 'var(--text-2)', margin: '-6px 0 12px' }}>
                ¿No está? Pedile al dueño que cree el producto.
              </p>
            )}
            {!loteExistente && esDueno && (
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '-6px 0 12px' }}>
                ¿No está? <button type="button" onClick={() => history.push('/producto/nuevo')}
                  style={{ background: 'none', border: 'none', color: 'var(--brand-600)', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 13 }}>
                  Crear producto nuevo</button>
              </p>
            )}

            <Field label="Cantidad" required>
              <Input value={cantidad} onChange={e => setCantidad(e.target.value)} inputMode="numeric" />
            </Field>

            <Field label="Fecha de vencimiento" required>
              {/* Atajos: elegir "en 1 mes" es más fácil que manejar el calendario. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
                {ATAJOS_VENCIMIENTO.map(a => {
                  const valor = sumarFecha(a.dias, a.meses);
                  const activo = valor === fechaVencimiento;
                  return (
                    <button key={a.label} type="button" onClick={() => setFechaVencimiento(valor)} aria-pressed={activo}
                      style={{ minHeight: 48, borderRadius: 'var(--radius)', border: activo ? '2px solid var(--brand-500)' : '2px solid transparent', boxShadow: 'var(--shadow-sm)', background: activo ? 'var(--brand-50)' : 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {a.label}
                    </button>
                  );
                })}
              </div>
              <Input type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)} />
            </Field>

            {/* Override de días de aviso: avanzado, oculto por defecto (ya hay un
                default por producto y un umbral global; mostrarlo siempre confundía). */}
            {!mostrarAvanzado ? (
              <button type="button" onClick={() => setMostrarAvanzado(true)}
                style={{ background: 'none', border: 'none', color: 'var(--brand-600)', fontWeight: 600, cursor: 'pointer', padding: '2px 0 6px', fontFamily: 'inherit', fontSize: 13 }}>
                + Avisar con otros días para esta compra
              </button>
            ) : (
              <Field label="Días de aviso (solo este lote)" hint={`Default del producto: ${producto?.diasAvisoDefault ?? 7}`}>
                <Input value={diasAviso} onChange={e => setDiasAviso(e.target.value)} inputMode="numeric"
                  placeholder={producto?.diasAvisoDefault.toString()} />
              </Field>
            )}

            <Field label="Número de lote del paquete (opcional)">
              <Input value={numeroLote} onChange={e => setNumeroLote(e.target.value)} placeholder="Opcional" />
            </Field>
            {producto?.proveedor && (
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '-4px 0 4px' }}>
                Proveedor: <strong>{producto.proveedor}</strong> <span style={{ color: 'var(--text-3)' }}>(se edita en el producto)</span>
              </p>
            )}

            <Button variant="primary" size="lg" fullWidth onClick={handleGuardar} disabled={procesando}
              icon={<CheckIcon width={18} height={18} />} style={{ marginTop: 8 }}>
              {procesando ? 'Guardando…' : esNuevo ? 'Guardar' : 'Guardar cambios'}
            </Button>
          </Card>

          {!vencidaPrimero && bloqueRetiros}
        </div>

        <IonToast isOpen={toast.show} message={toast.msg} duration={2500}
          onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

const RetiroBtn: React.FC<{ icon: React.ReactNode; label: string; color: string; onClick: () => void }> =
  ({ icon, label, color, onClick }) => (
    <button type="button" onClick={onClick}
      style={{
        background: 'var(--surface-2)', border: `1px solid var(--border)`,
        borderRadius: 'var(--radius)', padding: 14, minHeight: 72, color,
        cursor: 'pointer', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 6, fontFamily: 'inherit',
        fontWeight: 700, fontSize: 16, transition: 'all 150ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
      {icon}{label}
    </button>
  );

const ATAJOS_VENCIMIENTO = [
  { label: '1 semana', dias: 7, meses: 0 },
  { label: '15 días', dias: 15, meses: 0 },
  { label: '1 mes', dias: 0, meses: 1 },
  { label: '3 meses', dias: 0, meses: 3 },
  { label: '6 meses', dias: 0, meses: 6 },
  { label: '1 año', dias: 0, meses: 12 },
];

/** Hoy + días/meses, como YYYY-MM-DD en hora LOCAL (toISOString usa UTC y de noche corría un día). */
function sumarFecha(dias: number, meses: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + meses);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fechaTresMeses(): string {
  return sumarFecha(0, 3);
}

export default LotePage;

import React, { useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  BuildingStorefrontIcon, PencilIcon, PlusIcon, TrashIcon,
} from '@heroicons/react/24/outline';
import { useStore } from '../context/StoreContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import { Header } from './ProductoPage';

const SucursalesPage: React.FC = () => {
  const { state, addSucursal, updateSucursal, setSucursalActiva } = useStore();
  const history = useHistory();

  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaDir, setNuevaDir] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editDir, setEditDir] = useState('');
  const [toast, setToast] = useState({ show: false, msg: '' });
  const [creando, setCreando] = useState(false);

  // Solo las activas (el borrado es lógico).
  const sucursalesActivas = state.sucursales.filter(s => s.activa !== false);

  const crear = async () => {
    if (creando) return; // anti doble-tap
    const nombre = nuevoNombre.trim();
    if (!nombre) { setToast({ show: true, msg: 'Nombre obligatorio' }); return; }
    if (sucursalesActivas.some(s => s.nombre.trim().toLowerCase() === nombre.toLowerCase())) {
      setToast({ show: true, msg: 'Ya existe una sucursal con ese nombre' }); return;
    }
    setCreando(true);
    try {
      await addSucursal({ nombre, direccion: nuevaDir.trim() || undefined });
      setNuevoNombre(''); setNuevaDir('');
      setToast({ show: true, msg: 'Sucursal creada' });
    } finally {
      setCreando(false);
    }
  };

  const editar = async (id: string) => {
    if (!editNombre.trim()) return;
    const s = state.sucursales.find(x => x.id === id);
    if (!s) return;
    await updateSucursal({ ...s, nombre: editNombre.trim(), direccion: editDir.trim() || undefined });
    setEditando(null);
    setToast({ show: true, msg: 'Actualizada' });
  };

  const seleccionar = (id: string) => {
    setSucursalActiva(id);
    setToast({ show: true, msg: 'Sucursal cambiada' });
    setTimeout(() => history.push('/dashboard'), 700);
  };

  // Borrado LÓGICO (activa=false): no pierde el stock (los lotes quedan en la
  // base), solo deja de mostrarse. No se puede borrar la única sucursal.
  const borrar = async (s: typeof sucursalesActivas[number]) => {
    if (sucursalesActivas.length <= 1) { setToast({ show: true, msg: 'No podés borrar la única sucursal' }); return; }
    if (!window.confirm(`¿Borrar la sucursal "${s.nombre}"? El stock que tenga cargado deja de verse (no se elimina).`)) return;
    if (s.id === state.sucursalActivaId) {
      const otra = sucursalesActivas.find(x => x.id !== s.id);
      if (otra) setSucursalActiva(otra.id!);
    }
    await updateSucursal({ ...s, activa: false });
    setToast({ show: true, msg: 'Sucursal borrada' });
  };

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as any}>
        <div className="animate-fade-in" style={{
          padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px',
          maxWidth: 640, margin: '0 auto',
        }}>
          <Header title="Sucursales" onBack={() => history.goBack()} />

          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
            El stock se gestiona por sucursal. Cambiá la activa para ver o cargar productos en otra.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {sucursalesActivas.map(s => {
              const activa = s.id === state.sucursalActivaId;
              const enEd = editando === s.id;
              return (
                <Card key={s.id} padding="md"
                  style={{ borderColor: activa ? 'var(--brand-300)' : 'var(--border)' }}>
                  {enEd ? (
                    <>
                      <Field label="Nombre">
                        <Input value={editNombre} onChange={e => setEditNombre(e.target.value)} />
                      </Field>
                      <Field label="Dirección">
                        <Input value={editDir} onChange={e => setEditDir(e.target.value)} />
                      </Field>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="secondary" size="sm" fullWidth onClick={() => setEditando(null)}>Cancelar</Button>
                        <Button variant="primary" size="sm" fullWidth onClick={() => editar(s.id!)}>Guardar</Button>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 'var(--radius)',
                        background: activa ? 'var(--brand-50)' : 'var(--surface-2)',
                        color: activa ? 'var(--brand-600)' : 'var(--text-2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <BuildingStorefrontIcon width={20} height={20} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 15 }}>{s.nombre}</span>
                          {activa && <Badge variant="success" size="sm">Activa</Badge>}
                        </div>
                        {s.direccion && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{s.direccion}</div>}
                      </div>
                      {!activa && (
                        <Button variant="secondary" size="sm" onClick={() => seleccionar(s.id!)}>Usar</Button>
                      )}
                      <button type="button" aria-label={`Editar ${s.nombre}`}
                        onClick={() => { setEditando(s.id!); setEditNombre(s.nombre); setEditDir(s.direccion || ''); }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-3)', padding: 6, display: 'flex',
                        }}>
                        <PencilIcon width={18} height={18} />
                      </button>
                      {sucursalesActivas.length > 1 && (
                        <button type="button" aria-label={`Borrar ${s.nombre}`}
                          onClick={() => borrar(s)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--level-vencido-fg)', padding: 6, display: 'flex',
                          }}>
                          <TrashIcon width={18} height={18} />
                        </button>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Nueva sucursal</h2>
          <Card padding="md">
            <Field label="Nombre">
              <Input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                placeholder="Ej: Sucursal Norte" />
            </Field>
            <Field label="Dirección">
              <Input value={nuevaDir} onChange={e => setNuevaDir(e.target.value)} placeholder="Opcional" />
            </Field>
            <Button variant="primary" size="md" fullWidth onClick={crear} disabled={creando}
              icon={<PlusIcon width={18} height={18} />}>{creando ? 'Creando…' : 'Crear sucursal'}</Button>
          </Card>
        </div>

        <IonToast isOpen={toast.show} message={toast.msg} duration={1500}
          onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

export default SucursalesPage;

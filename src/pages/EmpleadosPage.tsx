// ═══════════════════════════════════════════════════════════════════════════
// Gestión de empleados (solo dueño):
//  - Lista de miembros del comercio.
//  - AGREGAR: generar código de invitación (un solo uso, vence en 7 días) y
//    compartirlo; el empleado se registra con ese código y queda unido.
//  - BORRAR: quitar empleados (nunca al dueño) vía RPC quitar_miembro.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { UserGroupIcon, UserPlusIcon, TrashIcon, ShareIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../lib/useConfirm';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { compartirTexto } from '../lib/compartir';
import { Header } from './ProductoPage';

interface MiembroRow { id: string; user_id: string; rol: string; nombre: string | null; creado_en: string; }
interface InvRow { id: string; codigo: string; expira_en: string; }

const EmpleadosPage: React.FC = () => {
  const { comercio, miembro } = useAuth();
  const history = useHistory();
  const confirmar = useConfirm();
  const [miembros, setMiembros] = useState<MiembroRow[]>([]);
  const [pendientes, setPendientes] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '' });

  const esDueno = miembro?.rol === 'dueno';

  const cargar = useCallback(async () => {
    if (!comercio) return;
    setLoading(true);
    const { data: ms } = await supabase.from('miembros')
      .select('id, user_id, rol, nombre, creado_en')
      .eq('comercio_id', comercio.id).order('creado_en');
    setMiembros((ms ?? []) as MiembroRow[]);
    if (esDueno) {
      const { data: inv } = await supabase.from('invitaciones')
        .select('id, codigo, expira_en')
        .eq('comercio_id', comercio.id)
        .is('usada_por', null)
        .gt('expira_en', new Date().toISOString())
        .order('creado_en', { ascending: false });
      setPendientes((inv ?? []) as InvRow[]);
    }
    setLoading(false);
  }, [comercio, esDueno]);

  useEffect(() => { cargar(); }, [cargar]);

  const invitar = async () => {
    if (!comercio) return;
    setCreando(true);
    const { data, error } = await supabase.rpc('crear_invitacion', { p: { comercio_id: comercio.id } });
    setCreando(false);
    if (error) { setToast({ show: true, msg: 'No se pudo crear la invitación' }); return; }
    const codigo = (data as { codigo?: string })?.codigo;
    if (codigo) {
      await cargar();
      compartirCodigo(codigo);
    }
  };

  const compartirCodigo = (codigo: string) => {
    compartirTexto(
      `Te invito a trabajar en ${comercio?.nombre ?? 'mi comercio'} 🛒\n\n` +
      `1) Descargá la app de ventas.\n` +
      `2) Tocá "Crear cuenta" y poné el código de invitación: *${codigo}*\n\n` +
      `El código vence en 7 días y es de un solo uso.`,
      'Invitación de empleado',
    ).then(r => {
      if (r === 'copiado') setToast({ show: true, msg: 'Invitación copiada al portapapeles' });
    });
  };

  const anularInvitacion = async (id: string) => {
    if (!(await confirmar('¿Anular este código de invitación?', { peligro: true, okText: 'Anular' }))) return;
    const { error } = await supabase.from('invitaciones').delete().eq('id', id);
    if (!error) { setPendientes(p => p.filter(x => x.id !== id)); }
  };

  const quitar = async (m: MiembroRow) => {
    if (!(await confirmar(`¿Quitar a "${m.nombre ?? 'este empleado'}" del comercio? Va a perder el acceso.`, { peligro: true, okText: 'Quitar' }))) return;
    const { error } = await supabase.rpc('quitar_miembro', { p: { miembro_id: m.id } });
    if (error) { setToast({ show: true, msg: 'No se pudo quitar: ' + error.message }); return; }
    setMiembros(x => x.filter(y => y.id !== m.id));
    setToast({ show: true, msg: 'Empleado dado de baja' });
  };

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
        <div style={{ padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom))) 16px', maxWidth: 760, margin: '0 auto' }}>
          <Header title="Empleados" onBack={() => history.goBack()} />

          {!esDueno ? (
            <EmptyState icon={<UserGroupIcon width={32} height={32} />} title="Solo para el dueño"
              description="La gestión de empleados está disponible únicamente para el dueño del comercio." />
          ) : (
            <>
              {/* Invitar */}
              <button type="button" onClick={invitar} disabled={creando} className="pressable"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--brand-500)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 8, opacity: creando ? 0.6 : 1 }}>
                <UserPlusIcon width={18} height={18} /> {creando ? 'Generando código…' : 'Invitar empleado'}
              </button>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 18px', textAlign: 'center', lineHeight: 1.5 }}>
                Genera un código de un solo uso (vence en 7 días). El empleado crea su cuenta con ese código y queda unido a tu comercio.
              </p>

              {/* Invitaciones pendientes */}
              {pendientes.length > 0 && (
                <Card padding="md" style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-2)' }}>Invitaciones pendientes</div>
                  {pendientes.map((inv, i) => (
                    <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: i < pendientes.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 700, letterSpacing: '0.12em', flex: 1 }}>{inv.codigo}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>vence {new Date(inv.expira_en).toLocaleDateString('es-AR')}</span>
                      <button type="button" aria-label={`Compartir código ${inv.codigo}`} onClick={() => compartirCodigo(inv.codigo)} className="pressable"
                        style={{ width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-600)' }}>
                        <ShareIcon width={15} height={15} />
                      </button>
                      <button type="button" aria-label={`Anular código ${inv.codigo}`} onClick={() => anularInvitacion(inv.id)} className="pressable"
                        style={{ width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--level-vencido-fg)' }}>
                        <TrashIcon width={15} height={15} />
                      </button>
                    </div>
                  ))}
                </Card>
              )}

              {/* Miembros */}
              <Card padding="md">
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-2)' }}>Equipo</div>
                {loading ? (
                  <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: 12 }}>Cargando…</p>
                ) : miembros.map((m, i) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < miembros.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: m.rol === 'dueno' ? 'var(--brand-100)' : 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      {m.rol === 'dueno' ? '👑' : '🧑'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{m.nombre ?? '(sin nombre)'}{m.user_id === miembro?.userId ? ' (vos)' : ''}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{m.rol === 'dueno' ? 'Dueño' : 'Empleado'} · desde {new Date(m.creado_en).toLocaleDateString('es-AR')}</div>
                    </div>
                    {m.rol === 'empleado' && (
                      <button type="button" aria-label={`Quitar a ${m.nombre ?? 'empleado'}`} onClick={() => quitar(m)} className="pressable"
                        style={{ width: 36, height: 36, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--level-vencido-fg)' }}>
                        <TrashIcon width={16} height={16} />
                      </button>
                    )}
                  </div>
                ))}
              </Card>
            </>
          )}
        </div>
        <IonToast isOpen={toast.show} message={toast.msg} duration={2400} onDidDismiss={() => setToast({ show: false, msg: '' })} />
      </IonContent>
    </IonPage>
  );
};

export default EmpleadosPage;

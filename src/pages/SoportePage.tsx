import React, { useCallback, useEffect, useState } from 'react';
import { IonContent, IonPage, IonToast } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../lib/useConfirm';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Header } from './ProductoPage';

// Panel del desarrollador / soporte: ve todos los comercios y les cambia el plan.
// Todo pasa por las funciones de la migración 8, que verifican plataforma_admins
// en el servidor (esta pantalla sola no da ningún permiso).

interface ComercioSoporte {
  id: string; nombre: string; plan: string; trial_hasta: string | null; creado_en: string;
  email_dueno: string | null; miembros: number; productos: number; lotes: number;
  ventas_30d: number; ultima_actividad: string | null;
}

const DIAS_PRUEBA_EXTRA = 14;

function diasRestantes(hasta: string | null): number | null {
  if (!hasta) return null;
  return Math.ceil((new Date(hasta).getTime() - Date.now()) / 86_400_000);
}

function estadoPlan(c: ComercioSoporte): { texto: string; color: string } {
  if (c.plan === 'activo') return { texto: 'Pagando', color: 'var(--level-ok-fg)' };
  if (c.plan === 'suspendido') return { texto: 'Suspendido', color: 'var(--level-vencido-fg)' };
  const d = diasRestantes(c.trial_hasta);
  if (d === null) return { texto: 'Prueba', color: 'var(--level-aviso-fg)' };
  return d < 0
    ? { texto: 'Prueba vencida', color: 'var(--level-vencido-fg)' }
    : { texto: `Prueba: ${d} día${d === 1 ? '' : 's'}`, color: 'var(--level-urgente-fg)' };
}

const SoportePage: React.FC = () => {
  const history = useHistory();
  const { esAdminPlataforma } = useAuth();
  const confirmar = useConfirm();
  const [comercios, setComercios] = useState<ComercioSoporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: e } = await supabase.rpc('admin_listar_comercios');
    setCargando(false);
    if (e) { setError(e.message); return; }
    setError('');
    setComercios((data ?? []) as ComercioSoporte[]);
  }, []);

  useEffect(() => { if (esAdminPlataforma) cargar(); }, [esAdminPlataforma, cargar]);

  const cambiarPlan = async (c: ComercioSoporte, plan: 'activo' | 'trial' | 'suspendido', pregunta: string) => {
    if (!(await confirmar(pregunta, { okText: 'Sí, cambiar', peligro: plan === 'suspendido' }))) return;
    // Prueba: se extiende desde hoy o desde el fin actual, lo que sea más tarde.
    const base = Math.max(Date.now(), c.trial_hasta ? new Date(c.trial_hasta).getTime() : 0);
    const trial_hasta = plan === 'trial' ? new Date(base + DIAS_PRUEBA_EXTRA * 86_400_000).toISOString() : null;
    const { error: e } = await supabase.rpc('admin_cambiar_plan', { p: { comercio_id: c.id, plan, trial_hasta } });
    setToast(e ? `No se pudo: ${e.message}` : `${c.nombre}: listo`);
    if (!e) cargar();
  };

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
        <div style={{ padding: '20px 16px calc(96px + var(--sab,env(safe-area-inset-bottom)))', maxWidth: 640, margin: '0 auto' }}>
          <Header title="Panel de soporte" onBack={() => history.goBack()} />

          {!esAdminPlataforma ? (
            <p style={{ fontSize: 16, color: 'var(--text-2)' }}>Esta sección es solo para el equipo de soporte.</p>
          ) : (
            <>
              <p style={{ fontSize: 16, color: 'var(--text-2)', marginBottom: 14 }}>
                {cargando ? 'Cargando comercios…' : `${comercios.length} comercio${comercios.length === 1 ? '' : 's'}`}
              </p>
              {error && <p role="alert" style={{ fontSize: 16, color: 'var(--danger)', marginBottom: 12 }}>{error}</p>}

              {comercios.map(c => {
                const est = estadoPlan(c);
                return (
                  <Card key={c.id} padding="md" style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 19, fontWeight: 700 }}>{c.nombre}</div>
                      <span style={{ fontSize: 15, fontWeight: 700, color: est.color }}>{est.texto}</span>
                    </div>
                    <div style={{ fontSize: 15, color: 'var(--text-2)', margin: '4px 0 10px', lineHeight: 1.5 }}>
                      {c.email_dueno ?? 'sin dueño'} · {c.miembros} persona{c.miembros === 1 ? '' : 's'}<br />
                      {c.productos} productos · {c.lotes} compras activas · {c.ventas_30d} ventas (30 días)<br />
                      Último movimiento: {c.ultima_actividad ? new Date(c.ultima_actividad).toLocaleDateString('es-AR') : 'nunca'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {c.plan !== 'activo' && (
                        <Button variant="primary" size="md" onClick={() => cambiarPlan(c, 'activo', `¿Marcar "${c.nombre}" como que ya pagó?`)}>
                          Pagó: activar
                        </Button>
                      )}
                      <Button variant="secondary" size="md" onClick={() => cambiarPlan(c, 'trial', `¿Dar ${DIAS_PRUEBA_EXTRA} días más de prueba a "${c.nombre}"?`)}>
                        +{DIAS_PRUEBA_EXTRA} días de prueba
                      </Button>
                      {c.plan !== 'suspendido' && (
                        <Button variant="ghost" size="md" onClick={() => cambiarPlan(c, 'suspendido', `¿Suspender "${c.nombre}"? No va a poder usar las apps.`)}
                          style={{ color: 'var(--danger)' }}>
                          Suspender
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </>
          )}
        </div>
        <IonToast isOpen={!!toast} message={toast} duration={2400} position="top" onDidDismiss={() => setToast('')} />
      </IonContent>
    </IonPage>
  );
};

export default SoportePage;

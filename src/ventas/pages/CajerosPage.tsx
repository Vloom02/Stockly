// ═══════════════════════════════════════════════════════════════════════════
// Gestión de cajeros (solo dueño). Alta con nombre + clave numérica (la que se
// pone en el teclado grande al iniciar turno); el número de empleado se asigna
// solo si se deja vacío. Activar/desactivar y cambiar la clave con el PinPad.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { IonContent, IonToast } from '@ionic/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useEmpleado } from '../context/EmpleadoContext';
import { Card, Button, Input } from '../components/ui';
import { PlusIcon, KeyIcon, UserIcon } from '../components/ui/icons';
import PinPad from '../components/PinPad';

const CLAVE_VALIDA = /^\d{4,6}$/; // 4 a 6 números: se ingresa en el teclado numérico del inicio de turno

const CajerosPage: React.FC = () => {
  const { comercio } = useAuth();
  const { empleados, recargar } = useEmpleado();
  const [legajo, setLegajo] = useState('');
  const [nombre, setNombre] = useState('');
  const [pass, setPass] = useState('');
  const [saving, setSaving] = useState(false);
  const [cambiandoClave, setCambiandoClave] = useState<{ id: string; legajo: string; nombre: string } | null>(null);

  // Siguiente número libre (01, 02, …) si el dueño no escribe uno.
  const proximoLegajo = () => {
    const usados = empleados.map(e => parseInt(e.legajo, 10)).filter(n => !Number.isNaN(n));
    return String((usados.length ? Math.max(...usados) : 0) + 1).padStart(2, '0');
  };
  const [toast, setToast] = useState({ show: false, msg: '', color: 'success' as 'success' | 'danger' });

  const aviso = (msg: string, ok = true) => setToast({ show: true, msg, color: ok ? 'success' : 'danger' });

  const agregar = async () => {
    if (!comercio || !nombre.trim() || !CLAVE_VALIDA.test(pass)) { aviso('Poné el nombre y una clave de 4 a 6 números', false); return; }
    // Las ventas y los cierres quedan a nombre del empleado: dos con el mismo nombre se mezclarían.
    if (empleados.some(e => e.nombre.trim().toLowerCase() === nombre.trim().toLowerCase())) {
      aviso(`Ya hay un empleado que se llama ${nombre.trim()}. Agregale el apellido o una inicial.`, false);
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('guardar_empleado_venta', {
      p: { comercio_id: comercio.id, legajo: legajo.trim() || proximoLegajo(), nombre: nombre.trim(), pass },
    });
    setSaving(false);
    if (error) { aviso(navigator.onLine ? 'No se pudo guardar. Probá de nuevo.' : 'Sin internet: los empleados se agregan con conexión.', false); return; }
    setLegajo(''); setNombre(''); setPass('');
    await recargar();
    aviso('Empleado agregado');
  };

  const toggleActivo = async (e: { id: string; legajo: string; nombre: string; activo?: boolean }) => {
    if (!comercio) return;
    if (e.activo !== false) {
      const { error } = await supabase.rpc('baja_empleado_venta', { p: { id: e.id, comercio_id: comercio.id } });
      if (error) { aviso('No se pudo desactivar', false); return; }
    } else {
      const { error } = await supabase.rpc('guardar_empleado_venta', {
        p: { id: e.id, comercio_id: comercio.id, legajo: e.legajo, nombre: e.nombre, activo: true },
      });
      if (error) { aviso('No se pudo reactivar', false); return; }
    }
    await recargar();
  };

  const guardarClave = async (e: { id: string; legajo: string; nombre: string }, nueva: string): Promise<boolean> => {
    if (!comercio) return false;
    const { error } = await supabase.rpc('guardar_empleado_venta', {
      p: { id: e.id, comercio_id: comercio.id, legajo: e.legajo, nombre: e.nombre, pass: nueva },
    });
    aviso(error ? 'No se pudo cambiar la clave' : `Clave de ${e.nombre} cambiada`, !error);
    if (!error) setCambiandoClave(null);
    return !error;
  };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Empleados</h1>
        <p style={{ fontSize: 16, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.5 }}>
          Para usar la app, cada uno toca su nombre y pone su clave. Lo que vende queda a su nombre y no ve precios, reportes ni ajustes del dueño.
        </p>

        {/* Alta */}
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>Agregar empleado</div>
          <Input label="Nombre" value={nombre} onChange={setNombre} placeholder="Ej: Juan" />
          <Input label="Clave (4 a 6 números)" value={pass} onChange={v => setPass(v.replace(/\D/g, '').slice(0, 6))} type="password" inputMode="numeric" placeholder="Ej: 1234" />
          <Input label="Número de empleado (opcional)" value={legajo} onChange={setLegajo} placeholder={`Si lo dejás vacío: ${proximoLegajo()}`} />
          <Button fullWidth size="lg" onClick={agregar} loading={saving} disabled={!nombre.trim() || !CLAVE_VALIDA.test(pass)} style={{ marginTop: 8 }}>
            <PlusIcon size={20} /> Agregar
          </Button>
        </Card>

        {/* Lista */}
        <Card>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Equipo de caja</div>
          {empleados.length === 0 ? (
            <p style={{ fontSize: 16, color: 'var(--text-2)', textAlign: 'center', padding: 14 }}>Todavía no agregaste empleados.</p>
          ) : empleados.map((e, i) => {
            const activo = e.activo !== false;
            return (
              <div key={e.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < empleados.length - 1 ? '1px solid var(--border)' : 'none', opacity: activo ? 1 : 0.5 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface-3)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><UserIcon size={22} /></div>
                {/* El nombre necesita lugar: si no entra con los dos botones, estos bajan a otra línea. */}
                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>{e.nombre}</div>
                  <div style={{ fontSize: 14, color: 'var(--text-2)' }}>N° {e.legajo}{activo ? '' : ' · dado de baja'}</div>
                </div>
                <button type="button" onClick={() => setCambiandoClave(e)} className="pressable" aria-label={`Cambiar la clave de ${e.nombre}`}
                  style={{ minHeight: 44, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, border: 'none', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <KeyIcon size={18} /> Clave
                </button>
                <button type="button" onClick={() => toggleActivo(e)} className="pressable"
                  style={{ minHeight: 44, padding: '0 12px', border: '1px solid ' + (activo ? 'var(--color-danger-border)' : 'var(--color-primary-border)'), borderRadius: 'var(--radius)', background: activo ? 'var(--color-danger-bg)' : 'var(--color-primary-bg)', color: activo ? 'var(--color-danger)' : 'var(--color-primary-dark)', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {activo ? 'Dar de baja' : 'Volver a activar'}
                </button>
              </div>
            );
          })}
        </Card>
      </div>
      {cambiandoClave && (
        <PinPad
          mode="create"
          titulo={`Nueva clave para ${cambiandoClave.nombre}`}
          subtitulo="De 4 a 6 números. Es la que va a poner al empezar a vender."
          onSuccess={(clave) => guardarClave(cambiandoClave, clave)}
          onCancel={() => setCambiandoClave(null)}
        />
      )}
      <IonToast isOpen={toast.show} onDidDismiss={() => setToast(t => ({ ...t, show: false }))} message={toast.msg} duration={4500} position="top" color={toast.color} />
    </IonContent>
  );
};

export default CajerosPage;

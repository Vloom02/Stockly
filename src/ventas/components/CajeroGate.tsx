// ═══════════════════════════════════════════════════════════════════════════
// Inicio de turno: si el comercio tiene cajeros definidos, hay que iniciar turno
// para poder vender. Pensado para gente grande: cada uno toca SU NOMBRE y pone
// su clave en un teclado numérico grande (sin escribir legajos). Quien tenga una
// clave con letras usa el formulario de texto. El dueño entra con su PIN (admin).
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { IonContent } from '@ionic/react';
import { useEmpleado } from '../context/EmpleadoContext';
import { useOwner } from '../context/OwnerContext';
import { useAuth } from '../context/AuthContext';
import { Button, Input } from './ui';
import { LockClosedIcon, UserIcon } from './ui/icons';
import PinPad from './PinPad';
import BotonHuella from './BotonHuella';
import { useHuella, dejarOfertaHuella } from '../lib/useHuella';
import { CLAVE_HUELLA_DUENO, claveHuellaCajero } from '../lib/huella';

interface Elegido { legajo: string; nombre: string; }

const CajeroGate: React.FC = () => {
  const { comercio } = useAuth();
  const { empleados, iniciarTurno, entrarComoAdmin } = useEmpleado();
  const { hasPin, tryUnlock } = useOwner();
  const [elegido, setElegido] = useState<Elegido | null>(null);
  const [conLetras, setConLetras] = useState(false); // clave con letras → formulario de texto
  const [legajo, setLegajo] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPinDueno, setShowPinDueno] = useState(false);

  const activos = empleados.filter(e => e.activo !== false);
  const huellaCajero = useHuella(elegido ? claveHuellaCajero(elegido.legajo) : null);
  const huellaDueno = useHuella(CLAVE_HUELLA_DUENO);

  const entrarCajero = async (clave: string) => {
    if (!elegido) return false;
    const err = await iniciarTurno(elegido.legajo, clave);
    return !err;
  };
  const entrarDueno = async (pin: string) => {
    const ok = await tryUnlock(pin);
    if (ok) entrarComoAdmin();
    return ok;
  };
  // Sin cajeros en la lista (o clave con letras): formulario clásico.
  const formularioTexto = activos.length === 0 || conLetras;

  const entrarConTexto = async () => {
    const leg = elegido?.legajo ?? legajo.trim();
    if (!leg || !pass) { setError('Completá tus datos'); return; }
    setError(''); setLoading(true);
    const err = await iniciarTurno(leg, pass);
    setLoading(false);
    if (err) { setError(err); setPass(''); }
  };

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)', paddingTop: 'calc(var(--space-6) + var(--ion-safe-area-top, 0px))' }}>
        <h1 className="anim-pop" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em', textAlign: 'center' }}>¿Quién va a atender?</h1>
        <p style={{ fontSize: 16, color: 'var(--text-2)', marginBottom: 'var(--space-5)', textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
          {comercio?.nombre ?? 'El comercio'} — tocá tu nombre.
        </p>

        <div style={{ width: '100%', maxWidth: 380 }}>
          {!formularioTexto ? (
            <div className="lista-animada" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activos.map(e => (
                <button key={e.id} type="button" className="pressable"
                  onClick={() => { setElegido({ legajo: e.legajo, nombre: e.nombre }); setError(''); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 68, padding: '12px 16px', borderRadius: 'var(--radius-lg)', border: 'none', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', boxShadow: 'var(--shadow-sm)' }}>
                  <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <UserIcon size={24} />
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{e.nombre}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {elegido ? (
                <p style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 12 }}>Hola, {elegido.nombre}</p>
              ) : (
                <Input label="Número de empleado" value={legajo} onChange={setLegajo} placeholder="Ej: 01" inputMode="text" />
              )}
              <Input label="Tu clave" value={pass} onChange={setPass} type="password" placeholder="Tu clave" />
              {error && <p role="alert" style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-danger)', margin: '4px 0 10px', textAlign: 'center' }}>{error}</p>}
              <Button fullWidth size="lg" onClick={entrarConTexto} loading={loading} disabled={!(elegido?.legajo || legajo.trim()) || !pass} style={{ marginTop: 8 }}>
                Entrar
              </Button>
              {activos.length > 0 && (
                <Button fullWidth size="lg" variant="ghost" onClick={() => { setConLetras(false); setElegido(null); setPass(''); setError(''); }} style={{ marginTop: 8 }}>
                  Volver a la lista
                </Button>
              )}
            </>
          )}

          {/* Acceso del dueño */}
          {hasPin && (
            <button type="button" onClick={() => setShowPinDueno(true)}
              style={{ marginTop: 20, width: '100%', minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 'var(--radius-lg)', background: 'none', border: '1.5px dashed var(--border)', color: 'var(--text)', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              <LockClosedIcon size={20} /> Soy el dueño
            </button>
          )}
        </div>
      </div>

      {/* Clave del cajero en teclado numérico grande */}
      {elegido && !conLetras && (
        <PinPad
          mode="unlock"
          titulo={`Hola, ${elegido.nombre}`}
          subtitulo="Poné tu clave"
          extra={huellaCajero.activa ? (
            <BotonHuella onClick={async () => { if (await huellaCajero.entrar(entrarCajero)) setElegido(null); }} />
          ) : undefined}
          onSuccess={async (clave) => {
            if (huellaCajero.disponible && !huellaCajero.activa) dejarOfertaHuella(claveHuellaCajero(elegido.legajo), clave);
            const ok = await entrarCajero(clave);
            if (ok) setElegido(null); else dejarOfertaHuella('', ''); // clave mal: no ofrecer
            return ok;
          }}
          onCancel={() => setElegido(null)}
        />
      )}
      {elegido && !conLetras && (
        <button type="button" onClick={() => setConLetras(true)}
          style={{ position: 'fixed', bottom: 'calc(16px + var(--sab, env(safe-area-inset-bottom)))', left: '50%', transform: 'translateX(-50%)', zIndex: 10001, minHeight: 48, padding: '0 18px', borderRadius: 'var(--radius-full)', border: 'none', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Mi clave tiene letras
        </button>
      )}

      {showPinDueno && (
        <PinPad
          mode="unlock"
          titulo="Hola, dueño"
          subtitulo="Poné tu PIN para entrar a todo"
          extra={huellaDueno.activa ? (
            <BotonHuella onClick={async () => { if (await huellaDueno.entrar(entrarDueno)) setShowPinDueno(false); }} />
          ) : undefined}
          onSuccess={async (pin) => {
            if (huellaDueno.disponible && !huellaDueno.activa) dejarOfertaHuella(CLAVE_HUELLA_DUENO, pin);
            const ok = await entrarDueno(pin);
            if (ok) setShowPinDueno(false); else dejarOfertaHuella('', ''); // PIN mal: no ofrecer
            return ok;
          }}
          onCancel={() => setShowPinDueno(false)}
        />
      )}
    </IonContent>
  );
};

export default CajeroGate;

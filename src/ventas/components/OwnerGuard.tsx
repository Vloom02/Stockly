// ═══════════════════════════════════════════════════════════════════════════
// Envuelve una página que solo el dueño puede ver.
// Si no está desbloqueado, muestra el PinPad (crear PIN la 1ª vez, o ingresarlo).
// ═══════════════════════════════════════════════════════════════════════════
import React, { ReactNode } from 'react';
import { IonContent } from '@ionic/react';
import { useOwner } from '../context/OwnerContext';
import PinPad from './PinPad';
import BotonHuella from './BotonHuella';
import BotonVolver from './BotonVolver';
import { useHuella } from '../lib/useHuella';
import { CLAVE_HUELLA_DUENO } from '../lib/huella';
import { LockClosedIcon } from './ui/icons';
import { Button } from './ui';

const OwnerGuard: React.FC<{ children: ReactNode; titulo: string }> = ({ children, titulo }) => {
  const { hasPin, isUnlocked, loading, setPin, tryUnlock, keepAlive } = useOwner();
  const [showPad, setShowPad] = React.useState(false);
  const huella = useHuella(CLAVE_HUELLA_DUENO);

  if (loading) {
    return (
      <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
        <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        </div>
      </IonContent>
    );
  }

  if (isUnlocked) {
    // Cualquier interacción mantiene viva la sesión de dueño
    return <div onPointerDown={keepAlive} onKeyDown={keepAlive} style={{ height: '100%' }}>{children}</div>;
  }

  // Bloqueado: pantalla de candado + botón para abrir el PinPad
  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      {showPad && (
        <PinPad
          mode={hasPin ? 'unlock' : 'create'}
          extra={hasPin && huella.activa ? (
            <BotonHuella onClick={async () => { if (await huella.entrar(tryUnlock)) setShowPad(false); }} />
          ) : undefined}
          onSuccess={async (pin) => {
            const ok = hasPin ? await tryUnlock(pin) : await setPin(pin);
            if (ok) { await huella.ofrecer(pin); setShowPad(false); }
            return ok;
          }}
          onCancel={() => setShowPad(false)}
        />
      )}
      <div style={{ padding: '16px 16px 0' }}><BotonVolver /></div>
      <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-full)', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <LockClosedIcon size={30} color="var(--color-primary)" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{titulo}</h2>
        <p style={{ fontSize: 16, color: 'var(--text-2)', marginBottom: 20, maxWidth: 300, lineHeight: 1.5 }}>
          {hasPin ? 'Esta sección es solo para el dueño. Ingresá tu PIN para verla.' : 'Esta sección es solo para el dueño. Creá un PIN para protegerla.'}
        </p>
        <Button size="lg" onClick={() => setShowPad(true)}>
          {hasPin ? 'Poner mi PIN' : 'Crear PIN de dueño'}
        </Button>
      </div>
    </IonContent>
  );
};

export default OwnerGuard;

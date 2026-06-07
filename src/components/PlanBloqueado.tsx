import React from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { ExclamationTriangleIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import Logo from './ui/Logo';
import Button from './ui/Button';
import { EstadoPlan } from '../lib/plan';

interface Props {
  estado: EstadoPlan;
  onReintentar: () => void;
  onCerrarSesion: () => void;
}

const PlanBloqueado: React.FC<Props> = ({ estado, onReintentar, onCerrarSesion }) => {
  const esSuspendido = estado.tipo === 'suspendido';

  return (
    <IonPage>
      <IonContent style={{ '--background': 'var(--bg)' } as any}>
        <div style={{
          minHeight: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center',
          padding: '32px 24px', gap: 8,
        }}>
          <div style={{ marginBottom: 8 }}>
            <Logo size={56} />
          </div>

          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'var(--level-vencido-bg)', color: 'var(--level-vencido-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '8px 0',
          }}>
            <ExclamationTriangleIcon width={34} height={34} />
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
            {esSuspendido ? 'Cuenta suspendida' : 'Tu prueba terminó'}
          </h1>

          <p style={{ fontSize: 15, color: 'var(--text-2)', maxWidth: 340, lineHeight: 1.6, margin: '4px 0 16px' }}>
            {esSuspendido
              ? 'Tu cuenta está suspendida temporalmente. Tus datos están a salvo. Para reactivarla, ponete en contacto con nosotros.'
              : 'Terminó el período de prueba gratuito de Stockly. Tus datos siguen guardados. Para seguir usando la app, activá tu suscripción.'}
          </p>

          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: 16, maxWidth: 340, width: '100%',
            marginBottom: 8,
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>
              Para activar tu cuenta, escribinos:
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand-600)' }}>
              WhatsApp: +54 9 11 2538-9308
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 340 }}>
            <Button variant="primary" size="md" onClick={onReintentar}>
              Ya activé mi cuenta · Reintentar
            </Button>
            <Button variant="ghost" size="md" onClick={onCerrarSesion}
              icon={<ArrowRightOnRectangleIcon width={18} height={18} />}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default PlanBloqueado;

import React, { useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import {
  EnvelopeIcon, LockClosedIcon, UserIcon, BuildingStorefrontIcon, KeyIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/ui/Logo';
import Button from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import { haptic } from '../utils/haptics';

// olvido: pide el código por email · codigo: código + contraseña nueva
type Modo = 'login' | 'registro' | 'olvido' | 'codigo';

const AuthPage: React.FC = () => {
  const { iniciarSesion, registrarse, pedirCodigo, cambiarConCodigo } = useAuth();
  const [modo, setModo] = useState<Modo>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [nombreComercio, setNombreComercio] = useState('');
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');
  const [cargando, setCargando] = useState(false);
  const [codigo, setCodigo] = useState('');

  const irA = (m: Modo) => { setModo(m); setError(''); setExito(''); };

  // "if (cargando) return": con Enter dos veces salían dos mails o dos registros.
  const mandarCodigo = async () => {
    if (cargando) return;
    setError(''); setExito('');
    if (!email.trim()) { setError('Escribí el email de tu cuenta'); return; }
    setCargando(true);
    try {
      const { error } = await pedirCodigo(email.trim());
      if (error) { setError(error); haptic.warning(); return; }
      setModo('codigo'); setCodigo(''); setPassword('');
      setExito(`Te mandamos un código a ${email.trim()}. Si no llega en unos minutos, mirá en "Spam" o "Correo no deseado".`);
    } finally { setCargando(false); }
  };

  const cambiarClave = async () => {
    if (cargando) return;
    setError('');
    const c = codigo.replace(/\D/g, '');
    if (c.length < 6) { setError('Escribí el código que te llegó por email'); return; }
    if (password.length < 8) { setError('La contraseña nueva debe tener al menos 8 caracteres'); return; }
    setCargando(true);
    try {
      const { error } = await cambiarConCodigo(email.trim(), c, password);
      if (error) { setError(error); haptic.warning(); }
      else haptic.success(); // ya queda adentro de la app
    } finally { setCargando(false); }
  };

  const submit = async () => {
    if (cargando) return;
    setError('');
    setExito('');

    if (!email.trim() || !password) {
      setError('Completá email y contraseña');
      return;
    }

    setCargando(true);
    try {
      if (modo === 'login') {
        const { error } = await iniciarSesion(email.trim(), password);
        if (error) { setError(error); haptic.warning(); }
        else haptic.success();
      } else {
        if (!nombre.trim() || !nombreComercio.trim()) {
          setError('Completá tu nombre y el del comercio');
          setCargando(false);
          return;
        }
        if (password.length < 8) {
          setError('La contraseña debe tener al menos 8 caracteres');
          setCargando(false);
          return;
        }
        const { error } = await registrarse(email.trim(), password, nombre.trim(), nombreComercio.trim());
        if (error) {
          setError(error);
          haptic.warning();
        } else {
          haptic.success();
          setExito(`¡Cuenta creada! Te mandamos un email a ${email.trim()}. Abrí el link para confirmarla y después iniciá sesión.`);
          setPassword('');
          setModo('login');
        }
      }
    } finally {
      setCargando(false);
    }
  };

  return (
    <IonPage>
      <style>{`.link-auth { background: none; border: none; color: var(--brand-600); font-weight: 600;
        cursor: pointer; font-family: inherit; font-size: 14px; padding: 12px 8px; min-height: 44px; }`}</style>
      <IonContent style={{ '--background': 'var(--bg)' } as any}>
        <div style={{
          minHeight: '100%',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: 'calc(40px + env(safe-area-inset-top)) 24px calc(40px + var(--sab,env(safe-area-inset-bottom)))',
          maxWidth: 420, margin: '0 auto',
        }}>
          {/* Logo y título */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ display: 'inline-flex', marginBottom: 16 }}>
              <Logo size={48} />
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 4 }}>
              {modo === 'login' ? 'Bienvenido de nuevo' : modo === 'registro' ? 'Creá tu cuenta' : 'Recuperar contraseña'}
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
              {modo === 'login' ? 'Ingresá para gestionar tu stock'
                : modo === 'registro' ? 'Empezá a controlar tus vencimientos hoy'
                : modo === 'olvido' ? 'Te mandamos un código a tu email'
                : 'Escribí el código y elegí una contraseña nueva'}
            </p>
          </div>

          {/* Mensajes */}
          {error && (
            <div role="alert" className="animate-slide-up" style={{
              background: 'var(--level-vencido-bg)', color: 'var(--level-vencido-fg)',
              border: '1px solid var(--level-vencido-border)',
              borderRadius: 'var(--radius)', padding: 12, fontSize: 16,
              marginBottom: 16, fontWeight: 600,
            }}>{error}</div>
          )}
          {exito && (
            <div role="status" className="animate-slide-up" style={{
              background: 'var(--level-ok-bg)', color: 'var(--level-ok-fg)',
              border: '1px solid var(--level-ok-border)',
              borderRadius: 'var(--radius)', padding: 12, fontSize: 16,
              marginBottom: 16, fontWeight: 600,
            }}>{exito}</div>
          )}

          {modo === 'olvido' && (<>
            <Field label="Email de tu cuenta">
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com" autoCapitalize="off"
                leftIcon={<EnvelopeIcon width={18} height={18} />}
                onKeyDown={(e) => { if (e.key === 'Enter') mandarCodigo(); }} />
            </Field>
            <Button variant="primary" size="lg" fullWidth onClick={mandarCodigo} loading={cargando} style={{ marginTop: 8 }}>
              Mandarme el código
            </Button>
          </>)}

          {modo === 'codigo' && (<>
            <Field label="Código del email">
              <Input value={codigo} onChange={e => setCodigo(e.target.value)} inputMode="numeric"
                autoComplete="one-time-code" placeholder="123456"
                leftIcon={<KeyIcon width={18} height={18} />} />
            </Field>
            <Field label="Contraseña nueva" hint="Mínimo 8 caracteres">
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Elegí una contraseña nueva"
                leftIcon={<LockClosedIcon width={18} height={18} />}
                onKeyDown={(e) => { if (e.key === 'Enter') cambiarClave(); }} />
            </Field>
            <Button variant="primary" size="lg" fullWidth onClick={cambiarClave} loading={cargando} style={{ marginTop: 8 }}>
              Guardar y entrar
            </Button>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button type="button" className="link-auth" onClick={mandarCodigo} disabled={cargando}>Mandarme otro código</button>
            </div>
          </>)}

          {(modo === 'login' || modo === 'registro') && (<>
          {/* Form */}
          {modo === 'registro' && (
            <>
              <Field label="Tu nombre">
                <Input value={nombre} onChange={e => setNombre(e.target.value)}
                  placeholder="Juan Pérez"
                  leftIcon={<UserIcon width={18} height={18} />} />
              </Field>
              <Field label="Nombre del comercio">
                <Input value={nombreComercio} onChange={e => setNombreComercio(e.target.value)}
                  placeholder="Almacén Don Juan"
                  leftIcon={<BuildingStorefrontIcon width={18} height={18} />} />
              </Field>
            </>
          )}

          <Field label="Email">
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com" autoCapitalize="off"
              leftIcon={<EnvelopeIcon width={18} height={18} />} />
          </Field>

          <Field label="Contraseña" hint={modo === 'registro' ? 'Mínimo 8 caracteres' : undefined}>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={modo === 'registro' ? 'Elegí una contraseña' : 'Tu contraseña'}
              leftIcon={<LockClosedIcon width={18} height={18} />}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          </Field>

          <Button variant="primary" size="lg" fullWidth onClick={submit}
            loading={cargando} style={{ marginTop: 8 }}>
            {modo === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </Button>

          {modo === 'login' && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button type="button" className="link-auth" onClick={() => irA('olvido')}>Olvidé mi contraseña</button>
            </div>
          )}
          </>)}

          {/* Cambiar modo */}
          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: 'var(--text-2)' }}>
            {modo === 'login' ? '¿No tenés cuenta?' : modo === 'registro' ? '¿Ya tenés cuenta?' : '¿Te acordaste?'}{' '}
            <button type="button" className="link-auth" onClick={() => irA(modo === 'login' ? 'registro' : 'login')}>
              {modo === 'login' ? 'Registrate gratis' : 'Iniciá sesión'}
            </button>
          </div>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-3)', marginTop: 32 }}>
            Stockly · 14 días de prueba gratis
          </p>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default AuthPage;

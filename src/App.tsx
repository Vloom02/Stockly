import React, { useState, useEffect, lazy, Suspense } from 'react';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route, Redirect } from 'react-router-dom';

// Páginas con code-splitting: cada una se descarga bajo demanda (chunk aparte),
// así el arranque de la app es más liviano y rápido.
const DashboardPage   = lazy(() => import('./pages/DashboardPage'));
const StockPage       = lazy(() => import('./pages/StockPage'));
const ProductoPage    = lazy(() => import('./pages/ProductoPage'));
const LotePage        = lazy(() => import('./pages/LotePage'));
const MovimientosPage = lazy(() => import('./pages/MovimientosPage'));
const ReportesPage    = lazy(() => import('./pages/ReportesPage'));
const SucursalesPage  = lazy(() => import('./pages/SucursalesPage'));
const EtiquetasPage   = lazy(() => import('./pages/EtiquetasPage'));
const InventarioPage  = lazy(() => import('./pages/InventarioPage'));
const ConfigPage      = lazy(() => import('./pages/ConfigPage'));
const AuthPage        = lazy(() => import('./pages/AuthPage'));
import TabBar from './components/TabBar';
import Onboarding from './components/Onboarding';
import Logo from './components/ui/Logo';
import PlanBloqueado from './components/PlanBloqueado';
import { evaluarPlan, EstadoPlan } from './lib/plan';
import { registrarPush } from './lib/push';

import { AuthProvider, useAuth } from './context/AuthContext';
import { StoreProvider, getSetting, setSetting } from './context/StoreContext';
import { supabaseConfigurado } from './lib/supabase';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import './theme/variables.css';

setupIonicReact();

// ─── App autenticada (con datos) ──────────────────────────────────────────
const AppAutenticada: React.FC<{ isDark: boolean; onThemeToggle: () => void; estadoPlan: EstadoPlan }> = ({ isDark, onThemeToggle, estadoPlan }) => {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { comercio } = useAuth();

  useEffect(() => {
    if (getSetting('onboarding-visto', '') !== 'si') setShowOnboarding(true);
  }, []);

  // Registrar push (FCM) una vez que hay comercio. No-op en web.
  useEffect(() => {
    if (comercio?.id) registrarPush(comercio.id);
  }, [comercio?.id]);

  const completar = () => { setSetting('onboarding-visto', 'si'); setShowOnboarding(false); };

  return (
    <StoreProvider>
      {showOnboarding && <Onboarding onComplete={completar} />}
      {estadoPlan.tipo === 'trial' && estadoPlan.diasRestantes !== undefined && estadoPlan.diasRestantes <= 5 && (
        <div style={{
          position: 'fixed', top: 'env(safe-area-inset-top)', left: 0, right: 0,
          zIndex: 500, background: 'var(--level-urgente-bg)', color: 'var(--level-urgente-fg)',
          padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center',
        }}>
          {estadoPlan.diasRestantes <= 0
            ? 'Tu prueba vence hoy'
            : `Te ${estadoPlan.diasRestantes === 1 ? 'queda' : 'quedan'} ${estadoPlan.diasRestantes} ${estadoPlan.diasRestantes === 1 ? 'día' : 'días'} de prueba`}
        </div>
      )}
      <IonReactRouter>
        <IonRouterOutlet id="main">
          <Route path="/dashboard" exact><Suspense fallback={<Cargando />}><DashboardPage /></Suspense></Route>
          <Route path="/stock" exact><Suspense fallback={<Cargando />}><StockPage /></Suspense></Route>
          <Route path="/producto/:id" exact><Suspense fallback={<Cargando />}><ProductoPage /></Suspense></Route>
          <Route path="/lote/:id" exact><Suspense fallback={<Cargando />}><LotePage /></Suspense></Route>
          <Route path="/movimientos" exact><Suspense fallback={<Cargando />}><MovimientosPage /></Suspense></Route>
          <Route path="/reportes" exact><Suspense fallback={<Cargando />}><ReportesPage /></Suspense></Route>
          <Route path="/sucursales" exact><Suspense fallback={<Cargando />}><SucursalesPage /></Suspense></Route>
          <Route path="/etiquetas" exact><Suspense fallback={<Cargando />}><EtiquetasPage /></Suspense></Route>
          <Route path="/inventario" exact><Suspense fallback={<Cargando />}><InventarioPage /></Suspense></Route>
          <Route path="/config" exact><Suspense fallback={<Cargando />}><ConfigPage onThemeToggle={onThemeToggle} isDark={isDark} /></Suspense></Route>
          <Route path="/" exact><Redirect to="/dashboard" /></Route>
        </IonRouterOutlet>
        <TabBar />
      </IonReactRouter>
    </StoreProvider>
  );
};

// ─── Pantalla de carga ──────────────────────────────────────────────────────
const Cargando: React.FC = () => (
  <div style={{
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 16, background: 'var(--bg)',
  }}>
    <Logo size={56} />
    <div style={{
      width: 24, height: 24, border: '3px solid var(--surface-3)',
      borderTopColor: 'var(--brand-500)', borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  </div>
);

// ─── Router de auth ───────────────────────────────────────────────────────
const Router: React.FC<{ isDark: boolean; onThemeToggle: () => void }> = ({ isDark, onThemeToggle }) => {
  const { session, cargando, comercio, recargarComercio, cerrarSesion } = useAuth();

  if (cargando) return <Cargando />;
  if (!session) {
    return (
      <IonReactRouter>
        <IonRouterOutlet>
          <Route><Suspense fallback={<Cargando />}><AuthPage /></Suspense></Route>
        </IonRouterOutlet>
      </IonReactRouter>
    );
  }

  // Control de plan: si el trial venció o la cuenta está suspendida, bloquear
  const estadoPlan = evaluarPlan(comercio);
  if (!estadoPlan.activo) {
    return (
      <PlanBloqueado
        estado={estadoPlan}
        onReintentar={recargarComercio}
        onCerrarSesion={cerrarSesion}
      />
    );
  }

  return <AppAutenticada isDark={isDark} onThemeToggle={onThemeToggle} estadoPlan={estadoPlan} />;
};

// ─── Error si falta configuración ─────────────────────────────────────────
const SinConfig: React.FC = () => (
  <div style={{ padding: 32, maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
    <Logo size={48} />
    <h1 style={{ fontSize: 20, fontWeight: 700, marginTop: 16 }}>Falta configurar Supabase</h1>
    <p style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
      Creá un archivo <code>.env</code> en la raíz del proyecto con tus claves de Supabase.
      Mirá las instrucciones en <code>supabase/SETUP.md</code>.
    </p>
  </div>
);

const App: React.FC = () => {
  const [isDark, setDark] = useState(false);

  useEffect(() => {
    const saved = getSetting('theme', '');
    const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(dark);
    document.body.classList.toggle('dark', dark);
  }, []);

  const onThemeToggle = () => {
    const next = !isDark;
    setDark(next);
    document.body.classList.toggle('dark', next);
    setSetting('theme', next ? 'dark' : 'light');
  };

  if (!supabaseConfigurado) {
    return <IonApp className={isDark ? 'dark' : ''}><SinConfig /></IonApp>;
  }

  return (
    <IonApp className={isDark ? 'dark' : ''}>
      <AuthProvider>
        <Router isDark={isDark} onThemeToggle={onThemeToggle} />
      </AuthProvider>
    </IonApp>
  );
};

export default App;

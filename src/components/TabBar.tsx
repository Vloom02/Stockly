import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  HomeIcon, CubeIcon, PlusIcon, Cog6ToothIcon, ShoppingCartIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  CubeIcon as CubeSolid,
  Cog6ToothIcon as CogSolid,
  ShoppingCartIcon as CartSolid,
} from '@heroicons/react/24/solid';

interface TabConfig {
  path: string;
  Icon: React.ComponentType<{ width?: number; height?: number; style?: React.CSSProperties }>;
  IconActive: React.ComponentType<{ width?: number; height?: number; style?: React.CSSProperties }>;
  label: string;
  fab?: boolean;
}

// Ancho de cada pestaña (fr): "Mercadería" necesita más lugar que "Cargar".
const ANCHOS = [1, 1, 0.8, 1.3, 1];
const TOTAL = ANCHOS.reduce((a, b) => a + b, 0);
const desde = (i: number) => ANCHOS.slice(0, i).reduce((a, b) => a + b, 0) / TOTAL;

const TABS: TabConfig[] = [
  { path: '/dashboard',   Icon: HomeIcon,    IconActive: HomeSolid,  label: 'Inicio' },
  { path: '/ventas',      Icon: ShoppingCartIcon, IconActive: CartSolid, label: 'Vender' },
  { path: '/lote/nuevo',  Icon: PlusIcon,    IconActive: PlusIcon,   label: 'Cargar', fab: true },
  { path: '/stock',       Icon: CubeIcon,    IconActive: CubeSolid,  label: 'Mercadería' },
  // Historial se abre desde Ajustes; caja y fiado, desde Vender.
  { path: '/config',      Icon: Cog6ToothIcon, IconActive: CogSolid, label: 'Ajustes' },
];

const estaActiva = (t: TabConfig, ruta: string) =>
  t.fab ? ruta.includes('/nuevo') : ruta === t.path || (t.path !== '/dashboard' && ruta.startsWith(t.path));

// Barra flotante "Tacto": una píldora se desliza hasta la pestaña elegida.
const TabBar: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const activa = TABS.findIndex(t => estaActiva(t, location.pathname));

  return (
    <nav aria-label="Secciones" style={{
      // En tablet no se estira de punta a punta: ancho máximo y centrada.
      position: 'fixed', left: 0, right: 0, margin: '0 auto', width: 'calc(100% - 20px)', maxWidth: 640,
      bottom: 'calc(10px + var(--sab,env(safe-area-inset-bottom)))',
      height: 72, padding: 6, zIndex: 100,
      display: 'grid', gridTemplateColumns: ANCHOS.map(a => `minmax(0, ${a}fr)`).join(' '),
      background: 'var(--surface)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)',
    }}>
      <span aria-hidden="true" style={{
        position: 'absolute', top: 6, bottom: 6,
        left: `calc(6px + (100% - 12px) * ${desde(Math.max(activa, 0))})`,
        width: `calc((100% - 12px) * ${ANCHOS[Math.max(activa, 0)] / TOTAL})`,
        // Lo elegido se marca por luminosidad (azul lleno, texto blanco), no por un tinte
        // pálido: a los mayores los tonos claros parecidos se les confunden.
        borderRadius: 20, background: 'var(--boton-marca)', boxShadow: 'var(--relieve), 0 2px 0 var(--boton-base)',
        opacity: activa < 0 || TABS[activa]?.fab ? 0 : 1,
        transition: 'left var(--mov-base) var(--ease-salida), width var(--mov-base) var(--ease-salida), opacity var(--mov-rapido) ease',
      }} />
      {TABS.map(t => {
        const active = estaActiva(t, location.pathname);
        const Ico = active ? t.IconActive : t.Icon;
        return (
          <button
            key={t.path}
            type="button"
            // Tocar la pestaña en la que ya estás no suma otro "atrás" que no hace nada.
            onClick={() => { if (location.pathname !== t.path) history.push(t.path); }}
            aria-current={active ? 'page' : undefined}
            style={{
              position: 'relative', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
              color: active && !t.fab ? 'var(--text-on-brand)' : active ? 'var(--marca-texto)' : 'var(--text-2)',
              fontFamily: 'inherit', fontSize: 13, letterSpacing: '-0.01em', fontWeight: active ? 800 : 700, minWidth: 0,
            }}
          >
            {t.fab ? (
              // "Cargar": una tecla en relieve, siempre a mano.
              <span className="boton-marca" style={{ width: 34, height: 34, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <PlusIcon width={22} height={22} strokeWidth={2.6 as any} />
              </span>
            ) : (
              <span key={active ? 'on' : 'off'} className={active ? 'anim-rebote' : undefined} style={{ display: 'flex', alignItems: 'center', height: 34 }}><Ico width={24} height={24} /></span>
            )}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default TabBar;

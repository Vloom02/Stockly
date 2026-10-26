// ═══════════════════════════════════════════════════════════════════════════
// "Caja y ventas": agrupa las secciones del DUEÑO en una grilla clara. Se abre
// desde Vender. Letra, colores y animaciones se eligen en Ajustes (toda la app).
// Si quien trabaja es un EMPLEADO (cajero no-admin), no ve nada de eso: solo
// puede cerrar su turno. El dueño entra como admin (PIN) y ve todo.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { IonContent } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { useEmpleado } from '../context/EmpleadoContext';
import { useOwner, OPCIONES_LOCK } from '../context/OwnerContext';
import { useConfirm } from '../../lib/useConfirm';
import { Opciones } from '../components/ui';
import { sonidoActivo, setSonidoActivo } from '../lib/aviso';
import { ChartBarIcon, BanknotesIcon, BookOpenIcon, ClipboardIcon, SparklesIcon, TagIcon, UserGroupIcon, LockClosedIcon } from '../components/ui/icons';

interface Tile { Icon: React.FC<{ size?: number; color?: string }>; label: string; desc: string; path: string; }

// Lo de todos los días: 4 opciones grandes, con palabras simples (público mayor).
const PRINCIPALES: Tile[] = [
  { Icon: ChartBarIcon,  label: 'Resumen del día',   desc: 'Cuánto se vendió hoy',     path: '/ventas/resumen' },
  { Icon: BanknotesIcon, label: 'Caja',              desc: 'Contar la plata y cerrar', path: '/ventas/caja' },
  { Icon: BookOpenIcon,  label: 'Fiado',             desc: 'Quién debe y cuánto',      path: '/ventas/fiado' },
  { Icon: ClipboardIcon, label: 'Ventas anteriores', desc: 'Ver o anular una venta',   path: '/ventas/historial' },
];
// Lo que se usa de vez en cuando: lista chica aparte.
const OTRAS: Tile[] = [
  { Icon: SparklesIcon,  label: 'Lo más vendido',    desc: 'Productos y horarios con más venta', path: '/ventas/estadisticas' },
  { Icon: TagIcon,       label: 'Ofertas',           desc: '2x1 y descuentos por cantidad',      path: '/ventas/ofertas' },
  { Icon: UserGroupIcon, label: 'Empleados de caja', desc: 'Quién puede cobrar',                 path: '/ventas/cajeros' },
];

const MasPage: React.FC = () => {
  const history = useHistory();
  const { cajero, cerrarTurno } = useEmpleado();
  const { hasPin, lockMin, setLockMin } = useOwner();
  const confirmar = useConfirm();
  const [sonido, setSonido] = React.useState(sonidoActivo);

  // Es "dueño" si no hay sistema de cajeros activo, o si entró como admin (PIN).
  const esDueno = !cajero || cajero.admin === true;

  return (
    <IonContent style={{ '--background': 'var(--bg)' } as React.CSSProperties}>
      <div style={{ padding: 'var(--space-4)', maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(96px + var(--sab,env(safe-area-inset-bottom)))', paddingTop: 'calc(var(--space-4) + var(--ion-safe-area-top, 0px))' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>Caja y ventas</h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
          {cajero && !cajero.admin ? `Estás en tu turno, ${cajero.nombre}` : 'Opciones del dueño (piden el PIN)'}
        </p>

        {esDueno ? (
          <>
            <div className="lista-animada" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {PRINCIPALES.map(t => (
                <button key={t.path} type="button" onClick={() => history.push(t.path)} className="pressable"
                  style={{ display: 'flex', alignItems: 'center', gap: 16, minHeight: 76, padding: '14px 16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', boxShadow: 'var(--shadow-sm)' }}>
                  <span style={{ width: 48, height: 48, borderRadius: 'var(--radius)', background: 'var(--color-primary-bg)', color: 'var(--color-primary-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <t.Icon size={28} />
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{t.label}</span>
                    <span style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.35 }}>{t.desc}</span>
                  </span>
                </button>
              ))}
            </div>

            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)', margin: '22px 0 8px' }}>Otras opciones</h2>
            <div className="lista-animada" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden' }}>
              {OTRAS.map((t, i) => (
                <button key={t.path} type="button" onClick={() => history.push(t.path)} className="pressable"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, minHeight: 60, padding: '12px 16px', border: 'none', borderTop: i ? '1px solid var(--border)' : 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--text)' }}>
                  <t.Icon size={24} color="var(--text-2)" />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{t.label}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{t.desc}</span>
                  </span>
                </button>
              ))}
            </div>

            {hasPin && (<>
              <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <LockClosedIcon size={22} color="var(--text-2)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Volver a pedir el PIN</div>
                  <div style={{ fontSize: 14, color: 'var(--text-2)' }}>Después de estos minutos sin usar</div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <Opciones etiqueta="Volver a pedir el PIN después de" columnas={3} valor={String(lockMin)}
                  onChange={v => setLockMin(Number(v))}
                  opciones={OPCIONES_LOCK.map(n => ({ valor: String(n), etiqueta: n < 60 ? `${n} min` : n === 60 ? '1 hora' : `${n / 60} horas` }))} />
              </div>
            </>)}

            <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Sonido al cobrar</div>
              <Opciones etiqueta="Sonido al cobrar" columnas={2} valor={sonido ? 'si' : 'no'}
                onChange={v => { setSonidoActivo(v === 'si'); setSonido(v === 'si'); }}
                opciones={[{ valor: 'si', etiqueta: 'Sí' }, { valor: 'no', etiqueta: 'No' }]} />
            </div>

          </>
        ) : (
          // Empleado: maneja su caja y cierra al salir.
          <div style={{ textAlign: 'center', padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ marginBottom: 8, color: 'var(--color-primary-dark)' }}><BanknotesIcon size={48} /></div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', maxWidth: 290, margin: '0 auto 18px', lineHeight: 1.5 }}>
              Manejá el efectivo de tu turno (apertura, ingresos y egresos) y cerrá la caja al terminar.
            </p>
            <button type="button" onClick={() => history.push('/ventas/caja-turno')} className="pressable"
              style={{ width: '100%', maxWidth: 320, padding: '13px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10 }}>
              Plata de mi turno (abrir, entradas y salidas)
            </button>
            <button type="button" onClick={() => history.push('/ventas/cerrar-caja')} className="pressable"
              style={{ width: '100%', maxWidth: 320, padding: '13px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--color-primary)', color: 'var(--text-on-brand)', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cerrar caja y salir
            </button>
          </div>
        )}

        {esDueno && (<>
        {cajero?.admin && (
          <button type="button" onClick={async () => { if (await confirmar('¿Cerrar turno de administrador?', { okText: 'Cerrar turno' })) cerrarTurno(); }}
            style={{ width: '100%', marginTop: 14, padding: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cerrar turno (administrador)
          </button>
        )}
        </>)}
      </div>
    </IonContent>
  );
};

export default MasPage;

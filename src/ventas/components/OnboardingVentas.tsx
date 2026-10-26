// ═══════════════════════════════════════════════════════════════════════════
// Onboarding de primera vez (tips). Se muestra una sola vez por dispositivo y
// SOLO si el comercio está vacío: un usuario con datos cargados (o un empleado
// que entra en otro celu) va directo a vender, sin tutorial.
// No siembra datos (el catálogo es compartido con Stockly).
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { IonModal } from '@ionic/react';
import { openDB, getLocalSetting, setLocalSetting } from '../lib/outbox';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const KEY = 'onboarding-ventas';

const PASOS = [
  { emoji: '🛒', titulo: 'Vendé en segundos', texto: 'Escaneá el código o buscá por nombre. Se arma el carrito y descontás stock con un toque.' },
  { emoji: '📦', titulo: 'Stock siempre al día', texto: 'Cada venta descuenta la mercadería, empezando por lo que vence antes. La cargás una vez en Mercadería y ya queda para vender.' },
  { emoji: '📒', titulo: 'Fiado bajo control', texto: 'Registrá ventas fiadas, cobrá de a poco y mandá recordatorios por WhatsApp desde Fiado.' },
  { emoji: '🧾', titulo: 'Caja y reportes', texto: 'Cerrá la caja en cada turno contando la plata, y mirá cuánto vendiste en el Resumen del día.' },
];

const OnboardingVentas: React.FC = () => {
  const { comercio } = useAuth();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!comercio) return;
    (async () => {
      try {
        await openDB();
        if ((await getLocalSetting(KEY)) === 'visto') return;

        // ¿El comercio ya tiene movimiento? (productos cargados o ventas hechas)
        // → usuario existente en un dispositivo nuevo: directo a vender.
        if (navigator.onLine) {
          const { data: prods } = await supabase.from('productos')
            .select('id').eq('comercio_id', comercio.id).limit(1);
          const { data: vtas } = await supabase.from('ventas_ventas')
            .select('id').eq('comercio_id', comercio.id).limit(1);
          if ((prods?.length ?? 0) > 0 || (vtas?.length ?? 0) > 0) {
            await setLocalSetting(KEY, 'visto');
            return;
          }
        }
        setOpen(true);
      } catch { /* si falla, no molestamos */ }
    })();
  }, [comercio]);

  const cerrar = () => {
    setOpen(false);
    openDB().then(() => setLocalSetting(KEY, 'visto')).catch(() => {});
  };

  const paso = PASOS[i];
  const ultimo = i === PASOS.length - 1;

  return (
    <IonModal isOpen={open} onDidDismiss={cerrar} breakpoints={[0, 1]} initialBreakpoint={1}>
      {/* Fondo y color explícitos: el modal no siempre hereda el tema → título ilegible */}
      <div style={{ padding: 'var(--space-6)', textAlign: 'center', display: 'flex', flexDirection: 'column', minHeight: 360, height: '100%', background: 'var(--bg)', color: 'var(--text)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{ fontSize: 56, lineHeight: 1 }}>{paso.emoji}</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text)' }}>{paso.titulo}</h2>
          <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 320 }}>{paso.texto}</p>
        </div>

        {/* dots */}
        <div style={{ display: 'flex', gap: 7, justifyContent: 'center', margin: '18px 0' }}>
          {PASOS.map((_, k) => (
            <span key={k} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 999, background: k === i ? 'var(--color-primary)' : 'var(--border-strong)', transition: 'all .2s' }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {!ultimo && (
            <button onClick={cerrar} className="pressable" style={{ flex: 1, padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Saltar
            </button>
          )}
          <button onClick={() => (ultimo ? cerrar() : setI(i + 1))} className="pressable" style={{ flex: ultimo ? 1 : 1.6, padding: 14, border: 'none', borderRadius: 'var(--radius)', background: 'var(--color-primary)', color: 'var(--text-on-brand)', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {ultimo ? '¡Empezar!' : 'Siguiente'}
          </button>
        </div>
      </div>
    </IonModal>
  );
};

export default OnboardingVentas;

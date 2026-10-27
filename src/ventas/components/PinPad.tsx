// ═══════════════════════════════════════════════════════════════════════════
// Teclado PIN modal. Dos modos:
//  - 'unlock': ingresar PIN existente para entrar a modo dueño
//  - 'create': crear PIN nuevo la primera vez (pide confirmación)
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { LockClosedIcon } from './ui/icons';

interface Props {
  mode: 'unlock' | 'create';
  titulo?: string;        // opcional: reemplaza el título del primer paso (ej. "Nuevo PIN de dueño")
  subtitulo?: string;     // opcional: reemplaza el texto de ayuda del primer paso
  extra?: React.ReactNode; // opcional: contenido bajo el subtítulo (ej. botón "Usar mi huella")
  onSuccess: (pin: string) => Promise<boolean>;
  onCancel: () => void;
}

const PinPad: React.FC<Props> = ({ mode, titulo: tituloProp, subtitulo: subtituloProp, extra, onSuccess, onCancel }) => {
  const [pin, setPin]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [stage, setStage]   = useState<'first' | 'confirm'>('first'); // solo para create
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);

  const current = mode === 'create' && stage === 'confirm' ? confirm : pin;
  const setCurrent = (v: string) => {
    if (mode === 'create' && stage === 'confirm') setConfirm(v);
    else setPin(v);
  };

  const titulo =
    mode === 'unlock' ? (tituloProp ?? 'Ingresá tu PIN') :
    stage === 'first' ? (tituloProp ?? 'Creá un PIN de dueño') : 'Repetí el PIN';
  const subtitulo =
    mode === 'unlock' ? (subtituloProp ?? 'Acceso a secciones del dueño') :
    stage === 'first' ? (subtituloProp ?? 'Mínimo 4 dígitos. Lo vas a necesitar para ver caja, reportes y deudas.') :
    'Confirmá el PIN para guardarlo';

  const press = async (d: string) => {
    if (busy) return;
    setError('');
    const next = (current + d).slice(0, 6);
    setCurrent(next);

    // En unlock: al llegar a 4+ no autoconfirma (el PIN puede ser de hasta 6). Confirma con ✓.
  };

  const backspace = () => { setError(''); setCurrent(current.slice(0, -1)); };

  const submit = async () => {
    if (busy) return;
    if (mode === 'create') {
      if (stage === 'first') {
        if (pin.length < 4) { setError('Mínimo 4 dígitos'); return; }
        setStage('confirm'); return;
      }
      // confirm stage
      if (confirm !== pin) { setError('Los PIN no coinciden'); setConfirm(''); return; }
      setBusy(true);
      const ok = await onSuccess(pin);
      setBusy(false);
      if (!ok) { setError('No se pudo guardar el PIN'); setStage('first'); setPin(''); setConfirm(''); }
      return;
    }
    // unlock
    if (pin.length < 4) { setError('PIN incompleto'); return; }
    setBusy(true);
    const ok = await onSuccess(pin);
    setBusy(false);
    if (!ok) { setError('PIN incorrecto'); setPin(''); }
  };

  const dots = Math.max(current.length, 0);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-full)', background: 'var(--color-primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <LockClosedIcon size={28} color="var(--color-primary)" />
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>{titulo}</h2>
      <p style={{ fontSize: 16, color: 'var(--text-2)', marginBottom: 24, textAlign: 'center', maxWidth: 290, lineHeight: 1.5 }}>{subtitulo}</p>
      {extra}

      {/* Dots */}
      <div key={error} className={error ? 'anim-sacudir' : undefined} style={{ display: 'flex', gap: 12, marginBottom: 16, minHeight: 18 }}>
        {Array.from({ length: Math.max(4, dots) }).map((_, i) => (
          <div key={i} className={i === dots - 1 ? 'anim-rebote' : undefined} style={{ width: 18, height: 18, borderRadius: '50%', background: i < dots ? 'var(--color-primary)' : 'var(--surface-3)', transition: 'background .15s' }} />
        ))}
      </div>

      {error && <p role="alert" style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 12, minHeight: 16 }}>{error}</p>}
      {!error && <div style={{ minHeight: 28 }} />}

      {/* Teclado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 12, marginBottom: 20 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => (
          <button key={n} onClick={() => press(n)} className="pressable"
            style={{ height: 64, borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', fontSize: 24, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
            {n}
          </button>
        ))}
        <button onClick={backspace} className="pressable"
          style={{ height: 64, borderRadius: 'var(--radius-lg)', border: 'none', background: 'transparent', fontSize: 17, fontWeight: 600, color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>Borrar</button>
        <button onClick={() => press('0')} className="pressable"
          style={{ height: 64, borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', fontSize: 24, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>0</button>
        <button onClick={submit} disabled={busy} className="pressable boton-marca"
          style={{ height: 64, borderRadius: 'var(--radius-lg)', border: 'none', fontSize: 19, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'inherit' }}>Listo</button>
      </div>

      <button onClick={onCancel} style={{ background: 'none', border: 'none', minHeight: 48, padding: '0 16px', fontSize: 16, color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>
        Cancelar
      </button>
    </div>
  );
};

export default PinPad;

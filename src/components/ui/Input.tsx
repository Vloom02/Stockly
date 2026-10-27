import React from 'react';

// ─── Base styles ─────────────────────────────────────────────────────────
// Fondo, borde hundido y el aro al enfocar viven en la clase .campo (theme/motion.css).
const baseFieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  fontSize: 17,
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'inherit',
  fontWeight: 600,
  minHeight: 52,
};
const conCampo = (c?: string) => ['campo', c].filter(Boolean).join(' ');

// ─── Field wrapper (con label, hint, error) ───────────────────────────
interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, hint, error, required, children }) => (
  <div style={{ marginBottom: 12 }}>
    {label && (
      <label style={{
        display: 'block',
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text-2)',
        marginBottom: 6,
        letterSpacing: '-0.005em',
      }}>
        {label}
        {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
      </label>
    )}
    {children}
    {hint && !error && (
      <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '4px 0 0' }}>{hint}</p>
    )}
    {error && (
      <p role="alert" className="anim-entrar" style={{ fontSize: 15, color: 'var(--danger)', margin: '6px 0 0', fontWeight: 600 }}>{error}</p>
    )}
  </div>
);

// ─── Input ───────────────────────────────────────────────────────────
interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leftIcon?: React.ReactNode;
  rightAddon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({ leftIcon, rightAddon, style, ...props }) => {
  if (!leftIcon && !rightAddon) {
    return (
      <input
        {...props}
        className={conCampo(props.className)}
        style={{ ...baseFieldStyle, ...style }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: rightAddon ? 6 : 0 }}>
      <div style={{ position: 'relative', flex: 1 }}>
        {leftIcon && (
          <div style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', color: 'var(--text-3)',
            display: 'flex', alignItems: 'center', pointerEvents: 'none',
          }}>{leftIcon}</div>
        )}
        <input
          {...props}
          className={conCampo(props.className)}
          style={{ ...baseFieldStyle, paddingLeft: leftIcon ? 38 : 12, ...style }}
        />
      </div>
      {rightAddon}
    </div>
  );
};

// ─── Select ──────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export const Select: React.FC<SelectProps> = ({ children, style, ...props }) => (
  <select
    {...props}
    className={conCampo(props.className)}
    style={{
      ...baseFieldStyle,
      paddingRight: 32,
      backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M3 4.5l3 3 3-3'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 12px center',
      appearance: 'none',
      cursor: 'pointer',
      ...style,
    }}
  >
    {children}
  </select>
);

// ─── Textarea ────────────────────────────────────────────────────────
export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ style, ...props }) => (
  <textarea
    {...props}
    className={conCampo(props.className)}
    style={{
      ...baseFieldStyle,
      minHeight: 100,
      resize: 'vertical',
      lineHeight: 1.5,
      fontFamily: 'var(--font-mono)',
      ...style,
    }}
  />
);

// ─── Opciones grandes ────────────────────────────────────────────────
// Reemplaza al desplegable (<select>): para gente mayor los desplegables y
// selectores chicos son de lo más difícil en pantallas táctiles (NN/g).
// Botones de 48 px mínimo, todos a la vista, el elegido bien marcado.
export interface Opcion { valor: string; etiqueta: string }

export const Opciones: React.FC<{
  opciones: Opcion[]; valor: string; onChange: (v: string) => void;
  columnas?: number; etiqueta?: string;
}> = ({ opciones, valor, onChange, columnas = 2, etiqueta }) => (
  // "Tacto": riel hundido; la opción elegida se levanta (blanca, con sombra y borde de marca).
  <div role="radiogroup" aria-label={etiqueta}
    style={{ display: 'grid', gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`, gap: 5,
      padding: 5, borderRadius: 'var(--radius-lg)', background: 'var(--campo-bg)', boxShadow: 'var(--hundido)' }}>
    {opciones.map((o, i) => {
      const sel = o.valor === valor;
      return (
        <button key={o.valor} type="button" role="radio" aria-checked={sel} onClick={() => onChange(o.valor)}
          className="pressable anim-entrar" style={{
            '--i': i, minHeight: 48, padding: '8px 10px', borderRadius: 'var(--radius)',
            border: sel ? '2px solid var(--brand-500)' : '2px solid transparent',
            background: sel ? 'var(--surface)' : 'transparent', boxShadow: sel ? 'var(--shadow-sm)' : 'none',
            color: sel ? 'var(--brand-700)' : 'var(--text-2)',
            fontSize: 16, fontWeight: sel ? 800 : 700, cursor: 'pointer', fontFamily: 'inherit',
            overflowWrap: 'anywhere',
          } as React.CSSProperties}>
          {o.etiqueta}
        </button>
      );
    })}
  </div>
);

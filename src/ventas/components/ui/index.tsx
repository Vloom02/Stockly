import React, { ReactNode, useState } from 'react';

// ─── Button ───────────────────────────────────────────────────────────────────
type BtnVariant = 'primary'|'secondary'|'ghost'|'danger'|'success';
type BtnSize    = 'sm'|'md'|'lg';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: BtnSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  type?: 'button'|'submit';
  style?: React.CSSProperties;
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children, onClick, variant='primary', size='md',
  disabled, loading, fullWidth, type='button', style, className,
}) => {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, fontFamily: 'var(--font-sans)', fontWeight: 600,
    border: 'none', borderRadius: 'var(--radius)', cursor: disabled||loading ? 'default' : 'pointer',
    outline: 'none',
    width: fullWidth ? '100%' : undefined,
    opacity: disabled ? .45 : 1,
    WebkitTapHighlightColor: 'transparent',
  };
  const sizes: Record<BtnSize, React.CSSProperties> = {
    // Mínimos táctiles pensados para dedos grandes (público mayor): 44 / 48 / 56 px.
    sm: { padding: '8px 14px', fontSize: 14, minHeight: 44 },
    md: { padding: '12px 18px', fontSize: 16, minHeight: 48 },
    lg: { padding: '16px 22px', fontSize: 18, minHeight: 56 },
  };
  const variants: Record<BtnVariant, React.CSSProperties> = {
    primary:   {},   // .boton-marca (relieve, baja como una tecla)
    secondary: {},   // .boton-blanco
    ghost:     { background: 'transparent',              color: 'var(--text-2)', border: '1px solid var(--border)' },
    danger:    {},   // .boton-peligro
    success:   {},   // .boton-marca
  };
  const relieve: Partial<Record<BtnVariant, string>> = { primary: 'boton-marca', success: 'boton-marca', secondary: 'boton-blanco', danger: 'boton-peligro' };
  return (
    <button type={type} onClick={!disabled&&!loading ? onClick : undefined} disabled={disabled}
      className={['pressable', relieve[variant], className].filter(Boolean).join(' ')}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {loading
        ? <span style={{ width:16, height:16, border:'2px solid rgba(255,255,255,.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .6s linear infinite' }} />
        : children}
    </button>
  );
};

// ─── Card ─────────────────────────────────────────────────────────────────────
interface CardProps {
  children: ReactNode;
  variant?: 'default'|'bordered'|'flat'|'pressable';
  onClick?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ children, variant='default', onClick, style, className }) => {
  const variants: Record<string, React.CSSProperties> = {
    // "Tacto": tarjetas blancas que sobresalen con sombra suave, sin borde.
    default:   { background:'var(--surface)',   boxShadow:'var(--shadow-md)' },
    bordered:  { background:'var(--surface)',   boxShadow:'var(--shadow-sm)' },
    flat:      { background:'var(--surface-2)', border:'none' },
    pressable: { background:'var(--surface)',   boxShadow:'var(--shadow-sm)', cursor:'pointer' },
  };
  return (
    <div onClick={onClick} className={`${variant==='pressable'?'pressable':''} ${className||''}`}
      style={{ borderRadius:'var(--radius-lg)', padding:'var(--space-4)', ...variants[variant], ...style }}>
      {children}
    </div>
  );
};

// ─── Input ────────────────────────────────────────────────────────────────────
interface InputProps {
  label?: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  mono?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  style?: React.CSSProperties;
  /** Se llama al apretar Enter (ej. enviar el login). */
  onEnter?: () => void;
}

export const Input: React.FC<InputProps> = ({
  label, hint, error, value, onChange, placeholder, type='text',
  maxLength, disabled, autoFocus, mono, inputMode, style, onEnter,
}) => {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 4, marginBottom: 12 }}>
      {label && <label style={{ fontSize:15, fontWeight:600, color:'var(--text-2)' }}>{label}</label>}
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength} disabled={disabled} autoFocus={autoFocus}
        inputMode={inputMode}
        onKeyDown={onEnter ? (e => { if (e.key === 'Enter') onEnter(); }) : undefined}
        // Hundido y aro al enfocar: clase .campo (theme/motion.css).
        className="campo"
        style={{
          width:'100%', padding:'12px 14px', fontSize:17, fontWeight: 600, minHeight: 52,
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          color: 'var(--text)', borderRadius: 'var(--radius)', outline: 'none',
          ...(error ? { borderColor: 'var(--color-danger)' } : {}),
          opacity: disabled ? .5 : 1,
          ...style,
        }}
      />
      {error && <span style={{ fontSize: 13, color:'var(--color-danger)' }}>{error}</span>}
      {hint && !error && <span style={{ fontSize: 13, color:'var(--text-3)' }}>{hint}</span>}
    </div>
  );
};

// ─── Select ───────────────────────────────────────────────────────────────────
interface SelectProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
}

export const Select: React.FC<SelectProps> = ({ label, value, onChange, options, placeholder, style }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display:'block', fontSize:13, fontWeight:500, color:'var(--text-2)', marginBottom:4 }}>{label}</label>}
    <select className="campo" value={value} onChange={e => onChange(e.target.value)}
      style={{ width:'100%', padding:'12px 14px', fontSize:17, fontWeight:600, minHeight:52, fontFamily:'var(--font-sans)', color: value ? 'var(--text)' : 'var(--text-3)', borderRadius:'var(--radius)', outline:'none', ...style }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

// ─── Badge ────────────────────────────────────────────────────────────────────
type BadgeColor = 'green'|'yellow'|'red'|'blue'|'purple'|'gray';

export const Badge: React.FC<{ children: ReactNode; color?: BadgeColor; dot?: boolean; style?: React.CSSProperties }> = ({
  children, color='green', dot, style,
}) => {
  const colors: Record<BadgeColor, React.CSSProperties> = {
    green:  { background:'var(--color-primary-bg)',  color:'var(--color-primary-dark)', border:'1px solid var(--color-primary-border)' },
    yellow: { background:'var(--color-warning-bg)',  color:'var(--color-warning-dark)', border:'1px solid var(--color-warning-border)' },
    red:    { background:'var(--color-danger-bg)',   color:'var(--color-danger-dark)',  border:'1px solid var(--color-danger-border)' },
    blue:   { background:'var(--color-info-bg)',     color:'var(--color-info-dark)',    border:'1px solid var(--color-info-border)' },
    purple: { background:'var(--color-accent-bg)',   color:'var(--color-accent)',       border:'1px solid var(--color-accent-border)' },
    gray:   { background:'var(--surface-2)',         color:'var(--text-2)',             border:'1px solid var(--border)' },
  };
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:'var(--radius-full)', fontSize: 13, fontWeight:600, ...colors[color], ...style }}>
      {dot && <span style={{ width:6, height:6, borderRadius:'50%', background:'currentColor' }} />}
      {children}
    </span>
  );
};

// ─── EmptyState ───────────────────────────────────────────────────────────────
export const EmptyState: React.FC<{
  icon?: ReactNode; title: string; description?: string;
  action?: { label: string; onClick: () => void };
}> = ({ icon, title, description, action }) => (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'48px 24px', textAlign:'center' }}>
    {icon && <div style={{ marginBottom:16, color:'var(--text-3)' }}>{icon}</div>}
    <div style={{ fontSize:16, fontWeight:600, color:'var(--text)', marginBottom:6 }}>{title}</div>
    {description && <div style={{ fontSize:13, color:'var(--text-2)', marginBottom:16, maxWidth:260, lineHeight:1.6 }}>{description}</div>}
    {action && <Button variant="secondary" size="sm" onClick={action.onClick}>{action.label}</Button>}
  </div>
);

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export const Skeleton: React.FC<{ width?: string|number; height?: number; radius?: string; style?: React.CSSProperties }> = ({
  width='100%', height=20, radius='var(--radius-sm)', style,
}) => (
  <div style={{ width, height, borderRadius:radius, background:'var(--surface-3)', animation:'shimmer 1.4s ease infinite', ...style }} />
);

export const SkeletonCard: React.FC = () => (
  <div style={{ background:'var(--surface)', boxShadow:'var(--shadow-sm)', borderRadius:'var(--radius-lg)', padding:14, marginBottom:7 }}>
    <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
      <div style={{ flex:1 }}>
        <Skeleton width="60%" height={16} style={{ marginBottom:8 }} />
        <Skeleton width="40%" height={12} />
      </div>
      <Skeleton width={36} height={36} radius="var(--radius)" />
    </div>
  </div>
);

// ─── SyncBanner ───────────────────────────────────────────────────────────────
export const SyncBanner: React.FC<{ queueLen: number; isOnline: boolean; bloqueados?: number; onReintentar?: () => void }> = ({ queueLen, isOnline, bloqueados = 0, onReintentar }) => {
  if (isOnline && queueLen === 0) return null;
  const isOffline = !isOnline;
  // Ventas rechazadas por el servidor: no se mandan solas. Antes decía "Mandando…" para siempre.
  if (!isOffline && bloqueados > 0 && onReintentar) {
    return (
      <button type="button" onClick={onReintentar} style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, width: '100%', minHeight: 48,
        padding: '10px 16px', textAlign: 'center', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
        background: 'var(--color-danger-bg)', color: 'var(--color-danger-dark)', border: 'none',
        borderBottom: '1px solid var(--color-danger-border)',
      }}>
        {bloqueados} venta{bloqueados > 1 ? 's' : ''} no se pudo guardar en internet · tocá acá para reintentar
      </button>
    );
  }
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
      padding: '10px 16px', textAlign: 'center', fontSize: 15, fontWeight: 600,
      background: isOffline ? 'var(--color-warning-bg)' : 'var(--color-info-bg)',
      color:      isOffline ? 'var(--color-warning-dark)' : 'var(--color-info-dark)',
      borderBottom: `1px solid ${isOffline ? 'var(--color-warning-border)' : 'var(--color-info-border)'}`,
      animation: 'slideUp var(--transition) ease',
    }}>
      {isOffline
        ? 'Sin internet: podés seguir vendiendo, se manda solo cuando vuelva'
        : `Mandando ${queueLen} venta${queueLen > 1 ? 's' : ''} guardada${queueLen > 1 ? 's' : ''}...`}
    </div>
  );
};

// ─── Divider ─────────────────────────────────────────────────────────────────
export const Divider: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div style={{ height:1, background:'var(--border)', margin:'14px 0', ...style }} />
);

// ─── Section title ────────────────────────────────────────────────────────────
export const SectionTitle: React.FC<{ children: ReactNode }> = ({ children }) => (
  <h3 style={{ fontSize: 16, fontWeight:800, color:'var(--text-2)', marginBottom:10 }}>
    {children}
  </h3>
);

// ─── Stat card ────────────────────────────────────────────────────────────────
export const StatCard: React.FC<{ label: string; value: ReactNode; color?: string }> = ({ label, value, color }) => (
  <div style={{ background:'var(--surface)', boxShadow:'var(--shadow-md)', borderRadius:'var(--radius-lg)', padding:'12px 14px' }}>
    <div style={{ fontSize: 13, color:'var(--text-2)', marginBottom:3 }}>{label}</div>
    <div style={{ fontSize:20, fontWeight:700, color: color || 'var(--text)' }}>{value}</div>
  </div>
);

// ─── Opciones grandes: las mismas de Stockly (un solo estilo en toda la app) ───
export { Opciones } from '../../../components/ui/Input';
export type { Opcion } from '../../../components/ui/Input';

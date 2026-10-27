import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth,
  icon,
  iconRight,
  loading,
  children,
  disabled,
  style,
  ...props
}) => {
  const styles = getButtonStyles(variant, size, fullWidth, disabled || loading);
  // El relieve y el "apretado" viven en CSS (theme/motion.css): .boton-marca baja como una tecla.
  const clase = CLASE[variant];
  return (
    <button
      {...props}
      className={[clase, props.className].filter(Boolean).join(' ') || undefined}
      disabled={disabled || loading}
      style={{ ...styles, ...style }}
    >
      {loading ? <Spinner /> : icon}
      {children && <span>{children}</span>}
      {!loading && iconRight}
    </button>
  );
};

const Spinner = () => (
  <span
    style={{
      width: 14, height: 14,
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
      display: 'inline-block',
    }}
  />
);

const CLASE: Partial<Record<Variant, string>> = {
  primary: 'boton-marca',
  danger: 'boton-peligro',
  secondary: 'boton-blanco',
};

function getButtonStyles(variant: Variant, size: Size, fullWidth?: boolean, disabled?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: 'none',
    fontFamily: 'inherit',
    fontWeight: 700,
    letterSpacing: '-0.005em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    width: fullWidth ? '100%' : undefined,
    whiteSpace: 'nowrap',
  };

  // Sizes
  const sizes: Record<Size, React.CSSProperties> = {
    // Mínimos táctiles pensados para dedos grandes (público mayor): 44 / 48 / 56 px.
    sm: { padding: '8px 14px', fontSize: 14, borderRadius: 'var(--radius-sm)', minHeight: 44 },
    md: { padding: '12px 18px', fontSize: 16, borderRadius: 'var(--radius)', minHeight: 48 },
    lg: { padding: '16px 22px', fontSize: 18, borderRadius: 'var(--radius-md)', minHeight: 56 },
  };

  // Variants
  const variants: Record<Variant, React.CSSProperties> = {
    primary: {},     // .boton-marca
    secondary: {},   // .boton-blanco
    ghost: {
      background: 'transparent',
      color: 'var(--text-2)',
    },
    danger: {},      // .boton-peligro
    success: {
      background: 'var(--surface)',
      color: 'var(--brand-700)',
      border: '1px solid var(--brand-200)',
    },
  };

  return { ...base, ...sizes[size], ...variants[variant] };
}

export default Button;

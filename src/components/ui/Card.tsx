import React from 'react';

interface CardProps {
  children: React.ReactNode;
  onClick?: () => void;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  variant?: 'default' | 'elevated' | 'outlined' | 'subtle';
  style?: React.CSSProperties;
  interactive?: boolean;
}

const PAD = { none: 0, sm: 12, md: 16, lg: 20 };

const Card: React.FC<CardProps> = ({
  children,
  onClick,
  padding = 'md',
  variant = 'default',
  style,
  interactive,
}) => {
  const isClickable = !!onClick || interactive;

  const variants: Record<string, React.CSSProperties> = {
    // "Tacto": tarjeta blanca que sobresale con sombra suave, sin borde.
    default: {
      background: 'var(--surface)',
      boxShadow: 'var(--shadow-md)',
    },
    elevated: {
      background: 'var(--surface)',
      boxShadow: 'var(--shadow-lg)',
    },
    outlined: {
      background: 'transparent',
      border: '1px solid var(--border)',
    },
    subtle: {
      background: 'var(--surface-2)',
    },
  };

  const baseStyle: React.CSSProperties = {
    ...variants[variant],
    borderRadius: 'var(--radius-lg)',
    padding: PAD[padding],
    cursor: isClickable ? 'pointer' : 'default',
    width: '100%',
    textAlign: 'left',
    fontFamily: 'inherit',
    color: 'inherit',
    ...style,
  };

  if (onClick) {
    return (
      // Al tocarla se hunde apenas (.tarjeta-tocable, theme/motion.css).
      <button
        type="button"
        onClick={onClick}
        className="tarjeta-tocable"
        style={{ ...baseStyle, border: baseStyle.border ?? 'none' }}
      >
        {children}
      </button>
    );
  }

  return <div style={baseStyle}>{children}</div>;
};

export default Card;

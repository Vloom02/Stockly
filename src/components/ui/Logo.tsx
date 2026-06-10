import React from 'react';

interface LogoProps {
  size?: number;
  showText?: boolean;
}

/**
 * Logo de Stockly: caja + reloj de vencimiento.
 * Caja crema y badge de reloj oro sobre tile de tinta cálida.
 * Coherente con el ícono de la app (launcher Android).
 */
const Logo: React.FC<LogoProps> = ({ size = 28, showText = false }) => {
  const gid = React.useId();
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <svg width={size} height={size} viewBox="0 0 128 128" fill="none">
        <defs>
          <linearGradient id={`bg-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a2116" />
            <stop offset="1" stopColor="#1c160d" />
          </linearGradient>
        </defs>

        {/* Tile de tinta cálida */}
        <rect width="128" height="128" rx="29" fill={`url(#bg-${gid})`} />

        {/* Caja / depósito en crema */}
        <g fill="none" stroke="#efe2c7" strokeWidth="5.5" strokeLinejoin="round" strokeLinecap="round">
          <path d="M34 50 L64 38 L94 50 L94 86 L64 98 L34 86 Z" />
          <path d="M34 50 L64 62 L94 50" />
          <path d="M64 62 L64 98" />
        </g>

        {/* Badge de reloj (vencimiento) en oro */}
        <circle cx="92" cy="40" r="15" fill="#e7bd4d" stroke="#1c160d" strokeWidth="4" />
        <path d="M92 33 L92 40 L97 44" fill="none" stroke="#1c160d" strokeWidth="3.4" strokeLinecap="round" />
      </svg>
      {showText && (
        <span style={{
          fontSize: size * 0.7,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          fontFamily: 'var(--font-display)',
          color: 'var(--text)',
        }}>
          Stockly
        </span>
      )}
    </div>
  );
};

export default Logo;

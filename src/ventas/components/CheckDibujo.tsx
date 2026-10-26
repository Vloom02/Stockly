import React from 'react';

/** Tilde grande que se dibuja solo: "¡salió bien!" (ver .check-dibujo en motion.css). */
const CheckDibujo: React.FC<{ size?: number }> = ({ size = 72 }) => (
  <svg className="check-dibujo anim-pop" width={size} height={size} viewBox="0 0 52 52" aria-hidden="true">
    <circle className="c" cx="26" cy="26" r="24" fill="none" stroke="var(--color-success, #2e7d32)" strokeWidth="3" />
    <path className="t" d="M15 27l7 7 15-15" fill="none" stroke="var(--color-success, #2e7d32)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default CheckDibujo;

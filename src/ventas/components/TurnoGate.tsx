// Si el comercio tiene cajeros, para entrar a vender hay que iniciar turno.
// Sin internet no se puede validar el legajo: no se bloquea (el cajero no queda
// trabado si cerró turno offline); al volver la red, se exige.
import React, { ReactNode } from 'react';
import { useEmpleado } from '../context/EmpleadoContext';
import CajeroGate from './CajeroGate';

const TurnoGate: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { cajero, hayEmpleados, cargando } = useEmpleado();

  if (cargando) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      </div>
    );
  }
  if (hayEmpleados && !cajero && navigator.onLine) return <CajeroGate />;
  return <>{children}</>;
};

export default TurnoGate;

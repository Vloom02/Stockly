// Si el comercio tiene cajeros, para entrar a vender hay que iniciar turno, también sin
// internet (con la clave guardada en el celular). Si no hay clave guardada, CajeroGate ofrece
// atender "sin turno": solo vender, sin nada del dueño.
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
  if (hayEmpleados && !cajero) return <CajeroGate />;
  return <>{children}</>;
};

export default TurnoGate;

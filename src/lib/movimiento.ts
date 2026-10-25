// Opción "Animaciones: Sí / No" de la app (además de "Quitar animaciones" de Android).
import { almacenGet, almacenSet } from './almacen';

const KEY = 'stockly:movimiento';
export const movimientoActivo = () => almacenGet(KEY, '1') !== '0';
export function aplicarMovimiento(on: boolean) {
  if (on) delete document.documentElement.dataset.movimiento;
  else document.documentElement.dataset.movimiento = 'no';
}
export function guardarMovimiento(on: boolean) { almacenSet(KEY, on ? '1' : '0'); aplicarMovimiento(on); }

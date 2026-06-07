import { describe, it, expect } from 'vitest';
import {
  diasRestantes, nivelPorDias, calcularNivelAlerta, ordenNivel, etiquetaNivel,
  UmbralesVencimiento,
} from './vencimientos';

// Umbrales por defecto de Stockly (critico=7, urgente=30, aviso=60)
const U: UmbralesVencimiento = { critico: 7, urgente: 30, aviso: 60 };
const HOY = new Date(2026, 5, 6); // 2026-06-06 (mes 0-indexado)

describe('diasRestantes', () => {
  it('da 0 cuando vence hoy', () => {
    expect(diasRestantes('2026-06-06', HOY)).toBe(0);
  });
  it('da positivo cuando vence en el futuro', () => {
    expect(diasRestantes('2026-06-16', HOY)).toBe(10);
  });
  it('da negativo cuando ya venció', () => {
    expect(diasRestantes('2026-06-01', HOY)).toBe(-5);
  });
  it('no se desfasa por hora del día (compara a medianoche)', () => {
    const tarde = new Date(2026, 5, 6, 23, 59, 59);
    expect(diasRestantes('2026-06-07', tarde)).toBe(1);
  });
});

describe('nivelPorDias', () => {
  it('clasifica vencido / critico / urgente / aviso / ok', () => {
    expect(nivelPorDias(-1, U)).toBe('vencido');
    expect(nivelPorDias(0, U)).toBe('critico');   // vence hoy = crítico
    expect(nivelPorDias(7, U)).toBe('critico');   // borde crítico
    expect(nivelPorDias(8, U)).toBe('urgente');
    expect(nivelPorDias(30, U)).toBe('urgente');  // borde urgente
    expect(nivelPorDias(31, U)).toBe('aviso');
    expect(nivelPorDias(60, U)).toBe('aviso');    // borde aviso
    expect(nivelPorDias(61, U)).toBe('ok');
  });

  it('diasAviso del lote acota SOLO la banda de aviso (no urgente/critico)', () => {
    // diasAviso recorta la ventana de aviso: con 35, a 40 días ya es 'ok'
    expect(nivelPorDias(40, U, 35)).toBe('ok');
    // A 35 días justo cae en aviso
    expect(nivelPorDias(35, U, 35)).toBe('aviso');
    // Sin diasAviso usa el umbral global (60): a 50 días es 'aviso'
    expect(nivelPorDias(50, U)).toBe('aviso');
  });

  it('vencido y critico tienen prioridad sobre el diasAviso del lote', () => {
    expect(nivelPorDias(-3, U, 90)).toBe('vencido');
    expect(nivelPorDias(5, U, 90)).toBe('critico');
  });
});

describe('calcularNivelAlerta', () => {
  it('integra fecha + umbrales', () => {
    expect(calcularNivelAlerta('2026-06-06', U, undefined, HOY)).toBe('critico');
    expect(calcularNivelAlerta('2026-06-01', U, undefined, HOY)).toBe('vencido');
    expect(calcularNivelAlerta('2026-12-31', U, undefined, HOY)).toBe('ok');
  });
});

describe('ordenNivel', () => {
  it('ordena de más grave (0) a menos grave', () => {
    const niveles = ['ok', 'vencido', 'aviso', 'critico', 'urgente'] as const;
    const ordenado = [...niveles].sort((a, b) => ordenNivel(a) - ordenNivel(b));
    expect(ordenado).toEqual(['vencido', 'critico', 'urgente', 'aviso', 'ok']);
  });
});

describe('etiquetaNivel', () => {
  it('devuelve etiquetas legibles', () => {
    expect(etiquetaNivel('vencido')).toBe('Vencido');
    expect(etiquetaNivel('ok')).toBe('OK');
  });
});

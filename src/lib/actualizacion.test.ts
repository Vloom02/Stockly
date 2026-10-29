import { describe, it, expect } from 'vitest';
import { esMasNueva, planDeActualizacion, versionParaAplicar } from './actualizacion';

describe('esMasNueva', () => {
  it('compara número por número (no como texto)', () => {
    expect(esMasNueva('v1.10.0', '1.9.3')).toBe(true);
    expect(esMasNueva('v1.1.0', '1.1.0')).toBe(false);
    expect(esMasNueva('1.0.9', '1.1.0')).toBe(false);
    expect(esMasNueva('v2', '1.9.9')).toBe(true);
  });
});

describe('planDeActualizacion', () => {
  const rel = (body: string) => ({
    tag_name: 'v1.3.0', body, html_url: 'https://github.com/x/releases/v1.3.0',
    assets: [{ name: 'stockly-web-1.3.0.zip', browser_download_url: 'https://z/web.zip' }, { name: 'Stockly-1.3.0.apk', browser_download_url: 'https://z/app.apk' }],
  });

  it('si ya está al día no hace nada', () => {
    expect(planDeActualizacion(rel(''), '1.3.0', '1.2.0')).toEqual({ tipo: 'nada' });
    expect(planDeActualizacion(null, '1.3.0', '1.2.0')).toEqual({ tipo: 'nada' });
  });

  it('cambió solo la parte web: se baja sola, con su checksum', () => {
    expect(planDeActualizacion(rel('apk-minimo: 1.2.0\nsha256: abc123'), '1.2.4', '1.2.0'))
      .toEqual({ tipo: 'web', version: '1.3.0', url: 'https://z/web.zip', checksum: 'abc123' });
  });

  it('sin huella sha256 no se baja la parte web', () => {
    expect(planDeActualizacion(rel('apk-minimo: 1.2.0'), '1.2.4', '1.2.0')).toEqual({ tipo: 'nada' });
  });

  it('si el APK instalado es más viejo que el mínimo, pide el APK', () => {
    expect(planDeActualizacion(rel('apk-minimo: 1.3.0\nsha256: abc'), '1.2.4', '1.2.0'))
      .toEqual({ tipo: 'apk', version: '1.3.0', url: 'https://z/app.apk' });
  });
});

describe('versionParaAplicar', () => {
  const b = (version: string, status: string) => ({ id: version, version, status });
  it('elige la bajada más nueva que la actual, ignorando las fallidas o a medio bajar', () => {
    expect(versionParaAplicar([b('1.2.5', 'pending'), b('1.3.0', 'error'), b('1.2.9', 'success'), b('1.4.0', 'downloading')], '1.2.4')?.version).toBe('1.2.9');
  });
  it('si no hay nada más nuevo, no aplica nada', () => {
    expect(versionParaAplicar([b('1.2.4', 'success'), b('1.2.0', 'pending')], '1.2.4')).toBeNull();
  });
});

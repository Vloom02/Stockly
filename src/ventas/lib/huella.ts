// ═══════════════════════════════════════════════════════════════════════════
// Entrar con la huella en vez de tipear el PIN / la clave (WCAG 2.2 · 3.3.8:
// no obligar a recordar un secreto). La clave real se guarda en el Keystore de
// Android protegida por biometría (BIOMETRY_ANY): solo sale con una huella
// válida, y después se verifica en el servidor como si se hubiera tipeado.
// Así la huella no salta ninguna verificación: si el dueño cambió el PIN, la
// clave guardada falla y se pide tipear de nuevo.
// ═══════════════════════════════════════════════════════════════════════════
import { Capacitor } from '@capacitor/core';
import { NativeBiometric, AccessControl } from '@capgo/capacitor-native-biometric';
import { openDB, getLocalSetting, setLocalSetting } from './outbox';

const servidor = (clave: string) => `com.almacen.app.${clave}`;
const flag = (clave: string) => `huella:${clave}`;

export const CLAVE_HUELLA_DUENO = 'pin-dueno';
export const claveHuellaCajero = (legajo: string) => `cajero-${legajo.trim().toLowerCase()}`;

/** ¿El celular tiene huella (u otra biometría) configurada? */
export async function huellaDisponible(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    return (await NativeBiometric.isAvailable()).isAvailable;
  } catch {
    return false;
  }
}

/** ¿Ya hay una clave guardada con huella para esta persona? */
export async function hayHuella(clave: string): Promise<boolean> {
  try {
    await openDB();
    return (await getLocalSetting(flag(clave))) === '1';
  } catch {
    return false;
  }
}

/** Guarda el secreto protegido por huella (pide la huella para confirmar). */
export async function guardarHuella(clave: string, secreto: string): Promise<boolean> {
  try {
    await NativeBiometric.setCredentials({
      server: servidor(clave), username: clave, password: secreto,
      accessControl: AccessControl.BIOMETRY_ANY, title: 'Activar huella',
    });
    await openDB();
    await setLocalSetting(flag(clave), '1');
    return true;
  } catch {
    return false; // canceló o el celular no lo permite: sigue con PIN
  }
}

/** Pide la huella y devuelve el secreto guardado (null si cancela o falla). */
export async function leerConHuella(clave: string, titulo: string): Promise<string | null> {
  try {
    const c = await NativeBiometric.getSecureCredentials({
      server: servidor(clave), title: titulo, reason: titulo,
    });
    return c.password || null;
  } catch {
    return null;
  }
}

/** Olvida la huella (por ejemplo, si la clave guardada ya no es válida). */
export async function borrarHuella(clave: string): Promise<void> {
  try { await NativeBiometric.deleteCredentials({ server: servidor(clave) }); } catch { /* ya no estaba */ }
  try { await openDB(); await setLocalSetting(flag(clave), ''); } catch { /* */ }
}

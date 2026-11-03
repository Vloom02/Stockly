// Archivos generados por la app (Excel, planillas, copias). En la app se guardan en el caché privado y se abre
// "Compartir" (Drive, WhatsApp, mail, abrir con Excel); en la web se descargan.
// No en Documentos: ahí quedaban ventas y nombres de clientes a la vista de cualquier otra app con permiso de archivos.
import { Capacitor } from '@capacitor/core';

const aBase64 = (datos: Uint8Array) => {
  let s = '';
  for (let i = 0; i < datos.length; i += 0x8000) s += String.fromCharCode(...datos.subarray(i, i + 0x8000));
  return btoa(s);
};

export type ResultadoArchivo = 'compartido' | 'cancelado' | 'descargado' | 'error';

/** Texto para avisar cómo terminó (null = no hace falta avisar). */
export function avisoArchivo(r: ResultadoArchivo, queEs = 'El archivo'): string | null {
  if (r === 'compartido') return null;
  if (r === 'cancelado') return `${queEs} no se mandó a ningún lado. Tocá de nuevo y elegí Drive, WhatsApp o mail.`;
  if (r === 'descargado') return `${queEs} se descargó.`;
  return `No se pudo armar ${queEs.toLowerCase()}.`;
}

export async function guardarYCompartir(nombre: string, datos: Uint8Array | string, tipo: string): Promise<ResultadoArchivo> {
  try {
    const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { uri } = await Filesystem.writeFile({ path: nombre, data: aBase64(bytes), directory: Directory.Cache });
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: nombre, files: [uri], dialogTitle: '¿Dónde lo guardás o a quién se lo mandás?' });
        return 'compartido';
      } catch {
        return 'cancelado';
      }
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return 'descargado';
  } catch {
    return 'error';
  }
}

// Archivos generados por la app (Excel, etc.). En la app se guardan en Documentos y se abre
// "Compartir" (WhatsApp, mail, Drive, abrir con Excel); en la web se descargan.
import { Capacitor } from '@capacitor/core';

const aBase64 = (datos: Uint8Array) => {
  let s = '';
  for (let i = 0; i < datos.length; i += 0x8000) s += String.fromCharCode(...datos.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function guardarYCompartir(nombre: string, datos: Uint8Array, tipo: string): Promise<'compartido' | 'guardado' | 'descargado' | 'error'> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const data = aBase64(datos);
      // Documentos puede no estar permitido en Android viejos: ahí queda en el caché y se comparte igual.
      const { uri } = await Filesystem.writeFile({ path: nombre, data, directory: Directory.Documents, recursive: true })
        .catch(() => Filesystem.writeFile({ path: nombre, data, directory: Directory.Cache }));
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: nombre, files: [uri] });
        return 'compartido';
      } catch {
        return 'guardado'; // cerró "Compartir": el archivo quedó guardado igual
      }
    }
    const url = URL.createObjectURL(new Blob([datos as BlobPart], { type: tipo }));
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

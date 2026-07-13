// ═══════════════════════════════════════════════════════════════════════════
// Foto de producto: cámara/galería (Capacitor Camera, ya redimensiona) →
// Supabase Storage, bucket público `productos`, path {comercio}/{producto}.jpg.
// ponytail: la subida es SOLO online — sin conexión se avisa y no se encola;
// si algún día hace falta, encolar el base64 en el outbox.
// ═══════════════════════════════════════════════════════════════════════════
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { supabase } from './supabase';

function base64ABlob(b64: string): Blob {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/jpeg' });
}

/**
 * Abre cámara/galería, sube la foto y devuelve la URL pública (con cache-bust).
 * Devuelve null si el usuario canceló. Lanza Error con mensaje legible si falla.
 */
export async function elegirYSubirFoto(comercioId: string, productoId: string): Promise<string | null> {
  if (!navigator.onLine) throw new Error('Necesitás conexión para subir la foto');

  let foto;
  try {
    foto = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,   // el usuario elige cámara o galería
      quality: 70,
      width: 512,                    // el plugin ya la achica
      correctOrientation: true,
    });
  } catch {
    return null; // canceló el selector
  }
  if (!foto.base64String) return null;

  const path = `${comercioId}/${productoId}.jpg`;
  const { error } = await supabase.storage.from('productos')
    .upload(path, base64ABlob(foto.base64String), { upsert: true, contentType: 'image/jpeg' });
  if (error) throw new Error('No se pudo subir la foto: ' + error.message);

  const { data } = supabase.storage.from('productos').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`; // cache-bust al reemplazar la foto
}

// Compartir texto: hoja nativa de Android (Capacitor Share), o Web Share /
// portapapeles como fallback. Devuelve true si quedó compartido/copiado.
import { Capacitor } from '@capacitor/core';

export async function compartirTexto(texto: string, titulo = 'Stockly'): Promise<'compartido' | 'copiado' | 'error'> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: titulo, text: texto, dialogTitle: titulo });
      return 'compartido';
    }
    if (navigator.share) {
      await navigator.share({ title: titulo, text: texto });
      return 'compartido';
    }
    await navigator.clipboard.writeText(texto);
    return 'copiado';
  } catch {
    // El usuario pudo cancelar la hoja de compartir.
    try { await navigator.clipboard.writeText(texto); return 'copiado'; } catch { return 'error'; }
  }
}

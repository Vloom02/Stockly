// Compartir texto: hoja nativa de Android (Capacitor Share), o Web Share /
// portapapeles como fallback. Devuelve true si quedó compartido/copiado.
import { Capacitor } from '@capacitor/core';

export async function compartirTexto(texto: string, titulo = 'Stockly'): Promise<'compartido' | 'copiado' | 'cancelado' | 'error'> {
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
  } catch (e) {
    // Cerró la hoja de compartir: no es un error ni se copia nada (antes decía "copiado").
    const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    if (/cancel|abort/i.test(msg)) return 'cancelado';
    try { await navigator.clipboard.writeText(texto); return 'copiado'; } catch { return 'error'; }
  }
}

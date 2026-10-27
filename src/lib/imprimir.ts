// Imprimir. window.print() no abre nada dentro de la app de Android (WebView): ahí se usa el
// diálogo de impresión del sistema (plugin de Capgo), que además ofrece "Guardar como PDF".
import { Capacitor } from '@capacitor/core';

/** Imprime un documento HTML armado aparte (no la pantalla). */
export async function imprimirHtml(nombre: string, html: string) {
  const { Printer } = await import('@capgo/capacitor-printer');
  await Printer.printHtml({ name: nombre, html });
}

/** Imprime la pantalla actual, respetando su CSS @media print. */
export async function imprimirPantalla(nombre: string) {
  if (!Capacitor.isNativePlatform()) {
    window.print();
    return;
  }
  const { Printer } = await import('@capgo/capacitor-printer');
  await Printer.printWebView({ name: nombre });
}

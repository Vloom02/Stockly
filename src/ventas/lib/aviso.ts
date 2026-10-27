// ═══════════════════════════════════════════════════════════════════════════
// Aviso por varios sentidos al cobrar: vibración + un "ding" suave + el mensaje
// en pantalla (la vibración sola no alcanza: muchos no la notan). El sonido se
// puede apagar desde "Más" (preferencia del dispositivo).
// ═══════════════════════════════════════════════════════════════════════════
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const KEY = 'ventas:sonido';
let audio: AudioContext | null = null;

export const sonidoActivo = (): boolean => {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
};
export const setSonidoActivo = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* */ }
};

function tono(frecuencia: number, inicio: number, duracion: number) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = frecuencia;
  // Envolvente suave (sin "click"): sube rápido y se apaga despacio.
  vol.gain.setValueAtTime(0.0001, audio.currentTime + inicio);
  vol.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + inicio + 0.02);
  vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + inicio + duracion);
  osc.connect(vol).connect(audio.destination);
  osc.start(audio.currentTime + inicio);
  osc.stop(audio.currentTime + inicio + duracion + 0.05);
}

/** Venta cobrada: vibración de éxito + "ding-dong" corto y agradable. */
export function avisoVentaOk() {
  Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  if (!sonidoActivo()) return;
  try {
    audio ??= new AudioContext();
    tono(880, 0, 0.18);
    tono(1320, 0.14, 0.28);
  } catch { /* sin audio: queda la vibración y el mensaje */ }
}

/** Toque leve: producto agregado al carrito. */
export function avisoToque() {
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

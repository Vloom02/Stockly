// Transiciones suaves de Ionic: cambio de pantalla, avisos (toast) y diálogos (alert).
// Se configuran una vez en setupIonicReact; cada animación consulta en el momento si
// el usuario apagó el movimiento (opción de la app o "Quitar animaciones" de Android).
import { createAnimation, Animation } from '@ionic/react';
import { movimientoActivo } from './movimiento';

const SALIDA = 'cubic-bezier(0.22, 1, 0.36, 1)';   // frena suave al final
const RESORTE = 'cubic-bezier(0.34, 1.3, 0.64, 1)'; // rebote apenas perceptible

export function animacionesActivas(): boolean {
  const reducido = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return movimientoActivo() && !reducido;
}

// Sin movimiento: misma animación, pero instantánea (Ionic igual necesita una).
const dur = (ms: number) => (animacionesActivas() ? ms : 0);

const raiz = (el: HTMLElement) => (el.shadowRoot ?? el) as ParentNode;

const paginaDe = (el: HTMLElement): HTMLElement =>
  el.classList.contains('ion-page') ? el : (el.querySelector(':scope > .ion-page') as HTMLElement) ?? el;

interface OpcionesNav { enteringEl: HTMLElement; leavingEl?: HTMLElement; direction?: string }

/** Pantalla nueva: aparece subiendo apenas y aclarándose. Volver: la que se va baja y se apaga. */
export const transicionPagina = (_: HTMLElement, opts: OpcionesNav): Animation => {
  const atras = opts.direction === 'back';
  const entra = createAnimation()
    .addElement(paginaDe(opts.enteringEl))
    .fill('both')
    .beforeRemoveClass('ion-page-invisible')
    .fromTo('opacity', atras ? '0.6' : '0.01', '1')
    .fromTo('transform', atras ? 'scale(0.99)' : 'translateY(18px) scale(0.985)', 'none');

  const anim = createAnimation().duration(dur(atras ? 240 : 340)).easing(SALIDA).addAnimation(entra);

  if (opts.leavingEl && atras) {
    const sale = createAnimation()
      .addElement(paginaDe(opts.leavingEl))
      .onFinish((paso) => {
        // Igual que la transición de Ionic: la página que se fue queda oculta.
        if (paso === 1 && sale.elements.length > 0) sale.elements[0].style.setProperty('display', 'none');
      })
      .fromTo('opacity', '1', '0')
      .fromTo('transform', 'none', 'translateY(18px)');
    anim.addAnimation(sale);
  }
  return anim;
};

interface OpcionesToast { position?: string; top?: string; bottom?: string }

/** Aviso: entra deslizándose y crece un poquito. Respeta la posición que calcula Ionic. */
export const toastEntra = (base: HTMLElement, opts?: OpcionesToast): Animation => {
  const caja = raiz(base).querySelector('.toast-wrapper') as HTMLElement;
  const wrapper = createAnimation().addElement(caja).fromTo('opacity', '0.01', '1');
  const pos = opts?.position ?? 'bottom';
  if (pos === 'top') {
    wrapper.fromTo('transform', `translateY(calc(${opts?.top ?? '0px'} - 16px)) scale(0.96)`, `translateY(${opts?.top ?? '0px'}) scale(1)`);
  } else if (pos === 'middle') {
    caja.style.setProperty('top', `calc(50% - ${caja.clientHeight / 2}px)`);
    wrapper.fromTo('transform', 'scale(0.94)', 'scale(1)');
  } else {
    wrapper.fromTo('transform', `translateY(calc(${opts?.bottom ?? '0px'} + 16px)) scale(0.96)`, `translateY(${opts?.bottom ?? '0px'}) scale(1)`);
  }
  return createAnimation().duration(dur(380)).easing(RESORTE).addAnimation(wrapper);
};

export const toastSale = (base: HTMLElement): Animation => {
  const caja = raiz(base).querySelector('.toast-wrapper') as HTMLElement;
  return createAnimation().duration(dur(200)).easing('ease-in')
    .addAnimation(createAnimation().addElement(caja).fromTo('opacity', '0.99', '0'));
};

/** Diálogo: el fondo se oscurece y la caja aparece con un rebote corto. */
export const alertEntra = (base: HTMLElement): Animation => {
  const r = raiz(base);
  const fondo = createAnimation().addElement(r.querySelector('ion-backdrop')!)
    .fromTo('opacity', '0.01', 'var(--backdrop-opacity)')
    .beforeStyles({ 'pointer-events': 'none' })
    .afterClearStyles(['pointer-events']);
  const caja = createAnimation().addElement(r.querySelector('.alert-wrapper')!)
    .fromTo('opacity', '0.01', '1')
    .fromTo('transform', 'scale(0.92)', 'scale(1)');
  return createAnimation().duration(dur(300)).easing(RESORTE).addAnimation([fondo, caja]);
};

export const alertSale = (base: HTMLElement): Animation => {
  const r = raiz(base);
  const fondo = createAnimation().addElement(r.querySelector('ion-backdrop')!)
    .fromTo('opacity', 'var(--backdrop-opacity)', '0');
  const caja = createAnimation().addElement(r.querySelector('.alert-wrapper')!)
    .fromTo('opacity', '0.99', '0')
    .fromTo('transform', 'scale(1)', 'scale(0.96)');
  return createAnimation().duration(dur(180)).easing('ease-in').addAnimation([fondo, caja]);
};

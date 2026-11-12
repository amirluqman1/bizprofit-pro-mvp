// PWA: daftar service worker, butang "Pasang app", amaran tiada internet.
import { $ } from './ui.js';

let deferred = null;   // peristiwa pasang dari Chrome (Android/desktop)

export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const canPromptInstall = () => !!deferred;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export async function promptInstall() {
  if (!deferred) return 'tiada';
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome;            // 'accepted' atau 'dismissed'
}

export function initPWA() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { deferred = null; });

  const syncOnline = () => { $('offline').hidden = navigator.onLine; };
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* app tetap jalan tanpa PWA */ });
  }
}

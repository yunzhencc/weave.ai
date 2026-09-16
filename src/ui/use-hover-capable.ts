'use client';

import { useSyncExternalStore } from 'react';

const HOVER_QUERY = '(hover: hover) and (pointer: fine)';

function subscribe(onStoreChange: () => void) {
  if (!window.matchMedia)
    return () => {};
  const mediaQuery = window.matchMedia(HOVER_QUERY);
  mediaQuery.addEventListener?.('change', onStoreChange);
  return () => mediaQuery.removeEventListener?.('change', onStoreChange);
}

function getSnapshot() {
  return window.matchMedia?.(HOVER_QUERY).matches ?? false;
}

/**
 * Returns true only on devices that have a true hover (mouse / trackpad).
 * Touch devices fire phantom `:hover` on tap that sticks until tap-elsewhere
 * — gate hover-only effects (scale lifts, magnetic pulls) behind this.
 */
export function useHoverCapable() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

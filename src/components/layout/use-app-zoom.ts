import { useEffect, useMemo, useRef } from "react";

const DEFAULT_APP_ZOOM = 1;
const APP_ZOOM_STEP = 0.1;
const MIN_APP_ZOOM = 0.5;
const MAX_APP_ZOOM = 2;
const APP_ZOOM_STORAGE_KEY = "arkline.appZoom";

export function useAppZoom() {
  const initialZoom = useMemo(readStoredAppZoom, []);
  const zoomRef = useRef(initialZoom);
  const gestureStartZoomRef = useRef(DEFAULT_APP_ZOOM);

  useEffect(() => {
    applyAppZoom(zoomRef.current);

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey || event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      zoomRef.current = clampZoom(zoomRef.current + direction * APP_ZOOM_STEP);
      applyAppZoom(zoomRef.current);
      storeAppZoom(zoomRef.current);
    }

    function handleGestureStart(event: Event) {
      event.preventDefault();
      gestureStartZoomRef.current = zoomRef.current;
    }

    function handleGestureChange(event: Event) {
      event.preventDefault();
      const scale = gestureScale(event);
      zoomRef.current = clampZoom(gestureStartZoomRef.current * scale);
      applyAppZoom(zoomRef.current);
      storeAppZoom(zoomRef.current);
    }

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    window.addEventListener("gesturestart", handleGestureStart, { capture: true, passive: false });
    window.addEventListener("gesturechange", handleGestureChange, { capture: true, passive: false });
    return () => {
      window.removeEventListener("wheel", handleWheel, true);
      window.removeEventListener("gesturestart", handleGestureStart, true);
      window.removeEventListener("gesturechange", handleGestureChange, true);
    };
  }, []);
}

function clampZoom(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Math.min(MAX_APP_ZOOM, Math.max(MIN_APP_ZOOM, rounded));
}

function gestureScale(event: Event) {
  const scale = (event as Event & { scale?: number }).scale;
  return typeof scale === "number" && Number.isFinite(scale) ? scale : 1;
}

function readStoredAppZoom() {
  try {
    const stored = Number.parseFloat(window.localStorage.getItem(APP_ZOOM_STORAGE_KEY) ?? "");
    return Number.isFinite(stored) ? clampZoom(stored) : DEFAULT_APP_ZOOM;
  } catch {
    return DEFAULT_APP_ZOOM;
  }
}

function storeAppZoom(value: number) {
  try {
    window.localStorage.setItem(APP_ZOOM_STORAGE_KEY, String(value));
  } catch {
    // Zoom remains available for the current session when storage is unavailable.
  }
}

function applyAppZoom(value: number) {
  document.documentElement.dataset.arklineZoom = String(value);
  if (!("__TAURI_INTERNALS__" in window)) {
    document.documentElement.style.setProperty("zoom", String(value));
    return;
  }
  void import("@tauri-apps/api/webview")
    .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(value))
    .catch(() => {
      document.documentElement.style.setProperty("zoom", String(value));
    });
}

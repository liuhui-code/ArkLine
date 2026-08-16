import { fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { useAppZoom } from "@/components/layout/use-app-zoom";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty("zoom");
  delete document.documentElement.dataset.arklineZoom;
});

describe("AppShell application zoom gestures", () => {
  it("zooms the whole application with Ctrl+mouse-wheel", async () => {
    render(<AppShell />);
    const zoomIn = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    });

    window.dispatchEvent(zoomIn);

    expect(zoomIn.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(document.documentElement.dataset.arklineZoom).toBe("1.1");
    });
  });

  it("zooms continuously with a macOS trackpad pinch gesture", async () => {
    renderHook(() => useAppZoom());
    const start = gestureEvent("gesturestart", 1);
    const change = gestureEvent("gesturechange", 1.25);

    window.dispatchEvent(start);
    window.dispatchEvent(change);

    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(document.documentElement.dataset.arklineZoom).toBe("1.25");
    });
  });

  it("keeps gesture zoom within a usable 50% to 200% range", async () => {
    renderHook(() => useAppZoom());

    for (let index = 0; index < 20; index += 1) {
      fireEvent.wheel(window, { ctrlKey: true, deltaY: 100 });
    }

    await waitFor(() => {
      expect(document.documentElement.dataset.arklineZoom).toBe("0.5");
    });
  });

  it("restores the user's zoom after the application starts again", async () => {
    const firstRun = renderHook(() => useAppZoom());
    fireEvent.wheel(window, { ctrlKey: true, deltaY: -100 });
    await waitFor(() => {
      expect(document.documentElement.dataset.arklineZoom).toBe("1.1");
    });

    firstRun.unmount();
    document.documentElement.style.removeProperty("zoom");
    delete document.documentElement.dataset.arklineZoom;
    renderHook(() => useAppZoom());

    await waitFor(() => {
      expect(document.documentElement.dataset.arklineZoom).toBe("1.1");
    });
  });

  it("leaves ordinary mouse-wheel and two-finger scrolling untouched", () => {
    renderHook(() => useAppZoom());
    const scroll = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });

    window.dispatchEvent(scroll);

    expect(scroll.defaultPrevented).toBe(false);
    expect(document.documentElement.dataset.arklineZoom).toBe("1");
  });
});

function gestureEvent(type: string, scale: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "scale", { value: scale });
  return event;
}

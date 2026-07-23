import { useEffect, useRef } from "react";
import { isBareShift, resolveShellCommand, type ShellCommand } from "@/components/layout/shell-keymap";
import type { KeybindingContext } from "@/components/layout/keybinding-model";

type UseShellHotkeysOptions = {
  context?: KeybindingContext;
  onCommand: (command: ShellCommand) => void;
};

const DOUBLE_SHIFT_WINDOW_MS = 400;

export function useShellHotkeys({ context = {}, onCommand }: UseShellHotkeysOptions) {
  const lastShiftAtRef = useRef(0);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      if (isBareShift(event)) {
        const now = Date.now();
        if (now - lastShiftAtRef.current <= DOUBLE_SHIFT_WINDOW_MS) {
          lastShiftAtRef.current = 0;
          event.preventDefault();
          event.stopPropagation();
          onCommand("openSearchEverywhere");
          return;
        }

        lastShiftAtRef.current = now;
        return;
      }

      lastShiftAtRef.current = 0;
      const command = resolveShellCommand(event, context);
      if (!command) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onCommand(command);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [context, onCommand]);
}

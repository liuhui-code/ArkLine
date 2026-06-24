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
      if (isBareShift(event)) {
        const now = Date.now();
        if (now - lastShiftAtRef.current <= DOUBLE_SHIFT_WINDOW_MS) {
          lastShiftAtRef.current = 0;
          event.preventDefault();
          onCommand("openSearchEverywhere");
          return;
        }

        lastShiftAtRef.current = now;
        return;
      }

      const command = resolveShellCommand(event, context);
      if (!command) {
        return;
      }

      event.preventDefault();
      onCommand(command);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [context, onCommand]);
}

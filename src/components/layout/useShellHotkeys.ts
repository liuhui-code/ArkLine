import { useEffect, useRef } from "react";
import { isBareShift, resolveShellCommand, type ShellCommand } from "@/components/layout/shell-keymap";
import type { KeybindingContext } from "@/components/layout/keybinding-model";

type UseShellHotkeysOptions = {
  context?: KeybindingContext;
  isCommandEnabled?: (command: ShellCommand) => boolean;
  onCommand: (command: ShellCommand) => void;
};

const DOUBLE_SHIFT_WINDOW_MS = 400;

function isCodeMirrorTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".cm-editor"));
}

function shouldDeferToEditor(event: KeyboardEvent, command: ShellCommand, context: KeybindingContext) {
  if (!isCodeMirrorTarget(event.target)) {
    return false;
  }

  if (command === "openCompletion" && event.ctrlKey && !context.settingsApplying) {
    return true;
  }

  if (command === "showCodeActions") {
    return true;
  }

  return command === "closeTransientUi" && Boolean(document.querySelector(".cm-tooltip-autocomplete"));
}

export function useShellHotkeys({ context = {}, isCommandEnabled, onCommand }: UseShellHotkeysOptions) {
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

      if (isCommandEnabled && !isCommandEnabled(command)) {
        return;
      }

      if (shouldDeferToEditor(event, command, context)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onCommand(command);
    }

    function handleDeferredEditorKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !isCodeMirrorTarget(event.target)) {
        return;
      }

      const command = resolveShellCommand(event, context);
      if (command !== "showCodeActions" || isCommandEnabled && !isCommandEnabled(command)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onCommand(command);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keydown", handleDeferredEditorKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keydown", handleDeferredEditorKeyDown);
    };
  }, [context, isCommandEnabled, onCommand]);
}

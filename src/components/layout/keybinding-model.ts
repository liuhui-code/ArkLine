export type KeybindingContext = {
  editorFocus?: boolean;
  completionOpen?: boolean;
  overlayOpen?: boolean;
  settingsOpen?: boolean;
  settingsApplying?: boolean;
};

export type Keybinding = {
  key: string;
  mod?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
};

export type CommandDescriptor<TCommand extends string = string> = {
  id: TCommand;
  title: string;
  category: string;
  defaultKeybindings: Keybinding[];
  when?: (context: KeybindingContext) => boolean;
};

export type KeybindingInventoryItem<TCommand extends string = string> = {
  commandId: TCommand;
  title: string;
  category: string;
  shortcut: string;
  source: "Default";
  status: "Active" | "Conflict";
  conflicts: string[];
};

export function matchesKeybinding(event: KeyboardEvent, keybinding: Keybinding) {
  const usesMod = keybinding.mod ?? false;
  const expectedCtrl = keybinding.ctrl ?? false;
  const expectedMeta = keybinding.meta ?? false;
  const primaryModifierMatched = usesMod ? event.ctrlKey !== event.metaKey : expectedCtrl === event.ctrlKey && expectedMeta === event.metaKey;

  return (
    eventKeyEquals(event, keybinding.key) &&
    primaryModifierMatched &&
    (keybinding.alt ?? false) === event.altKey &&
    (keybinding.shift ?? false) === event.shiftKey
  );
}

export function resolveKeybindingCommand<TCommand extends string>(
  event: KeyboardEvent,
  commands: CommandDescriptor<TCommand>[],
  context: KeybindingContext = {},
) {
  for (const command of commands) {
    if (command.when && !command.when(context)) {
      continue;
    }

    if (command.defaultKeybindings.some((keybinding) => matchesKeybinding(event, keybinding))) {
      return command.id;
    }
  }

  return null;
}

export function formatKeybinding(keybinding: Keybinding, platform: "mac" | "default" = getDisplayPlatform()) {
  const parts: string[] = [];

  if (keybinding.mod) {
    parts.push(platform === "mac" ? "Cmd" : "Ctrl");
  }

  if (keybinding.ctrl) {
    parts.push("Ctrl");
  }

  if (keybinding.meta) {
    parts.push(platform === "mac" ? "Cmd" : "Meta");
  }

  if (keybinding.alt) {
    parts.push(platform === "mac" ? "Option" : "Alt");
  }

  if (keybinding.shift) {
    parts.push("Shift");
  }

  parts.push(formatKey(keybinding.key));
  return parts.join("+");
}

export function formatCommandShortcut(command: CommandDescriptor, platform: "mac" | "default" = getDisplayPlatform()) {
  const [first] = command.defaultKeybindings;
  return first ? formatKeybinding(first, platform) : undefined;
}

export function buildKeybindingInventory<TCommand extends string>(
  commands: CommandDescriptor<TCommand>[],
  platform: "mac" | "default" = getDisplayPlatform(),
): KeybindingInventoryItem<TCommand>[] {
  const items = commands.flatMap((command) => (
    command.defaultKeybindings.map((keybinding) => ({
      commandId: command.id,
      title: command.title,
      category: command.category,
      shortcut: formatKeybinding(keybinding, platform),
      source: "Default" as const,
      status: "Active" as const,
      conflicts: [] as string[],
    }))
  ));

  return items.map((item) => {
    const conflicts = items
      .filter((candidate) => candidate.shortcut === item.shortcut && candidate.commandId !== item.commandId)
      .map((candidate) => candidate.title);

    return {
      ...item,
      status: conflicts.length > 0 ? "Conflict" : "Active",
      conflicts,
    };
  });
}

function eventKeyEquals(event: KeyboardEvent, key: string) {
  if (key.toLowerCase() === "space") {
    return event.code === "Space" || event.key === " ";
  }

  return event.key.toLowerCase() === key.toLowerCase();
}

function formatKey(key: string) {
  if (key.toLowerCase() === "escape") {
    return "Esc";
  }

  if (key.toLowerCase() === "arrowleft") {
    return "Left";
  }

  if (key.toLowerCase() === "space") {
    return "Space";
  }

  return key.length === 1 ? key.toUpperCase() : key;
}

function getDisplayPlatform(): "mac" | "default" {
  if (typeof navigator === "undefined") {
    return "default";
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "mac" : "default";
}

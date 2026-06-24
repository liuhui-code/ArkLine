import { useMemo, useState } from "react";
import { buildKeybindingInventory, type KeybindingInventoryItem } from "@/components/layout/keybinding-model";
import { shellCommandDescriptors } from "@/components/layout/shell-keymap";

type ExtraKeymapRow = {
  id: string;
  title: string;
  category: string;
  shortcut: string;
};

const extraKeymapRows: ExtraKeymapRow[] = [
  {
    id: "openSearchEverywhere",
    title: "Search Everywhere",
    category: "Navigation",
    shortcut: "Double Shift",
  },
];

function keymapRows(): KeybindingInventoryItem[] {
  return [
    ...buildKeybindingInventory(shellCommandDescriptors),
    ...extraKeymapRows.map((row) => ({
      commandId: row.id,
      title: row.title,
      category: row.category,
      shortcut: row.shortcut,
      source: "Default" as const,
      status: "Active" as const,
      conflicts: [],
    })),
  ].sort((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title));
}

function filterRows(rows: KeybindingInventoryItem[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return rows;
  }

  return rows.filter((row) => (
    row.title.toLowerCase().includes(normalized) ||
    row.category.toLowerCase().includes(normalized) ||
    row.shortcut.toLowerCase().includes(normalized) ||
    row.source.toLowerCase().includes(normalized) ||
    row.status.toLowerCase().includes(normalized)
  ));
}

export function SettingsKeymapPanel() {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => keymapRows(), []);
  const visibleRows = useMemo(() => filterRows(rows, query), [query, rows]);

  return (
    <section className="settings-section" aria-label="Keyboard Shortcuts Settings">
      <header className="settings-section__header">
        <div>
          <h3>Keymap</h3>
          <p>Review ArkLine shortcuts by command, category, or key. Editing and conflict resolution will arrive in the next keymap phase.</p>
        </div>
      </header>

      <section className="settings-group" aria-label="Keyboard Shortcuts">
        <label className="settings-field settings-field--stacked">
          <span>Search Keyboard Shortcuts</span>
          <input
            aria-label="Search Keyboard Shortcuts"
            value={query}
            placeholder="Search commands or shortcuts"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="settings-keymap" role="region" aria-label="Keyboard Shortcut Results">
          <table className="settings-keymap__table">
            <thead>
              <tr>
                <th scope="col">Command</th>
                <th scope="col">Category</th>
                <th scope="col">Shortcut</th>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${row.commandId}-${row.shortcut}`} aria-label={`${row.title} ${row.category} ${row.shortcut} ${row.source} ${row.status}`}>
                  <td>{row.title}</td>
                  <td>{row.category}</td>
                  <td><kbd>{row.shortcut || "Unassigned"}</kbd></td>
                  <td>{row.source}</td>
                  <td>
                    <span className={`settings-keymap__status settings-keymap__status--${row.status.toLowerCase()}`} title={row.conflicts.length > 0 ? `Conflicts with ${row.conflicts.join(", ")}` : undefined}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 ? <div className="settings-keymap__empty">No shortcuts match your search.</div> : null}
        </div>
      </section>
    </section>
  );
}

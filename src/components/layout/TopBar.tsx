import { useEffect, useRef, useState } from "react";
import { getShellCommandShortcut } from "@/components/layout/shell-keymap";
import type { BottomToolKey, OverlayKey } from "@/components/layout/shell-state";

type TopBarProps = {
  activeBottomTool: BottomToolKey;
  bottomToolVisible: boolean;
  activeOverlay: OverlayKey;
  workspaceName: string | null;
  settingsOpen: boolean;
  onOpenProject: () => void | Promise<void>;
  onOpenRecentProjects: () => void;
  onOpenSearchEverywhere: () => void;
  onOpenCommandPalette: () => void;
  onRunLint: () => void;
  onFormat: () => void;
  onLoadDiff: () => void;
  onOpenTerminal: () => void;
  onOpenSettings: () => void;
  onToggleEditorOnly: () => void;
};

type MenuKey = "file" | "edit" | "view";

export function TopBar({
  activeBottomTool,
  bottomToolVisible,
  activeOverlay,
  workspaceName,
  settingsOpen,
  onOpenProject,
  onOpenRecentProjects,
  onOpenSearchEverywhere,
  onOpenCommandPalette,
  onRunLint,
  onFormat,
  onLoadDiff,
  onOpenTerminal,
  onOpenSettings,
  onToggleEditorOnly,
}: TopBarProps) {
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!activeMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setActiveMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveMenu(null);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [activeMenu]);

function triggerMenuAction(action: () => void) {
    setActiveMenu(null);
    action();
  }

  function renderMenuItem(label: string, action: () => void, shortcut?: string) {
    return (
      <button type="button" className="topbar-menu__item" role="menuitem" onClick={() => triggerMenuAction(action)}>
        <span>{label}</span>
        {shortcut ? <span className="topbar-menu__shortcut" aria-hidden="true">{shortcut}</span> : null}
      </button>
    );
  }

  return (
    <header className="topbar" aria-label="Application Header">
      <div className="topbar__group topbar__group--left">
        <div className="brand brand--compact">
          <span className="brand__mark" aria-hidden="true" />
          <h1>ArkLine</h1>
        </div>
        <div className="toolbar toolbar--menu" role="toolbar" aria-label="Application Menu" ref={menuRef}>
          <button type="button" className={`toolbar__button toolbar__button--ghost${activeMenu === "file" ? " toolbar__button--active" : ""}`} onClick={() => setActiveMenu(activeMenu === "file" ? null : "file")}>File</button>
          <button type="button" className={`toolbar__button toolbar__button--ghost${activeMenu === "edit" ? " toolbar__button--active" : ""}`} onClick={() => setActiveMenu(activeMenu === "edit" ? null : "edit")}>Edit</button>
          <button type="button" className={`toolbar__button toolbar__button--ghost${activeMenu === "view" ? " toolbar__button--active" : ""}`} onClick={() => setActiveMenu(activeMenu === "view" ? null : "view")}>View</button>
          {activeMenu ? (
            <div className="topbar-menu" role="menu" aria-label={`${activeMenu} menu`}>
              {activeMenu === "file" ? (
                <>
                  {renderMenuItem("Open Project...", onOpenProject)}
                  {renderMenuItem("Recent Projects", onOpenRecentProjects)}
                </>
              ) : null}
              {activeMenu === "edit" ? (
                <>
                  {renderMenuItem("Command Palette", onOpenCommandPalette, getShellCommandShortcut("openCommandPalette"))}
                  {renderMenuItem("Settings", onOpenSettings)}
                </>
              ) : null}
              {activeMenu === "view" ? (
                <>
                  {renderMenuItem("Search Everywhere", onOpenSearchEverywhere, "Double Shift")}
                  {renderMenuItem("Terminal", onOpenTerminal, getShellCommandShortcut("showTerminal"))}
                  {renderMenuItem("Git", onLoadDiff, getShellCommandShortcut("showGit"))}
                  {renderMenuItem("Editor Only", onToggleEditorOnly, getShellCommandShortcut("toggleEditorOnly"))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <span className="topbar__workspace" title={workspaceName ?? "No workspace open"}>{workspaceName ?? "No workspace open"}</span>
        <div className="toolbar" role="toolbar" aria-label="Primary">
          <button type="button" aria-label="Run Lint" className="toolbar__button" onClick={onRunLint}><span className="toolbar__icon toolbar__icon--lint" aria-hidden="true" />Run Lint</button>
          <button type="button" aria-label="Format" className="toolbar__button" onClick={onFormat}><span className="toolbar__icon toolbar__icon--format" aria-hidden="true" />Format</button>
        </div>
      </div>
      <div className="topbar__group topbar__group--right">
        <div className="toolbar toolbar--utility" role="toolbar" aria-label="Secondary">
          <button type="button" className={`toolbar__button${bottomToolVisible && activeBottomTool === "terminal" ? " toolbar__button--active" : ""}`} onClick={onOpenTerminal}><span className="toolbar__icon toolbar__icon--terminal" aria-hidden="true" />Terminal</button>
          <button type="button" className={`toolbar__button toolbar__button--primary${settingsOpen ? " toolbar__button--active" : ""}`} onClick={onOpenSettings}><span className="toolbar__icon toolbar__icon--settings" aria-hidden="true" />Settings</button>
        </div>
      </div>
    </header>
  );
}

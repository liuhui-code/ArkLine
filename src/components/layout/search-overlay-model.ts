export type CommandPaletteItem = {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
};

type RecentFile = {
  path: string;
  title: string;
};

type RecentProject = {
  path: string;
  name: string;
};

export function buildCommandPaletteItems(
  query: string,
  items: CommandPaletteItem[],
) {
  const normalized = query.trim().toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(normalized));
}

export function filterRecentFileResults(openTabs: RecentFile[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return openTabs;
  }

  return openTabs.filter((tab) => tab.path.toLowerCase().includes(normalized) || tab.title.toLowerCase().includes(normalized));
}

export function filterRecentProjectResults(recentProjects: RecentProject[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return recentProjects;
  }

  return recentProjects.filter(
    (project) => project.path.toLowerCase().includes(normalized) || project.name.toLowerCase().includes(normalized),
  );
}

export function getOverlayLabel(
  activeOverlay: "quickOpen" | "searchEverywhere" | "recentFiles" | "recentProjects" | "goToLine" | "completion" | "commandPalette",
) {
  if (activeOverlay === "quickOpen") {
    return "Quick Open";
  }

  if (activeOverlay === "searchEverywhere") {
    return "Search Everywhere";
  }

  if (activeOverlay === "recentFiles") {
    return "Recent Files";
  }

  if (activeOverlay === "recentProjects") {
    return "Recent Projects";
  }

  if (activeOverlay === "goToLine") {
    return "Go to Line";
  }

  if (activeOverlay === "completion") {
    return "Completion";
  }

  return "Find Action";
}

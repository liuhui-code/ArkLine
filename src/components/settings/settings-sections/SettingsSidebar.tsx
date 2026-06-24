type SettingsSectionKey = "sdk" | "editor" | "validation" | "keymap";

type SettingsSidebarProps = {
  activeSection: SettingsSectionKey;
  onSelectSection: (section: SettingsSectionKey) => void;
};

const sections: { key: SettingsSectionKey; label: string }[] = [
  { key: "sdk", label: "SDK & Tools" },
  { key: "editor", label: "Editor" },
  { key: "validation", label: "Validation" },
  { key: "keymap", label: "Keymap" },
];

export function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  return (
    <nav className="settings-sidebar" aria-label="Settings Categories">
      {sections.map((section) => (
        <button
          key={section.key}
          type="button"
          role="tab"
          aria-selected={activeSection === section.key}
          className={`settings-sidebar__item${activeSection === section.key ? " settings-sidebar__item--active" : ""}`}
          onClick={() => onSelectSection(section.key)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

export type { SettingsSectionKey };

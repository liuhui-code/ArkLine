import { getSearchQuery } from "@codemirror/search";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";

const MAX_MATCHES = 2000;

function matchesFor(view: ViewUpdate["view"]) {
  const query = getSearchQuery(view.state);
  if (!query.valid) {
    return { count: 0, current: 0 };
  }

  const cursor = query.getCursor(view.state);
  const selection = view.state.selection.main;
  let count = 0;
  let current = 0;
  for (let match = cursor.next(); !match.done && count < MAX_MATCHES; match = cursor.next()) {
    count += 1;
    if (match.value.from <= selection.from && match.value.to >= selection.to) {
      current = count;
    }
  }

  return { count, current };
}

function setButtonMetadata(panel: HTMLElement, name: string, label: string) {
  const button = panel.querySelector<HTMLButtonElement>(`button[name="${name}"]`);
  if (!button) {
    return;
  }

  button.setAttribute("aria-label", label);
  button.title = label;
}

function updateSearchPanel(view: ViewUpdate["view"]) {
  const panel = view.dom.querySelector<HTMLElement>(".cm-panel.cm-search");
  if (!panel) {
    return;
  }

  const searchInput = panel.querySelector<HTMLInputElement>('input[name="search"]');
  if (!searchInput) {
    return;
  }

  panel.classList.add("cm-search-panel-ready");
  setButtonMetadata(panel, "next", "Find next (Enter)");
  setButtonMetadata(panel, "prev", "Find previous (Shift+Enter)");
  setButtonMetadata(panel, "select", "Select all matches");
  setButtonMetadata(panel, "replace", "Replace current match (Enter)");
  setButtonMetadata(panel, "replaceAll", "Replace all matches");
  setButtonMetadata(panel, "close", "Close find (Escape)");

  for (const [name, label] of [["case", "Match case"], ["re", "Regular expression"], ["word", "Match whole word"]] as const) {
    const input = panel.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    const wrapper = input?.closest("label");
    if (wrapper) {
      wrapper.title = label;
      wrapper.setAttribute("aria-label", label);
    }
  }

  const { count, current } = matchesFor(view);
  let status = panel.querySelector<HTMLSpanElement>(".cm-search-match-count");
  if (!status) {
    status = document.createElement("span");
    status.className = "cm-search-match-count";
    status.setAttribute("aria-live", "polite");
    searchInput.insertAdjacentElement("afterend", status);
  }

  if (!searchInput.value) {
    status.textContent = "";
  } else if (count >= MAX_MATCHES) {
    status.textContent = `${current || 1} of ${MAX_MATCHES}+`;
  } else if (count === 0) {
    status.textContent = "No results";
  } else {
    status.textContent = `${current || 1} of ${count}`;
  }
}

export const searchPanelEnhancement = ViewPlugin.fromClass(class {
  private lastSignature = "";

  constructor(view: ViewUpdate["view"]) {
    this.refresh(view);
  }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.view.state);
    const signature = `${query.search}|${query.caseSensitive}|${query.regexp}|${query.wholeWord}|${update.view.state.selection.main.from}|${update.view.state.doc.length}`;
    if (signature !== this.lastSignature || update.docChanged || update.selectionSet) {
      this.refresh(update.view);
    }
  }

  private refresh(view: ViewUpdate["view"]) {
    this.lastSignature = `${getSearchQuery(view.state).search}|${view.state.selection.main.from}|${view.state.doc.length}`;
    updateSearchPanel(view);
    queueMicrotask(() => updateSearchPanel(view));
  }
});


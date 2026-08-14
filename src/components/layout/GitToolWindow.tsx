import type { ReactNode } from "react";
import { GitLogToolWindow } from "@/components/layout/GitLogToolWindow";
import { GitStashView } from "@/components/layout/GitStashView";
import type { GitHistoryController } from "@/components/layout/use-git-history-controller";
import type { GitStashController } from "@/components/layout/use-git-stash-controller";
import type { GitBranchSnapshot } from "@/features/git/git-branch-model";

export type GitToolView = "log" | "stashes" | "trace";

type Props = {
  activeView: GitToolView;
  history: GitHistoryController;
  stash: GitStashController;
  branches: GitBranchSnapshot | null;
  tracePanel: ReactNode;
  onRefreshBranches: () => void;
  onChangeView: (view: GitToolView) => void;
};

export function GitToolWindow({ activeView, history, stash, branches, tracePanel, onRefreshBranches, onChangeView }: Props) {
  return (
    <section aria-label="Git Panel" className="bottom-tool-window__panel bottom-tool-window__panel--git">
      <div className="git-tool-window__tabs" role="tablist" aria-label="Git Views">
        <Tab label="Log" active={activeView === "log"} onClick={() => onChangeView("log")} />
        <Tab label="Stashes" active={activeView === "stashes"} onClick={() => onChangeView("stashes")} />
        <Tab label="Line Trace" active={activeView === "trace"} onClick={() => onChangeView("trace")} />
      </div>
      <div className="git-tool-window__content" role="tabpanel">
        {activeView === "log" ? <GitLogToolWindow history={history} branches={branches} onRefreshBranches={onRefreshBranches} /> : null}
        {activeView === "stashes" ? <GitStashView stash={stash} /> : null}
        {activeView === "trace" ? <div className="git-tool-window__trace">{tracePanel}</div> : null}
      </div>
    </section>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} className={`git-tool-window__tab${active ? " git-tool-window__tab--active" : ""}`} onClick={onClick}>{label}</button>;
}

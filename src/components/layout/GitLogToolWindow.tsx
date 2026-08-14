import { GitHistoryView } from "@/components/layout/GitHistoryView";
import type { GitHistoryController } from "@/components/layout/use-git-history-controller";
import type { GitBranchSnapshot } from "@/features/git/git-branch-model";

type Props = { history: GitHistoryController; branches: GitBranchSnapshot | null; onRefreshBranches: () => void };

export function GitLogToolWindow({ history, branches, onRefreshBranches }: Props) {
  return <div className="git-log-tool-window">
    <aside className="git-log-branches" aria-label="Git branches">
      <header><strong>Branches</strong><button type="button" aria-label="Refresh Git branches" onClick={onRefreshBranches}>↻</button></header>
      <BranchGroup label="Local" branches={branches?.localBranches ?? []} selected={history.refName} onSelect={history.selectRef} />
      <BranchGroup label="Remote" branches={branches?.remoteBranches ?? []} selected={history.refName} onSelect={history.selectRef} />
    </aside>
    <section className="git-log-main" aria-label="Git Log">
      <div className="git-log-scope"><button type="button" aria-pressed={history.refName === null} onClick={() => history.selectRef(null)}>All</button><span>{history.refName ?? "All branches"}</span></div>
      <GitHistoryView history={history} />
    </section>
  </div>;
}

function BranchGroup({ label, branches, selected, onSelect }: {
  label: string;
  branches: GitBranchSnapshot["localBranches"];
  selected: string | null;
  onSelect: (refName: string | null) => void;
}) {
  return <section className="git-log-branches__group"><strong>{label}</strong>{branches.map((branch) => <button key={`${branch.kind}:${branch.name}`} type="button" aria-pressed={selected === branch.name} onClick={() => onSelect(branch.name)}><span aria-hidden="true">{branch.current ? "●" : "○"}</span><span>{branch.displayName}</span>{branch.ahead || branch.behind ? <small>↑{branch.ahead} ↓{branch.behind}</small> : null}</button>)}</section>;
}

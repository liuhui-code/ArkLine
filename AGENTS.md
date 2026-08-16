## Mandatory project-wide TDD

This repository uses test-driven development for every behavior change, defect
fix, refactor, build/CI change, and developer-tooling change. These rules apply
to every human contributor and coding agent.

- Do not edit production code before observing RED through the closest stable
  public interface. Record the failing command and the parent revision.
- Work in vertical slices: One test → one minimal implementation → refactor while GREEN.
- A defect fix starts with a regression test that reproduces the defect.
- A refactor starts with a characterization test when existing contracts do not
  already protect the behavior being preserved.
- Run the focused GREEN command after each slice and `pnpm check:fast` before
  requesting merge.
- Never push or merge directly to `main`. Use a branch and pull request, and
  provide the required TDD evidence in the pull request body.
- Exceptions are limited to documentation-only or mechanically generated
  changes and require a reason, affected scope, owner, and future expiry date.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `liuhui-code/ArkLine`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context domain documentation layout. See `docs/agents/domain.md`.

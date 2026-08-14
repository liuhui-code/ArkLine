# ArkLine Quality Gate Architecture

## Objective

The gate protects merge and release decisions with repeatable evidence. It is
not a second build system and it must not hide a failed stage behind a green
summary. Every gate has named stages, bounded execution, a deterministic exit
code, and a JSON report that remains available after CI finishes.

## Industry alignment

ArkLine follows the GitHub Actions model in which required status checks block a
protected branch until they pass. The repository should require the stable
`Quality Gate / Fast` check on pull requests and `Windows / Package` for the
Windows product target. GitHub documents that required checks must pass before
a pull request can merge:

<https://docs.github.com/en/pull-requests/reference/status-checks>

The workflows use read-only `GITHUB_TOKEN` permissions for validation. Release
creation is isolated to the final job of the manual release workflow, whose
write permission is limited to `contents`. This follows GitHub's workflow
permission rule that nested workflows may only retain or reduce permissions:

<https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations>

Old non-`main` branch and pull-request runs are cancelled, while release and
packaged-soak workflows each serialize their runs. This avoids wasting runners
on obsolete commits without cancelling a release measurement halfway through.
Build outputs and test reports are uploaded as artifacts rather than placed in dependency caches;
GitHub explicitly distinguishes durable workflow artifacts from disposable
dependency caches:

<https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts>

## Gate layers

| Layer | Trigger | Purpose | Blocking result |
| --- | --- | --- | --- |
| Fast | every branch push and PR | whitespace, file-size policy, semantic tests, focused frontend contract tests, Rust tests, production build, local interaction performance | blocks merge |
| Full | manual release candidate | complete frontend suite, Rust tests, build, strict interaction performance | blocks release creation |
| Windows package | every branch after fast | native Windows package and bundle shape verification | blocks Windows target |
| Packaged soak | manual release evidence | real packaged executable, index workload, search/navigation responsiveness, memory and queue health | blocks release claim when strict |

The fast and full gates share one manifest and one Node runner. A failed stage
stops later stages, writes the failing command and exit information, and exits
non-zero. This keeps local and hosted decisions identical while still allowing
the Windows package and long soak to remain platform-specific. During a release,
the full gate is split into independent frontend and Rust lanes that run in
parallel with the native Windows portable build. The portable
bundle is unpacked and started against a pinned real Harmony project before it
becomes publishable.

## Required status checks and repository settings

Configure a protected `main` branch or repository ruleset with:

1. Require pull requests and at least one review.
2. Require `Quality Gate / Fast` and `Windows / Package` to pass.
3. Require branches to be up to date before merging when the repository has
   enough parallel changes to make merge skew material.
4. Disallow force-pushes and deletion of `main`.
5. Keep release publishing outside pull-request workflows. Manually dispatch
   `windows-exe-release` from the exact branch to release; the workflow creates
   the new tag at that SHA only after the frontend and Rust release lanes,
   Windows build, and packaged smoke check pass.

These branch settings are repository metadata and cannot be reliably enforced
by a source file alone. They must be checked once in the GitHub repository
settings and reviewed when workflow job names change.

## Failure evidence

Every CI gate uploads `artifacts/quality-gate-*.json` and the existing frontend,
packaged smoke, and packaged soak reports with `if: always()`. The report
contains schema version, gate name, start/end time, total duration, every stage,
exit code, signal, timeout, and the first failed stage. A green gate without a
report is a workflow defect.

## Long-term evolution

1. Keep the manifest as the contract and add a schema test before changing a
   stage or required check name.
2. Add coverage and static analysis only when the project has a stable tool and
   a useful baseline; do not turn warning churn into an opaque merge blocker.
3. Promote packaged soak from manual to scheduled/nightly evidence before making
   it a required PR check. Its runtime and platform cost are inappropriate for
   every keystroke-sized change.
4. Add signed release attestations and dependency review when release trust or
   supply-chain requirements justify them. Keep those concerns separate from
   application correctness gates.

# ArkLine TDD Policy

## Purpose

Tests are executable product contracts. A green test must mean that an observable
ArkLine capability still works, not only that an internal callback was invoked.
The capability registry in `docs/quality/capabilities.json` is the source of truth
for product risk, ownership, source impact, and test mapping.

## Project-wide enforcement

TDD is mandatory for every behavior change, defect fix, refactor, build/CI
change, and developer-tooling change. Contributors work on a branch and merge
through a pull request; direct updates to `main` are not an accepted development
path. Each pull request must identify the capability and acceptance criterion,
record a failing RED command on the parent behavior, record its focused GREEN
command, and name the merge-ready gate evidence.

The blocking `TDD Evidence` check validates that executable changes include a
changed test contract and complete RED/GREEN evidence. Rust files containing
inline tests are discovered through the repository test inventory. A branch
ruleset must require `TDD Evidence` and `Merge Ready` before merge. `Merge Ready`
fails closed unless the fast gate, complete frontend gate, Windows package, and
installed and portable candidate smoke all succeed.

Documentation-only and mechanically generated changes may use an explicit TDD
exception. The exception must state its reason, affected scope, owner, and a
future expiry date. An exception that includes production code is invalid.

## Change workflow

Behavior changes and defect fixes use one vertical slice at a time:

1. Name the capability and acceptance criterion.
2. Add one test through the closest stable public interface.
3. Capture RED evidence on the uncorrected implementation.
4. Make the smallest change that produces GREEN evidence.
5. REFACTOR only while the suite remains green.

The required cycle is **RED → GREEN → REFACTOR**. A defect test should fail on
the parent revision when practical and remain as a permanent regression contract.

## Test architecture

Use **Small / Medium / Large / Product** sizes:

- Small: deterministic pure logic, no process, filesystem, database, or DOM.
- Medium: in-process UI/service behavior with bounded temporary resources.
- Large: sidecars, Git/Hvigor processes, large fixtures, or platform integration.
- Product: the packaged application and a pinned real Harmony project.

Mock only system boundaries: operating-system APIs, process launch, external
tools, time, randomness, or transport. Do not mock ArkLine modules merely to
assert call count or call order. Prefer typed fixtures over casts that bypass a
public contract.

## Impact selection

`pnpm test:impact:shadow` maps changed files through the capability registry and
writes `artifacts/test-impact-shadow.json`. `pnpm test:impact:advisory` performs
the same selection, executes supported selected runners, and writes
`artifacts/test-impact-advisory.json`.

Stage 2 advisory execution is deliberately non-blocking in CI and does not
replace `pnpm check:fast`. Frontend and semantic-worker selections execute as
focused Vitest commands. The Rust runner compiles once, executes conservative
selected Rust test groups, and fails closed when a filter matches zero tests.
A fail-safe full selection is delegated to the authoritative gate instead of
duplicating the complete suite.

After the authoritative gate, `pnpm test:impact:reconcile` writes
`artifacts/test-impact-reconciliation.json`. It classifies eligible comparisons
as validated passes, confirmed failures, potential false negatives, or potential
false positives. Runner output now contributes failed test identities when the
test harness exposes them and explicitly falls back to step-only precision when
it does not. Per-run rates remain null when no failure was observed; historical aggregation
is required before promotion.

Stage 3 evidence assigns every GitHub Actions reconciliation a stable `sampleId`
and retains its artifact for 90 days. `pnpm test:impact:history` aggregates a
downloaded report directory, deduplicates run attempts, and computes rates only
over failure-bearing eligible samples. Promotion requires at least 100 production samples,
5 identity-bearing failure samples, zero potential false negatives, identified failures,
and no more than a 5% potential false-positive rate. This evidence does not make the advisory blocking;
failure injection and real CI history must satisfy the
thresholds first.

Stage 4 calibration runs in a separate scheduled workflow and does not block
`windows-ci`. It downloads the latest retained production and calibration
evidence, executes one real Vitest sentinel with an intentional
failure, and uploads the deduplicated history for another 90 days. The sentinel
passes in every ordinary suite; only `pnpm test:impact:calibration` enables the
failure. Its report uses sample kind `controlled-failure` and a distinct
`sampleId`, so controlled samples can satisfy the 5 identity-bearing failure samples
requirement but never inflate the 100 production samples requirement. The
calibration command succeeds only when the runner exits with the expected
failure and exposes its test identity.

Stage 5 promotion review runs `pnpm test:impact:review` after aggregation. It
writes machine-readable JSON and a Markdown report with one of three states:
`collecting` while samples are insufficient, `blocked` when risky evidence
requires investigation, and `review-required` when every machine threshold is
satisfied. Every generated report contains `blockingAuthorized: false` and is
published in the GitHub Actions Job Summary with the IDs of anomalous samples.
Automation never changes required checks;
enabling an affected-test gate requires a reviewed repository change and a
separate branch-protection decision.

The selector always includes changed tests, previous failures supplied by CI,
and foundation contract tests. Global contracts use the full suite. Unknown impact means full suite.
A missing Git diff also selects the full suite. These
fail-safe rules may not be weakened to improve reported duration.

## Flakes, ignored tests, and exceptions

Retries are diagnostic, not proof of correctness. A flaky or ignored blocking
test needs an issue, owner and expiry. Quarantine must state the affected
capability and retain a deterministic lower-level contract when possible.

A TDD exception is allowed for documentation-only or mechanically generated
changes. The pull request must state the reason, affected capability, owner and
expiry. Silent exceptions are not allowed.

## Inventory evidence

`pnpm test:inventory` writes `artifacts/test-inventory.json` with runner, domain,
owner, size, platform, hermeticity, ignored status, capability mappings, and
health counts. Unmapped tests are tracked debt; they are never interpreted as
proof that a capability is covered. Systemic findings remain owned and
time-bounded in `docs/quality/test-debt.json` until their acceptance evidence is
green.

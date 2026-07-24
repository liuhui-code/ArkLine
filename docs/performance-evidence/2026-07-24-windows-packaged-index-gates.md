# Windows Packaged Index And Interaction Gates

## Scope

This evidence tracks the Phase 6 packaged indexing and interaction gate for
commit `8b6e7d0d542b643af02a12489a3441c435b96e9d`. The workflow launches the
Windows x64 release executable through WebView2 WebDriver while project
indexing, Find in Files, Quick Open, and cross-file navigation run concurrently.

The GitHub-hosted runner is serialized by the `windows-packaged-soak`
concurrency group. Hosted-runner results are regression evidence; release
sign-off still uses the documented dedicated Windows machine class.

## Reproduction

```bash
gh workflow run windows-packaged-soak.yml \
  --ref main \
  -f fixture_profile=small \
  -f duration_minutes=5

gh workflow run windows-packaged-soak.yml \
  --ref main \
  -f fixture_profile=medium \
  -f duration_minutes=30
```

`small` generates 1,000 files and `medium` generates 20,000 files. `huge`, not
`medium`, is the 100,000-file report-only profile. The workflow builds the
portable executable, runs an isolated 1k protocol smoke, generates the selected
fixture, and uploads schema-v3 reports as `arkline-packaged-soak-evidence`.

## Strict Limits

| Metric | Limit |
| --- | ---: |
| Search result visible p95 | <= 300 ms |
| Navigation target visible p95 | <= 300 ms |
| W3C interaction timing p95 | <= 100 ms |
| Steady RSS / private-memory growth | <= 512 MiB each |
| JavaScript heap growth, when supported | <= 256 MiB |
| Workspace / shared-SDK WAL growth | <= 128 MiB each |

The verdict also requires real search and navigation results, no crash,
unresponsive interaction, stale apply, search miss, pending load, final queue
work, stalled index task, or Worker restart. p99 is retained as diagnostic
evidence but is not a hard verdict threshold.

## Final Small Strict Gate

- Run: [30124746978](https://github.com/liuhui-code/ArkLine/actions/runs/30124746978)
- Result: passed
- Workload: 1,000 generated files plus the fixture entry file, 5 minutes
- Platform: Windows `10.0.26100` x64, runner image `20260714.173.1`
- Node: `v20.20.2`
- Executable SHA-256:
  `33b936e3c73d4b08beb20f16c89aeb1287e61db8c22ee630c5ae972c9b2d36f2`

| Metric | Result |
| --- | ---: |
| Successful search / jump cycles | 734 / 734 |
| Search visible p50 / p95 / p99 | 93.4 / 133.6 / 196.2 ms |
| Navigation visible p50 / p95 / p99 | 38.9 / 81.4 / 148.7 ms |
| W3C interaction timing p95 | 32 ms |
| Crash / unresponsive / stale apply / search miss | 0 / 0 / 0 / 0 |
| Final content index | 1,001 / 1,001 files |
| Final pending queue / stalled tasks | 0 / 0 |
| Steady private-memory growth | 121,307,136 bytes |
| Steady JavaScript heap growth | 30,474,989 bytes |
| Workspace / shared-SDK WAL growth | 0 / 0 bytes |
| Worker restart growth | 0 |

The strict verdict contains no failure identifiers.

## Measured Failure History

These failures were retained because each identified a different scaling
defect. They are not passing release evidence.

| Run / commit | Measured failure | Root cause and correction |
| --- | --- | --- |
| [30106056471](https://github.com/liuhui-code/ArkLine/actions/runs/30106056471) / `369b6e68` | 19,648 / 20,001 content files; search p95 427 ms | Every incremental chunk loaded project-wide content/import/export catalogs. Point membership and requested-path-only loads made refresh work proportional to the chunk. |
| [30114332155](https://github.com/liuhui-code/ArkLine/actions/runs/30114332155) / `907e0939` | Content complete; search p95 323.2 ms; private growth 647,221,248 bytes | The soak retained thousands of WebDriver element references to detached overlay DOM. Renderer-side boolean/text reads and W3C keyboard actions removed the references. |
| [30118624644](https://github.com/liuhui-code/ArkLine/actions/runs/30118624644) / `22bfbb8f` | Content complete; search p95 317.5 ms | Native text-search IPC was about 9 ms p95, but Quick Open wrote every keystroke through `AppShell`, producing 92,187 shell renders. A local 40 ms filename draft now submits only the final query. |
| [30122892621](https://github.com/liuhui-code/ArkLine/actions/runs/30122892621) / `a23e7ad8` | Search p95 369.4 ms; stopped at 1,000 cycles | Background `partial` continuation events launched full Health and Layer Readiness reads every 3-4 seconds; each took about 330-480 ms while indexing. The status bar now consumes lightweight task events and detailed reads run only on final state or while diagnostics is open. |

Run
[30121313972](https://github.com/liuhui-code/ArkLine/actions/runs/30121313972)
then exposed a harness readiness bug: a stale Quick Open row was considered the
new query result. The product correctly refused Enter on the uncommitted query.
The schema-v3 harness now requires a result whose text contains the requested
filename before navigation.

## Final 20k Strict Gate

- Run: [30125657721](https://github.com/liuhui-code/ArkLine/actions/runs/30125657721)
- Result: passed
- Workload: 20,000 generated files plus the fixture entry file, 30 minutes
- Duration: 1,801,062 ms
- Platform: Windows `10.0.26100` x64, runner image `20260714.173.1`
- Node: `v20.20.2`
- Executable size: 20,508,672 bytes
- Executable SHA-256:
  `153edeb3f00fe865eabb91c0c51b98a914ae06854cb48d4eb66de49a0126d638`

| Metric | Result |
| --- | ---: |
| Successful search / jump cycles | 3,463 / 3,463 |
| Search visible p50 / p95 / p99 | 110 / 249.6 / 334.4 ms |
| Navigation visible p50 / p95 / p99 | 59 / 95.3 / 174.1 ms |
| W3C interaction timing p50 / p95 / p99 | 16 / 32 / 40 ms |
| Native text-search IPC p50 / p95 / p99 | 8 / 8 / 8 ms |
| Crash / unresponsive / stale apply / search miss | 0 / 0 / 0 / 0 |
| Final content / symbol / stub freshness | 20,001 / 20,001 each |
| Final pending queue / stalled tasks | 0 / 0 |
| Steady RSS / private-memory growth | 132,206,592 / 414,044,160 bytes |
| Steady JavaScript heap growth | 95,775,756 bytes |
| Workspace / shared-SDK WAL growth | 0 / 0 bytes |
| Worker restart growth | 0 |

The final indexer diagnostic was idle, every freshness layer had zero missing or
stale files, and the strict verdict contained no failure identifiers. This
closes the hosted Windows Phase 6 regression gate for the measured commit.
Dedicated release-machine sign-off remains a separate release-policy step.

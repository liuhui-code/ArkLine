# Large ArkTS diagnostic fixture

The navigation soak tests use NetEase's real-world HarmonyOS IM UIKit at a
pinned revision. The clone is intentionally ignored so the upstream repository
is not vendored into ArkLine.

```sh
git clone https://github.com/netease-kit/nim-uikit-harmony.git \
  tests/fixtures/large-arkts/nim-uikit-harmony
git -C tests/fixtures/large-arkts/nim-uikit-harmony \
  checkout 585feb45114a128a0d2a23947c83faf338e758f7
```

Run each diagnostic test serially:

```sh
cd src-tauri
cargo test --lib netease_large_project_class_search_is_retryable_during_catalog_only_stage \
  -- --ignored --nocapture --test-threads=1
ARKLINE_INDEXER_ENABLED=1 cargo test --lib netease_packaged_index_pipeline_publishes_classes \
  -- --ignored --nocapture --test-threads=1
cargo test --lib netease_large_project_resolves_direct_and_inherited_methods \
  -- --ignored --nocapture --test-threads=1
cargo test --lib netease_large_project_classes_are_searchable \
  -- --ignored --nocapture --test-threads=1
```

The tests remove the generated fixture-local `.arkline` cache when they finish,
including after an assertion failure.

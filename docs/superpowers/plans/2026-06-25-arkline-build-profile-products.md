# ArkLine Build Profile Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect HarmonyOS build products from `build-profile.json5` and use them in the Build panel and Hvigor command planning.

**Architecture:** Keep product parsing in the frontend build domain as a small, dependency-free parser. AppShell loads `build-profile.json5` when a Harmony project is opened, stores detected products in build state, and renders Product as a select instead of free text.

**Tech Stack:** React, TypeScript, Vitest, existing WorkspaceApi `openFile`, existing Build domain.

---

### Task 1: Add Build Profile Product Parser

**Files:**
- Create: `src/features/build/build-profile-parser.ts`
- Modify: `src/features/build/build-model.ts`
- Modify: `src/features/build/build-store.ts`
- Test: `tests/frontend/build-profile-parser.test.ts`

- [ ] **Step 1: Write parser tests**

Create `tests/frontend/build-profile-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBuildProfileProducts } from "@/features/build/build-profile-parser";

describe("build profile parser", () => {
  it("extracts products from Harmony build-profile json5 text", () => {
    const profile = `
      {
        app: { products: [{ name: "default" }, { name: "china" }] },
        modules: []
      }
    `;

    expect(parseBuildProfileProducts(profile)).toEqual(["default", "china"]);
  });

  it("dedupes product names and prefers stable source order", () => {
    const profile = `{ products: [{ name: 'default' }, { name: "default" }, { name: "beta" }] }`;

    expect(parseBuildProfileProducts(profile)).toEqual(["default", "beta"]);
  });

  it("falls back to default when no products are detected", () => {
    expect(parseBuildProfileProducts("{ modules: [] }")).toEqual(["default"]);
  });
});
```

- [ ] **Step 2: Run parser tests and confirm red**

Run:

```bash
pnpm exec vitest run tests/frontend/build-profile-parser.test.ts
```

Expected: FAIL because parser module does not exist.

- [ ] **Step 3: Implement parser and state fields**

Create `src/features/build/build-profile-parser.ts`:

```ts
export function parseBuildProfileProducts(content: string): string[] {
  const productBlockMatch = content.match(/products\s*:\s*\[([\s\S]*?)\]/m);
  const searchArea = productBlockMatch?.[1] ?? content;
  const names: string[] = [];
  const namePattern = /name\s*:\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = namePattern.exec(searchArea)) !== null) {
    const name = match[1].trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names.length > 0 ? names : ["default"];
}
```

Modify `src/features/build/build-model.ts`:

```ts
products: string[];
```

in `BuildState`.

Modify `src/features/build/build-store.ts` initial state:

```ts
products: ["default"],
```

and allow `products` in `configure`.

- [ ] **Step 4: Run parser tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-profile-parser.test.ts
```

Expected: PASS.

### Task 2: Product Select And AppShell Hydration

**Files:**
- Modify: `src/components/layout/BuildToolWindow.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/build-tool-window.test.tsx`

- [ ] **Step 1: Add failing UI tests**

Add tests to `tests/frontend/build-tool-window.test.tsx`:

```ts
it("loads build-profile products into the Product select", async () => {
  const user = userEvent.setup();
  render(<AppShell workspaceApi={createWorkspaceApi({
    openFile: async (path) => path.endsWith("build-profile.json5")
      ? `{ app: { products: [{ name: "default" }, { name: "china" }] } }`
      : "",
  })} />);

  await openProject(user);
  await user.click(screen.getByRole("tab", { name: "Build" }));

  const productSelect = await screen.findByLabelText("Build Product");
  expect(within(productSelect).getByRole("option", { name: "default" })).toBeInTheDocument();
  expect(within(productSelect).getByRole("option", { name: "china" })).toBeInTheDocument();
});

it("uses the selected build product in the Hvigor command", async () => {
  const user = userEvent.setup();
  const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
  render(<AppShell workspaceApi={createWorkspaceApi({
    runTerminalCommand,
    openFile: async (path) => path.endsWith("build-profile.json5")
      ? `{ app: { products: [{ name: "default" }, { name: "china" }] } }`
      : "",
  })} />);

  await openProject(user);
  await user.click(screen.getByRole("tab", { name: "Build" }));
  await user.selectOptions(await screen.findByLabelText("Build Product"), "china");
  await user.click(screen.getByRole("button", { name: "Run Build" }));

  await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
    command: "./hvigorw assembleHap --mode module -p module=entry@china -p product=china -p buildMode=debug --no-daemon",
  })));
});
```

- [ ] **Step 2: Run UI tests and confirm red**

Run:

```bash
pnpm exec vitest run tests/frontend/build-tool-window.test.tsx
```

Expected: FAIL because Product is still an input and build-profile products are not loaded.

- [ ] **Step 3: Product select in BuildToolWindow**

Replace Product input with:

```tsx
<select aria-label="Build Product" value={state.product} disabled={running} onChange={(event) => onChangeProduct(event.target.value)}>
  {(state.products.length > 0 ? state.products : [state.product || "default"]).map((product) => (
    <option key={product} value={product}>{product}</option>
  ))}
</select>
```

- [ ] **Step 4: Load build-profile products in AppShell**

In `AppShell`, import `parseBuildProfileProducts`.

Add a helper to find the build profile path from `workspace.visibleFiles`:

```ts
const buildProfilePath = workspace?.visibleFiles.find((path) => getPathBasename(path) === "build-profile.json5") ?? null;
```

Add effect:

```ts
useEffect(() => {
  if (!buildProfilePath) {
    buildStoreRef.current.configure({ products: ["default"], product: "default" });
    setBuildState({ ...buildStoreRef.current.state });
    return;
  }

  let cancelled = false;
  void workspaceApi.openFile(buildProfilePath).then((content) => {
    if (cancelled) return;
    const products = parseBuildProfileProducts(content);
    const product = products.includes(buildStoreRef.current.state.product)
      ? buildStoreRef.current.state.product
      : products.includes("default") ? "default" : products[0];
    buildStoreRef.current.configure({ products, product });
    setBuildState({ ...buildStoreRef.current.state });
  });

  return () => {
    cancelled = true;
  };
}, [buildProfilePath, workspaceApi]);
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-tool-window.test.tsx
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**
- No new source files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-profile-parser.test.ts tests/frontend/build-project-detector.test.ts tests/frontend/build-domain.test.ts tests/frontend/build-tool-window.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-arkline-build-profile-products.md src tests
git commit -m "feat: detect harmony build products"
```

Expected: commit created.

---

## Self Review

Spec coverage:
- Product parsing is covered by Task 1.
- Product select and command usage are covered by Task 2.
- Verification and commit are covered by Task 3.

Deferred by design:
- Full JSON5 parsing is intentionally deferred.
- Signing configs and artifact paths remain later build work.

import { render, screen, within } from "@testing-library/react";
import { UsagesPanel } from "@/components/layout/UsagesPanel";
import type { UsageSearchState } from "@/features/workspace/usage-search";

describe("UsagesPanel", () => {
  it("groups usage results by file and shows kind and confidence", () => {
    const state: UsageSearchState = {
      status: "ready",
      items: [
        {
          path: "C:/workspace/src/Index.ets",
          line: 4,
          column: 11,
          preview: "service.load();",
          kind: "memberAccess",
          confidence: "memberResolved",
        },
        {
          path: "C:/workspace/src/Index.ets",
          line: 8,
          column: 9,
          preview: "service.load();",
          kind: "memberAccess",
          confidence: "memberResolved",
        },
        {
          path: "C:/workspace/src/UserService.ets",
          line: 2,
          column: 3,
          preview: "load() {}",
          kind: "declaration",
          confidence: "exact",
        },
      ],
    };

    render(<UsagesPanel state={state} onOpenUsage={() => undefined} />);

    const indexGroup = screen.getByRole("group", { name: "Index.ets 2 usages" });
    expect(within(indexGroup).getByText("C:/workspace/src/Index.ets")).toBeVisible();
    expect(within(indexGroup).getByText("2")).toBeVisible();
    expect(within(indexGroup).getAllByText("memberAccess")).toHaveLength(2);
    expect(within(indexGroup).getAllByText("memberResolved")).toHaveLength(2);

    const serviceGroup = screen.getByRole("group", { name: "UserService.ets 1 usage" });
    expect(within(serviceGroup).getByText("exact")).toBeVisible();
  });
});

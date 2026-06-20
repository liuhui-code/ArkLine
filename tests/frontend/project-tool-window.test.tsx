import { render, screen } from "@testing-library/react";
import { ProjectToolWindow } from "@/components/layout/ProjectToolWindow";
import { demoArkTsTree } from "@/components/layout/demo-arkts-project";
import { vi } from "vitest";

describe("Project tool window", () => {
  it("renders an ArkTS-shaped project tree with active-path highlighting", () => {
    render(
      <ProjectToolWindow
        tree={demoArkTsTree}
        activePath={"C:\\samples\\ArkDemo\\entry\\src\\main\\ets\\pages\\Index.ets"}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("Index.ets")).toBeInTheDocument();
    expect(screen.getByText("EntryAbility.ets")).toBeInTheDocument();
    expect(screen.getByText("string.json")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "ArkDemo")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "entry")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveClass("project-tree__row--active");
    expect(screen.getByRole("button", { name: "Index.ets" }).querySelector(".project-tree__icon")).not.toBeNull();
    const rootRow = screen.getByText((_, node) => node?.textContent === "ArkDemo").closest(".project-tree__row");
    expect(rootRow?.querySelector(".project-tree__caret")).not.toBeNull();
  });

  it("preserves unix absolute paths for active-file highlighting", () => {
    render(
      <ProjectToolWindow
        tree={[
          {
            path: "/Users/liuhui/Documents/code/ArkDemo/entry/src/main/ets/pages/Index.ets",
            name: "Index.ets",
            title: "/Users/liuhui/Documents/code/ArkDemo/entry/src/main/ets/pages/Index.ets",
          },
        ]}
        activePath="/Users/liuhui/Documents/code/ArkDemo/entry/src/main/ets/pages/Index.ets"
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveClass("project-tree__row--active");
  });
});

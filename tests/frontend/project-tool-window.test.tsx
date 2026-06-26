import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        onRequestMutation={vi.fn()}
      />,
    );

    expect(screen.getByText("Index.ets")).toBeInTheDocument();
    expect(screen.getByText("EntryAbility.ets")).toBeInTheDocument();
    expect(screen.getByText("string.json")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ArkDemo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "entry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveClass("project-tree__row--active");
    expect(screen.getByRole("button", { name: "Index.ets" }).querySelector(".project-tree__icon")).not.toBeNull();
    const rootRow = screen.getByRole("button", { name: "ArkDemo" }).closest(".project-tree__row");
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
        onRequestMutation={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveClass("project-tree__row--active");
  });

  it("toggles directories between expanded and collapsed states", async () => {
    const user = userEvent.setup();

    render(
      <ProjectToolWindow
        tree={demoArkTsTree}
        activePath={"C:\\samples\\ArkDemo\\entry\\src\\main\\ets\\pages\\Index.ets"}
        onOpen={vi.fn()}
        onRequestMutation={vi.fn()}
      />,
    );

    const entryDirectory = screen.getByRole("button", { name: "entry" });
    expect(entryDirectory).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Index.ets" })).toBeInTheDocument();

    await user.click(entryDirectory);
    expect(entryDirectory).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Index.ets" })).not.toBeInTheDocument();

    await user.click(entryDirectory);
    expect(entryDirectory).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Index.ets" })).toBeInTheDocument();
  });
});

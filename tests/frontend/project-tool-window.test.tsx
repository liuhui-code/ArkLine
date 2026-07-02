import { render, screen, within } from "@testing-library/react";
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

  it("loads children only when a lazy directory is expanded", async () => {
    const user = userEvent.setup();
    const loadDirectory = vi.fn();

    render(
      <ProjectToolWindow
        lazyRoot={{ name: "ArkDemo", path: "C:/samples/ArkDemo" }}
        lazyChildren={{
          "C:\\samples\\ArkDemo": [
            {
              name: "entry",
              path: "C:/samples/ArkDemo/entry",
              kind: "directory",
              excluded: false,
              hasChildren: true,
            },
          ],
          "C:\\samples\\ArkDemo\\entry": [
            {
              name: "Index.ets",
              path: "C:/samples/ArkDemo/entry/Index.ets",
              kind: "file",
              excluded: false,
              hasChildren: false,
            },
          ],
        }}
        lazyLoadingPaths={new Set()}
        activePath={null}
        onLoadDirectory={loadDirectory}
        onOpen={vi.fn()}
        onRequestMutation={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Index.ets" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "entry" }));

    expect(loadDirectory).toHaveBeenCalledWith("C:\\samples\\ArkDemo\\entry");
    expect(await screen.findByRole("button", { name: "Index.ets" })).toBeInTheDocument();
  });

  it("shows a loading row while lazy directory children are loading", async () => {
    const user = userEvent.setup();

    render(
      <ProjectToolWindow
        lazyRoot={{ name: "ArkDemo", path: "C:/samples/ArkDemo" }}
        lazyChildren={{
          "C:\\samples\\ArkDemo": [
            {
              name: "entry",
              path: "C:/samples/ArkDemo/entry",
              kind: "directory",
              excluded: false,
              hasChildren: true,
            },
          ],
        }}
        lazyLoadingPaths={new Set(["C:\\samples\\ArkDemo\\entry"])}
        activePath={null}
        onLoadDirectory={vi.fn()}
        onOpen={vi.fn()}
        onRequestMutation={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "entry" }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading...");
  });

  it("opens an IDE-style context menu for project tree rows", async () => {
    const user = userEvent.setup();
    const requestMutation = vi.fn();
    const openFile = vi.fn();

    render(
      <ProjectToolWindow
        tree={demoArkTsTree}
        activePath={null}
        onOpen={openFile}
        onRequestMutation={requestMutation}
      />,
    );

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Index.ets" }),
    });

    const menu = screen.getByRole("menu", { name: "Index.ets actions" });
    expect(menu).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Open" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "New File" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Copy Path" })).toBeVisible();

    await user.click(within(menu).getByRole("menuitem", { name: "Open" }));

    expect(openFile).toHaveBeenCalledWith(expect.stringMatching(/Index\.ets$/));
    expect(screen.queryByRole("menu", { name: "Index.ets actions" })).not.toBeInTheDocument();
  });

  it("routes project tree context menu creation actions through the existing mutation callback", async () => {
    const user = userEvent.setup();
    const requestMutation = vi.fn();

    render(
      <ProjectToolWindow
        tree={demoArkTsTree}
        activePath={null}
        onOpen={vi.fn()}
        onRequestMutation={requestMutation}
      />,
    );

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "pages" }),
    });
    await user.click(screen.getByRole("menuitem", { name: "New Directory" }));

    expect(requestMutation).toHaveBeenCalledWith({
      action: "newDirectory",
      parentPath: expect.stringMatching(/pages$/),
    });
  });

  it("closes the project context menu when clicking outside", async () => {
    const user = userEvent.setup();

    render(
      <ProjectToolWindow
        tree={demoArkTsTree}
        activePath={null}
        onOpen={vi.fn()}
        onRequestMutation={vi.fn()}
      />,
    );

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Index.ets" }),
    });
    expect(screen.getByRole("menu", { name: "Index.ets actions" })).toBeVisible();

    await user.click(document.body);

    expect(screen.queryByRole("menu", { name: "Index.ets actions" })).not.toBeInTheDocument();
  });
});

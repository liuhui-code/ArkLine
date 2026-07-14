import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";

it("opens replace with Ctrl+R and reports match position", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <ArkTsEditor
      appearance={defaultSettings().editor}
      path="C:/demo/main.ets"
      value="Entry Entry"
      onChange={() => undefined}
    />,
  );
  await user.click(screen.getByLabelText("Editor Content"));
  await user.keyboard("{Control>}f{/Control}");
  const searchInput = container.querySelector<HTMLInputElement>('input[name="search"]');
  expect(searchInput).toBeInTheDocument();
  await user.type(searchInput!, "Entry");
  expect(container.querySelector(".cm-search-match-count")).toHaveTextContent("1 of 2");
  await user.keyboard("{Control>}r{/Control}");
  await waitFor(() => expect(container.querySelector('input[name="replace"]')).toHaveFocus());
});

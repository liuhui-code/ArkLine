import { isMemberAccessCompletion } from "@/components/layout/completion-context";

describe("completion context", () => {
  it.each([
    ["service.", 9],
    ["service.pr", 11],
    ["service?.profile", 17],
    ["    .width", 11],
  ])("recognizes member access in %s", (content, column) => {
    expect(isMemberAccessCompletion({ content, line: 1, column })).toBe(true);
  });

  it.each([
    ["private", 8],
    ["const value = 1.25", 19],
  ])("keeps global completion context in %s", (content, column) => {
    expect(isMemberAccessCompletion({ content, line: 1, column })).toBe(false);
  });
});

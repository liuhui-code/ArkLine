import { describe, expect, it } from "vitest"

import { renderArkTsComponent, renderArkTsPage, renderArkTsTemplate } from "../features/templates.js"

describe("ArkTS templates", () => {
  it("renders a deterministic page template", () => {
    expect(renderArkTsPage("Home")).toBe([
      "@Entry",
      "@Component",
      "struct Home {",
      "  build() {",
      "  }",
      "}",
      "",
    ].join("\n"))
  })

  it("renders a deterministic component template without @Entry", () => {
    expect(renderArkTsComponent("UserCard")).toBe([
      "@Component",
      "struct UserCard {",
      "  build() {",
      "  }",
      "}",
      "",
    ].join("\n"))
  })

  it("dispatches templates by kind", () => {
    expect(renderArkTsTemplate("page", "Home")).toContain("@Entry\n@Component\nstruct Home")
    expect(renderArkTsTemplate("component", "UserCard")).toContain("@Component\nstruct UserCard")
  })
})

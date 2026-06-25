export type ArkTsTemplateKind = "page" | "component"

export function renderArkTsPage(name: string) {
  return [
    "@Entry",
    "@Component",
    `struct ${name} {`,
    "  build() {",
    "  }",
    "}",
    "",
  ].join("\n")
}

export function renderArkTsComponent(name: string) {
  return [
    "@Component",
    `struct ${name} {`,
    "  build() {",
    "  }",
    "}",
    "",
  ].join("\n")
}

export function renderArkTsTemplate(kind: ArkTsTemplateKind, name: string) {
  return kind === "page" ? renderArkTsPage(name) : renderArkTsComponent(name)
}

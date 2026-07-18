import fs from "node:fs"
import path from "node:path"

export function createArkuiSdkFixture(root: string): {
  sdkRoot: string
  commonPath: string
} {
  const sdkRoot = path.join(root, "sdk", "openharmony")
  const componentDir = path.join(sdkRoot, "ets", "component")
  const componentsDir = path.join(
    sdkRoot,
    "ets",
    "build-tools",
    "ets-loader",
    "components",
  )
  fs.mkdirSync(componentDir, { recursive: true })
  fs.mkdirSync(componentsDir, { recursive: true })
  fs.mkdirSync(path.join(sdkRoot, "ets"), { recursive: true })
  fs.mkdirSync(path.join(sdkRoot, "toolchains"), { recursive: true })

  const commonPath = path.join(componentDir, "common.d.ts")
  fs.writeFileSync(
    commonPath,
    [
      "declare class CommonMethod<T> {",
      "    /** Sets the width of the component. */",
      "    width(value: Length): T;",
      "    /** Sets the height of the component. */",
      "    height(value: Length): T;",
      "}",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(componentsDir, "common_attrs.json"),
    JSON.stringify({ attrs: ["width", "height"] }),
  )
  fs.writeFileSync(
    path.join(componentsDir, "column.json"),
    JSON.stringify({ name: "Column", attrs: ["justifyContent"] }),
  )

  return { sdkRoot, commonPath }
}

import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

export type FileTreeNode = {
  path: string;
  name: string;
  title: string;
};

export function createFileTreeNodes(paths: string[]) {
  return paths.map((path) => {
    const normalized = normalizePath(path);
    const name = getPathBasename(normalized);

    return {
      path: normalized,
      name,
      title: normalized
    } satisfies FileTreeNode;
  });
}

import { createWorkspaceCoreApi } from "@/features/workspace/workspace-default-core-api";
import { createWorkspaceGitApi } from "@/features/workspace/workspace-default-git-api";
import { createWorkspaceRuntimeApi } from "@/features/workspace/workspace-default-runtime-api";
import { hasTauriRuntime, invoke, listen } from "@/features/workspace/workspace-api-runtime";
import type { WorkspaceApi } from "@/features/workspace/workspace-api-contract";
import { createWorkspaceIndexManagementApi } from "@/features/workspace/workspace-index-management-api";
import { createWorkspaceIndexQueryApi } from "@/features/workspace/workspace-index-query-api";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

export const defaultWorkspaceApi: WorkspaceApi = {
  ...createWorkspaceCoreApi(),
  ...createWorkspaceIndexManagementApi({
    invoke,
    listen,
    hasTauriRuntime,
    normalizePath,
    getPathBasename,
  }),
  ...createWorkspaceIndexQueryApi({ invoke, hasTauriRuntime }),
  ...createWorkspaceGitApi(),
  ...createWorkspaceRuntimeApi(),
} as WorkspaceApi;

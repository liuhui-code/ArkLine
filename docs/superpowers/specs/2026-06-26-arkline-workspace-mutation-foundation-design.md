# ArkLine Workspace Mutation Foundation Design

## Goal

补齐 ArkLine 对标 DevEco Studio / 主流 IDE 的最基础项目与文件生命周期能力：新建文件、新建目录、重命名、删除，并为后续 New Project Wizard、模板生成、全局替换、重构操作提供统一的 Workspace Mutation 底座。

## Current State

已有能力：

- `WorkspaceEditPlan` 和 preview/apply 概念。
- `createFile`、`renameFile`、`deleteFile` operation。
- Tauri runtime 的 workspace edit service 能校验并应用文件级操作。
- CLI/code action 层已有 generate/rename-file 的部分能力。
- Project Tool Window 已有文件树、展开/折叠、聚焦当前文件。

主要缺口：

- 没有 `createDirectory`、`renameDirectory`、`deleteDirectory` 的显式语义。
- Project Tree 没有 New File / New Directory / Rename / Delete 入口。
- UI 入口不能直接构造和应用 workspace mutation。
- New Project 还没有可维护的 scaffold plan / template registry。
- apply 后 workspace 文件树、打开 tab、dirty document、active path 的同步策略需要统一。

## Architecture Decision

把新建项目/文件相关能力归入一个长期平台：Workspace Mutation Foundation。

核心分层：

1. Product Entry Points
   - TopBar File menu
   - Project Tree toolbar/context menu
   - Command Palette
   - future New Project Wizard
   - CLI
   - Code Action

2. Mutation Intent Builders
   - 将用户意图转换成 `WorkspaceEditPlan`
   - 不直接写文件系统
   - 负责路径解析、默认名称、模板内容、操作标题

3. Workspace Edit Runtime
   - preview
   - conflict detection
   - apply
   - changed files report

4. Workspace State Sync
   - `workspace.visibleFiles`
   - `workspace.fileTree`
   - open tabs
   - dirty documents
   - active editor path
   - status bar

## MVP Scope

第一阶段只实现基础文件/目录操作，不实现完整 New Project Wizard。

必须支持：

- Project Tree 新建文件。
- Project Tree 新建目录。
- Project Tree 重命名文件。
- Project Tree 删除文件。
- Project Tree 删除目录时必须走 recursive preview。
- File menu / Command Palette 至少能打开 New File / New Directory。
- 所有写操作生成 `WorkspaceEditPlan` 并走现有 preview/apply UI。

第一阶段允许暂缓：

- New Project Wizard UI。
- Harmony 项目模板。
- 引用感知重命名。
- 删除引用检查。
- 批量 undo。
- Include/exclude glob。

## Operation Model

扩展 `WorkspaceEditOperation`：

```ts
type WorkspaceEditOperation =
  | { kind: "createDirectory"; path: string }
  | { kind: "renameDirectory"; oldPath: string; newPath: string; overwrite: boolean }
  | { kind: "deleteDirectory"; path: string; recursive: boolean }
```

保留现有：

- `createFile`
- `renameFile`
- `deleteFile`
- `text`

目录和文件不混用：

- 创建文件目标不能是目录。
- 创建目录目标不能是文件。
- renameFile 不接受目录。
- renameDirectory 不接受文件。
- deleteFile 不接受目录。
- deleteDirectory 不接受文件。

## UI Behavior

Project Tree：

- 右键目录：
  - New File
  - New Directory
  - Rename
  - Delete
- 右键文件：
  - Rename
  - Delete
  - Copy Path
- 工具栏保留 Expand All / Collapse All / Focus Active File。
- 第一阶段可以用紧凑 inline dialog，不做复杂 floating context menu。

Dialogs：

- `New File`
  - parent directory
  - file name
  - optional initial content empty
- `New Directory`
  - parent directory
  - directory name
- `Rename`
  - current path
  - new name
- `Delete`
  - path
  - recursive warning for directory

所有确认后打开 Workspace Edit Preview，再由用户 Apply。

## New Project Long-Term Route

New Project 不是第一阶段实现项，但架构要预留：

```ts
type WorkspaceTemplate = {
  id: string;
  label: string;
  category: "file" | "directory" | "project";
  inputs: TemplateInput[];
  createPlan(input: TemplateInputValues): WorkspaceEditPlan;
};
```

未来 New Project Wizard 应该只负责采集输入，最终输出 scaffold plan。它不直接调用 `mkdir` 或 `writeFile`。

## Acceptance

- 能从 Project Tree 新建文件和目录。
- 能从 Project Tree 重命名文件。
- 能从 Project Tree 删除文件/目录。
- 所有操作都显示 Workspace Edit Preview。
- Apply 后文件树和打开 tab 状态同步。
- 操作路径不能逃逸 workspace root。
- Tauri service 和 frontend model 都支持目录 operation。
- CLI/semantic-worker 的 operation 类型保持可演进，不和 IDE UI 分叉。

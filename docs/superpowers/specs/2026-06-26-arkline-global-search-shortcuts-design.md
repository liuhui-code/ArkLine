# ArkLine Global Search Shortcuts Design

## Goal

补齐主流 IDE 全局内容搜索入口：`Ctrl/Cmd+Shift+F` 打开 Find in Files，`Ctrl/Cmd+Shift+R` 打开 Replace in Files，并整理全局搜索结果区域的左侧呈现，让它更接近 JetBrains / VS Code 的搜索结果树。

## Current State

- `Double Shift` 打开 `Search Everywhere`。
- 全局内容搜索能力已经存在于 `SearchEverywherePanel`，但入口命名和快捷键更像临时搜索，不像独立的 Find in Files。
- 搜索结果是扁平按钮列表，左侧区域缺少按文件分组、命中数量和层级感。
- `Settings > Keymap`、顶部菜单、Command Palette 需要同步展示新快捷键。
- 当前没有安全的批量替换预览和写入事务链路，因此不能贸然上线 Replace All。

## Product Decision

采用一个搜索面板、两种模式：

- `Search Everywhere`: 保留 `Double Shift`，语义仍是快速搜索入口。
- `Find in Files`: `Ctrl/Cmd+Shift+F`，打开同一个面板的 find 模式。
- `Replace in Files`: `Ctrl/Cmd+Shift+R`，打开同一个面板的 replace 模式，展示 replace 输入框和结果预览；批量替换执行留到后续 diff preview / undo 方案完善后再做。

这样可以避免复制三套搜索 UI，同时让主流 IDE 快捷键入口清晰可见。

## UX Requirements

- Find/Replace 快捷键在 overlay、settings apply、modal 打开时遵守现有快捷键上下文屏蔽规则。
- 搜索面板标题和 close aria label 随模式变化：
  - Search Everywhere
  - Find in Files
  - Replace in Files
- Replace 模式中搜索框仍保持首焦点，replace 输入框位于其下方。
- 左侧结果区改为按文件分组：
  - 文件行显示文件名、相对路径、命中数量。
  - 命中行显示 `line:column` 和片段。
  - 鼠标悬停或键盘选择同步右侧 preview。
- 结果为空时显示稳定空态，不出现布局跳动。
- 右侧 preview 保持当前能力：展示命中文件、相对路径、行列和上下文。

## Non-Goals

- 本轮不实现 Replace All 写入。
- 本轮不实现搜索范围 include/exclude glob。
- 本轮不重写底层 search engine。
- 本轮不改变 Quick Open、Command Palette、Completion 的现有交互。

## Acceptance

- `Ctrl/Cmd+Shift+F` 打开 Find in Files 面板。
- `Ctrl/Cmd+Shift+R` 打开 Replace in Files 面板，并显示 replace 输入框。
- 顶部菜单、Command Palette、Settings Keymap 都能看到新命令和快捷键。
- 搜索结果左侧为按文件分组的层级列表，点击命中仍能打开文件并跳转。
- 现有 Search Everywhere `Double Shift` 行为保持。

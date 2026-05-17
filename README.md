# Task Tracker for SiYuan

Task Tracker turns SiYuan documents into trackable tasks. You choose one document as the task library root, then every task is created as a child document under that root. Subtasks are created as child documents of their parent task, so the task hierarchy remains visible in SiYuan's document tree.

[中文说明](README_zh_CN.md) | [User Guide](docs/USER_GUIDE.md) | [中文使用说明](docs/USER_GUIDE_zh_CN.md)

## Features

- Task-note workflow: each task has a real SiYuan document, a metadata block, and custom block attributes.
- Task creation from the top bar, the dock, the task manager, the current document, or a selected block.
- Task fields for project, parent task, source note, status, priority, created date, planned start/end, and due date.
- Dock panel for daily tracking with All, Focus, and Today filters.
- Task control panel with Table, List, Timeline, Kanban, Calendar, and Completed views.
- Calendar view based on planned start dates, with a separate unplanned task panel.
- Completed task view grouped by the task creation month.
- Inline status, priority, planned date, and due date editing in task lists.
- Resizable table columns with width preferences stored in plugin settings.
- Startup recovery that can rebuild `tasks.json` from task document attributes after sync or device changes.
- Manual maintenance tools for cleaning deleted task records and rebuilding the task index.

## Requirements

- SiYuan `3.6.4` or later.
- Supported frontends: desktop, browser-desktop, and desktop-window.
- Supported backends: Windows, Linux, macOS, Docker, and all standard SiYuan backends.

## Quick Start

1. Create or open a document such as `Task Library`.
2. Set it as the task library root from the document title menu, or paste its document ID in `Settings -> Task Tracker -> Task Library`.
3. Create tasks from the top bar, dock, task manager, current document, or selected block.
4. Open the task control panel to switch between table, list, timeline, kanban, calendar, and completed views.
5. Complete a top-level task to archive it under `Task Library/Completed/YYYY-MM`.

## How It Works

The plugin keeps a fast local index in `tasks.json` and stores settings in `settings.json`. Task metadata is also written to the task document's custom attributes, so the index can be rebuilt from the task library when needed.

When a task is created, the plugin renders a task document from the configured template. The default template includes a quote block with source, parent, project, status, priority, description, created date, due date, planned date, and child task links. Keep that metadata block or another block containing `来源：` if you want task field changes in the panel to keep syncing back into the document body.

Deleting a task from the task control panel deletes the task document and its subtasks after confirmation. The maintenance action named "clean deleted task records" only removes plugin records whose SiYuan documents are already gone.

## Template Placeholders

The task template supports:

`{{title}}`, `{{source}}`, `{{parent}}`, `{{project}}`, `{{status}}`, `{{priority}}`, `{{description}}`, `{{dueDate}}`, `{{planStart}}`, `{{planEnd}}`, `{{childTasks}}`, `{{childTaskList}}`, `{{createdAt}}`, `{{updatedAt}}`.

## Development

```bash
npm install
npm run typecheck
npm run build
```

Useful scripts:

- `npm run build`: build the release-ready plugin into `dist/`.
- `npm run build:local`: build and sync `dist/` to a local SiYuan plugin directory.
- `npm run release`: build and create a release zip in `release/`.
- `npm run dev`: run the Vite watch build.

For local sync on another machine, set `SIYUAN_PLUGIN_DIR` to the target plugin directory before running `npm run build:local`.

## License

MIT

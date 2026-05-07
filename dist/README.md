# Task Tracker for SiYuan

This is an early task-tracking plugin for SiYuan. It uses one configured document as the task library root. Every task is created as a child document under that root, and subtasks are created as child documents of their parent task.

The first version focuses on:

- setting the current document as the task library;
- creating task-note documents from the top bar, current document, or selected block;
- tracking status, priority, project, planned time, due date, parent task, and source block;
- a docked task list for daily tracking;
- a simple calendar tab plus an unplanned task list.

Plugin data is stored in `tasks.json` and `settings.json`. Task metadata is also written to document custom attributes so task documents stay traceable inside SiYuan.

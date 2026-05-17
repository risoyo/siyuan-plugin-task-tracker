# Task Tracker User Guide

This guide describes the workflow implemented by the current plugin version.

## 1. Core Concepts

- Task library: one SiYuan document selected as the root container for task documents.
- Task document: every task is a real child document under the task library or under its parent task.
- Task index: `tasks.json` is a fast plugin cache. Task document attributes are the recoverable source for rebuilding that cache.
- Source note: a task can point back to a source document or block through a SiYuan block reference.
- Parent task: a task can have a parent task. Subtasks are stored as child documents of their parent task.

## 2. First Setup

1. Create a document such as `Task Library`.
2. Open the document title menu and choose `Use Current Document as Task Library`.
3. If the automatic command cannot identify the current document, copy the document ID in SiYuan, open plugin settings, paste the ID into `Task Library`, and click `Bind ID`.
4. Optionally configure a default project and adjust the task template.

New tasks are created under the task library. New subtasks are created under their parent task document.

## 3. Creating Tasks

You can create a task from:

- the top bar task icon;
- the Task Tracker dock;
- the task control panel;
- the current document title menu;
- the current or first selected block menu;
- a day cell in the calendar view.

The task dialog supports title, project, parent task, status, priority, created date, planned start, planned end, due date, and source mode.

Source mode options:

- Manual: the task has no source note.
- Note: the task stores a source document or block reference. When created from a document or block menu, the source is prefilled.

Clicking a day in the calendar creates a new task with that date prefilled as the planned start date.

## 4. Daily Dock

The dock is designed for quick tracking.

- All: active tasks with status `todo`, `doing`, or `waiting`.
- Focus: active tasks that are `doing`, or whose planned/due date is today or earlier.
- Today: active tasks whose planned/due date is today.

The dock lets you open tasks, update status, update planned date, update due date, create tasks, open the control panel, and clean records for deleted task documents.

## 5. Task Control Panel

Open the control panel from the top bar or the dock.

Views:

- Table: dense editable table with resizable columns.
- List: compact task tree with inline controls.
- Timeline: groups active tasks by planned start date, with unplanned tasks first.
- Kanban: groups active tasks by status except completed.
- Calendar: shows tasks by planned start date and can show a floating unplanned panel.
- Completed: groups completed tasks by creation month.

Search matches title, project, source text, source type, status label, priority label, dates, and parent title.

Common actions:

- Open task document.
- Open source document when a source exists.
- Edit task metadata.
- Add subtask.
- Complete or reopen task.
- Delete task tree after confirmation.

Deleting from the control panel deletes the task document and all descendant task documents. Use it carefully.

## 6. Statuses, Priorities, and Dates

Statuses:

- `todo`: to do.
- `doing`: in progress.
- `waiting`: waiting.
- `completed`: completed.
- `cancelled`: cancelled.

Priorities:

- `none`, `low`, `medium`, `high`.

Date behavior:

- Created date is used in task document naming and completed task grouping.
- Planned start is used by timeline and calendar views.
- Planned end is stored in task metadata and template rendering.
- Due date is used by daily filters and inline editing.

## 7. Completion and Archive

When a top-level task becomes completed, the plugin moves it under:

```text
Task Library/Completed/YYYY-MM
```

The archive month is based on the task creation date. Child task paths are refreshed after the move. Completed subtasks stay under their parent task.

The Completed view groups tasks by creation month and lets you reopen or delete completed tasks.

## 8. Maintenance and Recovery

Settings provide two maintenance actions:

- Clean deleted task records: removes plugin index records whose SiYuan task documents no longer exist.
- Rebuild task index from task library: scans task documents under the task library and rebuilds `tasks.json` from custom attributes.

On startup, the plugin waits for SiYuan sync to settle before recovery work. If the index is empty or missing tasks, it can recover tasks from document attributes. This is useful after changing devices or after sync problems.

## 9. Task Template

The default template includes a metadata quote block. Keep that block, or keep another quote block containing `来源：`, so task field changes can sync back into the task document body.

Supported placeholders:

- `{{title}}`
- `{{source}}`
- `{{parent}}`
- `{{project}}`
- `{{status}}`
- `{{priority}}`
- `{{description}}`
- `{{dueDate}}`
- `{{planStart}}`
- `{{planEnd}}`
- `{{childTasks}}`
- `{{childTaskList}}`
- `{{createdAt}}`
- `{{updatedAt}}`

`{{childTasks}}` renders inline block references. `{{childTaskList}}` renders a Markdown list.

## 10. Practical Notes

- Keep task documents inside the task library if you want rebuild to discover them.
- If you manually move or rename task documents, run the rebuild action if the panel looks stale.
- Keep regular SiYuan backups, especially before bulk deleting task trees.
- The plugin does not send task data to an external service.

import { isProtectedStatus } from "./statusConfig";
import { normalizeTaskCategory, type TaskCategory, type TaskItem, type TaskStatus } from "./types";

export function categoryViewTasks(tasks: TaskItem[], category: TaskCategory, statusFilter: "all" | TaskStatus = "all"): TaskItem[] {
  const children = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    if (task.parentId) {
      const siblings = children.get(task.parentId) || [];
      siblings.push(task);
      children.set(task.parentId, siblings);
    }
  }

  const roots = tasks.filter((task) => normalizeTaskCategory(task.category) === category
    && !isProtectedStatus(task.status)
    && (statusFilter === "all" || task.status === statusFilter));
  const included = new Set<string>();
  const visit = (task: TaskItem) => {
    if (included.has(task.id)) return;
    included.add(task.id);
    for (const child of children.get(task.id) || []) visit(child);
  };
  roots.forEach(visit);
  return tasks.filter((task) => included.has(task.id));
}

export function canSelectParentTask(parent: TaskItem, tasks: TaskItem[], editingTaskId?: string): boolean {
  const category = normalizeTaskCategory(parent.category);
  if ((category !== "longTerm" && category !== "weekly") || isProtectedStatus(parent.status)) return false;
  if (!editingTaskId) return true;
  if (parent.id === editingTaskId || parent.docId === editingTaskId) return false;

  const byId = new Map(tasks.flatMap((task) => [[task.id, task], [task.docId, task]] as Array<[string, TaskItem]>));
  const seen = new Set<string>();
  let current: TaskItem | undefined = parent;
  while (current?.parentId) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    if (current.parentId === editingTaskId) return false;
    current = byId.get(current.parentId);
    if (current?.id === editingTaskId || current?.docId === editingTaskId) return false;
  }
  return true;
}

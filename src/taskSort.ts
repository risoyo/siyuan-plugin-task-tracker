import { latestProgressRecordSummary } from "./progressRecords";
import type { SidebarTaskSortField, TableSortColumn, TaskItem } from "./types";

const TASK_TITLE_LOCALE = "zh-Hans-CN";

export function compareTasksByColumn(a: TaskItem, b: TaskItem, column: TableSortColumn): number {
  if (column === "task") {
    return compareTaskTitle(a, b);
  }
  if (column === "project") {
    return (a.project || "").localeCompare(b.project || "", TASK_TITLE_LOCALE)
      || compareTaskTitle(a, b);
  }
  if (column === "source") {
    const aSource = a.sourceText?.trim() || (a.sourceDocId ? "来源笔记" : "手动创建");
    const bSource = b.sourceText?.trim() || (b.sourceDocId ? "来源笔记" : "手动创建");
    return aSource.localeCompare(bSource, TASK_TITLE_LOCALE)
      || compareTaskTitle(a, b);
  }
  if (column === "createdAt") {
    return compareOptionalDates(a.createdAt, b.createdAt, "asc")
      || compareTaskTitle(a, b);
  }
  if (column === "status") {
    return compareBusinessOrder(a.status, b.status, ["todo", "doing", "waiting", "completed", "cancelled"])
      || compareTaskTitle(a, b);
  }
  if (column === "priority") {
    return compareBusinessOrder(a.priority, b.priority, ["none", "low", "medium", "high"])
      || compareTaskTitle(a, b);
  }
  if (column === "latest") {
    return (a.description || "").localeCompare(b.description || "", TASK_TITLE_LOCALE)
      || compareTaskTitle(a, b);
  }
  if (column === "progress") {
    return latestProgressRecordSummary(a.progressRecords).localeCompare(latestProgressRecordSummary(b.progressRecords), TASK_TITLE_LOCALE)
      || compareTaskTitle(a, b);
  }
  if (column === "plan") {
    return compareOptionalDates(a.planStart, b.planStart, "asc")
      || compareTaskTitle(a, b);
  }
  return compareOptionalDates(a.dueDate, b.dueDate, "asc")
    || compareTaskTitle(a, b);
}

export function compareTasksBySidebarSortField(a: TaskItem, b: TaskItem, field: SidebarTaskSortField): number {
  if (field === "default") {
    return compareOptionalDates(a.planStart || a.dueDate, b.planStart || b.dueDate, "asc")
      || compareOptionalDates(a.updatedAt, b.updatedAt, "desc")
      || compareTaskTitle(a, b);
  }
  if (field === "updatedAt") {
    return compareOptionalDates(a.updatedAt, b.updatedAt, "asc")
      || compareTaskTitle(a, b);
  }
  if (field === "planStart") {
    return compareOptionalDates(a.planStart, b.planStart, "asc")
      || compareTaskTitle(a, b);
  }
  if (field === "dueDate") {
    return compareOptionalDates(a.dueDate, b.dueDate, "asc")
      || compareTaskTitle(a, b);
  }
  if (field === "task" || field === "createdAt" || field === "priority" || field === "status") {
    return compareTasksByColumn(a, b, field);
  }
  return compareTaskTitle(a, b);
}

export function compareBusinessOrder<T extends string>(a: T | undefined, b: T | undefined, order: T[]): number {
  const rank = new Map(order.map((value, index) => [value, index]));
  return (rank.get(a || order[0]) ?? order.length) - (rank.get(b || order[0]) ?? order.length);
}

export function compareOptionalDates(a?: string, b?: string, direction: "asc" | "desc" = "asc"): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  return direction === "desc" ? b.localeCompare(a) : a.localeCompare(b);
}

export function sortTaskTree<T extends { task: TaskItem; children: T[] }>(
  nodes: T[],
  comparator?: (a: TaskItem, b: TaskItem) => number
): T[] {
  const sorted = nodes.map((node) => ({
    ...node,
    children: sortTaskTree(node.children, comparator)
  }));
  if (!comparator) {
    return sorted;
  }
  return sorted.sort((a, b) => comparator(a.task, b.task));
}

function compareTaskTitle(a: TaskItem, b: TaskItem): number {
  return a.title.localeCompare(b.title, TASK_TITLE_LOCALE);
}

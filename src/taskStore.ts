import type { Plugin } from "siyuan";
import { normalizeProgressRecords } from "./progressRecords";
import { normalizeStatusOptions, normalizeStoredTaskStatus } from "./statusConfig";
import {
  COMPLETED_TASK_STATUS,
  DEFAULT_DOCK_DISPLAY_OPTIONS,
  DEFAULT_SETTINGS,
  SETTINGS_DATA_FILE,
  TASKS_DATA_FILE,
  type CompletedPageColumnKey,
  type CompletedPageConfig,
  type CompletedSortSpec,
  type DockDisplayOptions,
  type SortDirection,
  type SidebarTaskSortField,
  type TableColumnKey,
  type TablePageColumnKey,
  type TablePageConfig,
  type TableSortColumn,
  type TableSortSpec,
  type TaskItem,
  type TaskSettings
} from "./types";

const TABLE_PAGE_COLUMNS: TablePageColumnKey[] = ["task", "project", "status", "priority", "latest", "progress", "createdAt", "plan", "due", "source"];
const DEFAULT_TABLE_PAGE_COLUMNS: TablePageColumnKey[] = [...TABLE_PAGE_COLUMNS];
const DEFAULT_TABLE_SORT: TableSortSpec = { column: "default" };

const COMPLETED_PAGE_COLUMNS: CompletedPageColumnKey[] = ["task", "project", "latest", "progress", "source", "createdAt", "planStart", "completedAt"];
const DEFAULT_COMPLETED_PAGE_COLUMNS: CompletedPageColumnKey[] = [...COMPLETED_PAGE_COLUMNS];
const DEFAULT_COMPLETED_SORT: CompletedSortSpec = { column: "default" };

export class TaskStore {
  private tasks: TaskItem[] = [];
  private settings: TaskSettings = { ...DEFAULT_SETTINGS };

  constructor(private plugin: Plugin) {}

  async load(): Promise<void> {
    const [tasksData, settingsData] = await Promise.all([
      this.plugin.loadData(TASKS_DATA_FILE).catch(() => undefined),
      this.plugin.loadData(SETTINGS_DATA_FILE).catch(() => undefined)
    ]);

    const loadedTasks = Array.isArray(tasksData)
      ? tasksData
      : (Array.isArray((tasksData as any)?.tasks) ? (tasksData as any).tasks : []);
    this.tasks = loadedTasks.map((task) => normalizeStoredTask(task));

    if (settingsData && typeof settingsData === "object") {
      this.settings = normalizeSettings(settingsData as TaskSettings);
    }

    if (loadedTasks.length && loadedTasks.some((task, index) => this.tasks[index] !== task)) {
      await this.saveTasks();
    }
  }

  all(): TaskItem[] {
    return [...this.tasks].sort((a, b) => {
      const aPlan = a.planStart || a.dueDate || "";
      const bPlan = b.planStart || b.dueDate || "";
      if (a.status === COMPLETED_TASK_STATUS && b.status !== COMPLETED_TASK_STATUS) {
        return 1;
      }
      if (b.status === COMPLETED_TASK_STATUS && a.status !== COMPLETED_TASK_STATUS) {
        return -1;
      }
      return aPlan.localeCompare(bPlan) || b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  get(id: string): TaskItem | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  getSettings(): TaskSettings {
    return normalizeSettings(this.settings);
  }

  getProjects(): string[] {
    return Array.from(new Set(this.tasks.map((task) => task.project?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }

  async setSettings(settings: TaskSettings): Promise<void> {
    const nextSettings = normalizeSettings({ ...this.settings, ...settings });
    const changed = JSON.stringify(this.settings) !== JSON.stringify(nextSettings);
    this.settings = nextSettings;
    if (changed) {
      await this.plugin.saveData(SETTINGS_DATA_FILE, this.settings);
    }
  }

  async upsert(task: TaskItem): Promise<void> {
    const normalizedTask = normalizeStoredTask(task);
    const index = this.tasks.findIndex((item) => item.id === normalizedTask.id);
    if (index >= 0) {
      if (JSON.stringify(this.tasks[index]) === JSON.stringify(normalizedTask)) {
        this.tasks[index] = normalizedTask;
        return;
      }
      this.tasks[index] = normalizedTask;
    } else {
      this.tasks.push(normalizedTask);
    }
    await this.saveTasks();
  }

  async replaceAll(tasks: TaskItem[]): Promise<void> {
    const nextTasks = tasks.map((task) => normalizeStoredTask(task));
    const changed = JSON.stringify(this.tasks) !== JSON.stringify(nextTasks);
    this.tasks = nextTasks;
    if (changed) {
      await this.saveTasks();
    }
  }

  async update(id: string, patch: Partial<TaskItem>): Promise<TaskItem> {
    const current = this.get(id);
    if (!current) {
      throw new Error(`Task not found: ${id}`);
    }
    const next: TaskItem = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await this.upsert(next);
    return next;
  }

  async removeMany(ids: string[]): Promise<number> {
    const idSet = new Set(ids);
    if (!idSet.size) {
      return 0;
    }

    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => !idSet.has(task.id));
    const removed = before - this.tasks.length;
    if (removed > 0) {
      await this.saveTasks();
    }
    return removed;
  }

  private async saveTasks(): Promise<void> {
    await this.plugin.saveData(TASKS_DATA_FILE, { tasks: this.tasks });
  }
}

function normalizeStoredTask(task: TaskItem): TaskItem {
  const normalizedTitle = typeof task.title === "string" && task.title.trim()
    ? task.title.trim()
    : fallbackTaskTitle(task);
  const fallbackTimestamp = task.updatedAt || task.createdAt || new Date().toISOString();
  return {
    ...task,
    noteFolderPath: typeof task.noteFolderPath === "string" ? task.noteFolderPath.trim() || undefined : undefined,
    progressRecords: normalizeProgressRecords(task.progressRecords, fallbackTimestamp),
    status: normalizeStoredTaskStatus(task.status),
    title: normalizedTitle,
    createdAt: task.createdAt || task.updatedAt || new Date().toISOString()
  };
}

function normalizeSettings(settings: TaskSettings): TaskSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    statusOptions: normalizeStatusOptions(settings),
    dockDisplayOptions: normalizeDockDisplayOptions(settings.dockDisplayOptions),
    pageConfigs: {
      ...settings.pageConfigs,
      table: normalizeTablePageConfig(settings.pageConfigs?.table),
      completed: normalizeCompletedPageConfig(settings.pageConfigs?.completed)
    }
  };
}

function normalizeTablePageConfig(raw?: TablePageConfig): TablePageConfig {
  const visibleColumns = normalizeVisibleColumns(raw?.visibleColumns);
  const columnOrder = normalizeColumnOrder(raw?.columnOrder);
  return {
    visibleColumns,
    columnOrder,
    currentSort: normalizeSortSpec(raw?.currentSort) || { ...DEFAULT_TABLE_SORT },
    defaultSort: normalizeDefaultSort(raw?.defaultSort),
    customTaskOrder: normalizeCustomTaskOrder(raw?.customTaskOrder)
  };
}

function normalizeVisibleColumns(columns?: TablePageColumnKey[]): TablePageColumnKey[] {
  const configured = Array.isArray(columns)
    ? columns.filter((column): column is TablePageColumnKey => TABLE_PAGE_COLUMNS.includes(column))
    : [];
  const unique = migrateTableConfig(Array.from(new Set(configured)));
  return unique.length ? unique : [...DEFAULT_TABLE_PAGE_COLUMNS];
}

function normalizeColumnOrder(columns?: TablePageColumnKey[]): TablePageColumnKey[] {
  const configured = Array.isArray(columns)
    ? columns.filter((column): column is TablePageColumnKey => TABLE_PAGE_COLUMNS.includes(column))
    : [];
  const unique = migrateTableConfig(Array.from(new Set(configured)));
  for (const column of DEFAULT_TABLE_PAGE_COLUMNS) {
    if (!unique.includes(column)) {
      unique.push(column);
    }
  }
  return unique;
}

function migrateTableConfig(columns: TablePageColumnKey[]): TablePageColumnKey[] {
  let result = [...columns];
  if (!result.includes("latest")) {
    const priorityIndex = result.indexOf("priority");
    if (priorityIndex >= 0) {
      result.splice(priorityIndex + 1, 0, "latest");
    } else {
      result.push("latest");
    }
  }
  if (!result.includes("progress")) {
    const latestIndex = result.indexOf("latest");
    if (latestIndex >= 0) {
      result.splice(latestIndex + 1, 0, "progress");
    } else {
      result.push("progress");
    }
  }
  return result;
}

function normalizeSortSpec(raw?: TableSortSpec): TableSortSpec | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  if (raw.column === "default") {
    return { column: "default" };
  }
  if (raw.column === "custom") {
    return { column: "custom" };
  }
  if (!isTableSortColumn(raw.column)) {
    return undefined;
  }
  return {
    column: raw.column,
    direction: normalizeSortDirection(raw.direction) || "asc"
  };
}

function normalizeDefaultSort(raw?: { column: TableSortColumn; direction: SortDirection }): { column: TableSortColumn; direction: SortDirection } | undefined {
  if (!raw || typeof raw !== "object" || !isTableSortColumn(raw.column)) {
    return undefined;
  }
  return {
    column: raw.column,
    direction: normalizeSortDirection(raw.direction) || "asc"
  };
}

function normalizeSortDirection(direction?: SortDirection): SortDirection | undefined {
  return direction === "asc" || direction === "desc" ? direction : undefined;
}

function normalizeCustomTaskOrder(raw?: string[]): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(new Set(raw.map((id) => typeof id === "string" ? id.trim() : "").filter(Boolean)));
}

function normalizeDockDisplayOptions(raw?: DockDisplayOptions): DockDisplayOptions {
  return {
    showStatus: raw?.showStatus !== false,
    showDate: raw?.showDate !== false,
    sortField: isSidebarTaskSortField(raw?.sortField) ? raw.sortField : DEFAULT_DOCK_DISPLAY_OPTIONS.sortField,
    sortDirection: normalizeSortDirection(raw?.sortDirection) || DEFAULT_DOCK_DISPLAY_OPTIONS.sortDirection
  };
}

function isSidebarTaskSortField(value: unknown): value is SidebarTaskSortField {
  return value === "default"
    || value === "task"
    || value === "createdAt"
    || value === "updatedAt"
    || value === "planStart"
    || value === "dueDate"
    || value === "priority"
    || value === "status";
}

function isTableSortColumn(value: unknown): value is TableSortColumn {
  return typeof value === "string" && TABLE_PAGE_COLUMNS.includes(value as TablePageColumnKey);
}

function normalizeCompletedPageConfig(raw?: CompletedPageConfig): CompletedPageConfig {
  const visibleColumns = normalizeCompletedVisibleColumns(raw?.visibleColumns);
  const columnOrder = normalizeCompletedColumnOrder(raw?.columnOrder);
  return {
    visibleColumns,
    columnOrder,
    currentSort: normalizeCompletedSortSpec(raw?.currentSort) || { ...DEFAULT_COMPLETED_SORT },
    defaultSort: normalizeCompletedDefaultSort(raw?.defaultSort)
  };
}

function normalizeCompletedVisibleColumns(columns?: CompletedPageColumnKey[]): CompletedPageColumnKey[] {
  const configured = Array.isArray(columns)
    ? columns.filter((column): column is CompletedPageColumnKey => COMPLETED_PAGE_COLUMNS.includes(column))
    : [];
  const unique = Array.from(new Set(configured));
  if (!unique.length) {
    return [...DEFAULT_COMPLETED_PAGE_COLUMNS];
  }
  return migrateCompletedConfig(unique);
}

function normalizeCompletedColumnOrder(columns?: CompletedPageColumnKey[]): CompletedPageColumnKey[] {
  const configured = Array.isArray(columns)
    ? columns.filter((column): column is CompletedPageColumnKey => COMPLETED_PAGE_COLUMNS.includes(column))
    : [];
  const unique = Array.from(new Set(configured));
  const migrated = migrateCompletedConfig(unique);
  for (const column of DEFAULT_COMPLETED_PAGE_COLUMNS) {
    if (!migrated.includes(column)) {
      migrated.push(column);
    }
  }
  return migrated;
}

function migrateCompletedConfig(columns: CompletedPageColumnKey[]): CompletedPageColumnKey[] {
  let result = [...columns];
  if (!result.includes("latest")) {
    const sourceIndex = result.indexOf("source");
    if (sourceIndex >= 0) {
      result.splice(sourceIndex, 0, "latest");
    } else {
      result.push("latest");
    }
  }
  if (!result.includes("progress")) {
    const latestIndex = result.indexOf("latest");
    if (latestIndex >= 0) {
      result.splice(latestIndex + 1, 0, "progress");
    } else {
      result.push("progress");
    }
  }
  if (result.includes("planStart")) {
    return result;
  }
  const createdAtIndex = result.indexOf("createdAt");
  const completedAtIndex = result.indexOf("completedAt");
  if (createdAtIndex >= 0 && completedAtIndex > createdAtIndex) {
    result.splice(createdAtIndex + 1, 0, "planStart");
    return result;
  }
  return [...result, "planStart"];
}

function normalizeCompletedSortSpec(raw?: CompletedSortSpec): CompletedSortSpec | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  if (raw.column === "default") {
    return { column: "default" };
  }
  if (!isCompletedSortColumn(raw.column)) {
    return undefined;
  }
  return {
    column: raw.column,
    direction: normalizeSortDirection(raw.direction) || "asc"
  };
}

function normalizeCompletedDefaultSort(raw?: { column: CompletedPageColumnKey; direction: SortDirection }): { column: CompletedPageColumnKey; direction: SortDirection } | undefined {
  if (!raw || typeof raw !== "object" || !isCompletedSortColumn(raw.column)) {
    return undefined;
  }
  return {
    column: raw.column,
    direction: normalizeSortDirection(raw.direction) || "asc"
  };
}

function isCompletedSortColumn(value: unknown): value is CompletedPageColumnKey {
  return typeof value === "string" && COMPLETED_PAGE_COLUMNS.includes(value as CompletedPageColumnKey);
}

function fallbackTaskTitle(task: Pick<TaskItem, "path" | "docId">): string {
  const fromPath = task.path.split("/").pop()?.replace(/\.sy$/i, "").trim();
  return fromPath || task.docId;
}

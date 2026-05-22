import type { Plugin } from "siyuan";
import {
  DEFAULT_SETTINGS,
  SETTINGS_DATA_FILE,
  TASKS_DATA_FILE,
  TASK_INDEX_SCHEMA_VERSION,
  type CompletedPageColumnKey,
  type CompletedPageConfig,
  type CompletedSortSpec,
  type SortDirection,
  type TableColumnKey,
  type TablePageColumnKey,
  type TablePageConfig,
  type TableSortColumn,
  type TableSortSpec,
  type TaskIndexCacheFile,
  type TaskIndexMeta,
  type TaskItem,
  type TaskLocalPreferences,
  type TaskSettings
} from "./types";

const TABLE_PAGE_COLUMNS: TablePageColumnKey[] = ["task", "project", "source", "createdAt", "status", "priority", "plan", "due"];
const DEFAULT_TABLE_PAGE_COLUMNS: TablePageColumnKey[] = [...TABLE_PAGE_COLUMNS];
const DEFAULT_TABLE_SORT: TableSortSpec = { column: "default" };

const COMPLETED_PAGE_COLUMNS: CompletedPageColumnKey[] = ["task", "project", "source", "createdAt", "planStart", "completedAt"];
const DEFAULT_COMPLETED_PAGE_COLUMNS: CompletedPageColumnKey[] = [...COMPLETED_PAGE_COLUMNS];
const DEFAULT_COMPLETED_SORT: CompletedSortSpec = { column: "default" };
const LOCAL_PREFS_VERSION = 1;

export interface LocalPreferenceStore {
  load(): TaskLocalPreferences | undefined;
  save(value: TaskLocalPreferences): void;
}

export class TaskStore {
  private tasks: TaskItem[] = [];
  private settings: TaskSettings = { ...DEFAULT_SETTINGS };
  private localPreferences: TaskLocalPreferences = {};
  private cacheMeta: TaskIndexMeta = defaultCacheMeta();
  private localPreferenceStore: LocalPreferenceStore;
  private cacheSaveTimer?: number;
  private cacheDirty = false;
  private cacheWriteInFlight?: Promise<void>;

  constructor(private plugin: Plugin) {
    this.localPreferenceStore = createLocalPreferenceStore(plugin.name);
  }

  async load(): Promise<void> {
    const [tasksData, settingsData] = await Promise.all([
      this.plugin.loadData(TASKS_DATA_FILE).catch(() => undefined),
      this.plugin.loadData(SETTINGS_DATA_FILE).catch(() => undefined)
    ]);

    const parsedCache = parseTaskCache(tasksData);
    this.tasks = parsedCache.tasks.map((task) => normalizeStoredTask(task));
    this.cacheMeta = parsedCache.meta;

    if (settingsData && typeof settingsData === "object") {
      this.settings = normalizeSettings(settingsData as TaskSettings);
    }

    this.localPreferences = normalizeLocalPreferences(
      this.localPreferenceStore.load(),
      this.settings
    );

    if (shouldMigrateLegacyLocalPrefs(this.settings, this.localPreferences)) {
      this.localPreferenceStore.save(this.localPreferences);
      await this.setSettings({
        tableColumnWidths: undefined,
        completedTableColumnWidths: undefined,
        pageConfigs: undefined
      });
    }

    if (parsedCache.dirty) {
      await this.saveTasksImmediate();
    }
  }

  all(): TaskItem[] {
    return [...this.tasks].sort((a, b) => {
      const aPlan = a.planStart || a.dueDate || "";
      const bPlan = b.planStart || b.dueDate || "";
      if (a.status === "completed" && b.status !== "completed") {
        return 1;
      }
      if (b.status === "completed" && a.status !== "completed") {
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

  getLocalPreferences(): TaskLocalPreferences {
    return normalizeLocalPreferences(this.localPreferences);
  }

  getCacheMeta(): TaskIndexMeta {
    return { ...this.cacheMeta };
  }

  getProjects(): string[] {
    return Array.from(new Set(this.tasks.map((task) => task.project?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }

  async setSettings(settings: Partial<TaskSettings>): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, ...settings });
    await this.plugin.saveData(SETTINGS_DATA_FILE, this.settings);
  }

  async setLocalPreferences(prefs: Partial<TaskLocalPreferences>): Promise<void> {
    this.localPreferences = normalizeLocalPreferences({ ...this.localPreferences, ...prefs });
    this.localPreferenceStore.save(this.localPreferences);
  }

  async setCacheMeta(patch: Partial<TaskIndexMeta>): Promise<void> {
    this.cacheMeta = {
      ...this.cacheMeta,
      ...patch
    };
    this.scheduleCacheSave();
  }

  async markCacheCorrupt(reason?: string): Promise<void> {
    this.cacheMeta = {
      ...this.cacheMeta,
      corrupt: true,
      builtAt: new Date().toISOString()
    };
    if (reason) {
      console.warn(`Task Tracker cache marked corrupt: ${reason}`);
    }
    this.scheduleCacheSave();
  }

  async upsert(task: TaskItem): Promise<void> {
    const normalizedTask = normalizeStoredTask(task);
    const index = this.tasks.findIndex((item) => item.id === normalizedTask.id);
    if (index >= 0) {
      this.tasks[index] = normalizedTask;
    } else {
      this.tasks.push(normalizedTask);
    }
    this.scheduleCacheSave();
  }

  async replaceAll(tasks: TaskItem[], metaPatch?: Partial<TaskIndexMeta>): Promise<void> {
    this.tasks = tasks.map((task) => normalizeStoredTask(task));
    this.cacheMeta = {
      ...this.cacheMeta,
      ...metaPatch,
      schemaVersion: TASK_INDEX_SCHEMA_VERSION,
      builtAt: new Date().toISOString(),
      corrupt: false
    };
    await this.saveTasksImmediate();
  }

  async update(id: string, patch: Partial<TaskItem>): Promise<TaskItem> {
    const current = this.get(id);
    if (!current) {
      throw new Error(`Task not found: ${id}`);
    }
    const next: TaskItem = normalizeStoredTask({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    });
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
      this.scheduleCacheSave();
    }
    return removed;
  }

  async markNeedsReconcile(ids: string[]): Promise<number> {
    const idSet = new Set(ids.filter(Boolean));
    if (!idSet.size) {
      return 0;
    }
    let changed = 0;
    this.tasks = this.tasks.map((task) => {
      if (!idSet.has(task.id) || task.needsReconcile) {
        return task;
      }
      changed += 1;
      return {
        ...task,
        needsReconcile: true
      };
    });
    if (changed > 0) {
      this.scheduleCacheSave();
    }
    return changed;
  }

  async clearNeedsReconcile(ids: string[]): Promise<number> {
    const idSet = new Set(ids.filter(Boolean));
    if (!idSet.size) {
      return 0;
    }
    let changed = 0;
    this.tasks = this.tasks.map((task) => {
      if (!idSet.has(task.id) || !task.needsReconcile) {
        return task;
      }
      changed += 1;
      return {
        ...task,
        needsReconcile: undefined
      };
    });
    if (changed > 0) {
      this.scheduleCacheSave();
    }
    return changed;
  }

  private scheduleCacheSave(): void {
    this.cacheDirty = true;
    if (this.cacheSaveTimer !== undefined) {
      return;
    }
    this.cacheSaveTimer = window.setTimeout(() => {
      this.cacheSaveTimer = undefined;
      void this.saveTasksImmediate();
    }, 3000);
  }

  private async saveTasksImmediate(): Promise<void> {
    this.cacheDirty = true;
    if (this.cacheWriteInFlight) {
      await this.cacheWriteInFlight;
      if (!this.cacheDirty) {
        return;
      }
    }
    this.cacheDirty = false;
    const payload: TaskIndexCacheFile = {
      schemaVersion: TASK_INDEX_SCHEMA_VERSION,
      tasks: this.tasks,
      meta: {
        ...this.cacheMeta,
        schemaVersion: TASK_INDEX_SCHEMA_VERSION,
        builtAt: new Date().toISOString()
      }
    };
    this.cacheWriteInFlight = this.plugin.saveData(TASKS_DATA_FILE, payload)
      .then(() => undefined)
      .catch((error) => {
        this.cacheDirty = true;
        throw error;
      })
      .finally(() => {
        this.cacheWriteInFlight = undefined;
      });
    await this.cacheWriteInFlight;
  }
}

function parseTaskCache(raw: unknown): { tasks: TaskItem[]; meta: TaskIndexMeta; dirty: boolean } {
  const meta = defaultCacheMeta();
  if (!raw) {
    return { tasks: [], meta, dirty: false };
  }

  if (Array.isArray(raw)) {
    return {
      tasks: raw as TaskItem[],
      meta,
      dirty: true
    };
  }

  if (typeof raw !== "object") {
    return { tasks: [], meta: { ...meta, corrupt: true }, dirty: true };
  }

  const candidate = raw as Partial<TaskIndexCacheFile> & { tasks?: unknown; meta?: unknown };
  const tasksFromObject = Array.isArray(candidate.tasks)
    ? candidate.tasks as TaskItem[]
    : (Array.isArray((raw as any)?.tasks) ? (raw as any).tasks as TaskItem[] : []);
  const schemaVersion = typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : undefined;
  const parsedMeta = normalizeCacheMeta(candidate.meta, schemaVersion);
  const dirty = schemaVersion !== TASK_INDEX_SCHEMA_VERSION || parsedMeta.corrupt === true;
  return {
    tasks: tasksFromObject,
    meta: parsedMeta,
    dirty
  };
}

function normalizeStoredTask(task: TaskItem): TaskItem {
  const normalizedTitle = typeof task.title === "string" && task.title.trim()
    ? task.title.trim()
    : fallbackTaskTitle(task);
  return {
    ...task,
    title: normalizedTitle,
    createdAt: task.createdAt || task.updatedAt || new Date().toISOString(),
    taskRevision: Number.isFinite(task.taskRevision) ? task.taskRevision : parseRevisionFallback(task),
    taskLastEditedAt: task.taskLastEditedAt || task.updatedAt || task.createdAt,
    taskLastEditedBy: task.taskLastEditedBy || undefined,
    taskLastOpId: task.taskLastOpId || undefined,
    docUpdated: task.docUpdated || task.updatedAt
  };
}

function parseRevisionFallback(task: Partial<TaskItem>): number {
  const fromUnknown = Number((task as any).taskRevision);
  if (Number.isFinite(fromUnknown)) {
    return Math.max(0, Math.floor(fromUnknown));
  }
  return 0;
}

function normalizeSettings(settings: TaskSettings): TaskSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    collaborationMode: settings.collaborationMode || "strict",
    pageConfigs: {
      ...settings.pageConfigs,
      table: normalizeTablePageConfig(settings.pageConfigs?.table),
      completed: normalizeCompletedPageConfig(settings.pageConfigs?.completed)
    }
  };
}

function normalizeLocalPreferences(
  prefs?: TaskLocalPreferences,
  legacySettings?: TaskSettings
): TaskLocalPreferences {
  const fallback = legacySettings || {};
  return {
    tableColumnWidths: normalizeColumnWidths(
      (prefs?.tableColumnWidths || fallback.tableColumnWidths) as Partial<Record<TableColumnKey, number>> | undefined
    ),
    completedTableColumnWidths: normalizeColumnWidths(
      (prefs?.completedTableColumnWidths || fallback.completedTableColumnWidths) as Partial<Record<TableColumnKey, number>> | undefined
    ),
    pageConfigs: {
      table: normalizeTablePageConfig(prefs?.pageConfigs?.table || fallback.pageConfigs?.table),
      completed: normalizeCompletedPageConfig(prefs?.pageConfigs?.completed || fallback.pageConfigs?.completed)
    }
  };
}

function normalizeColumnWidths(raw?: Partial<Record<TableColumnKey, number>>): Partial<Record<TableColumnKey, number>> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const next: Partial<Record<TableColumnKey, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) {
      next[key as TableColumnKey] = Math.round(width);
    }
  }
  return Object.keys(next).length ? next : undefined;
}

function shouldMigrateLegacyLocalPrefs(settings: TaskSettings, prefs: TaskLocalPreferences): boolean {
  const hasLegacy = Boolean(settings.tableColumnWidths || settings.completedTableColumnWidths || settings.pageConfigs?.table || settings.pageConfigs?.completed);
  if (!hasLegacy) {
    return false;
  }
  return Boolean(prefs.tableColumnWidths || prefs.completedTableColumnWidths || prefs.pageConfigs?.table || prefs.pageConfigs?.completed);
}

function normalizeCacheMeta(raw?: unknown, schemaVersion?: number): TaskIndexMeta {
  if (!raw || typeof raw !== "object") {
    return {
      ...defaultCacheMeta(),
      schemaVersion: schemaVersion || TASK_INDEX_SCHEMA_VERSION
    };
  }
  const input = raw as Partial<TaskIndexMeta>;
  return {
    schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : (schemaVersion || TASK_INDEX_SCHEMA_VERSION),
    builtAt: typeof input.builtAt === "string" && input.builtAt ? input.builtAt : new Date(0).toISOString(),
    lastRootDocId: input.lastRootDocId,
    lastRootPath: input.lastRootPath,
    lastDocUpdatedMax: input.lastDocUpdatedMax,
    corrupt: Boolean(input.corrupt)
  };
}

function defaultCacheMeta(): TaskIndexMeta {
  return {
    schemaVersion: TASK_INDEX_SCHEMA_VERSION,
    builtAt: new Date(0).toISOString(),
    corrupt: false
  };
}

function normalizeTablePageConfig(raw?: TablePageConfig): TablePageConfig {
  const visibleColumns = normalizeVisibleColumns(raw?.visibleColumns);
  const columnOrder = normalizeColumnOrder(raw?.columnOrder);
  return {
    visibleColumns,
    columnOrder,
    currentSort: normalizeSortSpec(raw?.currentSort) || { ...DEFAULT_TABLE_SORT },
    defaultSort: normalizeDefaultSort(raw?.defaultSort)
  };
}

function normalizeVisibleColumns(columns?: TablePageColumnKey[]): TablePageColumnKey[] {
  const configured = Array.isArray(columns)
    ? columns.filter((column): column is TablePageColumnKey => TABLE_PAGE_COLUMNS.includes(column))
    : [];
  const unique = Array.from(new Set(configured));
  return unique.length ? unique : [...DEFAULT_TABLE_PAGE_COLUMNS];
}

function normalizeColumnOrder(columns?: TablePageColumnKey[]): TablePageColumnKey[] {
  const configured = Array.isArray(columns)
    ? columns.filter((column): column is TablePageColumnKey => TABLE_PAGE_COLUMNS.includes(column))
    : [];
  const unique = Array.from(new Set(configured));
  for (const column of DEFAULT_TABLE_PAGE_COLUMNS) {
    if (!unique.includes(column)) {
      unique.push(column);
    }
  }
  return unique;
}

function normalizeSortSpec(raw?: TableSortSpec): TableSortSpec | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  if (raw.column === "default") {
    return { column: "default" };
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
  if (columns.includes("planStart")) {
    return columns;
  }
  const createdAtIndex = columns.indexOf("createdAt");
  const completedAtIndex = columns.indexOf("completedAt");
  if (createdAtIndex >= 0 && completedAtIndex > createdAtIndex) {
    const result = [...columns];
    result.splice(createdAtIndex + 1, 0, "planStart");
    return result;
  }
  return [...columns, "planStart"];
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

class WebStorageLocalPreferenceStore implements LocalPreferenceStore {
  constructor(private key: string, private storage: Storage) {}

  load(): TaskLocalPreferences | undefined {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) {
        return undefined;
      }
      const parsed = JSON.parse(raw) as { version?: number; data?: TaskLocalPreferences };
      if (!parsed || typeof parsed !== "object" || !parsed.data) {
        return undefined;
      }
      return parsed.data;
    } catch {
      return undefined;
    }
  }

  save(value: TaskLocalPreferences): void {
    try {
      this.storage.setItem(this.key, JSON.stringify({
        version: LOCAL_PREFS_VERSION,
        data: value
      }));
    } catch {
      // ignore
    }
  }
}

class MemoryLocalPreferenceStore implements LocalPreferenceStore {
  private data?: TaskLocalPreferences;

  load(): TaskLocalPreferences | undefined {
    return this.data;
  }

  save(value: TaskLocalPreferences): void {
    this.data = value;
  }
}

function createLocalPreferenceStore(pluginName: string): LocalPreferenceStore {
  const key = `task-tracker-local-preferences:${pluginName}`;
  if (typeof window !== "undefined") {
    const localStorageStore = getStorageSafe(() => window.localStorage);
    if (localStorageStore) {
      return new WebStorageLocalPreferenceStore(key, localStorageStore);
    }
    const sessionStorageStore = getStorageSafe(() => window.sessionStorage);
    if (sessionStorageStore) {
      return new WebStorageLocalPreferenceStore(key, sessionStorageStore);
    }
  }
  return new MemoryLocalPreferenceStore();
}

function getStorageSafe(factory: () => Storage): Storage | undefined {
  try {
    const storage = factory();
    const testKey = "__task_tracker_pref_probe__";
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return storage;
  } catch {
    return undefined;
  }
}

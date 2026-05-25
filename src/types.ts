export type TaskStatus = "todo" | "doing" | "waiting" | "completed" | "cancelled";

export type TaskPriority = "none" | "low" | "medium" | "high";

/** Centralized badge color configuration for each status — Badge + Popover dropdowns. */
export interface StatusBadgeConfig {
  label: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  dotColor: string;
}

export const STATUS_BADGE_CONFIG: Record<TaskStatus, StatusBadgeConfig> = {
  todo:       { label: "待处理", textColor: "#C2410C", bgColor: "#FFF7ED", borderColor: "#FED7AA", dotColor: "#F97316" },
  doing:      { label: "进行中", textColor: "#1D4ED8", bgColor: "#EFF6FF", borderColor: "#BFDBFE", dotColor: "#2563EB" },
  waiting:    { label: "等待中", textColor: "#6D28D9", bgColor: "#F5F3FF", borderColor: "#DDD6FE", dotColor: "#8B5CF6" },
  completed:  { label: "已完成", textColor: "#15803D", bgColor: "#F0FDF4", borderColor: "#BBF7D0", dotColor: "#16A34A" },
  cancelled:  { label: "已取消", textColor: "#475569", bgColor: "#F8FAFC", borderColor: "#CBD5E1", dotColor: "#94A3B8" }
};

/** Centralized badge color configuration for each priority — Badge + Popover dropdowns. */
export interface PriorityBadgeConfig {
  label: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  iconColor: string;
}

export const PRIORITY_BADGE_CONFIG: Record<TaskPriority, PriorityBadgeConfig> = {
  high:    { label: "高", textColor: "#DC2626", bgColor: "#FEF2F2", borderColor: "#FECACA", iconColor: "#EF4444" },
  medium:  { label: "中", textColor: "#D97706", bgColor: "#FFFBEB", borderColor: "#FDE68A", iconColor: "#F59E0B" },
  low:     { label: "低", textColor: "#2563EB", bgColor: "#EFF6FF", borderColor: "#BFDBFE", iconColor: "#3B82F6" },
  none:    { label: "无", textColor: "#64748B", bgColor: "#F8FAFC", borderColor: "#CBD5E1", iconColor: "#94A3B8" }
};

/** Kept for backward compat — maps status to textColor/bgColor for older views. */
export const TASK_STATUS_COLORS: Record<TaskStatus, { label: string; textColor: string; bgColor: string }> = {
  todo:       { label: "待处理", textColor: STATUS_BADGE_CONFIG.todo.textColor, bgColor: STATUS_BADGE_CONFIG.todo.bgColor },
  doing:      { label: "进行中", textColor: STATUS_BADGE_CONFIG.doing.textColor, bgColor: STATUS_BADGE_CONFIG.doing.bgColor },
  waiting:    { label: "等待中", textColor: STATUS_BADGE_CONFIG.waiting.textColor, bgColor: STATUS_BADGE_CONFIG.waiting.bgColor },
  completed:  { label: "已完成", textColor: STATUS_BADGE_CONFIG.completed.textColor, bgColor: STATUS_BADGE_CONFIG.completed.bgColor },
  cancelled:  { label: "已取消", textColor: STATUS_BADGE_CONFIG.cancelled.textColor, bgColor: STATUS_BADGE_CONFIG.cancelled.bgColor }
};

export interface StatusFilterOption {
  key: "all" | TaskStatus;
  label: string;
  statusFilter?: TaskStatus; // which status value this pill filters to
}

export const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { key: "all", label: "全部任务" },
  { key: "todo", label: "待处理", statusFilter: "todo" },
  { key: "doing", label: "进行中", statusFilter: "doing" },
  { key: "completed", label: "已完成", statusFilter: "completed" }
];

export interface TaskItem {
  id: string;
  title: string;
  docId: string;
  notebookId: string;
  path: string;
  parentId?: string;
  sourceBlockId?: string;
  sourceDocId?: string;
  sourceText?: string;
  project?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string;
  planStart?: string;
  planEnd?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  description?: string;
}

export type TableColumnKey = "task" | "project" | "source" | "createdAt" | "status" | "priority" | "plan" | "due" | "actions" | "planStart" | "completedAt";

export type TablePageColumnKey = "task" | "project" | "source" | "createdAt" | "status" | "priority" | "plan" | "due";

export type CompletedPageColumnKey = "task" | "project" | "source" | "createdAt" | "planStart" | "completedAt";

export type SortDirection = "asc" | "desc";

export type TableSortColumn = TablePageColumnKey;

export type CompletedSortColumn = CompletedPageColumnKey;

export interface TableSortSpec {
  column: TableSortColumn | "default";
  direction?: SortDirection;
}

export interface CompletedSortSpec {
  column: CompletedSortColumn | "default";
  direction?: SortDirection;
}

export interface TablePageConfig {
  visibleColumns?: TablePageColumnKey[];
  columnOrder?: TablePageColumnKey[];
  currentSort?: TableSortSpec;
  defaultSort?: {
    column: TableSortColumn;
    direction: SortDirection;
  };
}

export interface CompletedPageConfig {
  visibleColumns?: CompletedPageColumnKey[];
  columnOrder?: CompletedPageColumnKey[];
  currentSort?: CompletedSortSpec;
  defaultSort?: {
    column: CompletedSortColumn;
    direction: SortDirection;
  };
}

export interface TaskSettings {
  taskRootDocId?: string;
  taskRootNotebookId?: string;
  taskRootPath?: string;
  taskRootHPath?: string;
  taskRootTitle?: string;
  taskRootSource?: "manual" | "auto";
  defaultProject?: string;
  taskTemplate?: string;
  tableColumnWidths?: Partial<Record<TableColumnKey, number>>;
  completedTableColumnWidths?: Partial<Record<TableColumnKey, number>>;
  pageConfigs?: {
    table?: TablePageConfig;
    completed?: CompletedPageConfig;
  };
  startupSyncGraceMs?: number;
}

export interface TaskCreateInput {
  title: string;
  parentId?: string;
  sourceBlockId?: string;
  sourceDocId?: string;
  sourceText?: string;
  project?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string;
  planStart?: string;
  planEnd?: string;
  createdAt?: string;
  completedAt?: string;
  description?: string;
  detail?: string;
}

export interface SourceContext {
  blockId?: string;
  docId?: string;
  text?: string;
}

export interface BlockRow {
  id: string;
  box: string;
  path: string;
  content?: string;
  fcontent?: string;
  markdown?: string;
  root_id?: string;
  type?: string;
  hpath?: string;
  updated?: string;
}

export const TASKS_DATA_FILE = "tasks.json";
export const SETTINGS_DATA_FILE = "settings.json";

export const DEFAULT_SETTINGS: TaskSettings = {};

export const DEFAULT_TASK_TEMPLATE = `# {{title}}

## 任务概要

| 项目 | 状态 | 来源 | 优先级 | 创建时间 | 截止时间 | 计划时间 |
| --- | --- | --- | --- | --- | --- | --- |
| {{project}} | {{status}} | {{source}} | {{priority}} | {{createdAt}} | {{dueDate}} | {{planStart}} |

**父任务** ：{{parent}}
**子任务** ：{{childTasks}}
**任务描述** ：{{description}}

---

## 目标


## 背景


## 分析与拆解


## 推进记录


## 结果与复盘

`;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待处理",
  doing: "进行中",
  waiting: "等待中",
  completed: "已完成",
  cancelled: "已取消"
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高"
};

export const ACTIVE_TASK_STATUSES: TaskStatus[] = ["todo", "doing", "waiting"];

export const TASK_ATTRS = {
  id: "custom-task-tracker-id",
  status: "custom-task-tracker-status",
  priority: "custom-task-tracker-priority",
  project: "custom-task-tracker-project",
  dueDate: "custom-task-tracker-due",
  planStart: "custom-task-tracker-plan-start",
  planEnd: "custom-task-tracker-plan-end",
  createdAt: "custom-task-tracker-created-at",
  completedAt: "custom-task-tracker-completed-at",
  parentId: "custom-task-tracker-parent",
  sourceBlockId: "custom-task-tracker-source",
  sourceDocId: "custom-task-tracker-source-doc",
  sourceText: "custom-task-tracker-source-text",
  description: "custom-task-tracker-description"
} as const;

export const ROOT_ATTRS = {
  active: "custom-task-tracker-root",
  updatedAt: "custom-task-tracker-root-updated-at"
} as const;

export const REPORT_ATTRS = {
  kind: "custom-task-tracker-doc-kind"
} as const;

export const WEEKLY_REPORT_KIND = "weekly-report";

export const SOURCE_TASK_IDS_ATTR = "custom-task-tracker-task-ids";

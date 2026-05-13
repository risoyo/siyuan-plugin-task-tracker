export type TaskStatus = "todo" | "doing" | "waiting" | "completed" | "cancelled";

export type TaskPriority = "none" | "low" | "medium" | "high";

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
}

export type TableColumnKey = "task" | "project" | "source" | "createdAt" | "status" | "priority" | "plan" | "due" | "actions" | "completedAt";

export type TablePageColumnKey = "task" | "project" | "source" | "createdAt" | "status" | "priority" | "plan" | "due";

export type SortDirection = "asc" | "desc";

export type TableSortColumn = TablePageColumnKey;

export interface TableSortSpec {
  column: TableSortColumn | "default";
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

export interface TaskSettings {
  taskRootDocId?: string;
  taskRootNotebookId?: string;
  taskRootPath?: string;
  taskRootHPath?: string;
  taskRootTitle?: string;
  defaultProject?: string;
  taskTemplate?: string;
  tableColumnWidths?: Partial<Record<TableColumnKey, number>>;
  completedTableColumnWidths?: Partial<Record<TableColumnKey, number>>;
  pageConfigs?: {
    table?: TablePageConfig;
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

> 来源：{{source}}
> 父任务：{{parent}}
> 项目：{{project}}
> 状态：{{status}}
> 优先级：{{priority}}
> 创建时间：{{createdAt}}
> 截止时间：{{dueDate}}
> 计划时间：{{planStart}}
> 子任务：{{childTasks}}

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
  sourceText: "custom-task-tracker-source-text"
} as const;

export const SOURCE_TASK_IDS_ATTR = "custom-task-tracker-task-ids";

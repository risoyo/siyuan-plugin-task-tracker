import { Dialog, showMessage } from "siyuan";
import {
  addMonths,
  formatCompletedWeekLabel,
  formatDateKey,
  formatHumanDate,
  formatHumanDatetimeOrEmpty,
  formatHumanDatetimeWithWeekday,
  formatLocalDateTimeOrEmpty,
  formatMonthDay,
  formatWeekRangeCompact,
  mergeDateInputWithExisting,
  monthStart,
  monthTitle,
  sameMonth,
  startOfWeek,
  toDateKey,
  weekKey
} from "../date";
import type { TaskService } from "../document";
import { escapeHtml } from "../dialogs/TaskDialog";
import { latestProgressRecordSummary } from "../progressRecords";
import {
  getActiveTaskStatuses,
  getAllOrderedStatuses,
  getKanbanStatuses,
  getStatusBadgeConfig,
  getStatusFilterOptions,
  getStatusLabel,
  isCancelledTaskStatus,
  isCompletedTaskStatus,
  isProtectedStatus,
  STATUS_COLOR_PRESET_OPTIONS,
  normalizeStatusOptions
} from "../statusConfig";
import { openLocalFolderPath, supportsLocalFolderOpen } from "../localPath";
import { compareOptionalDates, compareTasksByColumn, sortTaskTree } from "../taskSort";
import {
  PRIORITY_BADGE_CONFIG,
  TASK_PRIORITY_LABELS,
  type StatusColorPreset,
  type CompletedPageColumnKey,
  type CompletedPageConfig,
  type CompletedSortColumn,
  type CompletedSortSpec,
  type SortDirection,
  type TableColumnKey,
  type TablePageColumnKey,
  type TablePageConfig,
  type TableSortColumn,
  type TableSortSpec,
  type TaskItem,
  type TaskPriority,
  type TaskSettings,
  type TaskStatus,
  type TaskStatusOption
} from "../types";

export type TaskManagerView = "table" | "list" | "timeline" | "kanban" | "calendar" | "completed";

export interface TaskManagerNewTaskOptions {
  parentId?: string;
  presetPlanDate?: string;
}

export interface TaskManagerTabActions {
  newTask: (options?: TaskManagerNewTaskOptions) => void;
  createSubtask: (parentId: string) => void;
  editTask: (task: TaskItem) => void;
  openTask: (task: TaskItem) => void;
  openSourceDoc?: (docId: string) => void;
  sync?: () => Promise<unknown> | unknown;
}

interface TaskManagerTabData {
  view?: TaskManagerView;
  month?: string;
  search?: string;
}

interface CompletedGroup {
  key: string;
  label: string;
  tasks: TaskItem[];
  tree: TaskTreeNode[];
}

interface TableConfigDialogState {
  visibleColumns: TablePageColumnKey[];
  columnOrder: TablePageColumnKey[];
  currentSort: TableSortSpec;
  defaultSort?: {
    column: TableSortColumn;
    direction: SortDirection;
  };
}

interface CompletedConfigDialogState {
  visibleColumns: CompletedPageColumnKey[];
  columnOrder: CompletedPageColumnKey[];
  currentSort: CompletedSortSpec;
  defaultSort?: {
    column: CompletedSortColumn;
    direction: SortDirection;
  };
}

type SettingsDialogPage = "table" | "completed";
type SettingsDialogTab = "fields" | "sorting" | "status" | "priority";

interface StatusMigrationDraft {
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  taskCount: number;
}

interface SettingsDialogState {
  page: SettingsDialogPage;
  activeTab: SettingsDialogTab;
  table: TableConfigDialogState;
  completed: CompletedConfigDialogState;
  statusOptions: TaskStatusOption[];
  migrations: StatusMigrationDraft[];
}

interface TaskTreeNode {
  task: TaskItem;
  children: TaskTreeNode[];
  contextOnly: boolean;
}

interface TableColumnDef {
  key: TableColumnKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
  className?: string;
}

interface RowActionOptions {
  compact?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  deleteOnly?: boolean;
  completedView?: boolean;
}

const VIEWS: Array<{ value: TaskManagerView; label: string }> = [
  { value: "table", label: "表格" },
  { value: "list", label: "清单" },
  { value: "timeline", label: "时间轴" },
  { value: "kanban", label: "看板" },
  { value: "calendar", label: "日历" },
  { value: "completed", label: "已完成" }
];

const VIEW_ICONS: Partial<Record<TaskManagerView, string>> = {
  table: "iconTaskManagerTable",
  list: "iconTaskManagerList",
  timeline: "iconTaskManagerTimeline",
  kanban: "iconTaskManagerKanban",
  calendar: "iconCalendar",
  completed: "iconSelect"
};

const FREEZE_FIRST_COLUMN_STORAGE_KEY = "task-tracker-table-freeze-first-column";

const TABLE_COLUMNS: TableColumnDef[] = [
  { key: "task", label: "任务", defaultWidth: 320, minWidth: 220, className: "is-task" },
  { key: "project", label: "项目", defaultWidth: 140, minWidth: 110 },
  { key: "status", label: "状态", defaultWidth: 120, minWidth: 96 },
  { key: "priority", label: "优先级", defaultWidth: 120, minWidth: 96 },
  { key: "latest", label: "任务近况", defaultWidth: 320, minWidth: 140, className: "is-latest" },
  { key: "progress", label: "推进记录", defaultWidth: 260, minWidth: 140, className: "is-progress" },
  { key: "createdAt", label: "创建时间", defaultWidth: 132, minWidth: 112 },
  { key: "plan", label: "计划时间", defaultWidth: 144, minWidth: 124 },
  { key: "due", label: "截止", defaultWidth: 144, minWidth: 124 },
  { key: "source", label: "来源", defaultWidth: 170, minWidth: 130 },
  { key: "actions", label: "操作", defaultWidth: 96, minWidth: 84, className: "is-actions" }
];

const TABLE_PAGE_COLUMNS: TablePageColumnKey[] = ["task", "project", "status", "priority", "latest", "progress", "createdAt", "plan", "due", "source"];
const TABLE_SORT_OPTIONS: Array<{ value: TableSortColumn | "default"; label: string }> = [
  { value: "default", label: "默认" },
  { value: "task", label: "任务" },
  { value: "project", label: "项目" },
  { value: "status", label: "状态" },
  { value: "priority", label: "优先级" },
  { value: "latest", label: "任务近况" },
  { value: "progress", label: "推进记录" },
  { value: "createdAt", label: "创建时间" },
  { value: "plan", label: "计划时间" },
  { value: "due", label: "截止" },
  { value: "source", label: "来源" }
];
const SORT_DIRECTIONS: Array<{ value: SortDirection; label: string }> = [
  { value: "asc", label: "正序" },
  { value: "desc", label: "倒序" }
];

const COMPLETED_TABLE_COLUMNS: TableColumnDef[] = [
  { key: "task", label: "任务", defaultWidth: 280, minWidth: 140, className: "is-task" },
  { key: "project", label: "项目", defaultWidth: 130, minWidth: 80 },
  { key: "latest", label: "任务近况", defaultWidth: 300, minWidth: 130, className: "is-latest" },
  { key: "progress", label: "推进记录", defaultWidth: 260, minWidth: 140, className: "is-progress" },
  { key: "source", label: "来源", defaultWidth: 150, minWidth: 80 },
  { key: "createdAt", label: "创建时间", defaultWidth: 132, minWidth: 100 },
  { key: "planStart", label: "计划开始", defaultWidth: 132, minWidth: 100 },
  { key: "completedAt", label: "完成时间", defaultWidth: 132, minWidth: 100 },
  { key: "actions", label: "操作", defaultWidth: 84, minWidth: 72, className: "is-actions" }
];

const COMPLETED_PAGE_COLUMNS: CompletedPageColumnKey[] = ["task", "project", "latest", "progress", "source", "createdAt", "planStart", "completedAt"];
const COMPLETED_SORT_OPTIONS: Array<{ value: CompletedSortColumn | "default"; label: string }> = [
  { value: "default", label: "默认" },
  { value: "task", label: "任务" },
  { value: "project", label: "项目" },
  { value: "latest", label: "任务近况" },
  { value: "progress", label: "推进记录" },
  { value: "source", label: "来源" },
  { value: "createdAt", label: "创建时间" },
  { value: "planStart", label: "计划开始" },
  { value: "completedAt", label: "完成时间" }
];

export class TaskManagerTab {
  private view: TaskManagerView = "table";
  private search = "";
  private viewFilters = new Map<TaskManagerView, "all" | TaskStatus>();
  private statusDropdownOpen = false;
  private bulkParentMenuOpen = false;
  private activePopover: { taskId: string; field: "status" | "priority" } | null = null;
  private activePopoverCleanup?: () => void;
  private month = monthStart(new Date());
  private calendarMode: "month" | "week" = "month";
  private weekStart = startOfWeek(new Date());
  private collapsedTaskIds = new Set<string>();
  private expandedCompletedGroups = new Set<string>();
  private completedGroupStateInitialized = false;
  private calendarUnplannedVisible = false;
  private expandedCalendarDateKeys = new Set<string>();
  private isComposingSearch = false;
  private freezeFirstColumn = false;
  private initialCollapsedParentsApplied = false;
  private tableColumnWidths: Record<TableColumnKey, number> = defaultTableColumnWidths(TABLE_COLUMNS);
  private completedTableColumnWidths: Record<TableColumnKey, number> = defaultTableColumnWidths(COMPLETED_TABLE_COLUMNS);
  private resizeCleanup?: () => void;
  private pendingTableScrollRestore?: { bodyTop: number; bodyLeft: number; wrapTop: number; wrapLeft: number };
  private pendingTableFocusTaskId?: string;
  private readonly compositionStartListener = (event: CompositionEvent) => this.handleCompositionStart(event);
  private readonly compositionEndListener = (event: CompositionEvent) => this.handleCompositionEnd(event);
  private unsubscribe?: () => void;

  constructor(
    private container: HTMLElement,
    private service: TaskService,
    private actions: TaskManagerTabActions,
    data?: TaskManagerTabData
  ) {
    if (data?.view && VIEWS.some((view) => view.value === data.view)) {
      this.view = data.view;
    }
    if (data?.search) {
      this.search = data.search;
    }
    if (data?.month) {
      const date = new Date(`${data.month}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
      }
    }
    this.freezeFirstColumn = readFreezeFirstColumnState();
    const settings = this.service.store.getSettings();
    this.tableColumnWidths = normalizeTableColumnWidths(TABLE_COLUMNS, settings.tableColumnWidths);
    this.completedTableColumnWidths = normalizeTableColumnWidths(COMPLETED_TABLE_COLUMNS, settings.completedTableColumnWidths);
    this.unsubscribe = this.service.onChange(() => this.render({ preserveTableScroll: true }));
  }

  destroy(): void {
    this.unsubscribe?.();
    this.resizeCleanup?.();
    this.container.onclick = null;
    this.container.onchange = null;
    this.container.oninput = null;
    this.container.onkeydown = null;
    this.container.onpointerdown = null;
    this.container.removeEventListener("compositionstart", this.compositionStartListener);
    this.container.removeEventListener("compositionend", this.compositionEndListener);
  }

  render(options: { preserveTableScroll?: boolean } = {}): void {
    if (options.preserveTableScroll) {
      this.captureTableScrollPosition();
    } else {
      this.pendingTableScrollRestore = undefined;
    }

    this.ensureInitialCollapsedParents();
    const tasks = this.tasksForCurrentView();

    this.container.innerHTML = `<div class="task-manager task-manager--${this.view}">
  ${this.renderToolbar(tasks)}
  <div class="task-manager__body">
    ${tasks.length ? this.renderCurrentView(tasks) : `<div class="task-manager-empty">这里暂时没有匹配任务。</div>`}
  </div>
</div>`;

    this.bind();
    this.restoreTableScrollPosition();
  }

  private captureTableScrollPosition(): void {
    const body = this.container.querySelector<HTMLElement>(".task-manager__body");
    const wrap = this.container.querySelector<HTMLElement>(".task-manager-table-wrap");
    if (!body && !wrap) {
      this.pendingTableScrollRestore = undefined;
      return;
    }
    this.pendingTableScrollRestore = {
      bodyTop: body?.scrollTop || 0,
      bodyLeft: body?.scrollLeft || 0,
      wrapTop: wrap?.scrollTop || 0,
      wrapLeft: wrap?.scrollLeft || 0
    };
  }

  private restoreTableScrollPosition(): void {
    const body = this.container.querySelector<HTMLElement>(".task-manager__body");
    const wrap = this.container.querySelector<HTMLElement>(".task-manager-table-wrap");
    if (body && this.pendingTableScrollRestore) {
      body.scrollTop = this.pendingTableScrollRestore.bodyTop;
      body.scrollLeft = this.pendingTableScrollRestore.bodyLeft;
    }
    if (wrap && this.pendingTableScrollRestore) {
      wrap.scrollTop = this.pendingTableScrollRestore.wrapTop;
      wrap.scrollLeft = this.pendingTableScrollRestore.wrapLeft;
    }
    if (this.pendingTableFocusTaskId) {
      const row = this.container.querySelector<HTMLElement>(`.task-manager-table__row[data-task-id="${this.pendingTableFocusTaskId}"]`);
      row?.scrollIntoView({ block: "nearest", inline: "nearest" });
      this.pendingTableFocusTaskId = undefined;
    }
    this.pendingTableScrollRestore = undefined;
  }

  private renderToolbar(tasks: TaskItem[]): string {
    const totalCount = this.view === "completed"
      ? this.service.store.all().filter((t) => isCompletedTaskStatus(t.status)).length
      : this.service.store.all().filter((t) => !isCompletedTaskStatus(t.status)).length;

    return `<div class="task-manager-toolbar">
  <div class="task-manager-toolbar__header">
    <div class="task-manager-toolbar__title">
      <svg class="task-manager-toolbar__icon"><use xlink:href="#iconTaskTracker"></use></svg>
      <span>任务控制面板</span>
      <small class="task-manager-toolbar__badge">${totalCount}</small>
    </div>
    <div class="task-manager-toolbar__actions">
      <label class="task-manager-toolbar__search">
        <svg><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-text-field" data-field="search" value="${escapeAttr(this.search)}" placeholder="搜索任务、项目或关键词" />
      </label>
      <button class="block__icon ariaLabel" data-action="sync" aria-label="同步任务文档" data-position="south"><svg><use xlink:href="#iconRefresh"></use></svg></button>
      <button class="task-manager-btn-primary" data-action="new-task"><svg><use xlink:href="#iconAdd"></use></svg><span>新建任务</span></button>
    </div>
  </div>
  ${this.renderViewSwitch(tasks)}
</div>`;
  }

  private get currentFilter(): "all" | TaskStatus {
    return this.viewFilters.get(this.view) || "all";
  }

  private renderViewSwitch(tasks: TaskItem[]): string {
    const supportsPageSettings = this.view === "table" || this.view === "completed";
    const isCompletedView = this.view === "completed";
    const filter = this.currentFilter;
    const filterActive = filter !== "all";
    const filterOptions = getStatusFilterOptions(this.service.store.getSettings());
    const filterLabel = filterActive
      ? (filterOptions.find((option) => option.key === filter)?.label || getStatusLabel(filter, this.service.store.getSettings()))
      : "全部任务";
    const filterBtnClass = filterActive ? "task-manager-filter-btn task-manager-filter-all-btn is-filtering" : "task-manager-filter-btn task-manager-filter-all-btn";
    const tableParentTaskIds = this.view === "table" ? this.parentTaskIdsForTasks(tasks) : [];

    const dropdownHtml = isCompletedView ? "" : `
    <div class="task-manager-filter-dropdown">
      <button class="${filterBtnClass}" data-action="toggle-status-dropdown" aria-haspopup="listbox" aria-expanded="${this.statusDropdownOpen}">
        <span class="task-manager-filter-btn__label">${filterLabel}</span>
        <svg class="task-manager-filter-btn__arrow" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      ${this.statusDropdownOpen ? `<div class="task-manager-filter-dropdown__menu" role="listbox">
        ${filterOptions.map((option) => {
          const selected = filter === option.key;
          return `<button class="task-manager-filter-dropdown__item ${selected ? "is-selected" : ""}" data-action="select-status-filter" data-status-key="${option.key}" role="option" aria-selected="${selected}">
            <span>${option.label}</span>
            ${selected ? `<svg class="task-manager-filter-dropdown__check"><use xlink:href="#iconSelect"></use></svg>` : ""}
          </button>`;
        }).join("")}
      </div>` : ""}
  </div>`;

    return `<div class="task-manager-view-switch" role="tablist" aria-label="任务视图">
  <div class="task-manager-view-switch__left">
    ${VIEWS.map((view) => {
      const active = this.view === view.value;
      const icon = VIEW_ICONS[view.value] || "";
      return `<button class="task-manager-view-switch__btn ${active ? "is-active" : ""}" data-manager-view="${view.value}" aria-label="${view.label}" role="tab" aria-selected="${active}">
        ${icon ? `<svg><use xlink:href="#${icon}"></use></svg>` : ""}
        <span>${view.label}</span>
      </button>`;
    }).join("")}
  </div>
  <div class="task-manager-view-switch__right">
    ${this.view === "table" ? this.renderBulkParentMenu(tableParentTaskIds.length === 0) : ""}
    ${supportsPageSettings ? `<button class="task-icon-btn task-icon-btn--settings task-manager-settings-btn" data-action="open-page-config" type="button" aria-label="页面设置" title="页面设置">${renderControlsIcon()}</button>` : ""}
    ${dropdownHtml}
  </div>
</div>`;
  }

  private renderBulkParentMenu(disabled: boolean): string {
    return `<div class="task-manager-bulk-parent-dropdown">
      <button
        class="task-icon-btn task-icon-btn--toggle-tree task-manager-bulk-parent-btn"
        data-action="toggle-parent-bulk-menu"
        type="button"
        aria-label="一键展开/收缩所有父任务"
        title="一键展开/收缩所有父任务"
        data-position="south"
        ${disabled ? "disabled" : ""}
      >
        ${renderBulkParentIcon("entry")}
      </button>
      ${this.bulkParentMenuOpen && !disabled ? `<div class="task-manager-bulk-parent-dropdown__menu" role="menu">
        <button class="task-manager-bulk-parent-dropdown__item" data-action="expand-all-parents" role="menuitem" type="button">
          <span class="task-manager-bulk-parent-dropdown__item-icon">${renderBulkParentIcon("expand")}</span>
          <span>展开所有父任务</span>
        </button>
        <button class="task-manager-bulk-parent-dropdown__item" data-action="collapse-all-parents" role="menuitem" type="button">
          <span class="task-manager-bulk-parent-dropdown__item-icon">${renderBulkParentIcon("collapse")}</span>
          <span>收缩所有父任务</span>
        </button>
      </div>` : ""}
    </div>`;
  }

  private renderCurrentView(tasks: TaskItem[]): string {
    switch (this.view) {
      case "list":
        return this.renderListView(tasks);
      case "timeline":
        return this.renderTimelineView(tasks);
      case "kanban":
        return this.renderKanbanView(tasks);
      case "calendar":
        return this.renderCalendarView(tasks);
      case "completed":
        return this.renderCompletedView(tasks);
      case "table":
      default:
        return this.renderTableView(tasks);
    }
  }

  private renderTableView(tasks: TaskItem[]): string {
    const columns = this.effectiveTableColumns();
    const sortedTasks = this.sortTasksForTable(tasks);
    return this.renderTableLikeView(sortedTasks, columns);
  }

  private renderCompletedView(tasks: TaskItem[]): string {
    const groups = groupCompletedTasksByWeek(tasks);
    this.initializeCompletedGroupState(groups);
    const columns = this.effectiveCompletedTableColumns();
    const tableWidth = this.completedTableWidthWithColumns(columns);

    return `<div class="task-manager-completed-groups">
  ${groups.map((group) => {
    const expanded = this.expandedCompletedGroups.has(group.key);
    return `<section class="task-manager-completed-group">
      <div class="task-manager-completed-group__header">
        <button class="task-manager-completed-group__toggle" data-action="toggle-completed-group" data-group-key="${escapeAttr(group.key)}" aria-expanded="${expanded}" title="${expanded ? "折叠分组" : "展开分组"}" type="button">
          <span class="task-manager-completed-group__header-main">
            <span class="task-manager-completed-group__chevron">${renderChevron(expanded)}</span>
            <span class="task-manager-completed-group__title">${escapeHtml(group.label)}</span>
          </span>
        </button>
        <span class="task-manager-completed-group__header-side">
          <button class="b3-button b3-button--outline task-manager-completed-group__export" data-action="export-completed-group" data-group-key="${escapeAttr(group.key)}" type="button">导出</button>
          <span class="task-manager-completed-group__count">${group.tasks.length}</span>
        </span>
      </div>
      ${expanded ? `<div class="task-manager-completed-group__body">
        <table class="task-manager-table task-manager-completed-table" style="width: ${tableWidth}px; min-width: ${tableWidth}px;">
          <colgroup>
            ${columns.map((column) => `<col style="width: ${this.completedTableColumnWidths[column.key]}px; min-width: ${column.minWidth}px;" />`).join("")}
          </colgroup>
          <thead>
            <tr>
              ${columns.map((column) => this.renderTableHeaderCell(column)).join("")}
            </tr>
          </thead>
          <tbody>
            ${group.tree.map((node, index) => this.renderCompletedTableNode(node, 0, columns, index === group.tree.length - 1)).join("")}
          </tbody>
        </table>
      </div>` : ""}
    </section>`;
  }).join("")}
</div>`;
  }


  private completedTableWidth(): number {
    return COMPLETED_TABLE_COLUMNS.reduce((total, column) => total + this.completedTableColumnWidths[column.key], 0);
  }

  private completedTableWidthWithColumns(columns: TableColumnDef[]): number {
    return columns.reduce((total, column) => total + this.completedTableColumnWidths[column.key], 0);
  }

  private renderCompletedTableNode(node: TaskTreeNode, depth: number, columns: TableColumnDef[], isLastSibling = false): string {
    const task = node.task;
    const childCount = node.children.length;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const hierarchyClass = childCount > 0 ? " task-manager-table__row--parent" : depth > 0 ? " task-manager-table__row--child" : "";
    const lastClass = depth > 0 && isLastSibling ? " is-last-child" : "";
    const row = `<tr class="task-manager-table__row task-manager-status-${task.status} task-manager-priority-${task.priority}${hierarchyClass}${lastClass}" data-task-id="${task.id}" style="${escapeAttr(this.buildTaskStyleVars(task, `--task-depth: ${depth};`))}">
  ${columns.map((column) => this.renderCompletedTableCell(column.key, task, childCount, collapsed)).join("")}
</tr>`;
    const children = childCount && !collapsed
      ? node.children.map((child, index) => this.renderCompletedTableNode(child, depth + 1, columns, index === node.children.length - 1)).join("")
      : "";

    return `${row}${children}`;
  }

  private renderCompletedTableCell(key: TableColumnKey, task: TaskItem, childCount: number, collapsed: boolean): string {
    if (key === "task") {
      const isParent = childCount > 0;
      return `<td class="task-manager-table__cell is-task">
  <div class="task-manager-table__task-cell">
    ${isParent
      ? `<button class="task-manager-task__toggle" data-task-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
      : `<span class="task-manager-task__toggle-placeholder"></span>`}
    <span class="task-manager-table__task-text ${isParent ? "is-parent" : ""}" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</span>
    ${isParent ? `<span class="task-manager-table__child-count">${childCount}</span>` : ""}
  </div>
</td>`;
    }
    if (key === "project") {
      return `<td class="task-manager-table__cell is-project">${this.renderCompletedProjectText(task)}</td>`;
    }
    if (key === "latest") {
      return `<td class="task-manager-table__cell is-latest">${this.renderLatestText(task)}</td>`;
    }
    if (key === "progress") {
      return `<td class="task-manager-table__cell is-progress">${this.renderProgressText(task)}</td>`;
    }
    if (key === "source") {
      return `<td class="task-manager-table__cell is-source">${this.renderCompletedSourceText(task)}</td>`;
    }
    if (key === "createdAt") {
      const display = formatHumanDatetimeWithWeekday(task.createdAt);
      return `<td class="task-manager-table__cell is-time"><span class="task-manager-table__time ${display === "—" ? "is-empty" : ""}" title="${escapeAttr(formatLocalDateTimeOrEmpty(task.createdAt))}">${escapeHtml(display)}</span></td>`;
    }
    if (key === "planStart") {
      const display = formatHumanDatetimeWithWeekday(task.planStart);
      return `<td class="task-manager-table__cell is-time"><span class="task-manager-table__time ${display === "—" ? "is-empty" : ""}" title="${escapeAttr(formatLocalDateTimeOrEmpty(task.planStart))}">${escapeHtml(display)}</span></td>`;
    }
    if (key === "actions") {
      return `<td class="task-manager-table__cell is-actions">${this.renderRowActions(task, { compact: true, completedView: true })}</td>`;
    }
    // completedAt
    const display = formatHumanDatetimeWithWeekday(task.completedAt);
    return `<td class="task-manager-table__cell is-time"><span class="task-manager-table__time ${display === "—" ? "is-empty" : ""}" title="${escapeAttr(formatLocalDateTimeOrEmpty(task.completedAt))}">${escapeHtml(display)}</span></td>`;
  }

  private renderCompletedProjectText(task: TaskItem): string {
    const label = task.project || "无项目";
    const isEmpty = !task.project;
    return `<span class="task-manager-table__text task-manager-table__text--project ${isEmpty ? "is-empty" : ""}" title="${escapeAttr(label)}">${escapeHtml(label)}</span>`;
  }

  private renderCompletedSourceText(task: TaskItem): string {
    return this.renderTableSourceText(task);
  }

  private renderTableLikeView(tasks: TaskItem[], columns: TableColumnDef[]): string {
    const childCounts = countChildren(tasks);
    const matched = new Set(tasks.map((task) => task.id));
    const visible = includeAncestors(tasks, matched);
    const tree = sortTaskTree(buildTaskTree(tasks, visible, matched), this.tableComparator());

    return `<div class="task-manager-table-card ${this.freezeFirstColumn ? "is-freeze-first-column" : ""}">
  <div class="task-manager-table-wrap">
    <table class="task-manager-table">
      <colgroup>
        ${columns.map((column) => `<col style="width: ${this.tableColumnWidths[column.key]}px; min-width: ${column.minWidth}px;" />`).join("")}
      </colgroup>
      <thead>
        <tr>
          ${columns.map((column) => this.renderTableHeaderCell(column)).join("")}
        </tr>
      </thead>
      <tbody>
        ${tree.map((node, index) => this.renderTableNode(node, 0, childCounts, columns, index === tree.length - 1)).join("")}
      </tbody>
    </table>
  </div>
</div>`;
  }

  private renderTableHeaderCell(column: TableColumnDef): string {
    const resizable = column.key !== "actions";
    const freezeButton = column.key === "task" && this.view === "table"
      ? `<button class="task-manager-freeze-btn ${this.freezeFirstColumn ? "is-active" : ""}" data-action="toggle-freeze-first-column" type="button" aria-label="${this.freezeFirstColumn ? "取消冻结任务列" : "冻结任务列"}" title="${this.freezeFirstColumn ? "取消冻结任务列" : "冻结任务列"}">${renderFreezeColumnIcon(this.freezeFirstColumn)}</button>`
      : "";
    return `<th class="task-manager-table__head ${column.className || ""}" data-column-key="${column.key}">
  <div class="task-manager-table__head-content">
    <span>${column.label}</span>
    ${freezeButton}
    ${resizable ? `<button class="task-manager-table__resize-handle" data-column-resize="${column.key}" aria-label="调整${column.label || "操作"}列宽" title="拖动调整列宽"></button>` : ""}
  </div>
</th>`;
  }

  private renderTableNode(node: TaskTreeNode, depth: number, childCounts: Map<string, number>, columns: TableColumnDef[], isLastSibling = false): string {
    const task = node.task;
    const childCount = childCounts.get(task.id) || 0;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const row = this.renderTableRow(node, depth, childCount, collapsed, columns, isLastSibling);
    const children = node.children.length && !collapsed
      ? node.children.map((child, index) => this.renderTableNode(child, depth + 1, childCounts, columns, index === node.children.length - 1)).join("")
      : "";

    return `${row}${children}`;
  }

  private renderTableRow(node: TaskTreeNode, depth: number, childCount: number, collapsed: boolean, columns: TableColumnDef[], isLastSibling = false): string {
    const task = node.task;
    const contextClass = node.contextOnly ? " task-manager-table__row--context" : "";
    const hierarchyClass = childCount > 0 ? " task-manager-table__row--parent" : depth > 0 ? " task-manager-table__row--child" : "";
    const lastClass = depth > 0 && isLastSibling ? " is-last-child" : "";
    return `<tr class="task-manager-table__row task-manager-status-${task.status} task-manager-priority-${task.priority}${hierarchyClass}${lastClass}${contextClass}" data-task-id="${task.id}" style="${escapeAttr(this.buildTaskStyleVars(task, `--task-depth: ${depth};`))}">
  ${columns.map((column) => this.renderTableCell(column.key, task, childCount, collapsed)).join("")}
</tr>`;
  }

  private renderTableCell(key: TableColumnKey, task: TaskItem, childCount: number, collapsed: boolean): string {
    if (key === "task") {
      const isParent = childCount > 0;
      return `<td class="task-manager-table__cell is-task">
  <div class="task-manager-table__task-cell">
    ${isParent
      ? `<button class="task-manager-task__toggle" data-task-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
      : `<span class="task-manager-task__toggle-placeholder"></span>`}
    <span class="task-manager-table__task-text ${isParent ? "is-parent" : ""}" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</span>
    ${isParent ? `<span class="task-manager-table__child-count">${childCount}</span>` : ""}
  </div>
</td>`;
    }
    if (key === "project") {
      return `<td class="task-manager-table__cell is-project">${this.renderTableProjectText(task)}</td>`;
    }
    if (key === "latest") {
      return `<td class="task-manager-table__cell is-latest">${this.renderLatestText(task)}</td>`;
    }
    if (key === "progress") {
      return `<td class="task-manager-table__cell is-progress">${this.renderProgressText(task)}</td>`;
    }
    if (key === "source") {
      return `<td class="task-manager-table__cell is-source">${this.renderTableSourceText(task)}</td>`;
    }
    if (key === "createdAt") {
      const display = formatHumanDatetimeWithWeekday(task.createdAt);
      return `<td class="task-manager-table__cell is-time"><span class="task-manager-table__time ${display === "—" ? "is-empty" : ""}" title="${escapeAttr(formatLocalDateTimeOrEmpty(task.createdAt))}">${escapeHtml(display)}</span></td>`;
    }
    if (key === "status") {
      return `<td class="task-manager-table__cell is-status">${this.renderInlineStatusBadge(task, "table")}</td>`;
    }
    if (key === "priority") {
      return `<td class="task-manager-table__cell is-priority">${this.renderInlinePriorityBadge(task, "table")}</td>`;
    }
    if (key === "plan") {
      const display = formatHumanDatetimeWithWeekday(task.planStart);
      return `<td class="task-manager-table__cell is-time"><span class="task-manager-table__time ${display === "—" ? "is-empty" : ""}" title="${escapeAttr(formatHumanDatetimeOrEmpty(task.planStart))}">${escapeHtml(display)}</span></td>`;
    }
    if (key === "due") {
      const display = formatHumanDatetimeWithWeekday(task.dueDate);
      return `<td class="task-manager-table__cell is-time"><span class="task-manager-table__time ${display === "—" ? "is-empty" : ""}" title="${escapeAttr(formatHumanDatetimeOrEmpty(task.dueDate))}">${escapeHtml(display)}</span></td>`;
    }
    if (key === "completedAt") {
      const display = formatHumanDatetimeWithWeekday(task.completedAt);
      return `<td class="task-manager-table__cell is-time"><span class="task-manager-table__completed-at ${display === "—" ? "is-empty" : ""}" title="${escapeAttr(formatLocalDateTimeOrEmpty(task.completedAt))}">${escapeHtml(display)}</span></td>`;
    }
    return `<td class="task-manager-table__cell is-actions">${this.renderRowActions(task, { compact: true, showEdit: true, showDelete: true })}</td>`;
  }

  private renderTableReadonlyCell(value: string, title?: string): string {
    return `<td class="task-manager-table__cell"><span class="task-manager-table__text task-manager-table__text--plain" title="${escapeAttr(title ?? value)}">${escapeHtml(value)}</span></td>`;
  }

  private effectiveTableColumns(): TableColumnDef[] {
    const config = this.getTablePageConfig();
    const visible = new Set(config.visibleColumns || TABLE_PAGE_COLUMNS);
    const configured = (config.columnOrder || TABLE_PAGE_COLUMNS)
      .map((key) => TABLE_COLUMNS.find((column) => column.key === key))
      .filter((column): column is TableColumnDef => Boolean(column && visible.has(column.key as TablePageColumnKey)));
    const fallback = TABLE_COLUMNS.filter((column) => column.key !== "actions" && visible.has(column.key as TablePageColumnKey));
    const ordered = configured.length ? configured : fallback;
    return [...ordered, ...TABLE_COLUMNS.filter((column) => column.key === "actions")];
  }

  private getTablePageConfig(): TablePageConfig {
    return this.service.store.getSettings().pageConfigs?.table || {
      visibleColumns: [...TABLE_PAGE_COLUMNS],
      columnOrder: [...TABLE_PAGE_COLUMNS],
      currentSort: { column: "default" }
    };
  }

  private async updateTablePageConfig(patch: Partial<TablePageConfig>): Promise<void> {
    const settings = this.service.store.getSettings();
    await this.service.store.setSettings({
      pageConfigs: {
        ...settings.pageConfigs,
        table: {
          ...this.getTablePageConfig(),
          ...patch
        }
      }
    });
  }

  private getCompletedPageConfig(): CompletedPageConfig {
    return this.service.store.getSettings().pageConfigs?.completed || {
      visibleColumns: [...COMPLETED_PAGE_COLUMNS],
      columnOrder: [...COMPLETED_PAGE_COLUMNS],
      currentSort: { column: "default" }
    };
  }

  private async updateCompletedPageConfig(patch: Partial<CompletedPageConfig>): Promise<void> {
    const settings = this.service.store.getSettings();
    await this.service.store.setSettings({
      pageConfigs: {
        ...settings.pageConfigs,
        completed: {
          ...this.getCompletedPageConfig(),
          ...patch
        }
      }
    });
  }

  private effectiveCompletedTableColumns(): TableColumnDef[] {
    const config = this.getCompletedPageConfig();
    const visible = new Set(config.visibleColumns || COMPLETED_PAGE_COLUMNS);
    const configured = (config.columnOrder || COMPLETED_PAGE_COLUMNS)
      .map((key) => COMPLETED_TABLE_COLUMNS.find((column) => column.key === key))
      .filter((column): column is TableColumnDef => Boolean(column && visible.has(column.key as CompletedPageColumnKey)));
    const fallback = COMPLETED_TABLE_COLUMNS.filter((column) => column.key !== "actions" && visible.has(column.key as CompletedPageColumnKey));
    const ordered = configured.length ? configured : fallback;
    return [...ordered, ...COMPLETED_TABLE_COLUMNS.filter((column) => column.key === "actions")];
  }

  private tableConfigDialogState(): TableConfigDialogState {
    const config = this.getTablePageConfig();
    return {
      visibleColumns: [...(config.visibleColumns || TABLE_PAGE_COLUMNS)],
      columnOrder: [...(config.columnOrder || TABLE_PAGE_COLUMNS)],
      currentSort: config.currentSort || { column: "default" },
      defaultSort: config.defaultSort
        ? { ...config.defaultSort }
        : undefined
    };
  }

  private async openTableConfigDialog(): Promise<void> {
    const state = this.tableConfigDialogState();
    const dialog = new Dialog({
      title: "字段 / 排序",
      content: this.renderTableConfigDialog(state),
      width: "520px"
    });

    const content = dialog.element.querySelector<HTMLElement>(".task-manager-config");
    if (!content) {
      return;
    }

    const renderColumns = () => {
      const list = content.querySelector<HTMLElement>("[data-role='column-order']");
      if (!list) {
        return;
      }
      list.innerHTML = state.columnOrder.map((column, index) => {
        const visible = state.visibleColumns.includes(column);
        const label = TABLE_SORT_OPTIONS.find((option) => option.value === column)?.label || column;
        return `<div class="task-manager-config__column-row" data-column="${column}">
  <label class="task-manager-config__column-label">
    <input type="checkbox" data-column-visibility="${column}" ${visible ? "checked" : ""} />
    <span>${label}</span>
  </label>
  <div class="task-manager-config__column-actions">
    <button type="button" class="b3-button b3-button--outline" data-column-move="up" data-column="${column}" ${index === 0 ? "disabled" : ""}>上移</button>
    <button type="button" class="b3-button b3-button--outline" data-column-move="down" data-column="${column}" ${index === state.columnOrder.length - 1 ? "disabled" : ""}>下移</button>
  </div>
</div>`;
      }).join("");
    };

    const sortColumn = content.querySelector<HTMLSelectElement>("[name='sort-column']");
    const sortDirection = content.querySelector<HTMLSelectElement>("[name='sort-direction']");
    const defaultSummary = content.querySelector<HTMLElement>("[data-role='default-sort-summary']");

    const renderDefaultSummary = () => {
      if (!defaultSummary) {
        return;
      }
      if (!state.defaultSort) {
        defaultSummary.textContent = "当前未保存默认排序，将回退系统默认顺序。";
        return;
      }
      const columnLabel = TABLE_SORT_OPTIONS.find((option) => option.value === state.defaultSort?.column)?.label || state.defaultSort.column;
      const directionLabel = SORT_DIRECTIONS.find((option) => option.value === state.defaultSort?.direction)?.label || state.defaultSort.direction;
      defaultSummary.textContent = `已保存默认排序：${columnLabel} / ${directionLabel}`;
    };

    renderColumns();
    renderDefaultSummary();

    content.addEventListener("change", (event) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.dataset.columnVisibility) {
        const column = target.dataset.columnVisibility as TablePageColumnKey;
        if (target.checked) {
          if (!state.visibleColumns.includes(column)) {
            state.visibleColumns.push(column);
          }
        } else {
          state.visibleColumns = state.visibleColumns.filter((item) => item !== column);
        }
        if (!state.visibleColumns.length) {
          state.visibleColumns = ["task"];
        }
        renderColumns();
        return;
      }
      if (target === sortColumn) {
        state.currentSort = {
          column: (sortColumn?.value || "default") as TableSortColumn | "default",
          direction: sortDirection?.value as SortDirection | undefined
        };
      }
      if (target === sortDirection && state.currentSort.column !== "default") {
        state.currentSort = {
          column: state.currentSort.column,
          direction: (sortDirection?.value || "asc") as SortDirection
        };
      }
    });

    content.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const moveButton = target.closest<HTMLElement>("[data-column-move]");
      if (moveButton?.dataset.column && moveButton.dataset.columnMove) {
        const column = moveButton.dataset.column as TablePageColumnKey;
        const delta = moveButton.dataset.columnMove === "up" ? -1 : 1;
        const index = state.columnOrder.indexOf(column);
        const nextIndex = index + delta;
        if (index >= 0 && nextIndex >= 0 && nextIndex < state.columnOrder.length) {
          const next = [...state.columnOrder];
          next.splice(index, 1);
          next.splice(nextIndex, 0, column);
          state.columnOrder = next;
          renderColumns();
        }
        return;
      }
      const action = target.closest<HTMLElement>("[data-config-action]")?.dataset.configAction;
      if (action === "save-default") {
        if (state.currentSort.column === "default") {
          state.defaultSort = undefined;
        } else {
          state.defaultSort = {
            column: state.currentSort.column,
            direction: state.currentSort.direction || "asc"
          };
        }
        renderDefaultSummary();
        return;
      }
      if (action === "cancel") {
        dialog.destroy();
        return;
      }
      if (action === "save") {
        void this.runUpdate(async () => {
          await this.updateTablePageConfig({
            visibleColumns: state.visibleColumns,
            columnOrder: state.columnOrder,
            currentSort: state.currentSort.column === "default"
              ? { column: "default" }
              : { column: state.currentSort.column, direction: state.currentSort.direction || "asc" },
            defaultSort: state.defaultSort
          });
          dialog.destroy();
          this.render();
        });
      }
    });
  }

  private renderTableConfigDialog(state: TableConfigDialogState): string {
    return `<div class="task-manager-config">
  <div class="b3-dialog__content task-manager-config__content">
    <section class="task-manager-config__section">
      <div class="task-manager-config__title">字段显示与顺序</div>
      <div class="task-manager-config__hint">勾选控制显示，使用上移/下移调整表格列顺序。</div>
      <div class="task-manager-config__column-list" data-role="column-order"></div>
    </section>
    <section class="task-manager-config__section">
      <div class="task-manager-config__title">排序</div>
      <div class="task-manager-config__grid">
        <label>
          <span>当前排序</span>
          <select class="b3-select fn__block" name="sort-column">
            ${TABLE_SORT_OPTIONS.map((option) => `<option value="${option.value}" ${state.currentSort.column === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>方向</span>
          <select class="b3-select fn__block" name="sort-direction">
            ${SORT_DIRECTIONS.map((option) => `<option value="${option.value}" ${((state.currentSort.direction || "asc") === option.value) ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="task-manager-config__default-sort" data-role="default-sort-summary"></div>
      <div class="task-manager-config__actions-inline">
        <button type="button" class="b3-button b3-button--outline" data-config-action="save-default">保存当前排序为默认</button>
      </div>
    </section>
  </div>
  <div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-config-action="cancel">取消</button>
    <div class="fn__space"></div>
    <button type="button" class="b3-button b3-button--text" data-config-action="save">保存</button>
  </div>
</div>`;
  }

  private completedConfigDialogState(): CompletedConfigDialogState {
    const config = this.getCompletedPageConfig();
    return {
      visibleColumns: [...(config.visibleColumns || COMPLETED_PAGE_COLUMNS)],
      columnOrder: [...(config.columnOrder || COMPLETED_PAGE_COLUMNS)],
      currentSort: config.currentSort || { column: "default" },
      defaultSort: config.defaultSort
        ? { ...config.defaultSort }
        : undefined
    };
  }

  private settingsDialogState(page: SettingsDialogPage): SettingsDialogState {
    return {
      page,
      activeTab: "fields",
      table: this.tableConfigDialogState(),
      completed: this.completedConfigDialogState(),
      statusOptions: normalizeStatusOptions(this.service.store.getSettings()),
      migrations: []
    };
  }

  private async openSettingsDialog(page: SettingsDialogPage): Promise<void> {
    const state = this.settingsDialogState(page);
    const dialog = new Dialog({
      title: "任务控制面板设置",
      content: this.renderSettingsDialog(state),
      width: "1040px",
      height: "80vh"
    });

    if (!dialog.element.querySelector<HTMLElement>(".task-manager-settings")) {
      return;
    }

    let dragFieldKey: string | null = null;
    let dragStatusId: string | null = null;
    const rerender = () => {
      const current = dialog.element.querySelector<HTMLElement>(".task-manager-settings");
      if (current) {
        current.outerHTML = this.renderSettingsDialog(state);
      }
    };

    const getPageState = () => state.page === "table" ? state.table : state.completed;
    const getColumnOrder = () => [...getPageState().columnOrder];
    const getVisibleColumns = () => [...getPageState().visibleColumns];
    const setPageState = (patch: Partial<TableConfigDialogState> | Partial<CompletedConfigDialogState>) => {
      if (state.page === "table") {
        state.table = { ...state.table, ...(patch as Partial<TableConfigDialogState>) };
      } else {
        state.completed = { ...state.completed, ...(patch as Partial<CompletedConfigDialogState>) };
      }
    };

    dialog.element.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const nav = target.closest<HTMLElement>("[data-settings-tab]");
      if (nav?.dataset.settingsTab) {
        state.activeTab = nav.dataset.settingsTab as SettingsDialogTab;
        rerender();
        return;
      }

      const action = target.closest<HTMLElement>("[data-settings-action]")?.dataset.settingsAction;
      if (!action) {
        return;
      }

      if (action === "cancel") {
        dialog.destroy();
        return;
      }
      if (action === "restore-defaults") {
        if (state.activeTab === "fields") {
          if (state.page === "table") {
            state.table.visibleColumns = [...TABLE_PAGE_COLUMNS];
            state.table.columnOrder = [...TABLE_PAGE_COLUMNS];
          } else {
            state.completed.visibleColumns = [...COMPLETED_PAGE_COLUMNS];
            state.completed.columnOrder = [...COMPLETED_PAGE_COLUMNS];
          }
          rerender();
          return;
        }
        if (state.activeTab === "sorting") {
          if (state.page === "table") {
            state.table.currentSort = { column: "default" };
            state.table.defaultSort = undefined;
          } else {
            state.completed.currentSort = { column: "default" };
            state.completed.defaultSort = undefined;
          }
          rerender();
          return;
        }
        if (state.activeTab === "status") {
          showMessage("状态管理暂不支持一键恢复默认");
        }
        return;
      }
      if (action === "save-default-sort") {
        const pageState = getPageState();
        if (pageState.currentSort.column === "default") {
          pageState.defaultSort = undefined as any;
        } else {
          pageState.defaultSort = {
            column: pageState.currentSort.column as any,
            direction: pageState.currentSort.direction || "asc"
          } as any;
        }
        rerender();
        return;
      }
      if (action === "add-status") {
        void (async () => {
          const result = await this.openStatusEditorDialog();
          if (!result) {
            return;
          }
          if (state.statusOptions.some((option) => option.label === result.label)) {
            showMessage("状态名称不能重复");
            return;
          }
          state.statusOptions = [
            ...state.statusOptions,
            {
              id: `status-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              label: result.label,
              color: result.color,
              order: state.statusOptions.length
            }
          ];
          rerender();
        })();
        return;
      }
      const editStatusId = target.closest<HTMLElement>("[data-edit-status]")?.dataset.editStatus;
      if (editStatusId) {
        void (async () => {
          const current = state.statusOptions.find((option) => option.id === editStatusId);
          if (!current) {
            return;
          }
          const result = await this.openStatusEditorDialog(current);
          if (!result) {
            return;
          }
          if (state.statusOptions.some((option) => option.id !== editStatusId && option.label === result.label)) {
            showMessage("状态名称不能重复");
            return;
          }
          state.statusOptions = state.statusOptions.map((option) => option.id === editStatusId ? {
            ...option,
            label: result.label,
            color: result.color
          } : option);
          rerender();
        })();
        return;
      }
      const deleteStatusId = target.closest<HTMLElement>("[data-delete-status]")?.dataset.deleteStatus;
      if (deleteStatusId) {
        const current = state.statusOptions.find((option) => option.id === deleteStatusId);
        if (!current) {
          return;
        }
        if (isProtectedStatus(current.id)) {
          showMessage("系统语义状态不可删除");
          return;
        }
        const taskCount = this.service.store.all().filter((task) => task.status === current.id).length;
        void (async () => {
          if (taskCount > 0) {
            const migration = await this.openStatusMigrationDialog(current.id, state.statusOptions, taskCount);
            if (!migration) {
              return;
            }
            state.migrations = [
              ...state.migrations.filter((item) => item.fromStatus !== current.id),
              migration
            ];
          } else {
            state.migrations = state.migrations.filter((item) => item.fromStatus !== current.id);
          }
          state.statusOptions = state.statusOptions
            .filter((option) => option.id !== current.id)
            .map((option, index) => ({ ...option, order: index }));
          rerender();
        })();
        return;
      }
      if (action === "save") {
        const pageState = getPageState();
        if (!pageState.visibleColumns.length) {
          showMessage("至少保留一个字段");
          return;
        }
        if (!pageState.visibleColumns.includes("task" as any)) {
          showMessage("任务字段必须显示");
          return;
        }
        void this.runUpdate(async () => {
          if (state.page === "table") {
            await this.updateTablePageConfig({
              visibleColumns: state.table.visibleColumns,
              columnOrder: state.table.columnOrder,
              currentSort: state.table.currentSort,
              defaultSort: state.table.defaultSort
            });
          } else {
            await this.updateCompletedPageConfig({
              visibleColumns: state.completed.visibleColumns,
              columnOrder: state.completed.columnOrder,
              currentSort: state.completed.currentSort,
              defaultSort: state.completed.defaultSort
            });
          }
          await this.service.store.setSettings({
            statusOptions: state.statusOptions.map((option, index) => ({ ...option, order: index }))
          });
          const resolvedMigrations = state.migrations
            .map((migration) => ({
              ...migration,
              toStatus: resolveMigrationTarget(migration.toStatus, state.migrations)
            }))
            .filter((migration) => migration.fromStatus !== migration.toStatus);
          for (const migration of resolvedMigrations) {
            await this.service.migrateTaskStatuses(migration.fromStatus, migration.toStatus);
          }
          const validFilterKeys = new Set<string>([
            "all",
            ...getStatusFilterOptions({ statusOptions: state.statusOptions } as TaskSettings).map((option) => String(option.key))
          ]);
          Array.from(this.viewFilters.entries()).forEach(([view, filter]) => {
            if (!validFilterKeys.has(String(filter))) {
              this.viewFilters.set(view, "all");
            }
          });
          dialog.destroy();
          this.render({ preserveTableScroll: true });
        });
      }
    });

    dialog.element.addEventListener("change", (event) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.dataset.settingsColumnVisibility) {
        const column = target.dataset.settingsColumnVisibility as TablePageColumnKey | CompletedPageColumnKey;
        let visible = getVisibleColumns();
        if (target.checked) {
          if (!visible.includes(column as never)) {
            visible.push(column as never);
          }
        } else {
          if (column === "task") {
            target.checked = true;
            showMessage("任务字段必须显示");
            return;
          }
          visible = visible.filter((item) => item !== column);
        }
        setPageState({ visibleColumns: visible } as any);
        rerender();
        return;
      }
      if (target instanceof HTMLSelectElement && target.dataset.settingsSortField) {
        const pageState = getPageState();
        const nextColumn = target.value as TableSortColumn | CompletedSortColumn | "default";
        pageState.currentSort = nextColumn === "default"
          ? { column: "default" }
          : { column: nextColumn as any, direction: pageState.currentSort.direction || "asc" };
        rerender();
        return;
      }
      if (target instanceof HTMLSelectElement && target.dataset.settingsSortDirection) {
        const pageState = getPageState();
        if (pageState.currentSort.column !== "default") {
          pageState.currentSort = {
            column: pageState.currentSort.column,
            direction: target.value as SortDirection
          } as any;
          rerender();
        }
      }
    });

    dialog.element.addEventListener("dragstart", (event) => {
      const target = event.target as HTMLElement;
      const fieldItem = target.closest<HTMLElement>("[data-draggable-column]");
      if (fieldItem?.dataset.draggableColumn) {
        dragFieldKey = fieldItem.dataset.draggableColumn;
        event.dataTransfer?.setData("text/plain", dragFieldKey);
        return;
      }
      const statusItem = target.closest<HTMLElement>("[data-draggable-status]");
      if (statusItem?.dataset.draggableStatus) {
        dragStatusId = statusItem.dataset.draggableStatus;
        event.dataTransfer?.setData("text/plain", dragStatusId);
      }
    });

    dialog.element.addEventListener("dragover", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-draggable-column]") || target.closest("[data-draggable-status]")) {
        event.preventDefault();
      }
    });

    dialog.element.addEventListener("drop", (event) => {
      const target = event.target as HTMLElement;
      const fieldTarget = target.closest<HTMLElement>("[data-draggable-column]");
      if (fieldTarget?.dataset.draggableColumn && dragFieldKey) {
        event.preventDefault();
        const targetKey = fieldTarget.dataset.draggableColumn;
        const next = reorderStringList(getColumnOrder(), dragFieldKey, targetKey);
        setPageState({ columnOrder: next } as any);
        rerender();
        dragFieldKey = null;
        return;
      }
      const statusTarget = target.closest<HTMLElement>("[data-draggable-status]");
      if (statusTarget?.dataset.draggableStatus && dragStatusId) {
        event.preventDefault();
        const targetId = statusTarget.dataset.draggableStatus;
        const ids = reorderStringList(state.statusOptions.map((item) => item.id), dragStatusId, targetId);
        state.statusOptions = ids
          .map((id, index) => {
            const option = state.statusOptions.find((item) => item.id === id);
            return option ? { ...option, order: index } : undefined;
          })
          .filter((option): option is TaskStatusOption => Boolean(option));
        rerender();
        dragStatusId = null;
      }
    });
  }

  private renderSettingsDialog(state: SettingsDialogState): string {
    const pageState = state.page === "table" ? state.table : state.completed;
    const currentOptions = state.page === "table" ? TABLE_SORT_OPTIONS : COMPLETED_SORT_OPTIONS;
    const fieldRows = pageState.columnOrder.map((column) => {
      const visible = pageState.visibleColumns.includes(column as never);
      const label = currentOptions.find((option) => option.value === column)?.label || String(column);
      return `<div class="task-manager-settings__list-row" draggable="true" data-draggable-column="${column}">
  <label class="task-manager-settings__check-row">
    <input type="checkbox" data-settings-column-visibility="${column}" ${visible ? "checked" : ""} ${column === "task" ? "disabled" : ""} />
    <span>${label}</span>
  </label>
  <button type="button" class="task-manager-settings__drag-handle" title="拖拽调整顺序">≡</button>
</div>`;
    }).join("");

    const defaultSortSummary = pageState.defaultSort
      ? `已保存默认排序：${currentOptions.find((option) => option.value === pageState.defaultSort?.column)?.label || pageState.defaultSort.column} / ${SORT_DIRECTIONS.find((option) => option.value === pageState.defaultSort?.direction)?.label || pageState.defaultSort.direction}`
      : "当前未保存默认排序，将回退系统默认顺序。";

    return `<div class="task-manager-settings">
  <div class="task-manager-settings__shell">
    <aside class="task-manager-settings__nav">
      <div class="task-manager-settings__nav-title">任务控制面板设置</div>
      ${this.renderSettingsNavButton("fields", "字段显示", state.activeTab)}
      ${this.renderSettingsNavButton("sorting", "排序设置", state.activeTab)}
      ${this.renderSettingsNavButton("status", "状态管理", state.activeTab)}
      ${this.renderSettingsNavButton("priority", "优先级管理", state.activeTab)}
    </aside>
    <section class="task-manager-settings__content">
      ${state.activeTab === "fields" ? `<div class="task-manager-settings__panel">
        <div class="task-manager-settings__panel-title">字段显示</div>
        <div class="task-manager-settings__panel-hint">勾选需要在列表中显示的字段，并通过拖拽调整显示顺序。</div>
        <div class="task-manager-settings__list">${fieldRows}</div>
      </div>` : ""}
      ${state.activeTab === "sorting" ? `<div class="task-manager-settings__panel">
        <div class="task-manager-settings__panel-title">排序设置</div>
        <div class="task-manager-settings__panel-hint">设置列表当前排序规则，保存后按此规则展示。</div>
        <div class="task-manager-settings__form-grid">
          <label class="task-manager-settings__field">
            <span>排序字段</span>
            <select class="b3-select fn__block" data-settings-sort-field="current">
              ${currentOptions.map((option) => `<option value="${option.value}" ${pageState.currentSort.column === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
            </select>
          </label>
          <label class="task-manager-settings__field">
            <span>排序方向</span>
            <select class="b3-select fn__block" data-settings-sort-direction="current" ${pageState.currentSort.column === "default" ? "disabled" : ""}>
              ${SORT_DIRECTIONS.map((option) => `<option value="${option.value}" ${((pageState.currentSort.direction || "asc") === option.value) ? "selected" : ""}>${option.label}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="task-manager-settings__status-note">${escapeHtml(defaultSortSummary)}</div>
        <div class="task-manager-settings__inline-actions">
          <button type="button" class="b3-button b3-button--outline" data-settings-action="save-default-sort">保存为默认排序</button>
        </div>
      </div>` : ""}
      ${state.activeTab === "status" ? `<div class="task-manager-settings__panel">
        <div class="task-manager-settings__panel-header">
          <div>
            <div class="task-manager-settings__panel-title">状态管理</div>
            <div class="task-manager-settings__panel-hint">自定义任务状态，支持添加、编辑、删除和拖拽排序。</div>
          </div>
          <button type="button" class="task-manager-settings__primary-button" data-settings-action="add-status">+ 添加状态</button>
        </div>
        <div class="task-manager-settings__list">
          ${state.statusOptions.map((option) => {
            const badge = getStatusBadgeConfig(option.id, { statusOptions: state.statusOptions } as TaskSettings);
            const protectedText = isProtectedStatus(option.id) ? "系统语义状态不可删除" : "删除";
            const migration = state.migrations.find((item) => item.fromStatus === option.id);
            return `<div class="task-manager-settings__status-row" draggable="true" data-draggable-status="${escapeAttr(option.id)}">
  <div class="task-manager-settings__status-main">
    <span class="task-manager-settings__status-dot" style="--dot-color:${badge.dotColor};"></span>
    <span>${escapeHtml(option.label)}</span>
  </div>
  <div class="task-manager-settings__status-actions">
    ${migration ? `<span class="task-manager-settings__migration-tag">迁移到 ${escapeHtml(getStatusLabel(migration.toStatus, { statusOptions: state.statusOptions } as TaskSettings))} · ${migration.taskCount}</span>` : ""}
    <button type="button" class="task-manager-settings__icon-button task-progress-item__icon-button" data-edit-status="${escapeAttr(option.id)}" title="编辑" aria-label="编辑状态">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h6"/><path d="M14.2 4.8a1.8 1.8 0 0 1 2.6 0l2.4 2.4a1.8 1.8 0 0 1 0 2.6L8.7 20.3 4 21l.7-4.7L14.2 4.8z"/></svg>
    </button>
    <button type="button" class="task-manager-settings__icon-button task-progress-item__icon-button task-progress-item__icon-button--danger ${isProtectedStatus(option.id) ? "is-disabled" : ""}" data-delete-status="${escapeAttr(option.id)}" ${isProtectedStatus(option.id) ? "disabled" : ""} title="${escapeAttr(protectedText)}" aria-label="删除状态">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 4h6"/><path d="M7 7v12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 19V7"/><path d="M10 11v5M14 11v5"/></svg>
    </button>
    <button type="button" class="task-manager-settings__drag-handle" title="拖拽调整顺序">≡</button>
  </div>
</div>`;
          }).join("")}
        </div>
      </div>` : ""}
      ${state.activeTab === "priority" ? `<div class="task-manager-settings__panel">
        <div class="task-manager-settings__panel-title">优先级管理</div>
        <div class="task-manager-settings__panel-hint">本次仅提供占位页，后续可在这里管理优先级名称、颜色和顺序。</div>
        <div class="task-manager-settings__placeholder">当前版本暂不支持自定义优先级，现有优先级逻辑保持不变。</div>
      </div>` : ""}
    </section>
  </div>
  <div class="task-manager-settings__footer">
    <button type="button" class="b3-button b3-button--outline" data-settings-action="restore-defaults">恢复默认设置</button>
    <div class="fn__space"></div>
    <button type="button" class="task-tracker-dialog-v3__btn-cancel task-manager-settings__footer-button" data-settings-action="cancel">取消</button>
    <button type="button" class="task-tracker-dialog-v3__btn-primary task-manager-settings__footer-button" data-settings-action="save">保存</button>
  </div>
</div>`;
  }

  private renderSettingsNavButton(tab: SettingsDialogTab, label: string, activeTab: SettingsDialogTab): string {
    return `<button type="button" class="task-manager-settings__nav-btn ${activeTab === tab ? "is-active" : ""}" data-settings-tab="${tab}">${label}</button>`;
  }

  private async openStatusEditorDialog(current?: TaskStatusOption): Promise<{ label: string; color: StatusColorPreset } | undefined> {
    return new Promise((resolve) => {
      const dialog = new Dialog({
        title: current ? "编辑状态" : "添加状态",
        content: `<div class="task-manager-settings-modal">
  <label class="task-manager-settings__field">
    <span>状态名称</span>
    <input class="b3-text-field fn__block" name="label" value="${escapeAttr(current?.label || "")}" placeholder="请输入状态名称" />
  </label>
  <label class="task-manager-settings__field">
    <span>颜色</span>
    <select class="b3-select fn__block" name="color">
      ${STATUS_COLOR_PRESET_OPTIONS.map((option) => `<option value="${option.value}" ${option.value === (current?.color || "blue") ? "selected" : ""}>${option.label}</option>`).join("")}
    </select>
  </label>
  <div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">取消</button>
    <div class="fn__space"></div>
    <button type="button" class="b3-button b3-button--text" data-action="save">保存</button>
  </div>
</div>`,
        width: "420px"
      });

      const root = dialog.element.querySelector<HTMLElement>(".task-manager-settings-modal");
      root?.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
        if (action === "cancel") {
          dialog.destroy();
          resolve(undefined);
          return;
        }
        if (action === "save") {
          const labelInput = root.querySelector<HTMLInputElement>("[name='label']");
          const colorInput = root.querySelector<HTMLSelectElement>("[name='color']");
          const label = labelInput?.value.trim() || "";
          if (!label) {
            showMessage("请填写状态名称");
            return;
          }
          const color = (colorInput?.value || "blue") as StatusColorPreset;
          dialog.destroy();
          resolve({ label, color });
        }
      });
    });
  }

  private async openStatusMigrationDialog(
    fromStatus: TaskStatus,
    options: TaskStatusOption[],
    taskCount: number
  ): Promise<StatusMigrationDraft | undefined> {
    const candidates = options.filter((option) => option.id !== fromStatus);
    if (!candidates.length) {
      showMessage("至少需要保留一个可迁移状态");
      return undefined;
    }
    return new Promise((resolve) => {
      const dialog = new Dialog({
        title: "迁移任务状态",
        content: `<div class="task-manager-settings-modal">
  <div class="task-manager-settings__panel-hint">共有 ${taskCount} 个任务正在使用该状态。删除前请选择迁移目标。</div>
  <label class="task-manager-settings__field">
    <span>迁移到</span>
    <select class="b3-select fn__block" name="target">
      ${candidates.map((option) => `<option value="${escapeAttr(option.id)}">${escapeHtml(option.label)}</option>`).join("")}
    </select>
  </label>
  <div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">取消</button>
    <div class="fn__space"></div>
    <button type="button" class="b3-button b3-button--text" data-action="confirm">确认迁移</button>
  </div>
</div>`,
        width: "420px"
      });

      const root = dialog.element.querySelector<HTMLElement>(".task-manager-settings-modal");
      root?.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
        if (action === "cancel") {
          dialog.destroy();
          resolve(undefined);
          return;
        }
        if (action === "confirm") {
          const select = root.querySelector<HTMLSelectElement>("[name='target']");
          const toStatus = select?.value || candidates[0].id;
          dialog.destroy();
          resolve({ fromStatus, toStatus, taskCount });
        }
      });
    });
  }

  private async openCompletedConfigDialog(): Promise<void> {
    const state = this.completedConfigDialogState();
    const dialog = new Dialog({
      title: "页面设置",
      content: this.renderCompletedConfigDialog(state),
      width: "520px"
    });

    const content = dialog.element.querySelector<HTMLElement>(".task-manager-config");
    if (!content) {
      return;
    }

    const renderColumns = () => {
      const list = content.querySelector<HTMLElement>("[data-role='column-order']");
      if (!list) {
        return;
      }
      list.innerHTML = state.columnOrder.map((column, index) => {
        const visible = state.visibleColumns.includes(column);
        const label = COMPLETED_SORT_OPTIONS.find((option) => option.value === column)?.label || column;
        return `<div class="task-manager-config__column-row" data-column="${column}">
  <label class="task-manager-config__column-label">
    <input type="checkbox" data-column-visibility="${column}" ${visible ? "checked" : ""} />
    <span>${label}</span>
  </label>
  <div class="task-manager-config__column-actions">
    <button type="button" class="b3-button b3-button--outline" data-column-move="up" data-column="${column}" ${index === 0 ? "disabled" : ""}>上移</button>
    <button type="button" class="b3-button b3-button--outline" data-column-move="down" data-column="${column}" ${index === state.columnOrder.length - 1 ? "disabled" : ""}>下移</button>
  </div>
</div>`;
      }).join("");
    };

    const sortColumn = content.querySelector<HTMLSelectElement>("[name='sort-column']");
    const sortDirection = content.querySelector<HTMLSelectElement>("[name='sort-direction']");
    const defaultSummary = content.querySelector<HTMLElement>("[data-role='default-sort-summary']");

    const renderDefaultSummary = () => {
      if (!defaultSummary) {
        return;
      }
      if (!state.defaultSort) {
        defaultSummary.textContent = "当前未保存默认排序，将回退系统默认顺序。";
        return;
      }
      const columnLabel = COMPLETED_SORT_OPTIONS.find((option) => option.value === state.defaultSort?.column)?.label || state.defaultSort.column;
      const directionLabel = SORT_DIRECTIONS.find((option) => option.value === state.defaultSort?.direction)?.label || state.defaultSort.direction;
      defaultSummary.textContent = `已保存默认排序：${columnLabel} / ${directionLabel}`;
    };

    renderColumns();
    renderDefaultSummary();

    content.addEventListener("change", (event) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.dataset.columnVisibility) {
        const column = target.dataset.columnVisibility as CompletedPageColumnKey;
        if (target.checked) {
          if (!state.visibleColumns.includes(column)) {
            state.visibleColumns.push(column);
          }
        } else {
          state.visibleColumns = state.visibleColumns.filter((item) => item !== column);
        }
        if (!state.visibleColumns.length) {
          state.visibleColumns = ["task"];
        }
        renderColumns();
        return;
      }
      if (target === sortColumn) {
        state.currentSort = {
          column: (sortColumn?.value || "default") as CompletedSortColumn | "default",
          direction: sortDirection?.value as SortDirection | undefined
        };
      }
      if (target === sortDirection && state.currentSort.column !== "default") {
        state.currentSort = {
          column: state.currentSort.column,
          direction: (sortDirection?.value || "asc") as SortDirection
        };
      }
    });

    content.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const moveButton = target.closest<HTMLElement>("[data-column-move]");
      if (moveButton?.dataset.column && moveButton.dataset.columnMove) {
        const column = moveButton.dataset.column as CompletedPageColumnKey;
        const delta = moveButton.dataset.columnMove === "up" ? -1 : 1;
        const index = state.columnOrder.indexOf(column);
        const nextIndex = index + delta;
        if (index >= 0 && nextIndex >= 0 && nextIndex < state.columnOrder.length) {
          const next = [...state.columnOrder];
          next.splice(index, 1);
          next.splice(nextIndex, 0, column);
          state.columnOrder = next;
          renderColumns();
        }
        return;
      }
      const action = target.closest<HTMLElement>("[data-config-action]")?.dataset.configAction;
      if (action === "save-default") {
        if (state.currentSort.column === "default") {
          state.defaultSort = undefined;
        } else {
          state.defaultSort = {
            column: state.currentSort.column as CompletedSortColumn,
            direction: state.currentSort.direction || "asc"
          };
        }
        renderDefaultSummary();
        return;
      }
      if (action === "cancel") {
        dialog.destroy();
        return;
      }
      if (action === "save") {
        void this.runUpdate(async () => {
          await this.updateCompletedPageConfig({
            visibleColumns: state.visibleColumns,
            columnOrder: state.columnOrder,
            currentSort: state.currentSort.column === "default"
              ? { column: "default" }
              : { column: state.currentSort.column as CompletedSortColumn, direction: state.currentSort.direction || "asc" },
            defaultSort: state.defaultSort
          });
          dialog.destroy();
          this.render();
        });
      }
    });
  }

  private renderCompletedConfigDialog(state: CompletedConfigDialogState): string {
    return `<div class="task-manager-config">
  <div class="b3-dialog__content task-manager-config__content">
    <section class="task-manager-config__section">
      <div class="task-manager-config__title">字段显示与顺序</div>
      <div class="task-manager-config__hint">勾选控制显示，使用上移/下移调整表格列顺序。</div>
      <div class="task-manager-config__column-list" data-role="column-order"></div>
    </section>
    <section class="task-manager-config__section">
      <div class="task-manager-config__title">排序</div>
      <div class="task-manager-config__grid">
        <label>
          <span>当前排序</span>
          <select class="b3-select fn__block" name="sort-column">
            ${COMPLETED_SORT_OPTIONS.map((option) => `<option value="${option.value}" ${state.currentSort.column === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>方向</span>
          <select class="b3-select fn__block" name="sort-direction">
            ${SORT_DIRECTIONS.map((option) => `<option value="${option.value}" ${((state.currentSort.direction || "asc") === option.value) ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="task-manager-config__default-sort" data-role="default-sort-summary"></div>
      <div class="task-manager-config__actions-inline">
        <button type="button" class="b3-button b3-button--outline" data-config-action="save-default">保存当前排序为默认</button>
      </div>
    </section>
  </div>
  <div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-config-action="cancel">取消</button>
    <div class="fn__space"></div>
    <button type="button" class="b3-button b3-button--text" data-config-action="save">保存</button>
  </div>
</div>`;
  }

  private tableComparator(): ((a: TaskItem, b: TaskItem) => number) | undefined {
    const sort = this.getEffectiveTableSort();
    if (!sort) {
      return undefined;
    }
    const direction = sort.direction === "desc" ? -1 : 1;
    const statusOrder = getAllOrderedStatuses(this.service.store.getSettings());
    return (a, b) => compareTasksByColumn(a, b, sort.column, statusOrder) * direction;
  }

  private getEffectiveTableSort(): { column: TableSortColumn; direction: SortDirection } | undefined {
    const config = this.getTablePageConfig();
    const currentSort = config.currentSort;
    if (!currentSort || currentSort.column === "default") {
      return config.defaultSort;
    }
    return {
      column: currentSort.column,
      direction: currentSort.direction || "asc"
    };
  }

  private sortTasksForTable(tasks: TaskItem[]): TaskItem[] {
    return [...tasks];
  }

  private renderListView(tasks: TaskItem[]): string {
    const matched = new Set(tasks.map((task) => task.id));
    const visible = includeAncestors(tasks, matched);
    const tree = buildTaskTree(tasks, visible, matched);

    return `<div class="task-manager-list">
  ${tree.length ? tree.map((node) => this.renderTaskNode(node, 0)).join("") : `<div class="task-manager-empty">这里暂时没有任务。</div>`}
</div>`;
  }

  private renderTaskNode(node: TaskTreeNode, depth: number): string {
    const task = node.task;
    const childCount = node.children.length;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const contextClass = node.contextOnly ? " task-manager-task--context" : "";
    const childClass = depth > 0 ? " task-manager-task--child" : "";

    return `<div class="task-manager-task task-manager-status-${task.status} task-manager-priority-${task.priority}${contextClass}${childClass}" data-task-id="${task.id}" style="${escapeAttr(this.buildTaskStyleVars(task, `--task-depth: ${depth};`))}">
  <div class="task-manager-task__main">
    <div class="task-manager-task__title-row">
      ${childCount
        ? `<button class="task-manager-task__toggle" data-task-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
        : `<span class="task-manager-task__toggle-placeholder"></span>`}
      <div class="task-manager-task__summary">
        <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</button>
        <div class="task-manager-task__header-meta">
          ${this.renderProjectPill(task)}
          ${this.renderSourcePill(task)}
          ${childCount ? `<span class="task-manager-task__child-count">${childCount}</span>` : ""}
        </div>
        ${this.renderRowActions(task)}
      </div>
    </div>
  </div>
  <div class="task-manager-task__controls">
    <div class="task-manager-task__control-grid">
      ${this.renderListMetaChip("status", task)}
      ${this.renderListMetaChip("priority", task)}
      ${this.renderListDateChip("planDate", "计划", formatMonthDay(task.planStart), toDateKey(task.planStart))}
      ${this.renderListDateChip("dueDate", "截止", task.dueDate ? formatMonthDay(task.dueDate) : "", task.dueDate || "")}
    </div>
  </div>
  ${childCount && !collapsed ? `<div class="task-manager-task__children">${node.children.map((child) => this.renderTaskNode(child, depth + 1)).join("")}</div>` : ""}
</div>`;
  }

  private renderProjectPill(task: TaskItem): string {
    return `<span class="task-manager-task__pill task-manager-task__pill--project" title="${escapeAttr(task.project || "无项目")}">${escapeHtml(task.project || "无项目")}</span>`;
  }

  private renderTableProjectText(task: TaskItem): string {
    const label = task.project || "无项目";
    const isEmpty = !task.project;
    return `<span class="task-manager-table__text task-manager-table__text--project ${isEmpty ? "is-empty" : ""}" title="${escapeAttr(label)}">${escapeHtml(label)}</span>`;
  }

  private renderLatestText(task: TaskItem): string {
    const latest = task.description?.trim();
    if (!latest) {
      return `<span class="task-manager-table__text task-manager-table__text--latest is-empty" title="—">—</span>`;
    }
    return `<span class="task-manager-table__text task-manager-table__text--latest" title="${escapeAttr(latest)}">${escapeHtml(latest)}</span>`;
  }

  private renderProgressText(task: TaskItem): string {
    const summary = latestProgressRecordSummary(task.progressRecords);
    if (!summary) {
      return `<span class="task-manager-table__text task-manager-table__text--progress is-empty" title="—">—</span>`;
    }
    return `<span class="task-manager-table__text task-manager-table__text--progress" title="${escapeAttr(summary)}">${escapeHtml(summary)}</span>`;
  }

  private renderSourcePill(task: TaskItem): string {
    if (!task.sourceDocId) {
      return `<span class="task-manager-task__pill task-manager-task__pill--source is-manual" title="手动创建">手动创建</span>`;
    }

    const label = task.sourceText?.trim() || "来源笔记";
    return `<button class="task-manager-task__pill task-manager-task__pill--source is-note" data-task-action="open-source" data-source-doc-id="${escapeAttr(task.sourceDocId)}" title="${escapeAttr(label)}"><span class="task-manager-task__pill-label">${escapeHtml(label)}</span></button>`;
  }

  private renderTableSourceText(task: TaskItem): string {
    const label = task.sourceDocId
      ? (task.sourceText?.trim() || "来源笔记")
      : "手动创建";
    const text = task.sourceDocId
      ? `<button type="button" class="task-manager-table__text task-manager-table__text--source is-interactive" data-task-action="open-source" data-source-doc-id="${escapeAttr(task.sourceDocId)}" title="${escapeAttr(label)}">${escapeHtml(label)}</button>`
      : `<span class="task-manager-table__text task-manager-table__text--source is-empty" title="手动创建">${escapeHtml(label)}</span>`;
    const folderButton = this.renderSourceFolderButton(task);
    return `<span class="task-manager-table__source-cell">${text}${folderButton}</span>`;
  }

  private renderSourceFolderButton(task: TaskItem): string {
    const noteFolderPath = task.noteFolderPath?.trim();
    if (!noteFolderPath) {
      return "";
    }
    return `<button type="button" class="task-source-folder-btn" data-task-action="open-note-folder" title="打开本地路径" aria-label="打开本地路径">${renderSourceFolderIcon()}</button>`;
  }

  private renderTimelineView(tasks: TaskItem[]): string {
    const groups = groupByPlanDate(tasks, { unplannedFirst: true, plannedDescending: true });
    return `<div class="task-manager-timeline">
  ${groups.map((group) => `<section class="task-manager-timeline__group">
    <div class="task-manager-timeline__date">${group.label}<span>${group.tasks.length}</span></div>
    <div class="task-manager-timeline__items">
      ${group.tasks.map((task) => this.renderTaskCard(task, "timeline")).join("")}
    </div>
  </section>`).join("")}
</div>`;
  }

  private renderKanbanView(tasks: TaskItem[]): string {
    const settings = this.service.store.getSettings();
    return `<div class="task-manager-kanban">
  ${getKanbanStatuses(settings).map((status) => {
    const columnTasks = tasks.filter((task) => task.status === status);
    return `<section class="task-manager-kanban__column task-manager-status-${status}" style="${escapeAttr(this.buildStatusStyleVars(status))}">
      <div class="task-manager-kanban__header">${escapeHtml(getStatusLabel(status, settings))}<span>${columnTasks.length}</span></div>
      <div class="task-manager-kanban__items">
        ${columnTasks.length ? columnTasks.map((task) => this.renderTaskCard(task, "kanban")).join("") : `<div class="task-manager-empty">暂无任务</div>`}
      </div>
    </section>`;
  }).join("")}
</div>`;
  }

  private renderCalendarView(tasks: TaskItem[]): string {
    if (this.calendarMode === "week") {
      return this.renderCalendarWeekView(tasks);
    }
    return this.renderCalendarMonthView(tasks);
  }

  private renderCalendarMonthView(tasks: TaskItem[]): string {
    const days = calendarDays(this.month);
    const weekRows = Math.ceil(days.length / 7);
    const tasksByDate = groupTasksByDate(tasks);
    const unplanned = tasks.filter((task) => !isCompletedTaskStatus(task.status) && !task.planStart);
    const monthValue = monthInputValue(this.month);
    const expandedWeekIndexes = new Set<number>();
    days.forEach((day, index) => {
      if (this.expandedCalendarDateKeys.has(formatDateKey(day))) {
        expandedWeekIndexes.add(Math.floor(index / 7));
      }
    });
    const gridStyle = calendarGridStyle(weekRows, expandedWeekIndexes);

    return `<div class="task-manager-calendar">
  <div class="task-manager-calendar__toolbar">
    <button class="task-manager-calendar__nav task-manager-calendar__nav--chevron task-manager-calendar__nav--prev" data-action="prev-month" aria-label="上个月" title="上个月">${renderChevron(false)}</button>
    <div class="task-manager-calendar__title">${monthTitle(this.month)}</div>
    <button class="task-manager-calendar__nav task-manager-calendar__nav--chevron task-manager-calendar__nav--next" data-action="next-month" aria-label="下个月" title="下个月">${renderChevron(false)}</button>
    <input class="b3-text-field task-manager-calendar__month-input" data-field="month" type="month" value="${monthValue}" aria-label="选择月份" />
    <button class="task-manager-calendar__nav task-manager-calendar__nav--today" data-action="today-month" aria-label="回到本月" title="回到本月">今</button>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--text task-manager-calendar__mode-toggle ${this.calendarMode === "week" ? "is-active" : ""}" data-action="toggle-calendar-week" aria-label="周视图" title="周视图">周</button>
    <button class="b3-button b3-button--text task-manager-calendar__mode-toggle ${this.calendarMode === "month" ? "is-active" : ""}" data-action="toggle-calendar-month" aria-label="月视图" title="月视图">月</button>
    <span class="fn__flex-1" style="flex:0 1 8px"></span>
    <button class="b3-button b3-button--text task-manager-calendar__unplanned-toggle ${this.calendarUnplannedVisible ? "is-active" : ""}" data-action="toggle-unplanned" aria-label="未安排任务" aria-pressed="${this.calendarUnplannedVisible}" title="未安排任务">未安排任务</button>
  </div>
  <div class="task-manager-calendar__layout">
    <section class="task-manager-calendar__main">
      <div class="task-manager-calendar__weekdays">
        ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div>${day}</div>`).join("")}
      </div>
      <div class="task-manager-calendar__grid" data-week-rows="${weekRows}" ${expandedWeekIndexes.size ? `data-expanded-weeks="${Array.from(expandedWeekIndexes).join(",")}"` : ""} style="${escapeAttr(gridStyle)}">
        ${days.map((day, index) => this.renderCalendarDay(day, tasksByDate[formatDateKey(day)] || [], Math.floor(index / 7))).join("")}
      </div>
    </section>
    ${this.calendarUnplannedVisible ? `<aside class="task-manager-calendar__floating-aside">
      <div class="task-manager-calendar__aside-title">未安排任务</div>
      <div class="task-manager-calendar__unplanned">
        ${unplanned.length ? unplanned.map((task) => this.renderTaskCard(task, "calendar-aside")).join("") : `<div class="task-manager-empty">没有未安排任务。</div>`}
      </div>
    </aside>` : ""}
  </div>
</div>`;
  }

  private renderCalendarWeekView(tasks: TaskItem[]): string {
    const weekLabel = `${formatWeekRangeCompact(formatDateKey(this.weekStart))}`;
    const tasksByDate = groupTasksByDate(tasks);
    const unplanned = tasks.filter((task) => !isCompletedTaskStatus(task.status) && !task.planStart);
    const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const weekDays: Array<{ date: Date; label: string; dateKey: string; isToday: boolean }> = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(this.weekStart.getFullYear(), this.weekStart.getMonth(), this.weekStart.getDate() + i);
      const dateKey = formatDateKey(day);
      weekDays.push({
        date: day,
        label: weekdayLabels[i],
        dateKey,
        isToday: dateKey === formatDateKey(new Date())
      });
    }

    return `<div class="task-manager-calendar task-manager-calendar--week">
  <div class="task-manager-calendar__toolbar">
    <button class="task-manager-calendar__nav task-manager-calendar__nav--chevron task-manager-calendar__nav--prev" data-action="prev-week" aria-label="上一周" title="上一周">${renderChevron(false)}</button>
    <div class="task-manager-calendar__title">${weekLabel}</div>
    <button class="task-manager-calendar__nav task-manager-calendar__nav--chevron task-manager-calendar__nav--next" data-action="next-week" aria-label="下一周" title="下一周">${renderChevron(false)}</button>
    <button class="task-manager-calendar__nav task-manager-calendar__nav--today" data-action="today-week" aria-label="回到本周" title="回到本周">今</button>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--text task-manager-calendar__mode-toggle ${this.calendarMode === "week" ? "is-active" : ""}" data-action="toggle-calendar-week" aria-label="周视图" title="周视图">周</button>
    <button class="b3-button b3-button--text task-manager-calendar__mode-toggle ${this.calendarMode === "month" ? "is-active" : ""}" data-action="toggle-calendar-month" aria-label="月视图" title="月视图">月</button>
    <span class="fn__flex-1" style="flex:0 1 8px"></span>
    <button class="b3-button b3-button--text task-manager-calendar__unplanned-toggle ${this.calendarUnplannedVisible ? "is-active" : ""}" data-action="toggle-unplanned" aria-label="未安排任务" aria-pressed="${this.calendarUnplannedVisible}" title="未安排任务">未安排任务</button>
  </div>
  <div class="task-manager-calendar__layout">
    <section class="task-manager-calendar__main">
      <div class="task-manager-calendar__week">
        ${weekDays.map((day) => this.renderCalendarWeekDay(day, tasksByDate[day.dateKey] || [])).join("")}
      </div>
    </section>
    ${this.calendarUnplannedVisible ? `<aside class="task-manager-calendar__floating-aside">
      <div class="task-manager-calendar__aside-title">未安排任务</div>
      <div class="task-manager-calendar__unplanned">
        ${unplanned.length ? unplanned.map((task) => this.renderTaskCard(task, "calendar-aside")).join("") : `<div class="task-manager-empty">没有未安排任务。</div>`}
      </div>
    </aside>` : ""}
  </div>
</div>`;
  }

  private renderCalendarWeekDay(day: { date: Date; label: string; dateKey: string; isToday: boolean }, tasks: TaskItem[]): string {
    const dayLabel = `${day.date.getMonth() + 1}/${day.date.getDate()}`;
    const todayClass = day.isToday ? "is-today" : "";

    return `<div class="task-manager-calendar-week-row ${todayClass}" data-date="${day.dateKey}">
  <div class="task-manager-calendar-week-row__label">
    <span class="task-manager-calendar-week-row__day">${day.label}</span>
    <span class="task-manager-calendar-week-row__date">${dayLabel}</span>
    ${tasks.length ? `<span class="task-manager-calendar-week-row__count">${tasks.length}</span>` : ""}
  </div>
  <div class="task-manager-calendar-week-row__tasks">
    ${tasks.length ? tasks.map((task) => `<button class="task-manager-calendar-pill task-manager-status-${task.status}" data-task-id="${task.id}" data-task-action="open" title="${escapeAttr(task.title)}" style="${escapeAttr(this.buildStatusStyleVars(task.status))}">${escapeHtml(task.title)}</button>`).join("") : `<span class="task-manager-calendar-week-row__empty">暂无日程</span>`}
  </div>
</div>`;
  }

  private renderCalendarDay(day: Date, tasks: TaskItem[], weekIndex: number): string {
    const dateKey = formatDateKey(day);
    const isToday = dateKey === formatDateKey(new Date());
    const outside = !sameMonth(day, this.month);
    const expanded = this.expandedCalendarDateKeys.has(dateKey);
    const visibleTasks = expanded ? tasks : tasks.slice(0, 3);
    const overflowCount = Math.max(tasks.length - 3, 0);

    return `<div class="task-manager-calendar-day ${outside ? "is-outside" : ""} ${isToday ? "is-today" : ""} ${expanded ? "is-expanded" : ""}" data-date="${dateKey}" data-week-index="${weekIndex}" role="button" tabindex="0">
  <span class="task-manager-calendar-day__num">${day.getDate()}</span>
  <div class="task-manager-calendar-day__tasks">
    ${visibleTasks.map((task) => `<button class="task-manager-calendar-pill task-manager-status-${task.status}" data-task-id="${task.id}" data-task-action="open" title="${escapeAttr(task.title)}" style="${escapeAttr(this.buildStatusStyleVars(task.status))}">${escapeHtml(task.title)}</button>`).join("")}
    ${overflowCount > 0 ? `<button class="task-manager-calendar-day__more-button" data-action="toggle-calendar-day-expand" data-date="${dateKey}" aria-label="${expanded ? "收起当日事项" : "展开当日事项"}" aria-expanded="${expanded}">${expanded ? "↑" : "more"}</button>` : ""}
  </div>
</div>`;
  }

  private renderTaskCard(task: TaskItem, mode: "timeline" | "kanban" | "calendar-aside" | "week"): string {
    return `<article class="task-manager-card task-manager-card--${mode} task-manager-card--compact task-manager-status-${task.status} task-manager-priority-${task.priority}" data-task-id="${task.id}" style="${escapeAttr(this.buildTaskStyleVars(task))}">
  <div class="task-manager-card__header task-manager-card__header--compact">
    <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</button>
    ${this.renderRowActions(task, { compact: true })}
  </div>
  <div class="task-manager-card__meta-chips">
    ${this.renderProjectMetaChip(task)}
    ${this.renderSourceMetaChip(task)}
    ${this.renderSelectMetaChip("状态", "status", task)}
    ${this.renderPriorityMetaChip(task)}
    ${this.renderDateMetaChip("计划", "planDate", formatMonthDay(task.planStart), toDateKey(task.planStart))}
    ${this.renderDateMetaChip("截止", "dueDate", formatMonthDay(task.dueDate), task.dueDate || "")}
  </div>
</article>`;
  }

  private renderProjectMetaChip(task: TaskItem): string {
    return `<span class="task-manager-card__meta-chip task-manager-card__meta-chip--project" title="${escapeAttr(task.project || "无项目")}">${escapeHtml(task.project || "无项目")}</span>`;
  }

  private renderSourceMetaChip(task: TaskItem): string {
    if (!task.sourceDocId) {
      return `<span class="task-manager-card__meta-chip task-manager-card__meta-chip--source is-manual" title="手动创建"><span class="task-manager-card__meta-value">手动创建</span></span>`;
    }

    const label = task.sourceText?.trim() || "来源笔记";
    return `<button class="task-manager-card__meta-chip task-manager-card__meta-chip--source is-note" data-task-action="open-source" data-source-doc-id="${escapeAttr(task.sourceDocId)}" title="${escapeAttr(label)}"><span class="task-manager-card__meta-value">${escapeHtml(label)}</span></button>`;
  }

  private renderPriorityMetaChip(task: TaskItem): string {
    return this.renderSelectMetaChip("优先级", "priority", task);
  }

  private renderSelectMetaChip(label: string, field: "status" | "priority", task: TaskItem): string {
    if (field === "status") {
      return `<span class="task-manager-card__meta-chip task-manager-card__meta-chip--select">${this.renderInlineStatusBadge(task, "card")}</span>`;
    }
    return `<span class="task-manager-card__meta-chip task-manager-card__meta-chip--select">${this.renderInlinePriorityBadge(task, "card")}</span>`;
  }

  private renderDateMetaChip(label: string, field: "planDate" | "dueDate", display: string, value: string): string {
    return `<label class="task-manager-card__meta-chip task-manager-card__meta-chip--date">
  <span class="task-manager-card__meta-value">${escapeHtml(display || "未设置")}</span>
  <input class="task-manager-card__meta-date-input" data-field="${field}" type="date" value="${escapeAttr(value)}" aria-label="${label}" />
</label>`;
  }

  private renderListMetaChip(field: "status" | "priority", task: TaskItem): string {
    if (field === "status") {
      return `<span class="task-manager-card__meta-chip task-manager-card__meta-chip--select">${this.renderInlineStatusBadge(task, "list")}</span>`;
    }
    return `<span class="task-manager-card__meta-chip task-manager-card__meta-chip--select">${this.renderInlinePriorityBadge(task, "list")}</span>`;
  }

  private renderListDateChip(field: "planDate" | "dueDate", label: string, display: string, value: string): string {
    return `<label class="task-manager-card__meta-chip task-manager-card__meta-chip--date">
  <span class="task-manager-card__meta-value">${escapeHtml(display || "未设置")}</span>
  <input class="task-manager-card__meta-date-input" data-field="${field}" type="date" value="${escapeAttr(value)}" aria-label="${label}" />
</label>`;
  }

  private renderRowActions(task: TaskItem, options: RowActionOptions = {}): string {
    const useCompact = options.compact || this.view === "list";
    const listClass = useCompact ? " task-manager-task__row-actions" : "";
    const buttonClass = useCompact
      ? "task-manager-task__action-button ariaLabel"
      : "block__icon ariaLabel";
    const positionAttr = " data-position=\"north\"";
    const subtaskLabel = useCompact ? "添加子任务" : "创建子任务";
    const editLabel = "编辑任务";
    const deleteLabel = "删除任务";
    const statusLabel = isCompletedTaskStatus(task.status)
      ? "重新打开"
      : "完成任务";
    const editButton = options.showEdit || !useCompact
      ? `<button class="${buttonClass}" data-task-action="edit" aria-label="${editLabel}" title="${editLabel}"${positionAttr}><svg><use xlink:href="#iconEdit"></use></svg></button>`
      : "";
    const deleteButton = (options.showDelete || options.deleteOnly || options.completedView)
      ? `<button class="${buttonClass}" data-task-action="delete" aria-label="${deleteLabel}" title="${deleteLabel}"${positionAttr}><svg><use xlink:href="#iconTaskTrackerTrash"></use></svg></button>`
      : "";

    if (options.deleteOnly) {
      return `<span class="task-manager-actions${listClass}">${deleteButton}</span>`;
    }

    if (options.completedView) {
      return `<span class="task-manager-actions${listClass}">
        <button class="${buttonClass}" data-task-action="edit" aria-label="${editLabel}" title="${editLabel}"${positionAttr}><svg><use xlink:href="#iconEdit"></use></svg></button>
        <button class="${buttonClass}" data-task-action="reopen" aria-label="${statusLabel}" title="${statusLabel}"${positionAttr}><svg><use xlink:href="#iconRefresh"></use></svg></button>
        ${deleteButton}
      </span>`;
    }

    return `<span class="task-manager-actions${listClass}">
  ${editButton}
  <button class="${buttonClass}" data-task-action="subtask" aria-label="${subtaskLabel}" title="${subtaskLabel}"${positionAttr}><svg><use xlink:href="#iconAdd"></use></svg></button>
  ${isCompletedTaskStatus(task.status)
    ? `<button class="${buttonClass}" data-task-action="reopen" aria-label="${statusLabel}" title="${statusLabel}"${positionAttr}><svg><use xlink:href="#iconRefresh"></use></svg></button>`
    : `<button class="${buttonClass}" data-task-action="complete" aria-label="${statusLabel}" title="${statusLabel}"${positionAttr}><svg><use xlink:href="#iconSelect"></use></svg></button>`}
  ${deleteButton}
</span>`;
  }

  private renderInlineStatusBadge(task: TaskItem, mode: "table" | "list" | "card"): string {
    const settings = this.service.store.getSettings();
    const cfg = getStatusBadgeConfig(task.status, settings);
    const open = this.activePopover?.taskId === task.id && this.activePopover?.field === "status";
    const sizeClass = mode === "table" ? "task-manager-inline-badge--table" : "task-manager-inline-badge--compact";
    return `<div class="task-manager-inline-dropdown" data-popover="status" data-task-id="${task.id}">
  <button type="button" class="task-manager-inline-badge ${sizeClass} ${open ? "is-open" : ""}" data-popover-toggle="status" data-task-id="${task.id}" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
    <span class="task-manager-inline-badge__dot" style="--dot-color: ${cfg.dotColor};"></span>
    <span class="task-manager-inline-badge__text">${cfg.label}</span>
    <svg class="task-manager-inline-badge__arrow" viewBox="0 0 10 6" width="8" height="5"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <div class="task-manager-inline-menu" data-popover-menu="status" data-task-id="${task.id}" style="display: ${open ? "" : "none"};">
    ${getAllOrderedStatuses(settings).map((status) => {
      const itemCfg = getStatusBadgeConfig(status, settings);
      const active = status === task.status;
      return `<button type="button" class="task-manager-inline-menu__item ${active ? "is-active" : ""}" data-popover-select="status" data-task-id="${task.id}" data-status-value="${status}">
        <span class="task-manager-inline-menu__dot" style="--dot-color: ${itemCfg.dotColor};"></span>
        <span class="task-manager-inline-menu__label">${itemCfg.label}</span>
        ${active ? `<svg class="task-manager-inline-menu__check" viewBox="0 0 16 16" width="12" height="12"><path d="M4 8l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}
      </button>`;
    }).join("")}
  </div>
</div>`;
  }

  private buildTaskStyleVars(task: TaskItem, extra = ""): string {
    const opacity = isCompletedTaskStatus(task.status)
      ? "0.72"
      : (isCancelledTaskStatus(task.status) ? "0.66" : "1");
    return `${this.buildStatusStyleVars(task.status)} --task-status-opacity: ${opacity}; ${extra}`.trim();
  }

  private buildStatusStyleVars(status: TaskStatus): string {
    const cfg = getStatusBadgeConfig(status, this.service.store.getSettings());
    return `--task-status-accent: ${cfg.dotColor}; --task-status-border: ${cfg.borderColor}; --task-status-bg: ${cfg.bgColor};`;
  }

  private renderInlinePriorityBadge(task: TaskItem, mode: "table" | "list" | "card"): string {
    const cfg = PRIORITY_BADGE_CONFIG[task.priority];
    const open = this.activePopover?.taskId === task.id && this.activePopover?.field === "priority";
    const sizeClass = mode === "table" ? "task-manager-inline-badge--table" : "task-manager-inline-badge--compact";
    return `<div class="task-manager-inline-dropdown" data-popover="priority" data-task-id="${task.id}">
  <button type="button" class="task-manager-inline-badge ${sizeClass} ${open ? "is-open" : ""}" data-popover-toggle="priority" data-task-id="${task.id}" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
    <svg class="task-manager-inline-badge__flag" viewBox="0 0 16 16" width="12" height="12" style="--icon-color: ${cfg.iconColor};"><path d="M4 2v12M4 2h9l-3 3.5L13 9H4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="task-manager-inline-badge__text">${cfg.label}</span>
    <svg class="task-manager-inline-badge__arrow" viewBox="0 0 10 6" width="8" height="5"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <div class="task-manager-inline-menu" data-popover-menu="priority" data-task-id="${task.id}" style="display: ${open ? "" : "none"};">
    ${(["high", "medium", "low", "none"] as TaskPriority[]).map((priority) => {
      const itemCfg = PRIORITY_BADGE_CONFIG[priority];
      const active = priority === task.priority;
      return `<button type="button" class="task-manager-inline-menu__item ${active ? "is-active" : ""}" data-popover-select="priority" data-task-id="${task.id}" data-priority-value="${priority}">
        <svg class="task-manager-inline-menu__flag" viewBox="0 0 16 16" width="12" height="12" style="--icon-color: ${itemCfg.iconColor};"><path d="M4 2v12M4 2h9l-3 3.5L13 9H4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="task-manager-inline-menu__label">${itemCfg.label}</span>
        ${active ? `<svg class="task-manager-inline-menu__check" viewBox="0 0 16 16" width="12" height="12"><path d="M4 8l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}
      </button>`;
    }).join("")}
  </div>
</div>`;
  }

  private closePopover(render = false): void {
    this.activePopoverCleanup?.();
    this.activePopoverCleanup = undefined;
    this.activePopover = null;
    if (render) {
      this.render();
    }
  }

  private openPopover(taskId: string, field: "status" | "priority", trigger: HTMLElement): void {
    this.closePopover();
    this.activePopover = { taskId, field };
    const container = trigger.closest<HTMLElement>("[data-popover]");
    const menu = container?.querySelector<HTMLElement>(`[data-popover-menu="${field}"][data-task-id="${taskId}"]`);
    if (!container || !menu) {
      return;
    }
    trigger.classList.add("is-open");
    menu.style.display = "";
    const resetPosition = this.positionInlinePopover(menu, trigger);
    const handleViewportChange = () => this.positionInlinePopover(menu, trigger);
    window.addEventListener("resize", handleViewportChange);
    const body = this.container.querySelector<HTMLElement>(".task-manager__body");
    const list = this.container.querySelector<HTMLElement>(".task-manager-list");
    body?.addEventListener("scroll", handleViewportChange, { passive: true });
    list?.addEventListener("scroll", handleViewportChange, { passive: true });
    this.activePopoverCleanup = () => {
      window.removeEventListener("resize", handleViewportChange);
      body?.removeEventListener("scroll", handleViewportChange);
      list?.removeEventListener("scroll", handleViewportChange);
      resetPosition();
      trigger.classList.remove("is-open");
      menu.style.display = "none";
    };
  }

  private positionInlinePopover(menu: HTMLElement, trigger: HTMLElement): () => void {
    const triggerRect = trigger.getBoundingClientRect();
    const menuHeight = Math.min(menu.offsetHeight || 220, 280);
    const menuWidth = Math.max(menu.offsetWidth || 148, triggerRect.width);
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const fitsBelow = spaceBelow >= Math.min(menuHeight, 220);
    const fitsAbove = spaceAbove >= Math.min(menuHeight, 220);
    let top = fitsBelow || !fitsAbove
      ? triggerRect.bottom + 4
      : triggerRect.top - menuHeight - 4;
    top = Math.max(8, Math.min(top, viewportHeight - menuHeight - 8));
    let left = triggerRect.left;
    left = Math.max(8, Math.min(left, viewportWidth - menuWidth - 8));

    menu.style.position = "fixed";
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.minWidth = `${Math.max(triggerRect.width, 148)}px`;
    menu.style.maxHeight = `${Math.min(Math.max(spaceBelow, spaceAbove), 280)}px`;
    menu.style.overflowY = "auto";
    menu.style.zIndex = "220";

    return () => {
      menu.style.position = "";
      menu.style.top = "";
      menu.style.left = "";
      menu.style.minWidth = "";
      menu.style.maxHeight = "";
      menu.style.overflowY = "";
      menu.style.zIndex = "";
    };
  }

  private bind(): void {
    this.container.onclick = (event) => this.handleClick(event);
    this.container.onchange = (event) => this.handleChange(event);
    this.container.oninput = (event) => this.handleInput(event);
    this.container.onkeydown = (event) => this.handleKeydown(event);
    this.container.onpointerdown = (event) => this.handlePointerDown(event);
    this.container.removeEventListener("compositionstart", this.compositionStartListener);
    this.container.removeEventListener("compositionend", this.compositionEndListener);
    this.container.addEventListener("compositionstart", this.compositionStartListener);
    this.container.addEventListener("compositionend", this.compositionEndListener);
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const viewButton = target.closest<HTMLElement>("[data-manager-view]");
    if (viewButton) {
      const nextView = viewButton.dataset.managerView as TaskManagerView;
      if (nextView !== this.view) {
        this.view = nextView;
        this.statusDropdownOpen = false;
        this.bulkParentMenuOpen = false;
      }
      this.render();
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "new-task") {
        this.actions.newTask({});
        return;
      }
      if (action === "open-page-config") {
        if (this.view === "completed") {
          void this.openSettingsDialog("completed");
        } else if (this.view === "table") {
          void this.openSettingsDialog("table");
        }
        return;
      }
      if (action === "open-table-config") {
        // kept for compatibility — same as open-page-config for table
        void this.openSettingsDialog("table");
        return;
      }
      if (action === "toggle-status-dropdown") {
        event.preventDefault();
        event.stopPropagation();
        this.statusDropdownOpen = !this.statusDropdownOpen;
        this.bulkParentMenuOpen = false;
        this.render();
        return;
      }
      if (action === "toggle-parent-bulk-menu") {
        event.preventDefault();
        event.stopPropagation();
        this.bulkParentMenuOpen = !this.bulkParentMenuOpen;
        this.statusDropdownOpen = false;
        this.render({ preserveTableScroll: this.view === "table" });
        return;
      }
      if (action === "toggle-freeze-first-column") {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFreezeFirstColumn();
        return;
      }
      if (action === "expand-all-parents") {
        event.preventDefault();
        event.stopPropagation();
        this.bulkParentMenuOpen = false;
        this.expandAllParentTasks();
        return;
      }
      if (action === "collapse-all-parents") {
        event.preventDefault();
        event.stopPropagation();
        this.bulkParentMenuOpen = false;
        this.collapseAllParentTasks();
        return;
      }
      if (action === "select-status-filter") {
        event.stopPropagation();
        const statusKey = actionButton.dataset.statusKey as string;
        const allowedKeys = new Set<string>(["all", ...getStatusFilterOptions(this.service.store.getSettings()).map((option) => String(option.key))]);
        if (allowedKeys.has(statusKey)) {
          this.viewFilters.set(this.view, statusKey as "all" | TaskStatus);
          this.statusDropdownOpen = false;
          this.bulkParentMenuOpen = false;
          this.render();
        }
        return;
      }
      if (action === "sync") {
        void this.runSync();
        return;
      }
      if (action === "prev-month") {
        this.month = addMonths(this.month, -1);
        this.expandedCalendarDateKeys.clear();
        this.render();
        return;
      }
      if (action === "next-month") {
        this.month = addMonths(this.month, 1);
        this.expandedCalendarDateKeys.clear();
        this.render();
        return;
      }
      if (action === "today-month") {
        this.month = monthStart(new Date());
        this.expandedCalendarDateKeys.clear();
        this.render();
        return;
      }
      if (action === "prev-week") {
        this.weekStart = new Date(this.weekStart.getFullYear(), this.weekStart.getMonth(), this.weekStart.getDate() - 7);
        this.render();
        return;
      }
      if (action === "next-week") {
        this.weekStart = new Date(this.weekStart.getFullYear(), this.weekStart.getMonth(), this.weekStart.getDate() + 7);
        this.render();
        return;
      }
      if (action === "today-week") {
        this.weekStart = startOfWeek(new Date());
        this.render();
        return;
      }
      if (action === "toggle-calendar-week") {
        this.calendarMode = "week";
        this.weekStart = startOfWeek(new Date());
        this.render();
        return;
      }
      if (action === "toggle-calendar-month") {
        this.calendarMode = "month";
        this.month = monthStart(this.weekStart);
        this.render();
        return;
      }
      if (action === "toggle-unplanned") {
        this.calendarUnplannedVisible = !this.calendarUnplannedVisible;
        this.render();
        return;
      }
      if (action === "toggle-calendar-day-expand") {
        event.preventDefault();
        event.stopPropagation();
        const dateKey = actionButton.dataset.date;
        if (!dateKey) {
          return;
        }
        if (this.expandedCalendarDateKeys.has(dateKey)) {
          this.expandedCalendarDateKeys.delete(dateKey);
        } else {
          this.expandedCalendarDateKeys.add(dateKey);
        }
        this.render();
        return;
      }
      if (action === "export-completed-group") {
        event.preventDefault();
        event.stopPropagation();
        const groupKey = actionButton.dataset.groupKey;
        if (!groupKey) {
          return;
        }
        void this.runUpdate(async () => {
          const report = await this.service.exportCompletedWeekReport(groupKey);
          showMessage(`已导出周报：${report.title}`);
        });
        return;
      }
      if (action === "toggle-completed-group") {
        const groupKey = actionButton.dataset.groupKey;
        if (!groupKey) {
          return;
        }
        if (this.expandedCompletedGroups.has(groupKey)) {
          this.expandedCompletedGroups.delete(groupKey);
        } else {
          this.expandedCompletedGroups.add(groupKey);
        }
        this.completedGroupStateInitialized = true;
        this.render();
        return;
      }
    }

    // ── Inline popover handling ──────────────────────────

    const popoverToggle = target.closest<HTMLElement>("[data-popover-toggle]");
    if (popoverToggle) {
      event.preventDefault();
      event.stopPropagation();
      const field = popoverToggle.dataset.popoverToggle as "status" | "priority";
      const taskId = popoverToggle.dataset.taskId;
      if (field && taskId) {
        if (this.activePopover?.taskId === taskId && this.activePopover?.field === field) {
          this.closePopover();
        } else {
          this.openPopover(taskId, field, popoverToggle);
        }
      }
      return;
    }

    const popoverSelect = target.closest<HTMLElement>("[data-popover-select]");
    if (popoverSelect) {
      event.preventDefault();
      event.stopPropagation();
      const field = popoverSelect.dataset.popoverSelect as "status" | "priority";
      const taskId = popoverSelect.dataset.taskId;
      if (!field || !taskId) {
        return;
      }
      const task = this.service.store.get(taskId);
      if (!task) {
        return;
      }
      if (field === "status") {
        const newStatus = popoverSelect.dataset.statusValue as TaskStatus;
        if (newStatus && newStatus !== task.status) {
          void this.runUpdate(() => this.service.updateTask(task.id, { status: newStatus }));
        }
      } else {
        const newPriority = popoverSelect.dataset.priorityValue as TaskPriority;
        if (newPriority && newPriority !== task.priority) {
          void this.runUpdate(() => this.service.updateTask(task.id, { priority: newPriority }));
        }
      }
      this.closePopover();
      return;
    }

    // Close inline popover when clicking outside
    if (this.activePopover && !target.closest("[data-popover]")) {
      this.closePopover();
      return;
    }

    if (this.bulkParentMenuOpen && !target.closest(".task-manager-bulk-parent-dropdown")) {
      this.bulkParentMenuOpen = false;
      this.render({ preserveTableScroll: this.view === "table" });
      return;
    }

    // Close status filter dropdown when clicking outside
    if (this.statusDropdownOpen && !target.closest(".task-manager-filter-dropdown")) {
      this.statusDropdownOpen = false;
      this.render();
      return;
    }

    const taskAction = target.closest<HTMLElement>("[data-task-action]");
    if (taskAction) {
      event.stopPropagation();
      const task = this.taskFromElement(taskAction);
      if (task) {
        this.handleTaskAction(taskAction.dataset.taskAction || "", task, taskAction);
      }
      return;
    }

    const dateChip = target.closest<HTMLElement>(".task-manager-card__meta-chip--date");
    if (dateChip) {
      const input = dateChip.querySelector<HTMLInputElement>("input[type='date']");
      if (input && event.target !== input) {
        event.preventDefault();
        event.stopPropagation();
        input.focus();
        if (typeof input.showPicker === "function") {
          input.showPicker();
        } else {
          input.click();
        }
        return;
      }
    }

    const day = target.closest<HTMLElement>(".task-manager-calendar-day");
    if (day?.dataset.date) {
      this.actions.newTask({ presetPlanDate: day.dataset.date });
    }

    const weekRow = target.closest<HTMLElement>(".task-manager-calendar-week-row");
    if (weekRow?.dataset.date) {
      this.actions.newTask({ presetPlanDate: weekRow.dataset.date });
    }
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.dataset.field === "month") {
      const date = new Date(`${target.value}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
        this.expandedCalendarDateKeys.clear();
        this.render();
      }
      return;
    }

    const field = target.closest<HTMLElement>("[data-field]");
    const task = field ? this.taskFromElement(field) : undefined;
    if (!field || !task) {
      return;
    }

    if (field.dataset.field === "planDate") {
      void this.runUpdate(() => this.service.updateTask(task.id, {
        planStart: mergeDateInputWithExisting((field as HTMLInputElement).value, task.planStart)
      }));
    } else if (field.dataset.field === "dueDate") {
      void this.runUpdate(() => this.service.updateTask(task.id, { dueDate: (field as HTMLInputElement).value || undefined }));
    }
  }

  private handleInput(event: Event): void {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.dataset.field !== "search") {
      return;
    }

    this.search = target.value;
    if (this.isComposingSearch) {
      return;
    }

    const cursor = target.selectionStart ?? target.value.length;
    this.render();
    const nextSearch = this.container.querySelector<HTMLInputElement>("[data-field='search']");
    nextSearch?.focus();
    nextSearch?.setSelectionRange(cursor, cursor);
  }

  private handlePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    const resizeHandle = target.closest<HTMLElement>("[data-column-resize]");
    if (resizeHandle) {
      const columnKey = resizeHandle.dataset.columnResize as TableColumnKey | undefined;
      const columns = this.currentTableColumns();
      const column = columnKey ? columns.find((item) => item.key === columnKey) : undefined;
      if (!column) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const widths = this.currentTableColumnWidths();
      const startWidth = widths[column.key];
      const move = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        if (this.view === "completed") {
          this.completedTableColumnWidths = {
            ...this.completedTableColumnWidths,
            [column.key]: Math.max(column.minWidth, Math.round(startWidth + delta))
          };
        } else {
          this.tableColumnWidths = {
            ...this.tableColumnWidths,
            [column.key]: Math.max(column.minWidth, Math.round(startWidth + delta))
          };
        }
        this.applyTableColumnWidths();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.resizeCleanup = undefined;
        void this.persistTableColumnWidths();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
      this.resizeCleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.resizeCleanup = undefined;
      };
      return;
    }
  }

  private applyTableColumnWidths(): void {
    const tables = Array.from(this.container.querySelectorAll<HTMLTableElement>(".task-manager-table"));
    if (!tables.length) {
      return;
    }

    const columns = this.currentTableColumns();
    const widths = this.currentTableColumnWidths();
    for (const table of tables) {
      const cols = table.querySelectorAll<HTMLTableColElement>("colgroup col");
      if (!cols.length) {
        continue;
      }

      if (this.view === "completed") {
        const tableWidth = this.completedTableWidthWithColumns(this.effectiveCompletedTableColumns());
        table.style.width = `${tableWidth}px`;
        table.style.minWidth = `${tableWidth}px`;
      }

      columns.forEach((column, index) => {
        const col = cols[index];
        if (col) {
          col.style.width = `${widths[column.key]}px`;
          col.style.minWidth = `${column.minWidth}px`;
        }
      });
    }
  }

  private currentTableColumns(): TableColumnDef[] {
    if (this.view === "completed") {
      return this.effectiveCompletedTableColumns();
    }
    return this.effectiveTableColumns();
  }

  private currentTableColumnWidths(): Record<TableColumnKey, number> {
    return this.view === "completed" ? this.completedTableColumnWidths : this.tableColumnWidths;
  }

  private async persistTableColumnWidths(): Promise<void> {
    if (this.view === "completed") {
      await this.service.store.setSettings({ completedTableColumnWidths: this.completedTableColumnWidths });
      return;
    }

    await this.service.store.setSettings({ tableColumnWidths: this.tableColumnWidths });
  }


  private handleCompositionStart(event: CompositionEvent): void {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.dataset.field === "search") {
      this.isComposingSearch = true;
    }
  }

  private handleCompositionEnd(event: CompositionEvent): void {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.dataset.field !== "search") {
      return;
    }

    this.isComposingSearch = false;
    this.search = target.value;
    this.render();
    const nextSearch = this.container.querySelector<HTMLInputElement>("[data-field='search']");
    const cursor = nextSearch?.value.length ?? 0;
    nextSearch?.focus();
    nextSearch?.setSelectionRange(cursor, cursor);
  }

  private handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;

    if (event.key === "Escape" && this.activePopover) {
      event.preventDefault();
      this.closePopover();
      this.render();
      return;
    }

    const expandButton = target.closest<HTMLElement>("[data-action='toggle-calendar-day-expand']");
    if (expandButton && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      const dateKey = expandButton.dataset.date;
      if (!dateKey) {
        return;
      }
      if (this.expandedCalendarDateKeys.has(dateKey)) {
        this.expandedCalendarDateKeys.delete(dateKey);
      } else {
        this.expandedCalendarDateKeys.add(dateKey);
      }
      this.render();
      return;
    }
    const day = target.closest<HTMLElement>(".task-manager-calendar-day");
    if (day?.dataset.date && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.actions.newTask({ presetPlanDate: day.dataset.date });
    }
  }

  private handleTaskAction(action: string, task: TaskItem, element?: HTMLElement): void {
    if (action === "open") {
      if (this.view === "table" || this.view === "calendar") {
        if (this.view === "table") {
          this.pendingTableFocusTaskId = task.id;
        }
        this.actions.editTask(task);
      } else {
        this.actions.openTask(task);
      }
    } else if (action === "open-source") {
      const docId = element?.dataset.sourceDocId || task.sourceDocId;
      if (docId) {
        this.actions.openSourceDoc?.(docId);
      }
    } else if (action === "open-note-folder") {
      void this.openTaskNoteFolder(task);
    } else if (action === "edit") {
      if (this.view === "table") {
        this.pendingTableFocusTaskId = task.id;
      }
      this.actions.editTask(task);
    } else if (action === "subtask") {
      this.actions.createSubtask(task.id);
    } else if (action === "complete") {
      void this.runUpdate(() => this.service.completeTask(task.id));
    } else if (action === "reopen") {
      void this.runUpdate(() => this.service.reopenTask(task.id));
    } else if (action === "delete") {
      void this.deleteTask(task);
    } else if (action === "toggle-children") {
      if (this.collapsedTaskIds.has(task.id)) {
        this.collapsedTaskIds.delete(task.id);
      } else {
        this.collapsedTaskIds.add(task.id);
      }
      this.render({ preserveTableScroll: this.view === "table" });
    }
  }

  private async deleteTask(task: TaskItem): Promise<void> {
    const confirmed = window.confirm(`确定删除“${task.title}”及其所有子任务吗？对应的任务文档也会被删除。`);
    if (!confirmed) {
      return;
    }

    try {
      const count = await this.service.deleteTaskTree(task.id);
      showMessage(count > 0 ? `已删除 ${count} 个任务` : "任务已不存在");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "删除任务失败", 5000, "error");
      this.render();
    }
  }

  private async openTaskNoteFolder(task: TaskItem): Promise<void> {
    const noteFolderPath = task.noteFolderPath?.trim();
    if (!noteFolderPath) {
      return;
    }
    if (!supportsLocalFolderOpen()) {
      showMessage("当前环境不支持打开本地文件夹。", 5000, "error");
      return;
    }
    try {
      await openLocalFolderPath(noteFolderPath);
    } catch {
      showMessage("无法打开该文件夹，请检查路径是否存在。", 5000, "error");
    }
  }

  private toggleFreezeFirstColumn(): void {
    this.freezeFirstColumn = !this.freezeFirstColumn;
    writeFreezeFirstColumnState(this.freezeFirstColumn);
    this.render({ preserveTableScroll: true });
  }

  private async runSync(): Promise<void> {
    try {
      if (this.actions.sync) {
        await this.actions.sync();
        showMessage("任务面板已同步");
        return;
      }

      const removed = await this.service.syncDeletedDocs();
      const synced = await this.service.syncAllTaskDocuments();
      showMessage(removed > 0 ? `已清理 ${removed} 个已删除任务记录，同步 ${synced} 个任务文档` : `已同步 ${synced} 个任务文档`);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "同步任务失败", 5000, "error");
    }
  }

  private async runUpdate(action: () => Promise<unknown>): Promise<void> {
    this.closePopover();
    try {
      await action();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "更新任务失败", 5000, "error");
      this.render();
    }
  }

  private initializeCompletedGroupState(groups: CompletedGroup[]): void {
    if (this.completedGroupStateInitialized || !groups.length) {
      return;
    }
    this.expandedCompletedGroups = new Set(groups.slice(0, 2).map((group) => group.key));
    this.completedGroupStateInitialized = true;
  }

  private tasksForCurrentView(): TaskItem[] {
    const collections = this.getTaskCollections();
    if (this.view === "calendar") {
      let tasks = collections.allTasks;
      if (this.currentFilter !== "all") {
        tasks = tasks.filter((t) => t.status === this.currentFilter);
      }
      return this.filterTasksBySearch(tasks);
    }
    if (this.view === "completed") {
      // Completed view is independent of status filter — always show all completed
      return this.filterTasksBySearch(collections.completedTasks);
    }
    // Active views: apply per-view status filter
    let active = collections.activeTasks;
    if (this.currentFilter !== "all") {
      active = active.filter((t) => t.status === this.currentFilter);
    }
    return this.filterTasksBySearch(active);
  }

  private getTaskCollections(): { allTasks: TaskItem[]; activeTasks: TaskItem[]; completedTasks: TaskItem[] } {
    const allTasks = this.service.store.all();
    const activeStatuses = new Set(getActiveTaskStatuses(this.service.store.getSettings()));
    return {
      allTasks,
      activeTasks: allTasks.filter((task) => activeStatuses.has(task.status)),
      completedTasks: allTasks.filter((task) => isCompletedTaskStatus(task.status))
    };
  }

  private filterTasksBySearch(tasks: TaskItem[]): TaskItem[] {
    const query = normalizeSearch(this.search);
    if (!query) {
      return tasks;
    }

    return tasks.filter((task) => {
      const parent = task.parentId ? this.service.store.get(task.parentId) : undefined;
      const haystack = [
        task.title,
        task.project,
        task.sourceText,
        task.sourceDocId ? "来源笔记" : "手动创建",
        getStatusLabel(task.status, this.service.store.getSettings()),
        TASK_PRIORITY_LABELS[task.priority],
        task.createdAt,
        task.planStart,
        task.dueDate,
        task.completedAt,
        parent?.title
      ].filter(Boolean).join(" ");
      return normalizeSearch(haystack).includes(query);
    });
  }

  private taskFromElement(element: HTMLElement): TaskItem | undefined {
    const owner = element.closest<HTMLElement>("[data-task-id]");
    const taskId = owner?.dataset.taskId;
    return taskId ? this.service.store.get(taskId) : undefined;
  }

  private ensureInitialCollapsedParents(): void {
    if (this.initialCollapsedParentsApplied) {
      return;
    }
    const tasks = this.service.store.all();
    if (!tasks.length) {
      return;
    }
    this.initialCollapsedParentsApplied = true;
    for (const taskId of this.parentTaskIdsForTasks(tasks)) {
      this.collapsedTaskIds.add(taskId);
    }
  }

  private parentTaskIdsForTasks(tasks: TaskItem[]): string[] {
    return collectParentTaskIds(tasks);
  }

  private expandAllParentTasks(): void {
    const parentTaskIds = this.parentTaskIdsForTasks(this.tasksForCurrentView());
    if (!parentTaskIds.length) {
      return;
    }
    for (const taskId of parentTaskIds) {
      this.collapsedTaskIds.delete(taskId);
    }
    this.render({ preserveTableScroll: true });
  }

  private collapseAllParentTasks(): void {
    const parentTaskIds = this.parentTaskIdsForTasks(this.tasksForCurrentView());
    if (!parentTaskIds.length) {
      return;
    }
    for (const taskId of parentTaskIds) {
      this.collapsedTaskIds.add(taskId);
    }
    this.render({ preserveTableScroll: true });
  }
}

function countChildren(tasks: TaskItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.parentId) {
      counts.set(task.parentId, (counts.get(task.parentId) || 0) + 1);
    }
  }
  return counts;
}

function includeAncestors(tasks: TaskItem[], matched: Set<string>): Set<string> {
  const visible = new Set(matched);
  const byId = new Map(tasks.map((task) => [task.id, task]));

  for (const id of matched) {
    let current = byId.get(id);
    while (current?.parentId) {
      visible.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }

  return visible;
}

function buildTaskTree(tasks: TaskItem[], visible: Set<string>, matched: Set<string>): TaskTreeNode[] {
  const nodes = new Map<string, TaskTreeNode>();
  for (const task of tasks) {
    if (visible.has(task.id)) {
      nodes.set(task.id, {
        task,
        children: [],
        contextOnly: !matched.has(task.id)
      });
    }
  }

  const roots: TaskTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.task.parentId ? nodes.get(node.task.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function collectParentTaskIds(tasks: TaskItem[]): string[] {
  const byId = new Set(tasks.map((task) => task.id));
  const byDocId = new Map(tasks.map((task) => [task.docId, task.id]));
  const ids = new Set<string>();

  for (const task of tasks) {
    if (!task.parentId) {
      continue;
    }
    const parentId = byId.has(task.parentId) ? task.parentId : byDocId.get(task.parentId);
    if (parentId) {
      ids.add(parentId);
    }
  }

  return Array.from(ids);
}

function buildCompletedTaskTree(tasks: TaskItem[]): TaskTreeNode[] {
  const nodes = new Map<string, TaskTreeNode>();
  const nodesByPath = new Map<string, TaskTreeNode>();
  for (const task of tasks) {
    const node: TaskTreeNode = {
      task,
      children: [],
      contextOnly: false
    };
    nodes.set(task.id, node);
    const pathKey = taskPathKey(task.path);
    if (pathKey) {
      nodesByPath.set(pathKey, node);
    }
  }

  const roots: TaskTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = completedParentNode(node.task, nodes, nodesByPath);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function groupCompletedTasksByWeek(tasks: TaskItem[]): CompletedGroup[] {
  const groups = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    const key = weekKey(task.completedAt || task.createdAt);
    const group = groups.get(key) || [];
    group.push(task);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, groupTasks]) => {
      const orderedTasks = [...groupTasks].sort(compareCompletedTaskDisplayOrder);
      return {
        key,
        label: formatCompletedWeekLabel(key),
        tasks: orderedTasks,
        tree: buildCompletedTaskTree(orderedTasks)
      };
    });
}

function compareCompletedTaskDisplayOrder(a: TaskItem, b: TaskItem): number {
  return compareOptionalDates(a.completedAt || a.createdAt, b.completedAt || b.createdAt, "desc")
    || compareOptionalDates(a.createdAt, b.createdAt, "desc")
    || compareOptionalDates(a.updatedAt, b.updatedAt, "desc")
    || a.title.localeCompare(b.title, "zh-Hans-CN");
}

function completedParentNode(task: TaskItem, nodes: Map<string, TaskTreeNode>, nodesByPath: Map<string, TaskTreeNode>): TaskTreeNode | undefined {
  if (task.parentId) {
    return nodes.get(task.parentId);
  }

  const parentPath = parentTaskPathKey(task.path);
  return parentPath ? nodesByPath.get(parentPath) : undefined;
}


function taskPathKey(path?: string): string {
  if (!path) {
    return "";
  }
  return path.replace(/\.sy$/i, "").replace(/\/+$/g, "").replace(/^\/+/, "");
}

function parentTaskPathKey(path?: string): string {
  const key = taskPathKey(path);
  const lastSlash = key.lastIndexOf("/");
  return lastSlash > 0 ? key.slice(0, lastSlash) : "";
}

function groupByPlanDate(tasks: TaskItem[], options: { unplannedFirst?: boolean; plannedDescending?: boolean } = {}): Array<{ key: string; label: string; tasks: TaskItem[] }> {
  const groups = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    const key = toDateKey(task.planStart) || "unplanned";
    const group = groups.get(key) || [];
    group.push(task);
    groups.set(key, group);
  }

  const direction = options.plannedDescending ? -1 : 1;
  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === "unplanned") {
        return options.unplannedFirst ? -1 : 1;
      }
      if (b === "unplanned") {
        return options.unplannedFirst ? 1 : -1;
      }
      return a.localeCompare(b) * direction;
    })
    .map(([key, groupTasks]) => ({
      key,
      label: key === "unplanned" ? "未安排" : key,
      tasks: key === "unplanned"
        ? [...groupTasks]
        : [...groupTasks].sort(compareTimelineTasks)
    }));
}

function compareTimelineTasks(a: TaskItem, b: TaskItem): number {
  return compareOptionalDates(a.planStart, b.planStart, "desc")
    || compareOptionalDates(a.updatedAt, b.updatedAt, "desc")
    || a.title.localeCompare(b.title, "zh-Hans-CN");
}


function defaultTableColumnWidths(columns: TableColumnDef[]): Record<TableColumnKey, number> {
  const widths = {
    task: 0,
    project: 0,
    source: 0,
    createdAt: 0,
    status: 0,
    priority: 0,
    latest: 0,
    progress: 0,
    plan: 0,
    due: 0,
    actions: 0,
    planStart: 0,
    completedAt: 0
  };
  for (const column of columns) {
    widths[column.key] = column.defaultWidth;
  }
  return widths;
}

function readFreezeFirstColumnState(): boolean {
  try {
    return window.localStorage.getItem(FREEZE_FIRST_COLUMN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeFreezeFirstColumnState(value: boolean): void {
  try {
    window.localStorage.setItem(FREEZE_FIRST_COLUMN_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // ignore storage failures
  }
}

function normalizeTableColumnWidths(columns: TableColumnDef[], raw?: Partial<Record<TableColumnKey, number>>): Record<TableColumnKey, number> {
  const next = defaultTableColumnWidths(columns);
  for (const column of columns) {
    const value = raw?.[column.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[column.key] = Math.max(column.minWidth, Math.round(value));
    }
  }
  return next;
}


function calendarDays(month: Date): Date[] {
  const first = monthStart(month);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const startOffset = (first.getDay() + 6) % 7;
  const endOffset = (7 - last.getDay()) % 7;
  const normalizedEndOffset = endOffset === 7 ? 0 : endOffset;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - startOffset);
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + normalizedEndOffset);
  const dayCount = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Array.from({ length: dayCount }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function reorderStringList(values: string[], dragged: string, target: string): string[] {
  if (!dragged || !target || dragged === target) {
    return values;
  }
  const next = [...values];
  const fromIndex = next.indexOf(dragged);
  const toIndex = next.indexOf(target);
  if (fromIndex === -1 || toIndex === -1) {
    return values;
  }
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, dragged);
  return next;
}

function resolveMigrationTarget(target: string, migrations: StatusMigrationDraft[]): string {
  let current = target;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const next = migrations.find((item) => item.fromStatus === current)?.toStatus;
    if (!next || next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

function groupTasksByDate(tasks: TaskItem[]): Record<string, TaskItem[]> {
  const result: Record<string, TaskItem[]> = {};
  for (const task of tasks) {
    const key = toDateKey(task.planStart);
    if (!key) {
      continue;
    }
    result[key] ||= [];
    result[key].push(task);
  }
  return result;
}

function monthInputValue(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

function calendarGridStyle(weekRows: number, expandedWeekIndexes: Set<number>): string {
  const compactHeight = weekRows === 5 ? 92 : 78;
  const expandedHeight = weekRows === 5 ? 196 : 172;
  const rows = Array.from({ length: weekRows }, (_, index) => {
    const height = expandedWeekIndexes.has(index) ? expandedHeight : compactHeight;
    return `minmax(${height}px, 1fr)`;
  });
  return `grid-template-rows: ${rows.join(" ")};`;
}

function normalizeSearch(value?: string): string {
  return (value || "").trim().toLocaleLowerCase();
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

function renderChevron(expanded: boolean): string {
  return `<span class="task-tree-chevron${expanded ? " is-expanded" : ""}" aria-hidden="true"></span>`;
}

function renderBulkParentIcon(type: "entry" | "expand" | "collapse"): string {
  if (type === "expand") {
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M5.5 7.5 8 10l2.5-2.5M8 2.5v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (type === "collapse") {
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11.5h10M5.5 8.5 8 6l2.5 2.5M8 13.5v-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.25h6M3 8h6M3 11.75h6M10.5 3v3M9 4.5l1.5 1.5L12 4.5M10.5 13v-3M9 11.5l1.5-1.5 1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderSourceFolderIcon(): string {
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H7.5L6.5 2.5H3a1 1 0 0 0-1 1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

function renderFreezeColumnIcon(active: boolean): string {
  if (active) {
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5 13 6l-2 1.2-.7 3.8-1.8-1.8-2.9 2.9-.9-.9 2.9-2.9L5.8 6.5l3.7-.8 1.3-1.9Z" fill="currentColor"/></svg>`;
  }
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5 13 6l-2 1.2-.7 3.8-1.8-1.8-2.9 2.9-.9-.9 2.9-2.9L5.8 6.5l3.7-.8 1.3-1.9Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}

function renderControlsIcon(): string {
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="5" cy="4" r="1.35" fill="#FFFFFF" stroke="currentColor" stroke-width="1.2"/><circle cx="10.5" cy="8" r="1.35" fill="#FFFFFF" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="12" r="1.35" fill="#FFFFFF" stroke="currentColor" stroke-width="1.2"/></svg>`;
}

import { showMessage } from "siyuan";
import {
  addMonths,
  formatDateKey,
  formatHumanDate,
  formatMonthDay,
  fromDateInput,
  monthStart,
  monthTitle,
  sameMonth,
  toDateKey
} from "../date";
import type { TaskService } from "../document";
import { escapeHtml, priorityOptions, statusOptions } from "../dialogs/TaskDialog";
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TableColumnKey,
  type TaskItem,
  type TaskPriority,
  type TaskStatus
} from "../types";

export type TaskManagerView = "table" | "list" | "timeline" | "kanban" | "calendar";

export interface TaskManagerNewTaskOptions {
  parentId?: string;
  presetPlanDate?: string;
}

export interface TaskManagerTabActions {
  newTask: (options?: TaskManagerNewTaskOptions) => void;
  createSubtask: (parentId: string) => void;
  openTask: (task: TaskItem) => void;
  openSourceDoc?: (docId: string) => void;
  sync?: () => Promise<unknown> | unknown;
}

interface TaskManagerTabData {
  view?: TaskManagerView;
  month?: string;
  search?: string;
  calendarAsideWidth?: number;
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
}

const VIEWS: Array<{ value: TaskManagerView; label: string }> = [
  { value: "table", label: "表格" },
  { value: "list", label: "清单" },
  { value: "timeline", label: "时间轴" },
  { value: "kanban", label: "看板" },
  { value: "calendar", label: "日历" }
];

const STATUSES = Object.keys(TASK_STATUS_LABELS) as TaskStatus[];

const TABLE_COLUMNS: TableColumnDef[] = [
  { key: "task", label: "任务", defaultWidth: 320, minWidth: 220, className: "is-task" },
  { key: "project", label: "项目", defaultWidth: 140, minWidth: 110 },
  { key: "source", label: "来源", defaultWidth: 170, minWidth: 130 },
  { key: "status", label: "状态", defaultWidth: 120, minWidth: 96 },
  { key: "priority", label: "优先级", defaultWidth: 120, minWidth: 96 },
  { key: "plan", label: "计划", defaultWidth: 144, minWidth: 124 },
  { key: "due", label: "截止", defaultWidth: 144, minWidth: 124 },
  { key: "actions", label: "操作", defaultWidth: 96, minWidth: 84, className: "is-actions" }
];

export class TaskManagerTab {
  private view: TaskManagerView = "table";
  private search = "";
  private month = monthStart(new Date());
  private collapsedTaskIds = new Set<string>();
  private isComposingSearch = false;
  private tableColumnWidths: Record<TableColumnKey, number> = defaultTableColumnWidths();
  private calendarAsideWidth = DEFAULT_CALENDAR_ASIDE_WIDTH;
  private resizeCleanup?: () => void;
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
    const settings = this.service.store.getSettings();
    this.tableColumnWidths = normalizeTableColumnWidths(settings.tableColumnWidths);
    this.calendarAsideWidth = normalizeCalendarAsideWidth(data?.calendarAsideWidth ?? settings.calendarAsideWidth);
    this.unsubscribe = this.service.onChange(() => this.render());
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

  render(): void {
    const tasks = this.filteredTasks();

    this.container.innerHTML = `<div class="task-manager task-manager--${this.view}">
  ${this.renderToolbar(tasks.length)}
  <div class="task-manager__body">
    ${tasks.length ? this.renderCurrentView(tasks) : `<div class="task-manager-empty">这里暂时没有匹配任务。</div>`}
  </div>
</div>`;

    this.bind();
  }

  private renderToolbar(count: number): string {
    return `<div class="task-manager-toolbar">
  <div class="task-manager-toolbar__title">
    <svg class="task-manager-toolbar__icon"><use xlink:href="#iconTaskTracker"></use></svg>
    <span>任务控制面板</span>
    <small>${count}</small>
  </div>
  <div class="task-manager-toolbar__views" role="tablist" aria-label="任务视图">
    ${VIEWS.map((view) => `<button class="task-manager-view-button ${this.view === view.value ? "is-active" : ""}" data-manager-view="${view.value}" aria-label="${view.label}" role="tab" aria-selected="${this.view === view.value}"><span>${view.label}</span></button>`).join("")}
  </div>
  <label class="task-manager-toolbar__search">
    <svg><use xlink:href="#iconSearch"></use></svg>
    <input class="b3-text-field" data-field="search" value="${escapeAttr(this.search)}" placeholder="搜索任务、项目等" />
  </label>
  <span class="fn__flex-1"></span>
  <button class="b3-button b3-button--text" data-action="new-task"><svg><use xlink:href="#iconAdd"></use></svg><span>新建</span></button>
  <button class="block__icon ariaLabel" data-action="sync" aria-label="同步任务文档" data-position="south"><svg><use xlink:href="#iconRefresh"></use></svg></button>
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
      case "table":
      default:
        return this.renderTableView(tasks);
    }
  }

  private renderTableView(tasks: TaskItem[]): string {
    const childCounts = countChildren(this.service.store.all());
    const matched = new Set(tasks.map((task) => task.id));
    const visible = includeAncestors(this.service.store.all(), matched);
    const tree = buildTaskTree(this.service.store.all(), visible, matched);

    return `<div class="task-manager-table-wrap">
  <table class="task-manager-table">
    <colgroup>
      ${TABLE_COLUMNS.map((column) => `<col style="width: ${this.tableColumnWidths[column.key]}px; min-width: ${column.minWidth}px;" />`).join("")}
    </colgroup>
    <thead>
      <tr>
        ${TABLE_COLUMNS.map((column) => this.renderTableHeaderCell(column)).join("")}
      </tr>
    </thead>
    <tbody>
      ${tree.map((node) => this.renderTableNode(node, 0, childCounts)).join("")}
    </tbody>
  </table>
</div>`;
  }

  private renderTableHeaderCell(column: TableColumnDef): string {
    return `<th class="task-manager-table__head ${column.className || ""}" data-column-key="${column.key}">
  <div class="task-manager-table__head-content">
    <span>${column.label}</span>
    <button class="task-manager-table__resize-handle" data-column-resize="${column.key}" aria-label="调整${column.label || "操作"}列宽" title="拖动调整列宽"></button>
  </div>
</th>`;
  }

  private renderTableNode(node: TaskTreeNode, depth: number, childCounts: Map<string, number>): string {
    const task = node.task;
    const childCount = childCounts.get(task.id) || 0;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const row = this.renderTableRow(node, depth, childCount, collapsed);
    const children = node.children.length && !collapsed
      ? node.children.map((child) => this.renderTableNode(child, depth + 1, childCounts)).join("")
      : "";

    return `${row}${children}`;
  }

  private renderTableRow(node: TaskTreeNode, depth: number, childCount: number, collapsed: boolean): string {
    const task = node.task;
    const contextClass = node.contextOnly ? " task-manager-table__row--context" : "";
    return `<tr class="task-manager-table__row task-manager-status-${task.status} task-manager-priority-${task.priority}${contextClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
  ${TABLE_COLUMNS.map((column) => this.renderTableCell(column.key, task, childCount, collapsed)).join("")}
</tr>`;
  }

  private renderTableCell(key: TableColumnKey, task: TaskItem, childCount: number, collapsed: boolean): string {
    if (key === "task") {
      return `<td class="task-manager-table__cell is-task">
  <div class="task-manager-table__task-cell">
    ${childCount
      ? `<button class="task-manager-task__toggle" data-task-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
      : `<span class="task-manager-task__toggle-placeholder"></span>`}
    <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</button>
  </div>
</td>`;
    }
    if (key === "project") {
      return `<td class="task-manager-table__cell">${this.renderProjectPill(task)}</td>`;
    }
    if (key === "source") {
      return `<td class="task-manager-table__cell">${this.renderSourcePill(task)}</td>`;
    }
    if (key === "status") {
      return `<td class="task-manager-table__cell"><select class="b3-select task-manager-field" data-field="status" aria-label="任务状态">${statusOptions(task.status)}</select></td>`;
    }
    if (key === "priority") {
      return `<td class="task-manager-table__cell"><select class="b3-select task-manager-field" data-field="priority" aria-label="任务优先级">${priorityOptions(task.priority)}</select></td>`;
    }
    if (key === "plan") {
      return `<td class="task-manager-table__cell"><input class="b3-text-field task-manager-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="计划日期" /></td>`;
    }
    if (key === "due") {
      return `<td class="task-manager-table__cell"><input class="b3-text-field task-manager-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="截止日期" /></td>`;
    }
    return `<td class="task-manager-table__cell is-actions">${this.renderRowActions(task, { compact: true })}</td>`;
  }

  private renderListView(tasks: TaskItem[]): string {
    const matched = new Set(tasks.map((task) => task.id));
    const visible = includeAncestors(this.service.store.all(), matched);
    const tree = buildTaskTree(this.service.store.all(), visible, matched);

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

    return `<div class="task-manager-task task-manager-status-${task.status} task-manager-priority-${task.priority}${contextClass}${childClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
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
      <select class="b3-select task-manager-field" data-field="status" aria-label="任务状态">${statusOptions(task.status)}</select>
      <select class="b3-select task-manager-field" data-field="priority" aria-label="任务优先级">${priorityOptions(task.priority)}</select>
      <input class="b3-text-field task-manager-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="计划日期" />
      <input class="b3-text-field task-manager-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="截止日期" />
    </div>
  </div>
  ${childCount && !collapsed ? `<div class="task-manager-task__children">${node.children.map((child) => this.renderTaskNode(child, depth + 1)).join("")}</div>` : ""}
</div>`;
  }

  private renderProjectPill(task: TaskItem): string {
    return `<span class="task-manager-task__pill task-manager-task__pill--project" title="${escapeAttr(task.project || "无项目")}">${escapeHtml(task.project || "无项目")}</span>`;
  }

  private renderSourcePill(task: TaskItem): string {
    if (!task.sourceDocId) {
      return `<span class="task-manager-task__pill task-manager-task__pill--source is-manual" title="手动创建">手动创建</span>`;
    }

    const label = task.sourceText?.trim() || "来源笔记";
    return `<button class="task-manager-task__pill task-manager-task__pill--source is-note" data-task-action="open-source" data-source-doc-id="${escapeAttr(task.sourceDocId)}" title="${escapeAttr(label)}">${escapeHtml(label)}</button>`;
  }

  private renderTimelineView(tasks: TaskItem[]): string {
    const groups = groupByPlanDate(tasks, { unplannedFirst: true });
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
    return `<div class="task-manager-kanban">
  ${STATUSES.map((status) => {
    const columnTasks = tasks.filter((task) => task.status === status);
    return `<section class="task-manager-kanban__column task-manager-status-${status}">
      <div class="task-manager-kanban__header">${TASK_STATUS_LABELS[status]}<span>${columnTasks.length}</span></div>
      <div class="task-manager-kanban__items">
        ${columnTasks.length ? columnTasks.map((task) => this.renderTaskCard(task, "kanban")).join("") : `<div class="task-manager-empty">暂无任务</div>`}
      </div>
    </section>`;
  }).join("")}
</div>`;
  }

  private renderCalendarView(tasks: TaskItem[]): string {
    const days = calendarDays(this.month);
    const tasksByDate = groupTasksByDate(tasks);
    const unplanned = tasks.filter((task) => !task.planStart);
    const monthValue = monthInputValue(this.month);

    return `<div class="task-manager-calendar">
  <div class="task-manager-calendar__toolbar">
    <button class="task-manager-calendar__nav task-manager-calendar__nav--chevron task-manager-calendar__nav--prev" data-action="prev-month" aria-label="上个月" title="上个月">${renderChevron(true)}</button>
    <div class="task-manager-calendar__title">${monthTitle(this.month)}</div>
    <button class="task-manager-calendar__nav task-manager-calendar__nav--chevron task-manager-calendar__nav--next" data-action="next-month" aria-label="下个月" title="下个月">${renderChevron(false)}</button>
    <input class="b3-text-field task-manager-calendar__month-input" data-field="month" type="month" value="${monthValue}" aria-label="选择月份" />
    <button class="task-manager-calendar__nav task-manager-calendar__nav--today" data-action="today-month" aria-label="回到本月" title="回到本月">今</button>
  </div>
  <div class="task-manager-calendar__layout" style="grid-template-columns: minmax(0, 1fr) 8px ${this.calendarAsideWidth}px;">
    <section class="task-manager-calendar__main">
      <div class="task-manager-calendar__weekdays">
        ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div>${day}</div>`).join("")}
      </div>
      <div class="task-manager-calendar__grid">
        ${days.map((day) => this.renderCalendarDay(day, tasksByDate[formatDateKey(day)] || [])).join("")}
      </div>
    </section>
    <button class="task-manager-calendar__splitter" data-calendar-aside-resize aria-label="调整未安排列宽" title="拖动调整未安排列宽"></button>
    <aside class="task-manager-calendar__aside" style="width: ${this.calendarAsideWidth}px;">
      <div class="task-manager-calendar__aside-title">未安排</div>
      <div class="task-manager-calendar__unplanned">
        ${unplanned.length ? unplanned.map((task) => this.renderTaskCard(task, "calendar-aside")).join("") : `<div class="task-manager-empty">没有未安排任务。</div>`}
      </div>
    </aside>
  </div>
</div>`;
  }

  private renderCalendarDay(day: Date, tasks: TaskItem[]): string {
    const dateKey = formatDateKey(day);
    const isToday = dateKey === formatDateKey(new Date());
    const outside = !sameMonth(day, this.month);

    return `<div class="task-manager-calendar-day ${outside ? "is-outside" : ""} ${isToday ? "is-today" : ""}" data-date="${dateKey}" role="button" tabindex="0">
  <span class="task-manager-calendar-day__num">${day.getDate()}</span>
  <div class="task-manager-calendar-day__tasks">
    ${tasks.slice(0, 5).map((task) => `<button class="task-manager-calendar-pill task-manager-status-${task.status}" data-task-id="${task.id}" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</button>`).join("")}
    ${tasks.length > 5 ? `<span class="task-manager-calendar-day__more">+${tasks.length - 5}</span>` : ""}
  </div>
</div>`;
  }

  private renderTaskCard(task: TaskItem, mode: "timeline" | "kanban" | "calendar-aside"): string {
    return `<article class="task-manager-card task-manager-card--${mode} task-manager-card--compact task-manager-status-${task.status} task-manager-priority-${task.priority}" data-task-id="${task.id}">
  <div class="task-manager-card__header task-manager-card__header--compact">
    <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</button>
    ${this.renderRowActions(task, { compact: true })}
  </div>
  <div class="task-manager-card__meta-chips">
    ${this.renderProjectMetaChip(task)}
    ${this.renderSourceMetaChip(task)}
    ${this.renderSelectMetaChip("状态", "status", statusOptions(task.status))}
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
    return this.renderSelectMetaChip("优先级", "priority", priorityOptions(task.priority));
  }

  private renderSelectMetaChip(label: string, field: "status" | "priority", options: string): string {
    return `<label class="task-manager-card__meta-chip task-manager-card__meta-chip--select">
  <select class="task-manager-card__meta-select" data-field="${field}" aria-label="${label}">${options}</select>
</label>`;
  }

  private renderDateMetaChip(label: string, field: "planDate" | "dueDate", display: string, value: string): string {
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
    const statusLabel = task.status === "completed"
      ? "重新打开"
      : "完成任务";

    return `<span class="task-manager-actions${listClass}">
  <button class="${buttonClass}" data-task-action="subtask" aria-label="${subtaskLabel}" title="${subtaskLabel}"${positionAttr}><svg><use xlink:href="#iconAdd"></use></svg></button>
  ${task.status === "completed"
    ? `<button class="${buttonClass}" data-task-action="reopen" aria-label="${statusLabel}" title="${statusLabel}"${positionAttr}><svg><use xlink:href="#iconRefresh"></use></svg></button>`
    : `<button class="${buttonClass}" data-task-action="complete" aria-label="${statusLabel}" title="${statusLabel}"${positionAttr}><svg><use xlink:href="#iconSelect"></use></svg></button>`}
</span>`;
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
      this.view = viewButton.dataset.managerView as TaskManagerView;
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
      if (action === "sync") {
        void this.runSync();
        return;
      }
      if (action === "prev-month") {
        this.month = addMonths(this.month, -1);
        this.render();
        return;
      }
      if (action === "next-month") {
        this.month = addMonths(this.month, 1);
        this.render();
        return;
      }
      if (action === "today-month") {
        this.month = monthStart(new Date());
        this.render();
        return;
      }
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
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.dataset.field === "month") {
      const date = new Date(`${target.value}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
        this.render();
      }
      return;
    }

    const field = target.closest<HTMLElement>("[data-field]");
    const task = field ? this.taskFromElement(field) : undefined;
    if (!field || !task) {
      return;
    }

    if (field.dataset.field === "status") {
      void this.runUpdate(() => this.service.updateTask(task.id, { status: (field as HTMLSelectElement).value as TaskStatus }));
    } else if (field.dataset.field === "priority") {
      void this.runUpdate(() => this.service.updateTask(task.id, { priority: (field as HTMLSelectElement).value as TaskPriority }));
    } else if (field.dataset.field === "planDate") {
      void this.runUpdate(() => this.service.updateTask(task.id, { planStart: fromDateInput((field as HTMLInputElement).value) }));
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
      const column = columnKey ? TABLE_COLUMNS.find((item) => item.key === columnKey) : undefined;
      if (!column) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = this.tableColumnWidths[column.key];
      const move = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        this.tableColumnWidths = {
          ...this.tableColumnWidths,
          [column.key]: Math.max(column.minWidth, Math.round(startWidth + delta))
        };
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

    const asideResizeHandle = target.closest<HTMLElement>("[data-calendar-aside-resize]");
    if (!asideResizeHandle) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const layout = this.container.querySelector<HTMLElement>(".task-manager-calendar__layout");
    if (!layout) {
      return;
    }

    const startX = event.clientX;
    const startWidth = this.calendarAsideWidth;
    const move = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      this.calendarAsideWidth = clampCalendarAsideWidth(startWidth + delta, layout.clientWidth);
      this.applyCalendarAsideWidth();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.resizeCleanup = undefined;
      void this.persistCalendarAsideWidth();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    this.resizeCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.resizeCleanup = undefined;
    };
  }

  private applyTableColumnWidths(): void {
    const table = this.container.querySelector<HTMLTableElement>(".task-manager-table");
    const cols = table?.querySelectorAll<HTMLTableColElement>("colgroup col");
    if (!table || !cols?.length) {
      return;
    }

    TABLE_COLUMNS.forEach((column, index) => {
      const col = cols[index];
      if (col) {
        col.style.width = `${this.tableColumnWidths[column.key]}px`;
        col.style.minWidth = `${column.minWidth}px`;
      }
    });
  }

  private async persistTableColumnWidths(): Promise<void> {
    await this.service.store.setSettings({ tableColumnWidths: this.tableColumnWidths });
  }

  private applyCalendarAsideWidth(): void {
    const layout = this.container.querySelector<HTMLElement>(".task-manager-calendar__layout");
    const aside = this.container.querySelector<HTMLElement>(".task-manager-calendar__aside");
    if (!layout || !aside) {
      return;
    }

    const width = clampCalendarAsideWidth(this.calendarAsideWidth, layout.clientWidth);
    this.calendarAsideWidth = width;
    layout.style.gridTemplateColumns = `minmax(0, 1fr) 8px ${width}px`;
    aside.style.width = `${width}px`;
  }

  private async persistCalendarAsideWidth(): Promise<void> {
    await this.service.store.setSettings({ calendarAsideWidth: this.calendarAsideWidth });
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
    const day = target.closest<HTMLElement>(".task-manager-calendar-day");
    if (day?.dataset.date && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.actions.newTask({ presetPlanDate: day.dataset.date });
    }
  }

  private handleTaskAction(action: string, task: TaskItem, element?: HTMLElement): void {
    if (action === "open") {
      this.actions.openTask(task);
    } else if (action === "open-source") {
      const docId = element?.dataset.sourceDocId || task.sourceDocId;
      if (docId) {
        this.actions.openSourceDoc?.(docId);
      }
    } else if (action === "subtask") {
      this.actions.createSubtask(task.id);
    } else if (action === "complete") {
      void this.runUpdate(() => this.service.completeTask(task.id));
    } else if (action === "reopen") {
      void this.runUpdate(() => this.service.reopenTask(task.id));
    } else if (action === "toggle-children") {
      if (this.collapsedTaskIds.has(task.id)) {
        this.collapsedTaskIds.delete(task.id);
      } else {
        this.collapsedTaskIds.add(task.id);
      }
      this.render();
    }
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
    try {
      await action();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "更新任务失败", 5000, "error");
      this.render();
    }
  }

  private filteredTasks(): TaskItem[] {
    const query = normalizeSearch(this.search);
    const tasks = this.service.store.all();
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
        TASK_STATUS_LABELS[task.status],
        TASK_PRIORITY_LABELS[task.priority],
        task.planStart,
        task.dueDate,
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

function groupByPlanDate(tasks: TaskItem[], options: { unplannedFirst?: boolean } = {}): Array<{ key: string; label: string; tasks: TaskItem[] }> {
  const groups = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    const key = toDateKey(task.planStart) || "unplanned";
    const group = groups.get(key) || [];
    group.push(task);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === "unplanned") {
        return options.unplannedFirst ? -1 : 1;
      }
      if (b === "unplanned") {
        return options.unplannedFirst ? 1 : -1;
      }
      return a.localeCompare(b);
    })
    .map(([key, groupTasks]) => ({
      key,
      label: key === "unplanned" ? "未安排" : key,
      tasks: groupTasks
    }));
}

function defaultTableColumnWidths(): Record<TableColumnKey, number> {
  return {
    task: 320,
    project: 140,
    source: 170,
    status: 120,
    priority: 120,
    plan: 144,
    due: 144,
    actions: 96
  };
}

function normalizeTableColumnWidths(raw?: Partial<Record<TableColumnKey, number>>): Record<TableColumnKey, number> {
  const defaults = defaultTableColumnWidths();
  const next = { ...defaults };
  for (const column of TABLE_COLUMNS) {
    const value = raw?.[column.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[column.key] = Math.max(column.minWidth, Math.round(value));
    }
  }
  return next;
}

const DEFAULT_CALENDAR_ASIDE_WIDTH = 280;
const MIN_CALENDAR_ASIDE_WIDTH = 220;
const MAX_CALENDAR_ASIDE_WIDTH = 520;

function normalizeCalendarAsideWidth(raw?: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_CALENDAR_ASIDE_WIDTH;
  }
  return clampCalendarAsideWidth(raw);
}

function clampCalendarAsideWidth(width: number, containerWidth = Number.POSITIVE_INFINITY): number {
  const maxByContainer = Number.isFinite(containerWidth)
    ? Math.max(MIN_CALENDAR_ASIDE_WIDTH, Math.min(MAX_CALENDAR_ASIDE_WIDTH, Math.round(containerWidth * 0.45)))
    : MAX_CALENDAR_ASIDE_WIDTH;
  return Math.max(MIN_CALENDAR_ASIDE_WIDTH, Math.min(maxByContainer, Math.round(width)));
}

function calendarDays(month: Date): Date[] {
  const first = monthStart(month);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - startOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
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

function normalizeSearch(value?: string): string {
  return (value || "").trim().toLocaleLowerCase();
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

function renderChevron(expanded: boolean): string {
  return `<span class="task-tree-chevron${expanded ? " is-expanded" : ""}" aria-hidden="true"></span>`;
}

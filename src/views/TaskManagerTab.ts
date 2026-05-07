import { showMessage } from "siyuan";
import {
  addMonths,
  formatDateKey,
  formatHumanDate,
  fromDateInput,
  monthStart,
  monthTitle,
  sameMonth,
  toDateKey
} from "../date";
import type { TaskService } from "../document";
import { escapeHtml, priorityOptions, statusOptions } from "../dialogs/TaskDialog";
import {
  ACTIVE_TASK_STATUSES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskItem,
  type TaskPriority,
  type TaskStatus
} from "../types";

type TaskManagerView = "list" | "table" | "timeline" | "kanban" | "calendar";

type TaskTreeNode = {
  task: TaskItem;
  children: TaskTreeNode[];
  contextOnly: boolean;
};

const VIEWS: Array<{ value: TaskManagerView; label: string }> = [
  { value: "list", label: "列表" },
  { value: "table", label: "表格" },
  { value: "timeline", label: "时间线" },
  { value: "kanban", label: "看板" },
  { value: "calendar", label: "日历" }
];

const STATUSES: TaskStatus[] = ["todo", "doing", "waiting", "cancelled", "completed"];

export class TaskManagerTab {
  private view: TaskManagerView = "list";
  private search = "";
  private month = monthStart(new Date());
  private collapsedTaskIds = new Set<string>();
  private unsubscribe?: () => void;

  constructor(
    private container: HTMLElement,
    private service: TaskService,
    private actions: {
      newTask: (options?: { presetPlanDate?: string }) => void;
      createSubtask: (parentId: string) => void;
      openTask: (task: TaskItem) => void;
      sync?: () => Promise<void>;
    }
  ) {
    this.unsubscribe = this.service.onChange(() => this.render());
  }

  destroy(): void {
    this.unsubscribe?.();
  }

  render(): void {
    const tasks = this.filteredTasks();
    this.container.innerHTML = `<div class="task-manager">
  <div class="task-manager__toolbar">
    <div class="task-manager__views">
      ${VIEWS.map((item) => `<button class="task-manager__view ${item.value === this.view ? "is-active" : ""}" data-manager-view="${item.value}">${item.label}</button>`).join("")}
    </div>
    <input class="b3-text-field task-manager__search" data-field="search" placeholder="搜索任务标题、项目、来源或文档 ID" value="${escapeAttr(this.search)}" />
    <button class="b3-button b3-button--outline" data-action="sync">同步</button>
    <button class="b3-button b3-button--text" data-action="new-task">新建任务</button>
  </div>
  <div class="task-manager__content">
    ${this.renderView(tasks)}
  </div>
</div>`;
    this.bind();
  }

  private renderView(tasks: TaskItem[]): string {
    switch (this.view) {
      case "table":
        return this.renderTableView(tasks);
      case "timeline":
        return this.renderTimelineView(tasks);
      case "kanban":
        return this.renderKanbanView(tasks);
      case "calendar":
        return this.renderCalendarView(tasks);
      case "list":
      default:
        return this.renderListView(tasks);
    }
  }

  private renderTableView(tasks: TaskItem[]): string {
    const matched = new Set(tasks.map((task) => task.id));
    const visible = includeAncestors(this.service.store.all(), matched);
    const tree = buildTaskTree(this.service.store.all(), visible, matched);
    const childCounts = countDescendants(tree);

    return `<div class="task-manager-table-wrap">
  <table class="task-manager-table">
    <thead>
      <tr>
        <th>任务</th>
        <th>项目</th>
        <th>状态</th>
        <th>优先级</th>
        <th>计划</th>
        <th>截止</th>
        <th>父任务</th>
        <th>子任务</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${tree.length ? tree.map((node) => this.renderTableNode(node, 0, childCounts)).join("") : `<tr><td colspan="9" class="task-manager-empty">这里暂时没有任务。</td></tr>`}
    </tbody>
  </table>
</div>`;
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
    const parent = task.parentId ? this.service.store.get(task.parentId) : undefined;
    const contextClass = node.contextOnly ? " task-manager-table__row--context" : "";
    return `<tr class="task-manager-table__row task-manager-status-${task.status} task-manager-priority-${task.priority}${contextClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
  <td>
    <div class="task-manager-table__task-cell">
      ${childCount
        ? `<button class="task-manager-task__toggle" data-task-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
        : `<span class="task-manager-task__toggle-placeholder"></span>`}
      <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</button>
    </div>
  </td>
  <td>${escapeHtml(task.project || "无项目")}</td>
  <td><select class="b3-select task-manager-field" data-field="status" aria-label="任务状态">${statusOptions(task.status)}</select></td>
  <td><select class="b3-select task-manager-field" data-field="priority" aria-label="任务优先级">${priorityOptions(task.priority)}</select></td>
  <td><input class="b3-text-field task-manager-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="计划日期" /></td>
  <td><input class="b3-text-field task-manager-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="截止日期" /></td>
  <td>${parent ? `<button class="task-manager-parent-link" data-task-id="${parent.id}" data-task-action="open">${escapeHtml(parent.title)}</button>` : "无"}</td>
  <td>${childCount}</td>
  <td>${this.renderRowActions(task)}</td>
</tr>`;
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
    const parent = task.parentId ? this.service.store.get(task.parentId) : undefined;
    const contextClass = node.contextOnly ? " task-manager-task--context" : "";

    return `<div class="task-manager-task task-manager-status-${task.status} task-manager-priority-${task.priority}${contextClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
  <div class="task-manager-task__main">
    <div class="task-manager-task__title-row">
      ${childCount
        ? `<button class="task-manager-task__toggle" data-task-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
        : `<span class="task-manager-task__toggle-placeholder"></span>`}
      <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</button>
      ${childCount ? `<span class="task-manager-task__child-count">${childCount}</span>` : ""}
    </div>
    <div class="task-manager-task__meta">
      <span>${escapeHtml(task.project || "无项目")}</span>
      <span>${TASK_STATUS_LABELS[task.status]}</span>
      <span>${TASK_PRIORITY_LABELS[task.priority]}</span>
      <span>计划：${formatHumanDate(task.planStart)}</span>
      <span>截止：${formatHumanDate(task.dueDate)}</span>
      ${parent ? `<span>父任务：${escapeHtml(parent.title)}</span>` : ""}
    </div>
  </div>
  <div class="task-manager-task__controls">
    <select class="b3-select task-manager-field" data-field="status" aria-label="任务状态">${statusOptions(task.status)}</select>
    <select class="b3-select task-manager-field" data-field="priority" aria-label="任务优先级">${priorityOptions(task.priority)}</select>
    <input class="b3-text-field task-manager-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="计划日期" />
    <input class="b3-text-field task-manager-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="截止日期" />
    ${this.renderRowActions(task)}
  </div>
  ${childCount && !collapsed ? `<div class="task-manager-task__children">${node.children.map((child) => this.renderTaskNode(child, depth + 1)).join("")}</div>` : ""}
</div>`;
  }

  private renderTimelineView(tasks: TaskItem[]): string {
    const groups = groupByPlanDate(tasks);
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
    <button class="task-manager-calendar__nav" data-action="prev-month" aria-label="上个月" title="上个月">‹</button>
    <div class="task-manager-calendar__title">${monthTitle(this.month)}</div>
    <button class="task-manager-calendar__nav" data-action="next-month" aria-label="下个月" title="下个月">›</button>
    <input class="b3-text-field task-manager-calendar__month-input" data-field="month" type="month" value="${monthValue}" aria-label="选择月份" />
    <button class="task-manager-calendar__nav task-manager-calendar__nav--today" data-action="today-month" aria-label="回到本月" title="回到本月">今</button>
  </div>
  <div class="task-manager-calendar__layout">
    <section class="task-manager-calendar__main">
      <div class="task-manager-calendar__weekdays">
        ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div>${day}</div>`).join("")}
      </div>
      <div class="task-manager-calendar__grid">
        ${days.map((day) => this.renderCalendarDay(day, tasksByDate[formatDateKey(day)] || [])).join("")}
      </div>
    </section>
    <aside class="task-manager-calendar__aside">
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
    const parent = task.parentId ? this.service.store.get(task.parentId) : undefined;
    return `<article class="task-manager-card task-manager-card--${mode} task-manager-status-${task.status} task-manager-priority-${task.priority}" data-task-id="${task.id}">
  <div class="task-manager-card__header">
    <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</button>
    ${this.renderRowActions(task)}
  </div>
  <div class="task-manager-card__meta">
    <span>${escapeHtml(task.project || "无项目")}</span>
    <span>${TASK_STATUS_LABELS[task.status]}</span>
    <span>${TASK_PRIORITY_LABELS[task.priority]}</span>
    <span>计划：${formatHumanDate(task.planStart)}</span>
    <span>截止：${formatHumanDate(task.dueDate)}</span>
    ${parent ? `<span>父任务：${escapeHtml(parent.title)}</span>` : ""}
  </div>
  <div class="task-manager-card__controls">
    <select class="b3-select task-manager-field" data-field="status" aria-label="任务状态">${statusOptions(task.status)}</select>
    <select class="b3-select task-manager-field" data-field="priority" aria-label="任务优先级">${priorityOptions(task.priority)}</select>
    <input class="b3-text-field task-manager-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="计划日期" />
    <input class="b3-text-field task-manager-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="截止日期" />
  </div>
</article>`;
  }

  private renderRowActions(task: TaskItem): string {
    return `<span class="task-manager-actions">
  <button class="block__icon ariaLabel" data-task-action="subtask" aria-label="创建子任务" data-position="north"><svg><use xlink:href="#iconAdd"></use></svg></button>
  ${task.status === "completed"
    ? `<button class="block__icon ariaLabel" data-task-action="reopen" aria-label="重新打开" data-position="north"><svg><use xlink:href="#iconRefresh"></use></svg></button>`
    : `<button class="block__icon ariaLabel" data-task-action="complete" aria-label="完成任务" data-position="north"><svg><use xlink:href="#iconSelect"></use></svg></button>`}
</span>`;
  }

  private bind(): void {
    this.container.onclick = (event) => this.handleClick(event);
    this.container.onchange = (event) => this.handleChange(event);
    this.container.oninput = (event) => this.handleInput(event);
    this.container.onkeydown = (event) => this.handleKeydown(event);
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
        this.handleTaskAction(taskAction.dataset.taskAction || "", task);
      }
      return;
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

    const cursor = target.selectionStart ?? target.value.length;
    this.search = target.value;
    this.render();
    const nextSearch = this.container.querySelector<HTMLInputElement>("[data-field='search']");
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

  private handleTaskAction(action: string, task: TaskItem): void {
    if (action === "open") {
      this.actions.openTask(task);
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
      const haystack = normalizeSearch([
        task.title,
        task.project,
        task.sourceText,
        task.sourceDocId,
        task.id
      ].filter(Boolean).join(" "));
      return haystack.includes(query);
    });
  }

  private taskFromElement(element: Element): TaskItem | undefined {
    const row = element.closest<HTMLElement>("[data-task-id]");
    const taskId = row?.dataset.taskId;
    return taskId ? this.service.store.get(taskId) : undefined;
  }
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

function countDescendants(roots: TaskTreeNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: TaskTreeNode): number => {
    let total = 0;
    for (const child of node.children) {
      total += 1 + visit(child);
    }
    counts.set(node.task.id, total);
    return total;
  };
  roots.forEach((node) => visit(node));
  return counts;
}

function groupByPlanDate(tasks: TaskItem[]): Array<{ label: string; tasks: TaskItem[] }> {
  const groups = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    const key = toDateKey(task.planStart) || "未安排";
    const bucket = groups.get(key) || [];
    bucket.push(task);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === "未安排") {
        return 1;
      }
      if (b === "未安排") {
        return -1;
      }
      return a.localeCompare(b);
    })
    .map(([label, groupTasks]) => ({ label, tasks: groupTasks }));
}

function groupTasksByDate(tasks: TaskItem[]): Record<string, TaskItem[]> {
  return tasks.reduce<Record<string, TaskItem[]>>((result, task) => {
    const key = toDateKey(task.planStart || task.dueDate);
    if (!key) {
      return result;
    }
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(task);
    return result;
  }, {});
}

function monthInputValue(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

function calendarDays(month: Date): Date[] {
  const first = monthStart(month);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function renderChevron(expanded: boolean): string {
  return `<span class="task-tree-chevron${expanded ? " is-expanded" : ""}" aria-hidden="true"></span>`;
}

import { showMessage } from "siyuan";
import { formatSidebarDate, toDateKey } from "../date";
import type { TaskService } from "../document";
import { escapeHtml } from "../dialogs/TaskDialog";
import {
  ACTIVE_TASK_STATUSES,
  type TaskItem,
  STATUS_BADGE_CONFIG
} from "../types";

type DockFilter = "all" | "important" | "today";

export class TaskDock {
  private filter: DockFilter = "all";
  private collapsedTaskIds = new Set<string>();
  private unsubscribe?: () => void;

  constructor(
    private container: HTMLElement,
    private service: TaskService,
    private actions: {
      newTask: () => void;
      createSubtask: (parentId: string) => void;
      openTask: (task: TaskItem) => void;
      openTaskManager: () => void;
      setCurrentDocAsRoot: () => void;
    }
  ) {
    this.unsubscribe = this.service.onChange(() => this.render());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.container.onchange = null;
    this.container.onkeydown = null;
  }

  render(): void {
    const settings = this.service.store.getSettings();
    const tree = this.filteredTaskTree();
    const counts = this.counts();

    this.container.innerHTML = `<div class="task-tracker task-tracker--dock">
  ${this.renderHeader()}
  ${settings.taskRootDocId ? this.renderContent(tree, counts) : this.renderEmptyRoot()}
</div>`;

    this.bind();
  }

  /* ── Header ──────────────────────────────────────────────── */

  private renderHeader(): string {
    return `<div class="task-tracker-dock__header">
  <svg class="task-tracker-dock__header-icon"><use xlink:href="#iconTaskTracker"></use></svg>
  <span class="task-tracker-dock__header-title">任务追踪</span>
  <span class="fn__flex-1 fn__space"></span>
  <button class="task-tracker-dock__add-icon-btn" data-action="new" title="添加任务">+</button>
</div>`;
  }

  /* ── Content (tabs + list) ───────────────────────────────── */

  private renderContent(tree: TaskTreeNode[], counts: Record<DockFilter, number>): string {
    return `<div class="task-tracker-dock__body">
  ${this.renderTabs(counts)}
  <div class="task-tracker-dock__list">
    ${tree.length ? tree.map((node) => this.renderTaskCard(node, 0, node.children.length > 0)).join("") : this.renderEmptyState()}
  </div>
</div>`;
  }

  private renderEmptyRoot(): string {
    return `<div class="task-tracker-dock__body">
  <div class="task-tracker-dock__empty task-tracker-dock__empty--root">
    <div class="task-tracker-dock__empty-title">还没有事项库</div>
    <div class="task-tracker-dock__empty-text">先创建或打开一个文档，比如"事项库"，再把它设为任务根文档。</div>
    <button class="b3-button b3-button--text" data-action="set-root">将当前文档设为事项库</button>
  </div>
</div>`;
  }

  /* ── Tabs ────────────────────────────────────────────────── */

  private renderTabs(counts: Record<DockFilter, number>): string {
    const tabs: Array<{ key: DockFilter; label: string }> = [
      { key: "all", label: "全部" },
      { key: "important", label: "重点" },
      { key: "today", label: "今日" }
    ];
    return `<div class="task-tracker-dock__tabs">
  ${tabs.map((tab) => {
    const active = this.filter === tab.key;
    return `<button class="task-tracker-dock__tab ${active ? "is-active" : ""}" data-filter="${tab.key}">
      <span class="task-tracker-dock__tab-label">${tab.label}</span>
      <span class="task-tracker-dock__tab-count">${counts[tab.key]}</span>
    </button>`;
  }).join("")}
</div>`;
  }

  /* ── Task Cards ──────────────────────────────────────────── */

  private renderTaskCard(node: TaskTreeNode, depth: number, isParent: boolean): string {
    const task = node.task;
    const childCount = node.children.length;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const contextClass = node.contextOnly ? " task-tracker-dock__task--context" : "";
    const childClass = depth > 0 ? " task-tracker-dock__task--child" : "";
    const parentClass = isParent ? " task-tracker-dock__task--parent" : "";

    return `<div class="task-tracker-dock__task ${childClass}${contextClass}${parentClass}" data-task-id="${task.id}">
  <div class="task-tracker-dock__task-row">
    ${depth > 0
      ? `<span class="task-tracker-dock__task-indent"></span>`
      : (childCount
        ? `<button class="task-tracker-dock__task-toggle" data-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
        : `<span class="task-tracker-dock__task-toggle-placeholder"></span>`)}
    <span class="task-tracker-dock__task-title ${isParent ? "is-parent" : ""}" data-action="open" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
    <span class="task-tracker-dock__task-badges">
      ${this.renderStatusBadge(task)}
      ${this.renderDateBadge(task)}
    </span>
    ${childCount && depth === 0 ? this.renderChildCountBadge(childCount) : ""}
  </div>
  ${childCount && !collapsed
    ? `<div class="task-tracker-dock__task-children">${node.children.map((child) => this.renderTaskCard(child, depth + 1, child.children.length > 0)).join("")}</div>`
    : ""}
</div>`;
  }

  /* ── Badges ──────────────────────────────────────────────── */

  private renderStatusBadge(task: TaskItem): string {
    const cfg = STATUS_BADGE_CONFIG[task.status];
    return `<span class="task-tracker-dock__status task-tracker-dock__status--${task.status}">
  ${escapeHtml(cfg.label)}
</span>`;
  }

  private renderDateBadge(task: TaskItem): string {
    const info = formatSidebarDate(task);
    return `<span class="task-tracker-dock__date task-tracker-dock__date--${info.kind}" title="${info.kind === "date" || info.kind === "overdue" ? info.dateKey : ""}">
  ${escapeHtml(info.display)}
</span>`;
  }

  private renderChildCountBadge(count: number): string {
    return `<span class="task-tracker-dock__child-count">${count}</span>`;
  }

  /* ── Empty State ─────────────────────────────────────────── */

  private renderEmptyState(): string {
    switch (this.filter) {
      case "today":
        return `<div class="task-tracker-dock__empty">
  <svg class="task-tracker-dock__empty-icon" viewBox="0 0 24 24" width="36" height="36"><rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 10h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
  <div class="task-tracker-dock__empty-title">今天暂无需要处理的任务</div>
  <div class="task-tracker-dock__empty-text">可切换到全部查看仍需跟踪的任务</div>
</div>`;
      case "important":
        return `<div class="task-tracker-dock__empty">
  <svg class="task-tracker-dock__empty-icon" viewBox="0 0 24 24" width="36" height="36"><path d="M12 2l2.4 7.4h7.6l-6 4.6 2.4 7.4-6.4-4.6-6.4 4.6 2.4-7.4-6-4.6h7.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
  <div class="task-tracker-dock__empty-title">暂无重点任务</div>
  <div class="task-tracker-dock__empty-text">高优先级、临近截止或已标记重点的任务会显示在这里</div>
</div>`;
      default:
        return `<div class="task-tracker-dock__empty">
  <svg class="task-tracker-dock__empty-icon" viewBox="0 0 24 24" width="36" height="36"><path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <div class="task-tracker-dock__empty-title">暂无需要跟踪的任务</div>
  <button class="b3-button b3-button--text" data-action="new">+ 添加任务</button>
</div>`;
    }
  }

  /* ── Event Binding ───────────────────────────────────────── */

  private bind(): void {
    // Tab filter clicks
    this.container.querySelectorAll<HTMLElement>("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        this.filter = button.dataset.filter as DockFilter;
        this.render();
      });
    });

    // Add / set-root actions
    this.container.querySelector("[data-action='new']")?.addEventListener("click", () => this.actions.newTask());
    this.container.querySelector("[data-action='set-root']")?.addEventListener("click", () => this.actions.setCurrentDocAsRoot());

    // Per-task listeners
    this.container.querySelectorAll<HTMLElement>("[data-task-id]").forEach((row) => {
      const taskId = row.dataset.taskId;
      const task = taskId ? this.service.store.get(taskId) : undefined;
      if (!task) return;

      row.querySelector("[data-action='open']")?.addEventListener("click", () => this.actions.openTask(task));

      row.querySelector("[data-action='toggle-children']")?.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleChildren(task.id);
      });
    });
  }

  private toggleChildren(taskId: string): void {
    if (this.collapsedTaskIds.has(taskId)) {
      this.collapsedTaskIds.delete(taskId);
    } else {
      this.collapsedTaskIds.add(taskId);
    }
    this.render();
  }

  /* ── Data ────────────────────────────────────────────────── */

  private filteredTaskTree(): TaskTreeNode[] {
    const tasks = this.service.store.all();
    const matched = new Set(tasks.filter((task) => this.matchesFilter(task)).map((task) => task.id));
    const visible = includeAncestors(tasks, matched);
    return buildTaskTree(tasks, visible, matched);
  }

  private matchesFilter(task: TaskItem): boolean {
    // Base check: only show active (non-completed, non-cancelled) tasks,
    // matching the current business rule from ACTIVE_TASK_STATUSES.
    if (!ACTIVE_TASK_STATUSES.includes(task.status)) return false;

    const today = toDateKey(new Date().toISOString());
    switch (this.filter) {
      case "today":
        return toDateKey(task.planStart) === today
          || toDateKey(task.planEnd) === today
          || toDateKey(task.dueDate) === today;
      case "all":
        return true;
      case "important":
        return isImportantTask(task);
      default:
        return true;
    }
  }

  private counts(): Record<DockFilter, number> {
    const tasks = this.service.store.all();
    const today = toDateKey(new Date().toISOString());
    const activePool = tasks.filter((t) => ACTIVE_TASK_STATUSES.includes(t.status));

    const allCount = activePool.length;
    const importantCount = activePool.filter((t) => isImportantTask(t)).length;
    const todayCount = activePool.filter((t) => {
      return toDateKey(t.planStart) === today
        || toDateKey(t.planEnd) === today
        || toDateKey(t.dueDate) === today;
    }).length;

    return { all: allCount, important: importantCount, today: todayCount };
  }

  private taskFromElement(element: Element): TaskItem | undefined {
    const row = element.closest<HTMLElement>("[data-task-id]");
    const taskId = row?.dataset.taskId;
    return taskId ? this.service.store.get(taskId) : undefined;
  }

  private async runUpdate(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "更新任务失败", 5000, "error");
    }
  }
}

/* ── Shared Helpers ──────────────────────────────────────────── */

interface TaskTreeNode {
  task: TaskItem;
  children: TaskTreeNode[];
  contextOnly: boolean;
}

function isImportantTask(task: TaskItem): boolean {
  if (task.priority === "high") return true;

  const today = toDateKey(new Date().toISOString());
  if (!today) return false;

  // Overdue: dueDate is before today
  const dueKey = toDateKey(task.dueDate);
  if (dueKey && dueKey < today) return true;

  // Due or planEnd within next 3 days (including today)
  const threeDaysLater = toDateKey(
    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  );
  if (dueKey && dueKey >= today && dueKey <= threeDaysLater) return true;
  const planEndKey = toDateKey(task.planEnd);
  if (planEndKey && planEndKey >= today && planEndKey <= threeDaysLater) return true;

  // Status is "doing" and has planStart or planEnd
  if (task.status === "doing" && (task.planStart || task.planEnd)) return true;

  return false;
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

function renderChevron(expanded: boolean): string {
  return `<span class="task-tree-chevron${expanded ? " is-expanded" : ""}" aria-hidden="true"></span>`;
}

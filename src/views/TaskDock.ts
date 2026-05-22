import { showMessage } from "siyuan";
import { formatSidebarDate, mergeDateInputWithExisting, toDateKey } from "../date";
import type { TaskService } from "../document";
import { escapeHtml } from "../dialogs/TaskDialog";
import {
  ACTIVE_TASK_STATUSES,
  type TaskItem,
  STATUS_BADGE_CONFIG,
  type TaskStatus
} from "../types";

type DockFilter = "all" | "important" | "today";

type DockPopoverField = "status";

export class TaskDock {
  private filter: DockFilter = "all";
  private collapsedTaskIds = new Set<string>();
  private activePopover: { taskId: string; field: DockPopoverField } | null = null;
  private activePopoverCleanup?: () => void;
  private unsubscribe?: () => void;

  constructor(
    private container: HTMLElement,
    private service: TaskService,
    private actions: {
      newTask: () => void;
      createSubtask: (parentId: string) => void;
      editTask: (task: TaskItem) => void;
      openTask: (task: TaskItem) => void;
      openTaskManager: () => void;
      setCurrentDocAsRoot: () => void;
    }
  ) {
    this.unsubscribe = this.service.onChange(() => this.render());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.closePopover();
    this.container.onclick = null;
    this.container.onchange = null;
    this.container.onkeydown = null;
  }

  render(): void {
    const settings = this.service.store.getSettings();
    const tree = this.filteredTaskTree();
    const counts = this.counts();

    this.closePopover();
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

    return `<div class="task-tracker-dock__task ${childClass}${contextClass}${parentClass}" data-task-id="${task.id}" data-depth="${depth}">
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
    const open = this.activePopover?.taskId === task.id && this.activePopover?.field === "status";
    return `<div class="task-manager-inline-dropdown task-tracker-dock__status-dropdown" data-popover="status" data-task-id="${task.id}">
  <button type="button" class="task-manager-inline-badge task-manager-inline-badge--compact task-tracker-dock__inline-badge task-tracker-dock__inline-badge--text-only ${open ? "is-open" : ""}" data-popover-toggle="status" data-task-id="${task.id}" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
    <span class="task-manager-inline-badge__text">${escapeHtml(cfg.label)}</span>
  </button>
  <div class="task-manager-inline-menu" data-popover-menu="status" data-task-id="${task.id}" style="display: ${open ? "" : "none"};">
    ${(["todo", "doing", "waiting", "completed", "cancelled"] as TaskStatus[]).map((status) => {
      const itemCfg = STATUS_BADGE_CONFIG[status];
      const active = status === task.status;
      return `<button type="button" class="task-manager-inline-menu__item ${active ? "is-active" : ""}" data-popover-select="status" data-task-id="${task.id}" data-status-value="${status}">
        <span class="task-manager-inline-menu__dot" style="--dot-color: ${itemCfg.dotColor};"></span>
        <span class="task-manager-inline-menu__label">${escapeHtml(itemCfg.label)}</span>
        ${active ? `<svg class="task-manager-inline-menu__check" viewBox="0 0 16 16" width="12" height="12"><path d="M4 8l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}
      </button>`;
    }).join("")}
  </div>
</div>`;
  }

  private renderDateBadge(task: TaskItem): string {
    const info = formatSidebarDate(task);
    return `<label class="task-manager-card__meta-chip task-manager-card__meta-chip--date task-tracker-dock__date-chip task-tracker-dock__date-chip--${info.kind}" title="${escapeHtml(info.kind === "date" || info.kind === "overdue" ? info.dateKey : "")}">
  <span class="task-manager-card__meta-value">${escapeHtml(info.display)}</span>
  <input class="task-manager-card__meta-date-input" data-field="${info.field || "dueDate"}" type="date" value="${escapeHtml(info.dateKey)}" aria-label="任务日期" />
</label>`;
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
    this.container.onclick = (event) => this.handleClick(event);
    this.container.onchange = (event) => this.handleChange(event);
    this.container.onkeydown = (event) => this.handleKeydown(event);
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    const filterButton = target.closest<HTMLElement>("[data-filter]");
    if (filterButton?.dataset.filter) {
      this.filter = filterButton.dataset.filter as DockFilter;
      this.render();
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "new") {
        this.actions.newTask();
        return;
      }
      if (action === "set-root") {
        this.actions.setCurrentDocAsRoot();
        return;
      }
      if (action === "toggle-children") {
        event.stopPropagation();
        const task = this.taskFromElement(actionButton);
        if (task) {
          this.toggleChildren(task.id);
        }
        return;
      }
      if (action === "open") {
        const task = this.taskFromElement(actionButton);
        if (task) {
          this.actions.editTask(task);
        }
        return;
      }
    }

    const popoverToggle = target.closest<HTMLElement>("[data-popover-toggle]");
    if (popoverToggle) {
      event.preventDefault();
      event.stopPropagation();
      const field = popoverToggle.dataset.popoverToggle as DockPopoverField;
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
      const taskId = popoverSelect.dataset.taskId;
      const newStatus = popoverSelect.dataset.statusValue as TaskStatus | undefined;
      const task = taskId ? this.service.store.get(taskId) : undefined;
      if (!task || !newStatus || newStatus === task.status) {
        this.closePopover();
        return;
      }
      void this.runUpdate(() => this.service.updateTask(task.id, { status: newStatus }));
      return;
    }

    if (this.activePopover && !target.closest("[data-popover]")) {
      this.closePopover();
    }

    const dateChip = target.closest<HTMLElement>(".task-tracker-dock__date-chip");
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
      }
    }
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const field = target.dataset.field as "dueDate" | "planEnd" | "planStart" | undefined;
    if (!field) {
      return;
    }

    const task = this.taskFromElement(target);
    if (!task) {
      return;
    }

    if (field === "dueDate") {
      void this.runUpdate(() => this.service.updateTask(task.id, {
        dueDate: target.value || undefined
      }));
      return;
    }

    void this.runUpdate(() => this.service.updateTask(task.id, {
      [field]: mergeDateInputWithExisting(target.value || undefined, task[field])
    }));
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.activePopover) {
      event.preventDefault();
      this.closePopover();
    }
  }

  private closePopover(): void {
    this.activePopoverCleanup?.();
    this.activePopoverCleanup = undefined;
    this.activePopover = null;
  }

  private openPopover(taskId: string, field: DockPopoverField, trigger: HTMLElement): void {
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
    const body = this.container.querySelector<HTMLElement>(".task-tracker-dock__body");
    const list = this.container.querySelector<HTMLElement>(".task-tracker-dock__list");
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
    this.closePopover();
    try {
      await action();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "更新任务失败", 5000, "error");
      this.render();
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

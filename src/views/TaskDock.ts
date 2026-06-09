import { showMessage } from "siyuan";
import {
  formatDateKey,
  formatSidebarDate,
  formatWeekRangeCompact,
  mergeDateInputWithExisting,
  startOfWeek,
  toDateKey
} from "../date";
import type { TaskService } from "../document";
import { escapeHtml } from "../dialogs/TaskDialog";
import {
  getActiveTaskStatuses,
  getAllOrderedStatuses,
  getStatusBadgeConfig
} from "../statusConfig";
import { compareTasksBySidebarSortField, sortTaskTree } from "../taskSort";
import {
  DEFAULT_DOCK_DISPLAY_OPTIONS,
  type DockDisplayOptions,
  type SidebarTaskSortField,
  type TaskItem,
  type TaskStatus
} from "../types";

type DockFilter = "all" | "important" | "nextThreeDays" | "overdue";
type MobileDockView = "tracking" | "week";
type DockNewTaskOptions = {
  parentId?: string;
  presetPlanDate?: string;
};

type DockPopoverField = "status";
type TaskDockMode = "desktop" | "mobile";
type SidebarDisplayOptions = DockDisplayOptions;

const SIDEBAR_DISPLAY_OPTIONS_STORAGE_KEY = "task-tracker-sidebar-display-options";
const MOBILE_DOCK_VIEW_STORAGE_KEY = "task-tracker-mobile-dock-view";
const MOBILE_WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
const SIDEBAR_SORT_FIELD_OPTIONS: Array<{ value: SidebarTaskSortField; label: string }> = [
  { value: "default", label: "默认顺序" },
  { value: "task", label: "任务名" },
  { value: "createdAt", label: "创建时间" },
  { value: "updatedAt", label: "更新时间" },
  { value: "planStart", label: "计划时间" },
  { value: "dueDate", label: "截止时间" },
  { value: "priority", label: "优先级" },
  { value: "status", label: "任务状态" }
];
const SIDEBAR_SORT_DIRECTION_OPTIONS: Array<{ value: "asc" | "desc"; label: string }> = [
  { value: "asc", label: "升序" },
  { value: "desc", label: "降序" }
];

export class TaskDock {
  private filter: DockFilter = "all";
  private collapsedTaskIdsByFilter = new Map<DockFilter, Set<string>>();
  private bulkParentMenuOpen = false;
  private activePopover: { taskId: string; field: DockPopoverField } | null = null;
  private activePopoverCleanup?: () => void;
  private displaySettingsOpen = false;
  private displaySettingsCleanup?: () => void;
  private displayOptions: SidebarDisplayOptions;
  private unsubscribe?: () => void;
  private readonly mode: TaskDockMode;
  private readonly isMobile: boolean;
  private mobileView: MobileDockView;
  private mobileWeekStart = startOfWeek(new Date());

  constructor(
    private container: HTMLElement,
    private service: TaskService,
    private actions: {
      newTask: (options?: DockNewTaskOptions) => void;
      createSubtask: (parentId: string) => void;
      editTask: (task: TaskItem) => void;
      openTask: (task: TaskItem) => void;
      openTaskManager: () => void;
      setCurrentDocAsRoot: () => void;
    },
    options: {
      mode?: TaskDockMode;
    } = {}
  ) {
    this.mode = options.mode || "desktop";
    this.isMobile = this.mode === "mobile";
    this.mobileView = this.isMobile ? readMobileDockView() : "tracking";
    this.displayOptions = readSidebarDisplayOptions(this.service.store.getSettings().dockDisplayOptions);
    void this.ensureDisplayOptionsPersisted();
    this.unsubscribe = this.service.onChange(() => this.render());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.closePopover();
    this.closeDisplaySettings();
    this.container.onclick = null;
    this.container.onchange = null;
    this.container.onkeydown = null;
  }

  render(): void {
    this.ensureCollapsedStateForCurrentFilter();
    const settings = this.service.store.getSettings();
    const tree = this.filteredTaskTree();
    const counts = this.counts();
    const parentTaskIds = this.parentTaskIdsForTree(tree);

    this.closePopover();
    this.displaySettingsCleanup?.();
    this.displaySettingsCleanup = undefined;
    this.container.innerHTML = `<div class="task-tracker task-tracker--dock ${this.isMobile ? "task-tracker--mobile" : ""}">
  ${this.renderHeader(parentTaskIds.length === 0)}
  ${settings.taskRootDocId ? this.renderContent(tree, counts) : this.renderEmptyRoot()}
</div>`;

    this.bind();
    if (this.displaySettingsOpen) {
      this.openDisplaySettings();
    }
  }

  /* ── Header ──────────────────────────────────────────────── */

  private renderHeader(disableBulkParentToggle: boolean): string {
    const showTrackingControls = !this.isMobile || this.mobileView === "tracking";
    return `<div class="task-tracker-dock__header">
  <svg class="task-tracker-dock__header-icon"><use xlink:href="#iconTaskTracker"></use></svg>
  <span class="task-tracker-dock__header-title">任务追踪</span>
  <span class="fn__flex-1 fn__space"></span>
  ${showTrackingControls ? this.renderDockBulkParentMenu(disableBulkParentToggle) : ""}
  ${showTrackingControls ? `<div class="task-tracker-dock__display-settings" data-display-settings>
    <button class="task-icon-btn task-icon-btn--settings task-tracker-display-btn ${this.displaySettingsOpen ? "is-active" : ""}" data-action="toggle-display-settings" title="显示设置" aria-label="显示设置" aria-expanded="${this.displaySettingsOpen}" type="button">
      ${renderControlsIcon()}
    </button>
    ${this.displaySettingsOpen ? this.renderDisplaySettingsPopover() : ""}
  </div>` : ""}
  <button class="task-icon-btn task-tracker-dock__add-icon-btn" data-action="new" title="添加任务" aria-label="添加任务" type="button">+</button>
</div>`;
  }

  private renderDockBulkParentMenu(disabled: boolean): string {
    return `<div class="task-tracker-dock__bulk-parent-dropdown">
  <button
    class="task-icon-btn task-icon-btn--toggle-tree task-tracker-dock__bulk-parent-btn"
    data-action="toggle-dock-parent-bulk-menu"
    type="button"
    aria-label="展开 / 收缩父任务"
    title="展开 / 收缩父任务"
    ${disabled ? "disabled" : ""}
  >
    ${renderBulkParentIcon("entry")}
  </button>
  ${this.bulkParentMenuOpen && !disabled ? `<div class="task-manager-bulk-parent-dropdown__menu task-tracker-dock__bulk-parent-menu" role="menu">
    <button class="task-manager-bulk-parent-dropdown__item" data-action="expand-all-dock-parents" role="menuitem" type="button">
      <span class="task-manager-bulk-parent-dropdown__item-icon">${renderBulkParentIcon("expand")}</span>
      <span>展开所有父任务</span>
    </button>
    <button class="task-manager-bulk-parent-dropdown__item" data-action="collapse-all-dock-parents" role="menuitem" type="button">
      <span class="task-manager-bulk-parent-dropdown__item-icon">${renderBulkParentIcon("collapse")}</span>
      <span>收缩所有父任务</span>
    </button>
  </div>` : ""}
</div>`;
  }

  private renderDisplaySettingsPopover(): string {
    return `<div class="task-tracker-display-popover" data-display-settings-popover>
  <div class="task-tracker-display-popover__title">显示设置</div>
  <label class="task-tracker-display-option">
    <span>显示任务状态</span>
    <input type="checkbox" data-display-option="showStatus" ${this.displayOptions.showStatus ? "checked" : ""} />
  </label>
  <label class="task-tracker-display-option">
    <span>显示计划时间</span>
    <input type="checkbox" data-display-option="showDate" ${this.displayOptions.showDate ? "checked" : ""} />
  </label>
  <div class="task-tracker-display-popover__section">
    <div class="task-tracker-display-popover__section-title">排序方式</div>
    <label class="task-tracker-display-field">
      <span>排序字段</span>
      <select class="b3-select fn__block" data-display-option-select="sortField">
        ${SIDEBAR_SORT_FIELD_OPTIONS.map((option) => `<option value="${option.value}" ${this.displayOptions.sortField === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
      </select>
    </label>
    <label class="task-tracker-display-field">
      <span>排序方向</span>
      <select class="b3-select fn__block" data-display-option-select="sortDirection">
        ${SIDEBAR_SORT_DIRECTION_OPTIONS.map((option) => `<option value="${option.value}" ${this.displayOptions.sortDirection === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
      </select>
    </label>
  </div>
</div>`;
  }

  /* ── Content (tabs + list) ───────────────────────────────── */

  private renderContent(tree: TaskTreeNode[], counts: Record<DockFilter, number>): string {
    if (this.isMobile) {
      return `<div class="task-tracker-dock__body">
  ${this.renderMobileViewSwitch()}
  ${this.mobileView === "week"
    ? this.renderMobileWeekView()
    : `${this.renderTabs(counts)}
  <div class="task-tracker-dock__list">
    ${tree.length ? tree.map((node) => this.renderTaskCard(node, 0, node.children.length > 0)).join("") : this.renderEmptyState()}
  </div>`}
</div>`;
    }
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
      { key: "nextThreeDays", label: "未来三日" },
      { key: "overdue", label: "已过期" }
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

  private renderMobileViewSwitch(): string {
    return `<div class="task-mobile-view-switch" role="tablist" aria-label="手机版任务视图">
  <button
    class="task-mobile-view-switch__btn ${this.mobileView === "tracking" ? "is-active" : ""}"
    data-action="switch-mobile-tracking"
    role="tab"
    aria-selected="${this.mobileView === "tracking"}"
    type="button"
  >任务追踪</button>
  <button
    class="task-mobile-view-switch__btn ${this.mobileView === "week" ? "is-active" : ""}"
    data-action="switch-mobile-week"
    role="tab"
    aria-selected="${this.mobileView === "week"}"
    type="button"
  >周日历</button>
</div>`;
  }

  private renderMobileWeekView(): string {
    const weekLabel = formatWeekRangeCompact(formatDateKey(this.mobileWeekStart));
    const tasksByDate = groupMobileWeekTasksByDate(this.mobileWeekTasks());
    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(this.mobileWeekStart.getFullYear(), this.mobileWeekStart.getMonth(), this.mobileWeekStart.getDate() + index);
      const dateKey = formatDateKey(date);
      return {
        label: MOBILE_WEEKDAY_LABELS[index],
        date,
        dateKey,
        isToday: dateKey === formatDateKey(new Date())
      };
    });

    return `<section class="task-mobile-week">
  <div class="task-mobile-week-header">
    <div class="task-mobile-week-nav">
      <button class="task-mobile-week-nav__button task-mobile-week-nav__button--prev" data-action="prev-mobile-week" aria-label="上一周" title="上一周" type="button">${renderChevron(false)}</button>
      <div class="task-mobile-week-nav__range">${escapeHtml(weekLabel)}</div>
      <button class="task-mobile-week-nav__button task-mobile-week-nav__button--next" data-action="next-mobile-week" aria-label="下一周" title="下一周" type="button">${renderChevron(false)}</button>
    </div>
    <button class="task-mobile-week-nav__today" data-action="today-mobile-week" type="button">今</button>
  </div>
  <div class="task-mobile-week-list">
    ${weekDays.map((day) => this.renderMobileWeekDay(day, tasksByDate.get(day.dateKey) || [])).join("")}
  </div>
</section>`;
  }

  private renderMobileWeekDay(
    day: { label: string; date: Date; dateKey: string; isToday: boolean },
    tasks: TaskItem[]
  ): string {
    return `<section class="task-mobile-week-day ${day.isToday ? "is-today" : ""}" data-mobile-week-date="${day.dateKey}">
  <div class="task-mobile-week-day__date">
    <span class="task-mobile-week-day__weekday">${day.label}</span>
    <span class="task-mobile-week-day__daynum">${day.date.getMonth() + 1}/${day.date.getDate()}</span>
    <span class="task-mobile-week-day__count">${tasks.length}</span>
  </div>
  <div class="task-mobile-week-day__content">
    ${tasks.length
      ? tasks.map((task) => this.renderMobileWeekTask(task)).join("")
      : `<span class="task-mobile-week-day__empty">暂无日程</span>`}
  </div>
</section>`;
  }

  private renderMobileWeekTask(task: TaskItem): string {
    const cfg = getStatusBadgeConfig(task.status, this.service.store.getSettings());
    return `<button
  class="task-mobile-week-task"
  data-action="open"
  data-task-id="${task.id}"
  title="${escapeHtml(task.title)}"
  type="button"
  style="--task-mobile-week-dot: ${cfg.dotColor}; --task-mobile-week-bg: ${cfg.bgColor}; --task-mobile-week-border: ${cfg.borderColor};"
>${escapeHtml(task.title)}</button>`;
  }

  /* ── Task Cards ──────────────────────────────────────────── */

  private renderTaskCard(node: TaskTreeNode, depth: number, isParent: boolean): string {
    const task = node.task;
    const childCount = node.children.length;
    const collapsed = this.currentCollapsedTaskIds().has(task.id);
    const contextClass = node.contextOnly ? " task-tracker-dock__task--context" : "";
    const childClass = depth > 0 ? " task-tracker-dock__task--child" : "";
    const parentClass = isParent ? " task-tracker-dock__task--parent" : "";

    const badges = this.renderTaskBadges(task);
    return `<div class="task-tracker-dock__task ${childClass}${contextClass}${parentClass}" data-task-id="${task.id}" data-depth="${depth}">
  <div class="task-tracker-dock__task-row">
    ${depth > 0 ? `<span class="task-tracker-dock__task-indent"></span>` : ""}
    ${childCount
      ? `<button class="task-tracker-dock__task-toggle" data-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
      : `<span class="task-tracker-dock__task-toggle-placeholder"></span>`}
    <span class="task-tracker-dock__task-title ${isParent ? "is-parent" : ""}" data-action="open" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
    ${badges}
    ${childCount && depth === 0 ? this.renderChildCountBadge(childCount) : ""}
  </div>
  ${childCount && !collapsed
    ? `<div class="task-tracker-dock__task-children">${node.children.map((child) => this.renderTaskCard(child, depth + 1, child.children.length > 0)).join("")}</div>`
    : ""}
</div>`;
  }

  private renderTaskBadges(task: TaskItem): string {
    const parts: string[] = [];
    if (this.displayOptions.showStatus) {
      parts.push(this.renderStatusBadge(task));
    }
    if (this.displayOptions.showDate) {
      parts.push(this.renderDateBadge(task));
    }
    if (!parts.length) {
      return "";
    }
    return `<span class="task-tracker-dock__task-badges">${parts.join("")}</span>`;
  }

  /* ── Badges ──────────────────────────────────────────────── */

  private renderStatusBadge(task: TaskItem): string {
    const cfg = getStatusBadgeConfig(task.status, this.service.store.getSettings());
    if (this.isMobile) {
      return `<span class="task-manager-inline-badge task-manager-inline-badge--compact task-tracker-dock__inline-badge task-tracker-dock__inline-badge--text-only is-readonly" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
  <span class="task-manager-inline-badge__text">${escapeHtml(cfg.label)}</span>
</span>`;
    }
    const open = this.activePopover?.taskId === task.id && this.activePopover?.field === "status";
    return `<div class="task-manager-inline-dropdown task-tracker-dock__status-dropdown" data-popover="status" data-task-id="${task.id}">
  <button type="button" class="task-manager-inline-badge task-manager-inline-badge--compact task-tracker-dock__inline-badge task-tracker-dock__inline-badge--text-only ${open ? "is-open" : ""}" data-popover-toggle="status" data-task-id="${task.id}" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
    <span class="task-manager-inline-badge__text">${escapeHtml(cfg.label)}</span>
  </button>
  <div class="task-manager-inline-menu" data-popover-menu="status" data-task-id="${task.id}" style="display: ${open ? "" : "none"};">
    ${getAllOrderedStatuses(this.service.store.getSettings()).map((status) => {
      const itemCfg = getStatusBadgeConfig(status, this.service.store.getSettings());
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
    if (this.isMobile) {
      return `<span class="task-manager-card__meta-chip task-manager-card__meta-chip--date task-tracker-dock__date-chip task-tracker-dock__date-chip--${info.kind}" title="${escapeHtml(info.kind === "date" || info.kind === "overdue" ? info.dateKey : "")}">
  <span class="task-manager-card__meta-value">${escapeHtml(info.display)}</span>
</span>`;
    }
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
      case "nextThreeDays":
        return `<div class="task-tracker-dock__empty">
  <svg class="task-tracker-dock__empty-icon" viewBox="0 0 24 24" width="36" height="36"><rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 10h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
  <div class="task-tracker-dock__empty-title">未来三日暂无需要处理的任务</div>
  <div class="task-tracker-dock__empty-text">可切换到全部查看仍需跟踪的任务</div>
</div>`;
      case "overdue":
        return `<div class="task-tracker-dock__empty">
  <svg class="task-tracker-dock__empty-icon" viewBox="0 0 24 24" width="36" height="36"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.8 5.8 18.7 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
  <div class="task-tracker-dock__empty-title">暂无已过期任务</div>
  <div class="task-tracker-dock__empty-text">设置了计划时间且已过期的未完成任务会显示在这里</div>
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
      this.ensureCollapsedStateForCurrentFilter();
      this.render();
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "toggle-dock-parent-bulk-menu") {
        event.preventDefault();
        event.stopPropagation();
        this.closeDisplaySettings();
        this.bulkParentMenuOpen = !this.bulkParentMenuOpen;
        this.render();
        return;
      }
      if (action === "expand-all-dock-parents") {
        event.preventDefault();
        event.stopPropagation();
        this.expandAllVisibleParents();
        return;
      }
      if (action === "collapse-all-dock-parents") {
        event.preventDefault();
        event.stopPropagation();
        this.collapseAllVisibleParents();
        return;
      }
      if (action === "toggle-display-settings") {
        event.preventDefault();
        event.stopPropagation();
        this.bulkParentMenuOpen = false;
        this.toggleDisplaySettings();
        return;
      }
      if (action === "switch-mobile-tracking") {
        event.preventDefault();
        event.stopPropagation();
        this.setMobileView("tracking");
        return;
      }
      if (action === "switch-mobile-week") {
        event.preventDefault();
        event.stopPropagation();
        this.setMobileView("week");
        return;
      }
      if (action === "prev-mobile-week") {
        event.preventDefault();
        event.stopPropagation();
        this.mobileWeekStart = new Date(this.mobileWeekStart.getFullYear(), this.mobileWeekStart.getMonth(), this.mobileWeekStart.getDate() - 7);
        this.render();
        return;
      }
      if (action === "next-mobile-week") {
        event.preventDefault();
        event.stopPropagation();
        this.mobileWeekStart = new Date(this.mobileWeekStart.getFullYear(), this.mobileWeekStart.getMonth(), this.mobileWeekStart.getDate() + 7);
        this.render();
        return;
      }
      if (action === "today-mobile-week") {
        event.preventDefault();
        event.stopPropagation();
        this.mobileWeekStart = startOfWeek(new Date());
        this.render();
        return;
      }
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
        event.stopPropagation();
        const task = this.taskFromElement(actionButton);
        if (task) {
          this.actions.editTask(task);
        }
        return;
      }
    }

    const popoverToggle = this.isMobile ? null : target.closest<HTMLElement>("[data-popover-toggle]");
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

    if (this.bulkParentMenuOpen && !target.closest(".task-tracker-dock__bulk-parent-dropdown")) {
      this.bulkParentMenuOpen = false;
      this.render();
      return;
    }

    const dateChip = this.isMobile ? null : target.closest<HTMLElement>(".task-tracker-dock__date-chip");
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

    if (this.isMobile && this.mobileView === "week") {
      const weekDay = target.closest<HTMLElement>("[data-mobile-week-date]");
      if (weekDay?.dataset.mobileWeekDate) {
        this.actions.newTask({ presetPlanDate: weekDay.dataset.mobileWeekDate });
      }
    }
  }

  private handleChange(event: Event): void {
    const displayOptionInput = event.target instanceof HTMLInputElement && event.target.dataset.displayOption
      ? event.target
      : null;
    if (displayOptionInput) {
      const option = displayOptionInput.dataset.displayOption as keyof SidebarDisplayOptions;
      this.displayOptions = {
        ...this.displayOptions,
        [option]: displayOptionInput.checked
      };
      void this.persistDisplayOptions();
      return;
    }

    const displayOptionSelect = event.target instanceof HTMLSelectElement && event.target.dataset.displayOptionSelect
      ? event.target
      : null;
    if (displayOptionSelect) {
      const option = displayOptionSelect.dataset.displayOptionSelect as "sortField" | "sortDirection";
      if (option === "sortField") {
        this.displayOptions = {
          ...this.displayOptions,
          sortField: displayOptionSelect.value as SidebarTaskSortField
        };
      } else {
        this.displayOptions = {
          ...this.displayOptions,
          sortDirection: displayOptionSelect.value === "desc" ? "desc" : "asc"
        };
      }
      void this.persistDisplayOptions();
      return;
    }

    if (this.isMobile) {
      return;
    }

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
    if (event.key === "Escape" && this.displaySettingsOpen) {
      event.preventDefault();
      this.closeDisplaySettings();
      this.render();
      return;
    }
    if (event.key === "Escape" && this.bulkParentMenuOpen) {
      event.preventDefault();
      this.bulkParentMenuOpen = false;
      this.render();
      return;
    }
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

  private toggleDisplaySettings(): void {
    if (this.displaySettingsOpen) {
      this.closeDisplaySettings();
      this.render();
      return;
    }
    this.closePopover();
    this.displaySettingsOpen = true;
    this.render();
  }

  private openDisplaySettings(): void {
    this.closeDisplaySettings();
    this.displaySettingsOpen = true;
    const root = this.container.querySelector<HTMLElement>("[data-display-settings]");
    if (!root) {
      return;
    }
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && root.contains(target)) {
        return;
      }
      this.closeDisplaySettings();
      this.render();
    };
    document.addEventListener("click", closeOnOutside);
    this.displaySettingsCleanup = () => {
      document.removeEventListener("click", closeOnOutside);
    };
  }

  private closeDisplaySettings(): void {
    this.displaySettingsCleanup?.();
    this.displaySettingsCleanup = undefined;
    this.displaySettingsOpen = false;
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
    const collapsed = this.currentCollapsedTaskIds();
    if (collapsed.has(taskId)) {
      collapsed.delete(taskId);
    } else {
      collapsed.add(taskId);
    }
    this.render();
  }

  private ensureCollapsedStateForCurrentFilter(): void {
    if (this.collapsedTaskIdsByFilter.has(this.filter)) {
      return;
    }
    const collapsed = new Set<string>();
    if (this.filter === "all") {
      for (const taskId of collectParentTaskIds(this.service.store.all())) {
        collapsed.add(taskId);
      }
    }
    this.collapsedTaskIdsByFilter.set(this.filter, collapsed);
  }

  private currentCollapsedTaskIds(): Set<string> {
    this.ensureCollapsedStateForCurrentFilter();
    return this.collapsedTaskIdsByFilter.get(this.filter) || new Set<string>();
  }

  private parentTaskIdsForTree(tree: TaskTreeNode[]): string[] {
    const ids: string[] = [];
    const visit = (nodes: TaskTreeNode[]) => {
      for (const node of nodes) {
        if (node.children.length) {
          ids.push(node.task.id);
          visit(node.children);
        }
      }
    };
    visit(tree);
    return ids;
  }

  private expandAllVisibleParents(): void {
    const parentTaskIds = this.parentTaskIdsForTree(this.filteredTaskTree());
    if (!parentTaskIds.length) {
      return;
    }
    const collapsed = this.currentCollapsedTaskIds();
    for (const taskId of parentTaskIds) {
      collapsed.delete(taskId);
    }
    this.bulkParentMenuOpen = false;
    this.render();
  }

  private collapseAllVisibleParents(): void {
    const parentTaskIds = this.parentTaskIdsForTree(this.filteredTaskTree());
    if (!parentTaskIds.length) {
      return;
    }
    const collapsed = this.currentCollapsedTaskIds();
    for (const taskId of parentTaskIds) {
      collapsed.add(taskId);
    }
    this.bulkParentMenuOpen = false;
    this.render();
  }

  /* ── Data ────────────────────────────────────────────────── */

  private filteredTaskTree(): TaskTreeNode[] {
    const tasks = this.service.store.all();
    const matched = new Set(tasks.filter((task) => this.matchesFilter(task)).map((task) => task.id));
    const visible = includeAncestors(tasks, matched);
    return sortTaskTree(buildTaskTree(tasks, visible, matched), this.sidebarComparator());
  }

  private matchesFilter(task: TaskItem): boolean {
    // Base check: only show active (non-completed, non-cancelled) tasks,
    // matching the current business rule from ACTIVE_TASK_STATUSES.
    if (!getActiveTaskStatuses(this.service.store.getSettings()).includes(task.status)) return false;

    const today = toDateKey(new Date().toISOString());
    const threeDaysLater = toDateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString());
    switch (this.filter) {
      case "nextThreeDays":
        return isTaskWithinDateRange(task, today, threeDaysLater);
      case "overdue":
        return isPlannedTaskOverdue(task, today);
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
    const threeDaysLater = toDateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString());
    const activeStatuses = new Set(getActiveTaskStatuses(this.service.store.getSettings()));
    const activePool = tasks.filter((t) => activeStatuses.has(t.status));

    const allCount = activePool.length;
    const importantCount = activePool.filter((t) => isImportantTask(t)).length;
    const nextThreeDaysCount = activePool.filter((t) => isTaskWithinDateRange(t, today, threeDaysLater)).length;
    const overdueCount = activePool.filter((t) => isPlannedTaskOverdue(t, today)).length;

    return { all: allCount, important: importantCount, nextThreeDays: nextThreeDaysCount, overdue: overdueCount };
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

  private sidebarComparator(): (a: TaskItem, b: TaskItem) => number {
    const direction = this.displayOptions.sortDirection === "desc" ? -1 : 1;
    const statusOrder = getAllOrderedStatuses(this.service.store.getSettings());
    return (a, b) => compareTasksBySidebarSortField(a, b, this.displayOptions.sortField, statusOrder) * direction;
  }

  private async persistDisplayOptions(): Promise<void> {
    this.render();
    try {
      await this.service.store.setSettings({
        dockDisplayOptions: this.displayOptions
      });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "保存侧栏显示设置失败", 5000, "error");
    }
  }

  private async ensureDisplayOptionsPersisted(): Promise<void> {
    const settings = this.service.store.getSettings();
    if (settings.dockDisplayOptions) {
      return;
    }
    try {
      await this.service.store.setSettings({
        dockDisplayOptions: this.displayOptions
      });
    } catch (error) {
      console.warn("Task Tracker: failed to persist dock display options", error);
    }
  }

  private setMobileView(view: MobileDockView): void {
    if (!this.isMobile || this.mobileView === view) {
      return;
    }
    this.mobileView = view;
    this.closePopover();
    this.closeDisplaySettings();
    this.bulkParentMenuOpen = false;
    writeMobileDockView(view);
    this.render();
  }

  private mobileWeekTasks(): TaskItem[] {
    return this.service.store.all().filter((task) => Boolean(toDateKey(task.planStart)));
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

function isTaskWithinDateRange(task: TaskItem, startKey?: string, endKey?: string): boolean {
  if (!startKey || !endKey) {
    return false;
  }
  return [task.planStart, task.planEnd, task.dueDate]
    .map((value) => toDateKey(value))
    .some((dateKey) => Boolean(dateKey && dateKey >= startKey && dateKey <= endKey));
}

function isPlannedTaskOverdue(task: TaskItem, today?: string): boolean {
  if (!today) {
    return false;
  }
  const planStartKey = toDateKey(task.planStart);
  return Boolean(planStartKey && planStartKey < today);
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

function renderChevron(expanded: boolean): string {
  return `<span class="task-tree-chevron${expanded ? " is-expanded" : ""}" aria-hidden="true"></span>`;
}

function renderControlsIcon(): string {
  return `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
  <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>
  <circle cx="5" cy="4" r="1.35" fill="#FFFFFF" stroke="currentColor" stroke-width="1.2"/>
  <circle cx="10.5" cy="8" r="1.35" fill="#FFFFFF" stroke="currentColor" stroke-width="1.2"/>
  <circle cx="7" cy="12" r="1.35" fill="#FFFFFF" stroke="currentColor" stroke-width="1.2"/>
</svg>`;
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

function readSidebarDisplayOptions(stored?: DockDisplayOptions): SidebarDisplayOptions {
  const fromSettings = normalizeSidebarDisplayOptions(stored);
  if (stored) {
    return fromSettings;
  }
  return readSidebarDisplayOptionsFromLegacyStorage() || fromSettings;
}

function normalizeSidebarDisplayOptions(raw?: Partial<DockDisplayOptions>): SidebarDisplayOptions {
  return {
    showStatus: raw?.showStatus !== false,
    showDate: raw?.showDate !== false,
    sortField: isSidebarSortField(raw?.sortField) ? raw.sortField : DEFAULT_DOCK_DISPLAY_OPTIONS.sortField,
    sortDirection: raw?.sortDirection === "desc" ? "desc" : DEFAULT_DOCK_DISPLAY_OPTIONS.sortDirection
  };
}

function readSidebarDisplayOptionsFromLegacyStorage(): SidebarDisplayOptions | undefined {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_DISPLAY_OPTIONS_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<SidebarDisplayOptions> | null;
    return normalizeSidebarDisplayOptions(parsed || undefined);
  } catch {
    return undefined;
  }
}

function isSidebarSortField(value: unknown): value is SidebarTaskSortField {
  return typeof value === "string" && SIDEBAR_SORT_FIELD_OPTIONS.some((option) => option.value === value);
}

function readMobileDockView(): MobileDockView {
  try {
    return window.localStorage.getItem(MOBILE_DOCK_VIEW_STORAGE_KEY) === "week" ? "week" : "tracking";
  } catch {
    return "tracking";
  }
}

function writeMobileDockView(view: MobileDockView): void {
  try {
    window.localStorage.setItem(MOBILE_DOCK_VIEW_STORAGE_KEY, view);
  } catch {
    // ignore storage failures
  }
}

function groupMobileWeekTasksByDate(tasks: TaskItem[]): Map<string, TaskItem[]> {
  const grouped = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    const key = toDateKey(task.planStart);
    if (!key) {
      continue;
    }
    const list = grouped.get(key) || [];
    list.push(task);
    grouped.set(key, list);
  }
  for (const list of grouped.values()) {
    list.sort(compareMobileWeekTasks);
  }
  return grouped;
}

function compareMobileWeekTasks(a: TaskItem, b: TaskItem): number {
  const aHasTime = hasExplicitTime(a.planStart);
  const bHasTime = hasExplicitTime(b.planStart);
  if (aHasTime !== bHasTime) {
    return aHasTime ? -1 : 1;
  }
  if (aHasTime && bHasTime) {
    const byPlanStart = (a.planStart || "").localeCompare(b.planStart || "");
    if (byPlanStart !== 0) {
      return byPlanStart;
    }
  }
  return (a.createdAt || "").localeCompare(b.createdAt || "")
    || a.title.localeCompare(b.title, "zh-Hans-CN");
}

function hasExplicitTime(value?: string): boolean {
  if (!value) {
    return false;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false;
  }
  const timeMatch = value.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!timeMatch) {
    return false;
  }
  const [, hour, minute, second] = timeMatch;
  return hour !== "00" || minute !== "00" || (second || "00") !== "00";
}

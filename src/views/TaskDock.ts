import { showMessage } from "siyuan";
import { fromDateInput, formatHumanDate, isActiveDateBeforeToday, toDateKey } from "../date";
import type { TaskService } from "../document";
import { priorityOptions, statusOptions, escapeHtml } from "../dialogs/TaskDialog";
import {
  ACTIVE_TASK_STATUSES,
  type TaskItem,
  type TaskPriority,
  type TaskStatus
} from "../types";

type DockFilter = "focus" | "unplanned" | "today" | "overdue" | "all" | "done";

export class TaskDock {
  private filter: DockFilter = "focus";
  private collapsedTaskIds = new Set<string>();
  private unsubscribe?: () => void;

  constructor(
    private container: HTMLElement,
    private service: TaskService,
    private actions: {
      newTask: () => void;
      createSubtask: (parentId: string) => void;
      openTask: (task: TaskItem) => void;
      openCalendar: () => void;
      setCurrentDocAsRoot: () => void;
    }
  ) {
    this.unsubscribe = this.service.onChange(() => this.render());
  }

  destroy(): void {
    this.unsubscribe?.();
  }

  render(): void {
    const settings = this.service.store.getSettings();
    const tree = this.filteredTaskTree();
    const counts = this.counts();

    this.container.innerHTML = `<div class="task-tracker task-tracker--dock">
  <div class="block__icons task-tracker-dock__header">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconTaskTracker"></use></svg>
      <span>任务追踪</span>
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <button class="block__icon ariaLabel" data-action="new" aria-label="新建任务" data-position="south"><svg><use xlink:href="#iconAdd"></use></svg></button>
    <button class="block__icon ariaLabel" data-action="calendar" aria-label="任务日历" data-position="south"><svg><use xlink:href="#iconCalendar"></use></svg></button>
    <button class="block__icon ariaLabel" data-action="sync-deleted" aria-label="清理已删除文档" data-position="south"><svg><use xlink:href="#iconRefresh"></use></svg></button>
  </div>
  <div class="task-tracker-dock__body">
    ${settings.taskRootDocId ? this.renderContent(tree, counts) : this.renderEmptyRoot()}
  </div>
</div>`;

    this.bind();
  }

  private renderContent(tree: TaskTreeNode[], counts: Record<DockFilter, number>): string {
    return `<div class="task-tracker-tabs">
  ${tabButton("all", "全部", counts.all, this.filter)}
  ${tabButton("focus", "焦点", counts.focus, this.filter)}
  ${tabButton("unplanned", "未安排", counts.unplanned, this.filter)}
  ${tabButton("today", "今日", counts.today, this.filter)}
  ${tabButton("overdue", "逾期", counts.overdue, this.filter)}
  ${tabButton("done", "完成", counts.done, this.filter)}
</div>
<div class="task-tracker-list">
  ${tree.length ? tree.map((node) => this.renderTaskNode(node, 0)).join("") : `<div class="task-tracker-empty">这里暂时没有任务。</div>`}
</div>`;
  }

  private renderEmptyRoot(): string {
    return `<div class="task-tracker-empty task-tracker-empty--root">
  <div class="task-tracker-empty__title">还没有事项库</div>
  <div class="task-tracker-empty__text">先创建或打开一个文档，比如“事项库”，再把它设为任务根文档。</div>
  <button class="b3-button b3-button--text" data-action="set-root">将当前文档设为事项库</button>
</div>`;
  }

  private renderTaskNode(node: TaskTreeNode, depth: number): string {
    const task = node.task;
    const statusClass = `task-status-${task.status}`;
    const priorityClass = `task-priority-${task.priority}`;
    const planned = formatHumanDate(task.planStart);
    const due = formatHumanDate(task.dueDate);
    const parent = task.parentId ? this.service.store.get(task.parentId) : undefined;
    const childCount = node.children.length;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const depthClass = depth > 0 ? " task-tracker-task--child" : "";
    const contextClass = node.contextOnly ? " task-tracker-task--context" : "";

    return `<div class="task-tracker-task ${statusClass} ${priorityClass}${depthClass}${contextClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
  <div class="task-tracker-task__main">
    <div class="task-tracker-task__title-row">
      ${childCount
        ? `<button class="task-tracker-task__toggle" data-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}"><span>${collapsed ? "▸" : "▾"}</span></button>`
        : `<span class="task-tracker-task__toggle-placeholder"></span>`}
      <button class="task-tracker-task__title" data-action="open" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</button>
      ${childCount ? `<span class="task-tracker-task__child-count">${childCount}</span>` : ""}
    </div>
    <div class="task-tracker-task__meta">
      <span>${escapeHtml(task.project || "无项目")}</span>
      <span>计划：${planned}</span>
      <span>截止：${due}</span>
      ${parent ? `<span>父任务：${escapeHtml(parent.title)}</span>` : ""}
    </div>
  </div>
  <div class="task-tracker-task__controls">
    <select class="b3-select" data-field="status" aria-label="任务状态">${statusOptions(task.status)}</select>
    <select class="b3-select" data-field="priority" aria-label="任务优先级">${priorityOptions(task.priority)}</select>
    <input class="b3-text-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="计划日期" />
    <input class="b3-text-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="截止日期" />
    <button class="block__icon ariaLabel" data-action="subtask" aria-label="创建子任务" data-position="north"><svg><use xlink:href="#iconAdd"></use></svg></button>
    ${task.status === "completed"
      ? `<button class="block__icon ariaLabel" data-action="reopen" aria-label="重新打开" data-position="north"><svg><use xlink:href="#iconRefresh"></use></svg></button>`
      : `<button class="block__icon ariaLabel" data-action="complete" aria-label="完成任务" data-position="north"><svg><use xlink:href="#iconSelect"></use></svg></button>`}
    <button class="block__icon ariaLabel" data-action="remove-record" aria-label="从任务追踪移除" data-position="north"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
  </div>
  ${childCount && !collapsed
    ? `<div class="task-tracker-task__children">${node.children.map((child) => this.renderTaskNode(child, depth + 1)).join("")}</div>`
    : ""}
</div>`;
  }

  private bind(): void {
    this.container.querySelector("[data-action='new']")?.addEventListener("click", () => this.actions.newTask());
    this.container.querySelector("[data-action='calendar']")?.addEventListener("click", () => this.actions.openCalendar());
    this.container.querySelector("[data-action='sync-deleted']")?.addEventListener("click", () => {
      this.runUpdate(async () => {
        const count = await this.service.syncDeletedDocs();
        showMessage(count > 0 ? `已清理 ${count} 个已删除任务记录` : "没有需要清理的任务记录");
      });
    });
    this.container.querySelector("[data-action='set-root']")?.addEventListener("click", () => this.actions.setCurrentDocAsRoot());
    this.container.querySelectorAll<HTMLElement>("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        this.filter = button.dataset.filter as DockFilter;
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLElement>("[data-task-id]").forEach((row) => {
      const taskId = row.dataset.taskId;
      const task = taskId ? this.service.store.get(taskId) : undefined;
      if (!task) {
        return;
      }

      row.querySelector("[data-action='open']")?.addEventListener("click", () => this.actions.openTask(task));
      row.querySelector("[data-action='toggle-children']")?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (this.collapsedTaskIds.has(task.id)) {
          this.collapsedTaskIds.delete(task.id);
        } else {
          this.collapsedTaskIds.add(task.id);
        }
        this.render();
      });
      row.querySelector("[data-action='subtask']")?.addEventListener("click", () => this.actions.createSubtask(task.id));
      row.querySelector("[data-action='complete']")?.addEventListener("click", () => this.runUpdate(() => this.service.completeTask(task.id)));
      row.querySelector("[data-action='reopen']")?.addEventListener("click", () => this.runUpdate(() => this.service.reopenTask(task.id)));
      row.querySelector("[data-action='remove-record']")?.addEventListener("click", () => {
        const message = `仅从插件任务追踪中移除“${task.title}”及其子任务记录，不会删除思源文档。确定继续？`;
        if (!window.confirm(message)) {
          return;
        }
        this.runUpdate(async () => {
          const count = await this.service.removeTaskRecord(task.id, { cascade: true });
          showMessage(count > 0 ? `已移除 ${count} 个任务记录` : "任务记录已不存在");
        });
      });

      row.querySelector<HTMLSelectElement>("[data-field='status']")?.addEventListener("change", (event) => {
        this.runUpdate(() => this.service.updateTask(task.id, { status: (event.target as HTMLSelectElement).value as TaskStatus }));
      });
      row.querySelector<HTMLSelectElement>("[data-field='priority']")?.addEventListener("change", (event) => {
        this.runUpdate(() => this.service.updateTask(task.id, { priority: (event.target as HTMLSelectElement).value as TaskPriority }));
      });
      row.querySelector<HTMLInputElement>("[data-field='planDate']")?.addEventListener("change", (event) => {
        this.runUpdate(() => this.service.updateTask(task.id, { planStart: fromDateInput((event.target as HTMLInputElement).value) }));
      });
      row.querySelector<HTMLInputElement>("[data-field='dueDate']")?.addEventListener("change", (event) => {
        this.runUpdate(() => this.service.updateTask(task.id, { dueDate: (event.target as HTMLInputElement).value || undefined }));
      });
    });
  }

  private async runUpdate(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "更新任务失败", 5000, "error");
    }
  }

  private filteredTaskTree(): TaskTreeNode[] {
    const tasks = this.service.store.all();
    const matched = new Set(tasks.filter((task) => this.matchesFilter(task)).map((task) => task.id));
    const visible = includeAncestors(tasks, matched);
    return buildTaskTree(tasks, visible, matched);
  }

  private matchesFilter(task: TaskItem): boolean {
    const today = toDateKey(new Date().toISOString());
    switch (this.filter) {
      case "unplanned":
        return isActive(task) && !task.planStart;
      case "today":
        return isActive(task) && toDateKey(task.planStart || task.dueDate) === today;
      case "overdue":
        return isActive(task) && isActiveDateBeforeToday(task.planStart || task.dueDate);
      case "all":
        return isActive(task);
      case "done":
        return task.status === "completed";
      case "focus":
      default:
        return isActive(task) && (task.status === "doing" || toDateKey(task.planStart || task.dueDate) <= today);
    }
  }

  private counts(): Record<DockFilter, number> {
    const tasks = this.service.store.all();
    const today = toDateKey(new Date().toISOString());
    return {
      focus: tasks.filter((task) => isActive(task) && (task.status === "doing" || toDateKey(task.planStart || task.dueDate) <= today)).length,
      unplanned: tasks.filter((task) => isActive(task) && !task.planStart).length,
      today: tasks.filter((task) => isActive(task) && toDateKey(task.planStart || task.dueDate) === today).length,
      overdue: tasks.filter((task) => isActive(task) && isActiveDateBeforeToday(task.planStart || task.dueDate)).length,
      all: tasks.filter(isActive).length,
      done: tasks.filter((task) => task.status === "completed").length
    };
  }
}

interface TaskTreeNode {
  task: TaskItem;
  children: TaskTreeNode[];
  contextOnly: boolean;
}

function tabButton(filter: DockFilter, label: string, count: number, current: DockFilter): string {
  return `<button class="task-tracker-tab ${filter === current ? "is-active" : ""}" data-filter="${filter}">${label}<span>${count}</span></button>`;
}

function isActive(task: TaskItem): boolean {
  return ACTIVE_TASK_STATUSES.includes(task.status);
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

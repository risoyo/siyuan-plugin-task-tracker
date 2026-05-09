import { showMessage } from "siyuan";
import { formatMonthDay, fromDateInput, toDateKey } from "../date";
import type { TaskService } from "../document";
import { escapeHtml, statusOptions } from "../dialogs/TaskDialog";
import {
  ACTIVE_TASK_STATUSES,
  type TaskItem,
  type TaskStatus
} from "../types";

type DockFilter = "focus" | "today" | "all";

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
      openTaskManager: () => void;
      setCurrentDocAsRoot: () => void;
    }
  ) {
    this.unsubscribe = this.service.onChange(() => this.render());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.container.onchange = null;
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
    <button class="block__icon ariaLabel" data-action="manager" aria-label="打开任务控制面板" data-position="south"><svg><use xlink:href="#iconTaskTracker"></use></svg></button>
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
  ${tabButton("today", "今日", counts.today, this.filter)}
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
    const childCount = node.children.length;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const depthClass = depth > 0 ? " task-tracker-task--child" : "";
    const contextClass = node.contextOnly ? " task-tracker-task--context" : "";

    return `<div class="task-tracker-task ${statusClass} ${priorityClass}${depthClass}${contextClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
  <div class="task-tracker-task__title-row">
    ${childCount
      ? `<button class="task-tracker-task__toggle" data-action="toggle-children" aria-label="${collapsed ? "展开子任务" : "折叠子任务"}" title="${collapsed ? "展开子任务" : "折叠子任务"}">${renderChevron(!collapsed)}</button>`
      : `<span class="task-tracker-task__toggle-placeholder"></span>`}
    <button class="task-tracker-task__title" data-action="open" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</button>
    <div class="task-tracker-task__meta">
      ${this.renderSelectMeta("状态", "status", statusOptions(task.status))}
      ${this.renderDateMeta("计划", "planDate", formatMonthDay(task.planStart), toDateKey(task.planStart))}
      ${task.dueDate ? this.renderDateMeta("截止", "dueDate", formatMonthDay(task.dueDate), task.dueDate) : ""}
    </div>
    ${childCount ? `<span class="task-tracker-task__child-count">${childCount}</span>` : ""}
  </div>
  ${childCount && !collapsed
    ? `<div class="task-tracker-task__children">${node.children.map((child) => this.renderTaskNode(child, depth + 1)).join("")}</div>`
    : ""}
</div>`;
  }

  private renderSelectMeta(label: string, field: "status", options: string): string {
    return `<label class="task-tracker-task__meta-chip">
  <select class="task-tracker-task__meta-select" data-field="${field}" aria-label="${label}">${options}</select>
</label>`;
  }

  private renderDateMeta(label: string, field: "planDate" | "dueDate", display: string, value: string): string {
    return `<label class="task-tracker-task__meta-chip task-tracker-task__meta-chip--date">
  <span class="task-tracker-task__meta-value">${display}</span>
  <input class="task-tracker-task__meta-date-input" data-field="${field}" type="date" value="${value}" aria-label="${label}" />
</label>`;
  }

  private bind(): void {
    this.container.querySelector("[data-action='new']")?.addEventListener("click", () => this.actions.newTask());
    this.container.querySelector("[data-action='manager']")?.addEventListener("click", () => this.actions.openTaskManager());
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

    this.container.onchange = (event) => this.handleFieldChange(event);

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
      row.querySelectorAll<HTMLElement>(".task-tracker-task__meta-chip--date").forEach((chip) => {
        chip.addEventListener("click", (event) => {
          const input = chip.querySelector<HTMLInputElement>("input[type='date']");
          if (!input) {
            return;
          }
          if (event.target === input) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          input.focus();
          if (typeof input.showPicker === "function") {
            input.showPicker();
          } else {
            input.click();
          }
        });
      });
    });
  }

  private handleFieldChange(event: Event): void {
    const target = event.target as HTMLElement;
    const field = target.closest<HTMLElement>("[data-field]");
    const task = field ? this.taskFromElement(field) : undefined;
    if (!field || !task) {
      return;
    }

    if (field.dataset.field === "status") {
      void this.runUpdate(() => this.service.updateTask(task.id, { status: (field as HTMLSelectElement).value as TaskStatus }));
    } else if (field.dataset.field === "planDate") {
      void this.runUpdate(() => this.service.updateTask(task.id, { planStart: fromDateInput((field as HTMLInputElement).value) }));
    } else if (field.dataset.field === "dueDate") {
      void this.runUpdate(() => this.service.updateTask(task.id, { dueDate: (field as HTMLInputElement).value || undefined }));
    }
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

  private filteredTaskTree(): TaskTreeNode[] {
    const tasks = this.service.store.all();
    const matched = new Set(tasks.filter((task) => this.matchesFilter(task)).map((task) => task.id));
    const visible = includeAncestors(tasks, matched);
    return buildTaskTree(tasks, visible, matched);
  }

  private matchesFilter(task: TaskItem): boolean {
    const today = toDateKey(new Date().toISOString());
    switch (this.filter) {
      case "today":
        return isActive(task) && toDateKey(task.planStart || task.dueDate) === today;
      case "all":
        return isActive(task);
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
      today: tasks.filter((task) => isActive(task) && toDateKey(task.planStart || task.dueDate) === today).length,
      all: tasks.filter(isActive).length
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

function renderChevron(expanded: boolean): string {
  return `<span class="task-tree-chevron${expanded ? " is-expanded" : ""}" aria-hidden="true"></span>`;
}

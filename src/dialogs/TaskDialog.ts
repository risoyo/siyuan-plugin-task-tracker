import { Dialog, showMessage } from "siyuan";
import { formatDateKey, fromDatetimeLocal, toDatetimeLocal } from "../date";
import { getDocById } from "../api";
import type { TaskService } from "../document";
import {
  PRIORITY_BADGE_CONFIG,
  STATUS_BADGE_CONFIG,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type SourceContext,
  type TaskCreateInput,
  type TaskItem,
  type TaskPriority,
  type TaskStatus
} from "../types";

export interface TaskDialogOptions {
  service: TaskService;
  parentId?: string;
  source?: SourceContext;
  presetTitle?: string;
  presetPlanDate?: string;
  task?: TaskItem;
  onSaved?: (task: TaskItem) => void;
}

type SourceMode = "manual" | "note";

export class TaskDialog {
  constructor(private options: TaskDialogOptions) {}

  show(): void {
    const editingTask = this.options.task;
    const editMode = Boolean(editingTask);
    const editSource = editingTask
      ? {
        blockId: editingTask.sourceBlockId,
        docId: editingTask.sourceDocId,
        text: editingTask.sourceText
      }
      : undefined;
    const effectiveSource = editSource?.docId ? editSource : this.options.source;
    const defaultMode: SourceMode = effectiveSource?.docId ? "note" : "manual";
    let sourceMode: SourceMode = defaultMode;
    let selectedSource = sourceMode === "note" && effectiveSource ? { ...effectiveSource } : undefined as SourceContext | undefined;
    const tasks = this.options.service.store.all();
    const activeTasks = tasks.filter((task) => {
      if (editMode && task.id === editingTask?.id) {
        return false;
      }
      return task.id === this.options.parentId || task.id === editingTask?.parentId || (task.status !== "completed" && task.status !== "cancelled");
    });
    const projects = this.options.service.store.getProjects();
    const defaultTitle = editingTask?.title || this.options.presetTitle || effectiveSource?.text || "";
    const defaultProject = editingTask?.project || this.options.service.store.getSettings().defaultProject || "";
    const defaultParentId = editingTask?.parentId || this.options.parentId || "";
    const defaultStatus: TaskStatus = editingTask?.status || "todo";
    const defaultPriority: TaskPriority = editingTask?.priority || "medium";
    const defaultCreatedAt = editingTask ? formatDateKey(new Date(editingTask.createdAt)) : formatDateKey(new Date());
    const defaultPlanStart = editingTask?.planStart
      ? toDatetimeLocal(editingTask.planStart)
      : (this.options.presetPlanDate ? `${this.options.presetPlanDate}T09:00` : "");
    const defaultPlanEnd = editingTask?.planEnd ? toDatetimeLocal(editingTask.planEnd) : "";
    const defaultDueDate = editingTask?.dueDate?.slice(0, 10) || "";
    const defaultCompletedAt = editingTask?.completedAt ? toDatetimeLocal(editingTask.completedAt) : "";
    const defaultDescription = editingTask?.description || "";
    const defaultSourceDocId = effectiveSource?.docId || "";
    const isSubtasks = Boolean(!editMode && this.options.parentId);
    const dialogTitle = editMode ? "编辑任务" : (this.options.parentId ? "创建子任务" : "新建任务");
    const submitLabel = editMode ? "保存修改" : (this.options.parentId ? "创建子任务" : "创建任务");
    const submittingLabel = editMode ? "保存中..." : "创建中...";

    const statusBadgeHtml = statusBadge(defaultStatus);
    const priorityBadgeHtml = priorityBadge(defaultPriority);
    const statusDropdownHtml = statusDropdown(defaultStatus);
    const priorityDropdownHtml = priorityDropdown(defaultPriority);

    const dialog = new Dialog({
      title: "",
      content: `<div class="task-tracker-dialog-v3">
  <div class="task-tracker-dialog-v3__header">
    <div class="task-tracker-dialog-v3__header-left">
      <div class="task-tracker-dialog-v3__icon-block">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </div>
      <span class="task-tracker-dialog-v3__title">${escapeHtml(dialogTitle)}</span>
    </div>
    <button class="task-tracker-dialog-v3__close" data-action="cancel" aria-label="关闭" title="关闭">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>
    </button>
  </div>
  <form class="task-tracker-dialog-v3__body">
    <div class="task-tracker-dialog-v3__grid">
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">任务标题 <span class="task-tracker-dialog-v3__required">*</span></span>
        <input class="task-tracker-dialog-v3__input" name="title" value="${escapeAttr(defaultTitle)}" required placeholder="请输入任务标题" />
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">项目</span>
        <input class="task-tracker-dialog-v3__input" name="project" list="task-tracker-projects" value="${escapeAttr(defaultProject)}" placeholder="选择或输入项目" />
        <datalist id="task-tracker-projects">
          ${projects.map((project) => `<option value="${escapeAttr(project)}"></option>`).join("")}
        </datalist>
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">父任务</span>
        ${isSubtasks
          ? `<div class="task-tracker-dialog-v3__parent-locked">
            <span class="task-tracker-dialog-v3__parent-text">${escapeHtml(activeTasks.find((t) => t.id === defaultParentId)?.title || defaultParentId)}</span>
            <span class="task-tracker-dialog-v3__parent-hint">当前子任务将归属于该任务</span>
          </div>
          <input type="hidden" name="parentId" value="${escapeAttr(defaultParentId)}" />`
          : `<select class="task-tracker-dialog-v3__select" name="parentId">
            <option value="">无</option>
            ${activeTasks.map((task) => `<option value="${task.id}" ${task.id === defaultParentId ? "selected" : ""}>${escapeHtml(task.title)}</option>`).join("")}
          </select>`
        }
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">状态</span>
        <div class="task-tracker-dialog-v3__dropdown" data-dropdown="status">
          <input type="hidden" name="status" value="${defaultStatus}" />
          <button type="button" class="task-tracker-dialog-v3__badge" data-dropdown-toggle data-dropdown="status">
            ${statusBadgeHtml}
          </button>
          <div class="task-tracker-dialog-v3__menu" data-dropdown-menu="status" style="display:none;">
            ${statusDropdownHtml}
          </div>
        </div>
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">优先级</span>
        <div class="task-tracker-dialog-v3__dropdown" data-dropdown="priority">
          <input type="hidden" name="priority" value="${defaultPriority}" />
          <button type="button" class="task-tracker-dialog-v3__badge" data-dropdown-toggle data-dropdown="priority">
            ${priorityBadgeHtml}
          </button>
          <div class="task-tracker-dialog-v3__menu" data-dropdown-menu="priority" style="display:none;">
            ${priorityDropdownHtml}
          </div>
        </div>
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">创建时间（系统记录）</span>
        <input class="task-tracker-dialog-v3__input" name="createdAt" type="date" value="${escapeAttr(defaultCreatedAt)}" readonly disabled />
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">计划开始</span>
        <input class="task-tracker-dialog-v3__input" name="planStart" type="datetime-local" value="${escapeAttr(defaultPlanStart)}" />
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">计划结束</span>
        <input class="task-tracker-dialog-v3__input" name="planEnd" type="datetime-local" value="${escapeAttr(defaultPlanEnd)}" />
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">截止日期</span>
        <input class="task-tracker-dialog-v3__input" name="dueDate" type="date" value="${escapeAttr(defaultDueDate)}" />
      </label>
      <label class="task-tracker-dialog-v3__field">
        <span class="task-tracker-dialog-v3__label">完成时间</span>
        <input class="task-tracker-dialog-v3__input" name="completedAt" type="datetime-local" value="${escapeAttr(defaultCompletedAt)}" />
      </label>
      <div class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--wide">
        <span class="task-tracker-dialog-v3__label">来源</span>
        <div class="task-tracker-source__summary" data-source-summary></div>
        <div class="task-tracker-source__mode" role="radiogroup" aria-label="来源模式">
          <label class="task-tracker-source__mode-item">
            <input type="radio" name="sourceMode" value="manual" ${sourceMode === "manual" ? "checked" : ""} />
            <span>手动创建</span>
          </label>
          <label class="task-tracker-source__mode-item">
            <input type="radio" name="sourceMode" value="note" ${sourceMode === "note" ? "checked" : ""} />
            <span>笔记</span>
          </label>
        </div>
        <div class="task-tracker-source__note" data-source-note ${sourceMode === "note" ? "" : "hidden"}>
          <input class="task-tracker-dialog-v3__input" name="sourceDocId" placeholder="填写笔记 ID" value="${escapeAttr(defaultSourceDocId)}" />
        </div>
      </div>
      <div class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--wide">
        <span class="task-tracker-dialog-v3__label">任务描述</span>
        <textarea class="task-tracker-dialog-v3__textarea" name="description" rows="4" placeholder="补充任务的背景、目标、注意事项等">${escapeHtml(defaultDescription)}</textarea>
      </div>
    </div>
  </form>
  <div class="task-tracker-dialog-v3__footer">
    <button type="button" class="task-tracker-dialog-v3__btn-cancel" data-action="cancel">取消</button>
    <button type="submit" class="task-tracker-dialog-v3__btn-primary">${submitLabel}</button>
  </div>
</div>`,
      width: "960px"
    });

    const root = dialog.element.querySelector<HTMLElement>(".task-tracker-dialog-v3");
    if (!root) {
      return;
    }

    const form = root.querySelector("form") as HTMLFormElement;
    const titleInput = root.querySelector<HTMLInputElement>("input[name='title']");
    const sourceDocIdInput = root.querySelector<HTMLInputElement>("input[name='sourceDocId']");
    const sourceSummary = root.querySelector<HTMLElement>("[data-source-summary]");
    const sourceNote = root.querySelector<HTMLElement>("[data-source-note]");
    const submitButton = root.querySelector<HTMLButtonElement>(".task-tracker-dialog-v3__btn-primary") as HTMLButtonElement;
    titleInput?.focus();
    titleInput?.select();

    // ── Source ──────────────────────────────────────────────

    const renderSourceSummary = () => {
      if (!sourceSummary) {
        return;
      }
      const current = sourceMode === "note"
        ? selectedSource?.text || sourceDocIdInput?.value.trim() || "尚未填写笔记 ID"
        : "手动创建";
      sourceSummary.innerHTML = `<div class="task-tracker-source__current">当前来源：${escapeHtml(current)}</div>`;
    };

    const renderSourceMode = () => {
      if (sourceNote) {
        sourceNote.hidden = sourceMode !== "note";
      }
      if (sourceMode === "manual") {
        selectedSource = undefined;
      }
      renderSourceSummary();
    };

    const applyDocIdSource = async (): Promise<void> => {
      const docId = sourceDocIdInput?.value.trim() || "";
      if (!docId) {
        throw new Error("请先填写笔记 ID");
      }
      const doc = await getDocById(docId);
      if (!doc) {
        throw new Error("填写的笔记 ID 无效，或它不是一篇文档");
      }
      selectedSource = {
        blockId: doc.id,
        docId: doc.id,
        text: doc.content || doc.hpath || doc.id
      };
      renderSourceSummary();
    };

    renderSourceMode();

    // ── Dropdown logic ────────────────────────────────────

    const closeAllDropdowns = () => {
      root.querySelectorAll<HTMLElement>("[data-dropdown-menu]").forEach((menu) => {
        menu.style.display = "none";
      });
      root.querySelectorAll<HTMLElement>("[data-dropdown-toggle]").forEach((toggle) => {
        toggle.classList.remove("is-open");
      });
    };

    const toggleDropdown = (dropdownName: string) => {
      const menu = root.querySelector<HTMLElement>(`[data-dropdown-menu="${dropdownName}"]`);
      const toggle = root.querySelector<HTMLElement>(`[data-dropdown-toggle][data-dropdown="${dropdownName}"]`);
      if (!menu || !toggle) {
        return;
      }
      const isOpen = menu.style.display !== "none";
      closeAllDropdowns();
      if (!isOpen) {
        menu.style.display = "";
        toggle.classList.add("is-open");
      }
    };

    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;

      const toggle = target.closest<HTMLElement>("[data-dropdown-toggle]");
      if (toggle) {
        event.stopPropagation();
        const name = toggle.dataset.dropdown;
        if (name) {
          toggleDropdown(name);
        }
        return;
      }

      const statusItem = target.closest<HTMLElement>("[data-status-value]");
      if (statusItem) {
        event.stopPropagation();
        const value = statusItem.dataset.statusValue as TaskStatus;
        const dropdownRoot = statusItem.closest<HTMLElement>("[data-dropdown]");
        if (dropdownRoot && value) {
          const hidden = dropdownRoot.querySelector<HTMLInputElement>("input[type='hidden']") as HTMLInputElement;
          hidden.value = value;
          const badgeBtn = dropdownRoot.querySelector<HTMLElement>("[data-dropdown-toggle]") as HTMLElement;
          badgeBtn.innerHTML = statusBadge(value);
        }
        closeAllDropdowns();
        return;
      }

      const priorityItem = target.closest<HTMLElement>("[data-priority-value]");
      if (priorityItem) {
        event.stopPropagation();
        const value = priorityItem.dataset.priorityValue as TaskPriority;
        const dropdownRoot = priorityItem.closest<HTMLElement>("[data-dropdown]");
        if (dropdownRoot && value) {
          const hidden = dropdownRoot.querySelector<HTMLInputElement>("input[type='hidden']") as HTMLInputElement;
          hidden.value = value;
          const badgeBtn = dropdownRoot.querySelector<HTMLElement>("[data-dropdown-toggle]") as HTMLElement;
          badgeBtn.innerHTML = priorityBadge(value);
        }
        closeAllDropdowns();
        return;
      }

      if (!target.closest("[data-dropdown-menu]") && !target.closest("[data-dropdown-toggle]")) {
        closeAllDropdowns();
      }
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const anyOpen = root.querySelector<HTMLElement>("[data-dropdown-menu]:not([style*='display: none'])");
        if (anyOpen) {
          event.stopPropagation();
          closeAllDropdowns();
        }
      }
    });

    // Close dropdowns on outside click
    const handleOutsideClick = (event: MouseEvent) => {
      if (!dialog.element.contains(event.target as Node)) {
        closeAllDropdowns();
      }
    };
    document.addEventListener("click", handleOutsideClick);

    // ── Cancel / Close ────────────────────────────────────

    const cleanupDialog = () => {
      document.removeEventListener("click", handleOutsideClick);
      dialog.destroy();
    };

    root.querySelectorAll<HTMLElement>("[data-action='cancel']").forEach((btn) => {
      btn.addEventListener("click", () => cleanupDialog());
    });

    // ── Source mode ────────────────────────────────────────

    root.querySelectorAll<HTMLInputElement>("input[name='sourceMode']").forEach((input) => {
      input.addEventListener("change", () => {
        sourceMode = input.value as SourceMode;
        renderSourceMode();
      });
    });
    sourceDocIdInput?.addEventListener("input", () => {
      if (sourceMode === "note") {
        selectedSource = undefined;
        renderSourceSummary();
      }
    });

    // ── Form submission ────────────────────────────────────

    submitButton?.addEventListener("click", () => form.requestSubmit());

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      submitButton.textContent = submittingLabel;

      try {
        const data = new FormData(form);
        if (sourceMode === "note") {
          await applyDocIdSource();
        } else {
          selectedSource = undefined;
        }
        const input: TaskCreateInput = {
          title: String(data.get("title") || "").trim(),
          parentId: String(data.get("parentId") || "") || undefined,
          sourceBlockId: selectedSource?.blockId,
          sourceDocId: selectedSource?.docId,
          sourceText: selectedSource?.text,
          project: String(data.get("project") || "").trim() || undefined,
          status: String(data.get("status") || "todo") as TaskStatus,
          priority: String(data.get("priority") || "medium") as TaskPriority,
          dueDate: String(data.get("dueDate") || "") || undefined,
          planStart: fromDatetimeLocal(String(data.get("planStart") || "")),
          planEnd: fromDatetimeLocal(String(data.get("planEnd") || "")),
          completedAt: fromDatetimeLocal(String(data.get("completedAt") || "")),
          description: String(data.get("description") || "").trim() || undefined
        };
        if (!input.title) {
          throw new Error("请填写任务标题");
        }
        const task = editMode && editingTask
          ? await this.options.service.updateTask(editingTask.id, input)
          : await this.options.service.createTask(input);
        showMessage(editMode ? "任务已更新" : "任务文档已创建");
        this.options.onSaved?.(task);
        cleanupDialog();
      } catch (error) {
        showMessage(error instanceof Error ? error.message : (editMode ? "更新任务失败" : "创建任务失败"), 5000, "error");
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
    });
  }
}

// ── Badge / Dropdown render helpers ──────────────────────────

function statusBadge(status: TaskStatus): string {
  const cfg = STATUS_BADGE_CONFIG[status];
  return `<span class="task-tracker-dialog-v3__badge-inner" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
    <span class="task-tracker-dialog-v3__badge-dot" style="--dot-color: ${cfg.dotColor};"></span>
    <span class="task-tracker-dialog-v3__badge-text">${cfg.label}</span>
    <svg class="task-tracker-dialog-v3__badge-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </span>`;
}

function statusDropdown(current: TaskStatus): string {
  const statuses: TaskStatus[] = ["todo", "doing", "waiting", "completed", "cancelled"];
  return statuses.map((status) => {
    const cfg = STATUS_BADGE_CONFIG[status];
    const active = status === current;
    return `<button type="button" class="task-tracker-dialog-v3__menu-item ${active ? "is-active" : ""}" data-status-value="${status}">
      <span class="task-tracker-dialog-v3__menu-dot" style="--dot-color: ${cfg.dotColor};"></span>
      <span class="task-tracker-dialog-v3__menu-label">${cfg.label}</span>
      ${active ? `<svg class="task-tracker-dialog-v3__menu-check" viewBox="0 0 16 16" width="14" height="14"><path d="M4 8l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}
    </button>`;
  }).join("");
}

function priorityBadge(priority: TaskPriority): string {
  const cfg = PRIORITY_BADGE_CONFIG[priority];
  return `<span class="task-tracker-dialog-v3__badge-inner" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
    <svg class="task-tracker-dialog-v3__badge-flag" viewBox="0 0 16 16" width="14" height="14" style="--icon-color: ${cfg.iconColor};"><path d="M4 2v12M4 2h9l-3 3.5L13 9H4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="task-tracker-dialog-v3__badge-text">${cfg.label}</span>
    <svg class="task-tracker-dialog-v3__badge-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </span>`;
}

function priorityDropdown(current: TaskPriority): string {
  const priorities: TaskPriority[] = ["high", "medium", "low", "none"];
  return priorities.map((priority) => {
    const cfg = PRIORITY_BADGE_CONFIG[priority];
    const active = priority === current;
    return `<button type="button" class="task-tracker-dialog-v3__menu-item ${active ? "is-active" : ""}" data-priority-value="${priority}">
      <svg class="task-tracker-dialog-v3__badge-flag" viewBox="0 0 16 16" width="14" height="14" style="--icon-color: ${cfg.iconColor};"><path d="M4 2v12M4 2h9l-3 3.5L13 9H4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="task-tracker-dialog-v3__menu-label">${cfg.label}</span>
      ${active ? `<svg class="task-tracker-dialog-v3__menu-check" viewBox="0 0 16 16" width="14" height="14"><path d="M4 8l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}
    </button>`;
  }).join("");
}

// ── Shared utilities ────────────────────────────────────────

/** Render a `<select>` element for the given status (used in TaskManagerTab). */
export function statusOptions(current: TaskStatus): string {
  return (Object.entries(TASK_STATUS_LABELS) as Array<[TaskStatus, string]>)
    .map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`)
    .join("");
}

/** Render a `<select>` element for the given priority (used in TaskManagerTab). */
export function priorityOptions(current: TaskPriority): string {
  return (Object.entries(TASK_PRIORITY_LABELS) as Array<[TaskPriority, string]>)
    .map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`)
    .join("");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

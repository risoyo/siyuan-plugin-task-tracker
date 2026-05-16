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

// ── Inline SVG icons ──────────────────────────────────────────

const ICONS = {
  close: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  taskGrid: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  folder: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4.5v7a1 1 0 001 1h10a1 1 0 001-1v-7a1 1 0 00-1-1H7.5L6.5 2.5H3a1 1 0 00-1 1z"/></svg>`,
  hierarchy: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="13" r="1.5"/><path d="M8 4.5v4M5.2 10L4 11.5M10.8 10l1.2 1.5"/></svg>`,
  calendar: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 2v2M11 2v2M2 7h12"/></svg>`,
  clock: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 5.5V8l2 1.5"/></svg>`,
  chevronDown: `<svg viewBox="0 0 10 6" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 8l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"/></svg>`,
  doc: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h6l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M9 2v4h4"/></svg>`,
  search: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4"/><path d="M10 10l3 3"/></svg>`,
};

// ── Reusable combobox / popover select HTML builders ──────────

function buildComboboxSelect(name: string, value: string, placeholder: string, leftIcon: string, optionsHtml: string, extraAttrs: string = ""): string {
  return `<div class="task-tracker-dialog-v3__combobox" data-combobox="${name}">
    <div class="task-tracker-dialog-v3__combobox-trigger" data-combobox-toggle="${name}">
      <span class="task-tracker-dialog-v3__combobox-icon">${leftIcon}</span>
      <span class="task-tracker-dialog-v3__combobox-value" data-combobox-value="${name}">${escapeHtml(value || placeholder)}</span>
      <span class="task-tracker-dialog-v3__combobox-arrow">${ICONS.chevronDown}</span>
    </div>
    <input type="hidden" name="${name}" value="${escapeAttr(value)}" ${extraAttrs} />
    <div class="task-tracker-dialog-v3__menu" data-combobox-menu="${name}" style="display:none;">
      <div class="task-tracker-dialog-v3__menu-scroll">
        ${optionsHtml}
      </div>
    </div>
  </div>`;
}

function buildComboboxOption(value: string, label: string, active: boolean, icon?: string, indent?: boolean): string {
  return `<button type="button" class="task-tracker-dialog-v3__menu-item ${active ? "is-active" : ""} ${indent ? "is-indented" : ""}" data-combobox-option="${escapeAttr(value)}">
    ${icon ? `<span class="task-tracker-dialog-v3__menu-item-icon">${icon}</span>` : ""}
    <span class="task-tracker-dialog-v3__menu-label">${escapeHtml(label)}</span>
    ${active ? `<span class="task-tracker-dialog-v3__menu-check">${ICONS.check}</span>` : ""}
  </button>`;
}

// ── Status / Priority badge + dropdown (from 3.1.0, refined) ──

function statusBadge(status: TaskStatus): string {
  const cfg = STATUS_BADGE_CONFIG[status];
  return `<span class="task-tracker-dialog-v3__badge-inner" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
    <span class="task-tracker-dialog-v3__badge-dot" style="--dot-color: ${cfg.dotColor};"></span>
    <span class="task-tracker-dialog-v3__badge-text">${cfg.label}</span>
    <span class="task-tracker-dialog-v3__badge-arrow">${ICONS.chevronDown}</span>
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
      ${active ? `<span class="task-tracker-dialog-v3__menu-check">${ICONS.check}</span>` : ""}
    </button>`;
  }).join("");
}

function priorityBadge(priority: TaskPriority): string {
  const cfg = PRIORITY_BADGE_CONFIG[priority];
  return `<span class="task-tracker-dialog-v3__badge-inner" style="--badge-color: ${cfg.textColor}; --badge-bg: ${cfg.bgColor}; --badge-border: ${cfg.borderColor};">
    <svg class="task-tracker-dialog-v3__badge-flag" viewBox="0 0 16 16" width="14" height="14" style="--icon-color: ${cfg.iconColor};"><path d="M4 2v12M4 2h9l-3 3.5L13 9H4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="task-tracker-dialog-v3__badge-text">${cfg.label}</span>
    <span class="task-tracker-dialog-v3__badge-arrow">${ICONS.chevronDown}</span>
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
      ${active ? `<span class="task-tracker-dialog-v3__menu-check">${ICONS.check}</span>` : ""}
    </button>`;
  }).join("");
}

// ── Segmented control ─────────────────────────────────────────

function buildSegmentedControl(name: string, options: Array<{ value: string; label: string; icon: string }>, current: string): string {
  return `<div class="task-tracker-dialog-v3__segments" data-segments="${name}">
    ${options.map((opt) => {
      const active = opt.value === current;
      return `<button type="button" class="task-tracker-dialog-v3__segment ${active ? "is-active" : ""}" data-segment-value="${opt.value}">
        <span class="task-tracker-dialog-v3__segment-icon">${opt.icon}</span>
        <span class="task-tracker-dialog-v3__segment-label">${escapeHtml(opt.label)}</span>
      </button>`;
    }).join("")}
  </div>`;
}

// ── Section divider ───────────────────────────────────────────

function sectionDivider(): string {
  return `<div class="task-tracker-dialog-v3__divider"></div>`;
}

function sectionTitle(title: string): string {
  return `<div class="task-tracker-dialog-v3__section-title">${escapeHtml(title)}</div>`;
}

// ── TaskDialog class ──────────────────────────────────────────

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
    const subtitle = editMode ? "修改任务信息并保存" : (this.options.parentId ? "在当前任务下创建一个子任务" : "创建一个新的跟踪任务");
    const submitLabel = editMode ? "保存修改" : (this.options.parentId ? "创建子任务" : "创建任务");
    const submittingLabel = editMode ? "保存中..." : "创建中...";

    // ── Build project options ──────────────────────────────
    const projectOptionsHtml = [
      buildComboboxOption("", "无项目", !defaultProject),
      ...projects.map((p) => buildComboboxOption(p, p, p === defaultProject, ICONS.folder)),
    ].join("");

    // ── Build parent task options ──────────────────────────
    const parentOptionsHtml = (() => {
      const parents = activeTasks.filter((t) => !t.parentId || t.parentId === defaultParentId);
      // Actually use all active tasks, but indent children
      const topLevel = activeTasks.filter((t) => !t.parentId);
      const children = activeTasks.filter((t) => t.parentId && !topLevel.includes(t));
      let html = buildComboboxOption("", "无（顶层任务）", !defaultParentId);
      for (const t of topLevel) {
        html += buildComboboxOption(t.id, t.title, t.id === defaultParentId);
      }
      for (const t of children) {
        html += buildComboboxOption(t.id, t.title, t.id === defaultParentId, undefined, true);
      }
      return html;
    })();

    // ── Source segmented control ───────────────────────────
    const sourceSegmentHtml = buildSegmentedControl("sourceMode", [
      { value: "manual", label: "手动创建", icon: ICONS.edit },
      { value: "note", label: "笔记", icon: ICONS.doc },
    ], sourceMode);

    const statusBadgeHtml = statusBadge(defaultStatus);
    const priorityBadgeHtml = priorityBadge(defaultPriority);
    const statusDropdownHtml = statusDropdown(defaultStatus);
    const priorityDropdownHtml = priorityDropdown(defaultPriority);

    const dialog = new Dialog({
      title: "",
      content: `<div class="task-tracker-dialog-v3">
  <!-- Header -->
  <div class="task-tracker-dialog-v3__header">
    <div class="task-tracker-dialog-v3__header-left">
      <div class="task-tracker-dialog-v3__icon-block">
        ${ICONS.taskGrid}
      </div>
      <div class="task-tracker-dialog-v3__header-text">
        <span class="task-tracker-dialog-v3__title">${escapeHtml(dialogTitle)}</span>
        <span class="task-tracker-dialog-v3__subtitle">${escapeHtml(subtitle)}</span>
      </div>
    </div>
    <button class="task-tracker-dialog-v3__close" data-action="cancel" aria-label="关闭" title="关闭">
      ${ICONS.close}
    </button>
  </div>

  <form class="task-tracker-dialog-v3__body">
    <!-- Basic info section -->
    <div class="task-tracker-dialog-v3__section">
      <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--full">
        <span class="task-tracker-dialog-v3__label">任务标题 <span class="task-tracker-dialog-v3__required">*</span></span>
        <input class="task-tracker-dialog-v3__input" name="title" value="${escapeAttr(defaultTitle)}" required placeholder="请输入任务标题" />
      </label>

      <div class="task-tracker-dialog-v3__row">
        <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--half">
          <span class="task-tracker-dialog-v3__label">项目</span>
          ${buildComboboxSelect("project", defaultProject, "选择或输入项目", ICONS.folder, projectOptionsHtml)}
        </label>
        <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--half">
          <span class="task-tracker-dialog-v3__label">父任务</span>
          ${isSubtasks
            ? `<div class="task-tracker-dialog-v3__parent-locked">
              <span class="task-tracker-dialog-v3__parent-icon">${ICONS.hierarchy}</span>
              <span class="task-tracker-dialog-v3__parent-text">${escapeHtml(activeTasks.find((t) => t.id === defaultParentId)?.title || defaultParentId)}</span>
              <span class="task-tracker-dialog-v3__parent-hint">当前任务将作为所选父任务的子任务</span>
            </div>
            <input type="hidden" name="parentId" value="${escapeAttr(defaultParentId)}" />`
            : buildComboboxSelect("parentId", defaultParentId, "选择或输入父任务（可选）", ICONS.hierarchy, parentOptionsHtml)
          }
          ${isSubtasks
            ? `<div class="task-tracker-dialog-v3__hint">当前任务将作为所选父任务的子任务</div>`
            : `<div class="task-tracker-dialog-v3__hint">如需创建子任务，请在此选择父任务</div>`
          }
        </label>
      </div>

      <div class="task-tracker-dialog-v3__row">
        <div class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--half">
          <span class="task-tracker-dialog-v3__label">状态 / 优先级</span>
          <div class="task-tracker-dialog-v3__status-priority-row">
            <div class="task-tracker-dialog-v3__dropdown" data-dropdown="status">
              <input type="hidden" name="status" value="${defaultStatus}" />
              <button type="button" class="task-tracker-dialog-v3__badge" data-dropdown-toggle data-dropdown="status">
                ${statusBadgeHtml}
              </button>
              <div class="task-tracker-dialog-v3__menu" data-dropdown-menu="status" style="display:none;">
                ${statusDropdownHtml}
              </div>
            </div>
            <div class="task-tracker-dialog-v3__dropdown" data-dropdown="priority">
              <input type="hidden" name="priority" value="${defaultPriority}" />
              <button type="button" class="task-tracker-dialog-v3__badge" data-dropdown-toggle data-dropdown="priority">
                ${priorityBadgeHtml}
              </button>
              <div class="task-tracker-dialog-v3__menu" data-dropdown-menu="priority" style="display:none;">
                ${priorityDropdownHtml}
              </div>
            </div>
          </div>
        </div>
        <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--half">
          <span class="task-tracker-dialog-v3__label">创建时间（系统记录）</span>
          <div class="task-tracker-dialog-v3__readonly-field">
            <span class="task-tracker-dialog-v3__readonly-icon">${ICONS.calendar}</span>
            <span class="task-tracker-dialog-v3__readonly-value">${escapeHtml(defaultCreatedAt)}</span>
          </div>
          <input type="hidden" name="createdAt" value="${escapeAttr(defaultCreatedAt)}" />
        </label>
      </div>
    </div>

    ${sectionDivider()}

    <!-- Time info section -->
    <div class="task-tracker-dialog-v3__section">
      ${sectionTitle("时间信息")}
      <div class="task-tracker-dialog-v3__row task-tracker-dialog-v3__row--quad">
        <label class="task-tracker-dialog-v3__field">
          <span class="task-tracker-dialog-v3__label">计划开始</span>
          <div class="task-tracker-dialog-v3__date-wrap">
            <span class="task-tracker-dialog-v3__date-icon">${ICONS.clock}</span>
            <input class="task-tracker-dialog-v3__input" name="planStart" type="datetime-local" value="${escapeAttr(defaultPlanStart)}" placeholder="选择日期和时间" />
          </div>
        </label>
        <label class="task-tracker-dialog-v3__field">
          <span class="task-tracker-dialog-v3__label">计划结束</span>
          <div class="task-tracker-dialog-v3__date-wrap">
            <span class="task-tracker-dialog-v3__date-icon">${ICONS.clock}</span>
            <input class="task-tracker-dialog-v3__input" name="planEnd" type="datetime-local" value="${escapeAttr(defaultPlanEnd)}" placeholder="选择日期和时间" />
          </div>
        </label>
        <label class="task-tracker-dialog-v3__field">
          <span class="task-tracker-dialog-v3__label">截止日期</span>
          <div class="task-tracker-dialog-v3__date-wrap">
            <span class="task-tracker-dialog-v3__date-icon">${ICONS.calendar}</span>
            <input class="task-tracker-dialog-v3__input" name="dueDate" type="date" value="${escapeAttr(defaultDueDate)}" placeholder="选择日期" />
          </div>
        </label>
        <label class="task-tracker-dialog-v3__field">
          <span class="task-tracker-dialog-v3__label">完成时间</span>
          <div class="task-tracker-dialog-v3__date-wrap">
            <span class="task-tracker-dialog-v3__date-icon">${ICONS.clock}</span>
            <input class="task-tracker-dialog-v3__input" name="completedAt" type="datetime-local" value="${escapeAttr(defaultCompletedAt)}" placeholder="选择日期和时间（可选）" />
          </div>
        </label>
      </div>
    </div>

    ${sectionDivider()}

    <!-- Notes & description section -->
    <div class="task-tracker-dialog-v3__section">
      ${sectionTitle("笔记信息")}
      <div class="task-tracker-dialog-v3__source-row">
        <div class="task-tracker-dialog-v3__source-left">
          <span class="task-tracker-dialog-v3__label">来源</span>
          ${sourceSegmentHtml}
        </div>
        <div class="task-tracker-dialog-v3__source-right" data-source-note ${sourceMode === "note" ? "" : "hidden"}>
          <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--full">
            <span class="task-tracker-dialog-v3__label">笔记 ID</span>
            <div class="task-tracker-dialog-v3__input-wrap">
              <span class="task-tracker-dialog-v3__input-icon">${ICONS.search}</span>
              <input class="task-tracker-dialog-v3__input" name="sourceDocId" placeholder="填写笔记 ID" value="${escapeAttr(defaultSourceDocId)}" />
            </div>
          </label>
        </div>
      </div>
      <div class="task-tracker-dialog-v3__source-summary" data-source-summary>
        <div class="task-tracker-dialog-v3__source-current">当前来源：${sourceMode === "note" ? (selectedSource?.text || "尚未填写笔记 ID") : "手动创建"}</div>
      </div>

      <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--full" style="margin-top:16px;">
        <span class="task-tracker-dialog-v3__label">任务描述</span>
        <textarea class="task-tracker-dialog-v3__textarea" name="description" rows="3" placeholder="补充任务的背景、目标、注意事项等">${escapeHtml(defaultDescription)}</textarea>
      </label>
    </div>
  </form>

  <!-- Footer -->
  <div class="task-tracker-dialog-v3__footer">
    <button type="button" class="task-tracker-dialog-v3__btn-cancel" data-action="cancel">取消</button>
    <button type="submit" class="task-tracker-dialog-v3__btn-primary">${submitLabel}</button>
  </div>
</div>`,
      width: "1080px"
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
      sourceSummary.innerHTML = `<div class="task-tracker-dialog-v3__source-current">当前来源：${escapeHtml(current)}</div>`;
    };

    const renderSourceMode = () => {
      if (sourceNote) {
        sourceNote.hidden = sourceMode !== "note";
      }
      if (sourceMode === "manual") {
        selectedSource = undefined;
      }
      // Update segment buttons
      root.querySelectorAll<HTMLElement>("[data-segment-value]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.segmentValue === sourceMode);
      });
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

    // ── Project combobox ────────────────────────────────────

    const initCombobox = (name: string) => {
      const combobox = root.querySelector<HTMLElement>(`[data-combobox="${name}"]`);
      if (!combobox) return;

      const toggle = combobox.querySelector<HTMLElement>(`[data-combobox-toggle="${name}"]`);
      const menu = combobox.querySelector<HTMLElement>(`[data-combobox-menu="${name}"]`);
      const hidden = combobox.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      const valueEl = combobox.querySelector<HTMLElement>(`[data-combobox-value="${name}"]`);
      const filterInput = combobox.querySelector<HTMLInputElement>(`[data-combobox-filter="${name}"]`);

      const updateDisplay = (val: string, label: string) => {
        if (valueEl) valueEl.textContent = label || (name === "project" ? "选择或输入项目" : "选择或输入父任务（可选）");
        if (menu) menu.style.display = "none";
        toggle?.classList.remove("is-open");
        // Update active state on options
        menu?.querySelectorAll<HTMLElement>("[data-combobox-option]").forEach((opt) => {
          opt.classList.toggle("is-active", opt.dataset.comboboxOption === val);
        });
      };

      toggle?.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = menu?.style.display !== "none";
        closeAllDropdowns();
        closeAllComboboxes(name);
        if (!isOpen && menu) {
          menu.style.display = "";
          toggle.classList.add("is-open");
          // Focus filter input if present
          if (filterInput) {
            filterInput.value = "";
            filterInput.focus();
            filterOptions("");
          }
        }
      });

      // Filter input handler for project combobox
      filterInput?.addEventListener("input", () => {
        filterOptions(filterInput.value);
      });

      filterInput?.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          closeAllComboboxes();
        }
        e.stopPropagation();
      });

      const filterOptions = (query: string) => {
        menu?.querySelectorAll<HTMLElement>("[data-combobox-option]").forEach((opt) => {
          const text = opt.textContent?.toLowerCase() || "";
          const matches = !query || text.includes(query.toLowerCase());
          (opt as HTMLElement).style.display = matches ? "" : "none";
        });
      };

      // Option click
      menu?.addEventListener("click", (e) => {
        const option = (e.target as HTMLElement).closest<HTMLElement>("[data-combobox-option]");
        if (!option) return;
        e.stopPropagation();
        const val = option.dataset.comboboxOption || "";
        const label = option.querySelector<HTMLElement>(".task-tracker-dialog-v3__menu-label")?.textContent || val;
        if (hidden) hidden.value = val;
        updateDisplay(val, label);
      });
    };

    // Init project and parent comboboxes
    initCombobox("project");
    initCombobox("parentId");

    // ── Combobox close management ───────────────────────────

    const closeAllComboboxes = (except?: string) => {
      root.querySelectorAll<HTMLElement>("[data-combobox-menu]").forEach((menu) => {
        const name = menu.dataset.comboboxMenu;
        if (name !== except) {
          menu.style.display = "none";
        }
      });
      root.querySelectorAll<HTMLElement>("[data-combobox-toggle]").forEach((toggle) => {
        const name = toggle.dataset.comboboxToggle;
        if (name !== except) {
          toggle.classList.remove("is-open");
        }
      });
    };

    // ── Dropdown logic (status / priority) ──────────────────

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
      closeAllComboboxes();
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

      if (!target.closest("[data-dropdown-menu]") && !target.closest("[data-dropdown-toggle]") && !target.closest("[data-combobox-menu]") && !target.closest("[data-combobox-toggle]")) {
        closeAllDropdowns();
        closeAllComboboxes();
      }
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const anyOpen = root.querySelector<HTMLElement>("[data-dropdown-menu]:not([style*='display: none'])");
        const anyCombobox = root.querySelector<HTMLElement>("[data-combobox-menu]:not([style*='display: none'])");
        if (anyOpen || anyCombobox) {
          event.stopPropagation();
          closeAllDropdowns();
          closeAllComboboxes();
        }
      }
    });

    const handleOutsideClick = (event: MouseEvent) => {
      if (!dialog.element.contains(event.target as Node)) {
        closeAllDropdowns();
        closeAllComboboxes();
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

    root.querySelectorAll<HTMLElement>("[data-segment-value]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = btn.dataset.segmentValue as SourceMode;
        if (val) {
          sourceMode = val;
          renderSourceMode();
        }
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

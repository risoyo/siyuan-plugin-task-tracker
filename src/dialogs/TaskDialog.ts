import { Dialog, getFrontend, showMessage } from "siyuan";
import { formatDateKey, fromDatetimeLocal, newSiyuanId, toDatetimeLocal } from "../date";
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
  allowStructureEdit?: boolean;
  onSaved?: (task: TaskItem) => void;
  onOpenTask?: (task: TaskItem) => void;
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
  chevronDown: `<svg viewBox="0 0 10 6" width="10" height="10"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 8l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"/></svg>`,
  doc: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h6l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M9 2v4h4"/></svg>`,
  search: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4"/><path d="M10 10l3 3"/></svg>`,
  save: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2.5h8l2 2V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M5 2.5v4h5v-4"/><path d="M5 11h6"/></svg>`
};

type ComboboxMode = "select-only" | "editable";

function buildComboboxSelect(
  name: string,
  value: string,
  placeholder: string,
  leftIcon: string,
  optionsHtml: string,
  mode: ComboboxMode = "select-only",
  extraAttrs: string = ""
): string {
  const editableInput = mode === "editable"
    ? `<input class="task-tracker-dialog-v3__combobox-input" name="${name}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off" ${extraAttrs} />`
    : `<span class="task-tracker-dialog-v3__combobox-value" data-combobox-value="${name}">${escapeHtml(value || placeholder)}</span>`;
  const hiddenInput = mode === "editable"
    ? ""
    : `<input type="hidden" name="${name}" value="${escapeAttr(value)}" ${extraAttrs} />`;
  return `<div class="task-tracker-dialog-v3__combobox ${mode === "editable" ? "is-editable" : ""}" data-combobox="${name}" data-combobox-mode="${mode}">
    <button type="button" class="task-tracker-dialog-v3__combobox-trigger" data-combobox-toggle="${name}">
      <span class="task-tracker-dialog-v3__combobox-icon">${leftIcon}</span>
      ${editableInput}
      <span class="task-tracker-dialog-v3__combobox-arrow">${ICONS.chevronDown}</span>
    </button>
    ${hiddenInput}
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

function sectionDivider(): string {
  return `<div class="task-tracker-dialog-v3__divider"></div>`;
}

function sectionTitle(title: string): string {
  return `<div class="task-tracker-dialog-v3__section-title">${escapeHtml(title)}</div>`;
}

function positionPopup(menu: HTMLElement, trigger: HTMLElement): void {
  const triggerRect = trigger.getBoundingClientRect();
  const menuHeight = menu.offsetHeight || 200;
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  const fitsBelow = spaceBelow >= Math.min(menuHeight, 240);
  const fitsAbove = spaceAbove >= Math.min(menuHeight, 240);

  let top: number;
  if (fitsBelow || !fitsAbove) {
    top = triggerRect.bottom + 4;
  } else {
    top = triggerRect.top - Math.min(menuHeight, 240) - 4;
  }

  const maxTop = viewportH - Math.min(menuHeight, 240) - 8;
  top = Math.max(8, Math.min(top, maxTop));

  menu.style.position = "fixed";
  menu.style.top = `${top}px`;
  menu.style.left = `${triggerRect.left}px`;
  menu.style.minWidth = `${triggerRect.width}px`;
  menu.style.zIndex = "400";
}

function resetPopupPosition(menu: HTMLElement): void {
  menu.style.position = "";
  menu.style.top = "";
  menu.style.left = "";
  menu.style.minWidth = "";
  menu.style.zIndex = "";
}

export class TaskDialog {
  constructor(private options: TaskDialogOptions) {}

  show(): void {
    const editingTask = this.options.task;
    const editMode = Boolean(editingTask);
    const allowStructureEdit = this.options.allowStructureEdit !== false;
    let revisionCursor = editingTask?.taskRevision ?? 0;
    if (editMode && editingTask) {
      void this.options.service.readTaskRevisionSnapshot(editingTask.docId, editingTask.id)
        .then((snapshot) => {
          revisionCursor = snapshot.revision;
        })
        .catch(() => undefined);
    }
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
    const headerTaskTitle = editingTask?.title || defaultTitle || dialogTitle;
    const submitLabel = editMode ? "保存修改" : (this.options.parentId ? "创建子任务" : "创建任务");
    const submittingLabel = editMode ? "保存中..." : "创建中...";

    const projectOptionsHtml = [
      buildComboboxOption("", "无项目", !defaultProject),
      ...projects.map((p) => buildComboboxOption(p, p, p === defaultProject, ICONS.folder)),
    ].join("");

    const parentOptionsHtml = (() => {
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

    const sourceSegmentHtml = buildSegmentedControl("sourceMode", [
      { value: "manual", label: "手动创建", icon: ICONS.edit },
      { value: "note", label: "笔记", icon: ICONS.doc },
    ], sourceMode);

    const statusBadgeHtml = statusBadge(defaultStatus);
    const priorityBadgeHtml = priorityBadge(defaultPriority);
    const statusDropdownHtml = statusDropdown(defaultStatus);
    const priorityDropdownHtml = priorityDropdown(defaultPriority);
    const frontend = getFrontend();
    const isMobileFrontend = frontend === "mobile" || frontend === "browser-mobile";

    const dialog = new Dialog({
      title: "",
      content: `<div class="task-tracker-dialog-v3">
  <div class="task-tracker-dialog-v3__header">
    <div class="task-tracker-dialog-v3__header-left">
      <div class="task-tracker-dialog-v3__icon-block">
        ${ICONS.taskGrid}
      </div>
      <div class="task-tracker-dialog-v3__header-mode">
        <span class="task-tracker-dialog-v3__subtitle">${escapeHtml(dialogTitle)}</span>
      </div>
    </div>
    <div class="task-tracker-dialog-v3__header-center">
      <span class="task-tracker-dialog-v3__title" title="${escapeAttr(headerTaskTitle)}">${escapeHtml(headerTaskTitle)}</span>
    </div>
    <div class="task-tracker-dialog-v3__header-right">
      ${editMode ? `<button type="button" class="task-tracker-dialog-v3__open-note" data-action="open-note" aria-label="打开笔记" title="打开笔记">
        <span class="task-tracker-dialog-v3__open-note-icon">${ICONS.doc}</span>
        <span>打开笔记</span>
      </button>` : `<span class="task-tracker-dialog-v3__header-spacer" aria-hidden="true"></span>`}
    </div>
  </div>

  <form class="task-tracker-dialog-v3__body">
    <div class="task-tracker-dialog-v3__body-scroll">
    <div class="task-tracker-dialog-v3__section">
      ${sectionTitle("任务信息")}
      <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--full task-tracker-dialog-v3__field--title">
        <span class="task-tracker-dialog-v3__label">任务标题 <span class="task-tracker-dialog-v3__required">*</span></span>
        <input class="task-tracker-dialog-v3__input" name="title" value="${escapeAttr(defaultTitle)}" required placeholder="请输入任务标题" />
      </label>

      <div class="task-tracker-dialog-v3__row task-tracker-dialog-v3__row--project-parent">
        <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--proj">
          <span class="task-tracker-dialog-v3__label">项目</span>
          ${buildComboboxSelect("project", defaultProject, "选择或输入项目", ICONS.folder, projectOptionsHtml, "editable")}
        </label>
        <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--parent">
          <span class="task-tracker-dialog-v3__label">父任务</span>
          ${isSubtasks
            ? `<div class="task-tracker-dialog-v3__parent-locked">
              <span class="task-tracker-dialog-v3__parent-icon">${ICONS.hierarchy}</span>
              <span class="task-tracker-dialog-v3__parent-text">${escapeHtml(activeTasks.find((t) => t.id === defaultParentId)?.title || defaultParentId)}</span>
              <span class="task-tracker-dialog-v3__parent-hint">当前任务将作为所选父任务的子任务</span>
            </div>
            <input type="hidden" name="parentId" value="${escapeAttr(defaultParentId)}" />`
            : (!allowStructureEdit && editMode
              ? `<div class="task-tracker-dialog-v3__parent-locked">
              <span class="task-tracker-dialog-v3__parent-icon">${ICONS.hierarchy}</span>
              <span class="task-tracker-dialog-v3__parent-text">${escapeHtml(activeTasks.find((t) => t.id === defaultParentId)?.title || "无（顶层任务）")}</span>
              <span class="task-tracker-dialog-v3__parent-hint">当前端仅支持轻编辑，不可修改父任务关系</span>
            </div>
            <input type="hidden" name="parentId" value="${escapeAttr(defaultParentId)}" />`
              : buildComboboxSelect("parentId", defaultParentId, "选择或输入父任务（可选）", ICONS.hierarchy, parentOptionsHtml))
          }
        </label>
      </div>

      <div class="task-tracker-dialog-v3__row">
        <div class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--half">
          <div class="task-tracker-dialog-v3__status-priority-row">
            <div class="task-tracker-dialog-v3__sp-item">
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
            </div>
            <div class="task-tracker-dialog-v3__sp-item">
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
            </div>
          </div>
        </div>
        <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--half">
          <span class="task-tracker-dialog-v3__label">创建时间</span>
          <div class="task-tracker-dialog-v3__readonly-field">
            <span class="task-tracker-dialog-v3__readonly-icon">${ICONS.calendar}</span>
            <span class="task-tracker-dialog-v3__readonly-value">${escapeHtml(defaultCreatedAt)}</span>
          </div>
          <input type="hidden" name="createdAt" value="${escapeAttr(defaultCreatedAt)}" />
        </label>
      </div>
    </div>

    ${sectionDivider()}

    <div class="task-tracker-dialog-v3__section">
      ${sectionTitle("时间信息")}
      <div class="task-tracker-dialog-v3__row task-tracker-dialog-v3__row--quad">
        <label class="task-tracker-dialog-v3__field">
          <span class="task-tracker-dialog-v3__label">计划开始</span>
          <div class="task-tracker-dialog-v3__date-wrap">
            <span class="task-tracker-dialog-v3__date-icon">${ICONS.clock}</span>
            <input class="task-tracker-dialog-v3__input task-tracker-dialog-v3__input--date" name="planStart" type="datetime-local" value="${escapeAttr(defaultPlanStart)}" />
          </div>
        </label>
        <label class="task-tracker-dialog-v3__field">
          <span class="task-tracker-dialog-v3__label">计划结束</span>
          <div class="task-tracker-dialog-v3__date-wrap">
            <span class="task-tracker-dialog-v3__date-icon">${ICONS.clock}</span>
            <input class="task-tracker-dialog-v3__input task-tracker-dialog-v3__input--date" name="planEnd" type="datetime-local" value="${escapeAttr(defaultPlanEnd)}" />
          </div>
        </label>
        <label class="task-tracker-dialog-v3__field">
          <span class="task-tracker-dialog-v3__label">截止日期</span>
          <div class="task-tracker-dialog-v3__date-wrap">
            <span class="task-tracker-dialog-v3__date-icon">${ICONS.calendar}</span>
            <input class="task-tracker-dialog-v3__input task-tracker-dialog-v3__input--date" name="dueDate" type="date" value="${escapeAttr(defaultDueDate)}" />
          </div>
        </label>
        <label class="task-tracker-dialog-v3__field">
          <span class="task-tracker-dialog-v3__label">完成时间</span>
          <div class="task-tracker-dialog-v3__date-wrap">
            <span class="task-tracker-dialog-v3__date-icon">${ICONS.clock}</span>
            <input class="task-tracker-dialog-v3__input task-tracker-dialog-v3__input--date" name="completedAt" type="datetime-local" value="${escapeAttr(defaultCompletedAt)}" />
          </div>
        </label>
      </div>
    </div>

    ${sectionDivider()}

    <div class="task-tracker-dialog-v3__section">
      ${sectionTitle("笔记信息")}
      <div class="task-tracker-dialog-v3__source-row">
        <div class="task-tracker-dialog-v3__source-left">
          <span class="task-tracker-dialog-v3__label">来源</span>
          <div class="task-tracker-dialog-v3__source-control">
            ${sourceSegmentHtml}
            <input class="task-tracker-dialog-v3__source-note-input" name="sourceDocId" placeholder="填写笔记ID" value="${escapeAttr(defaultSourceDocId)}" data-source-note style="${sourceMode === "note" ? "" : "display:none"}" />
          </div>
        </div>
        <div class="task-tracker-dialog-v3__source-right">
          <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--full">
            <span class="task-tracker-dialog-v3__label">任务描述</span>
            <textarea class="task-tracker-dialog-v3__textarea" name="description" rows="3" placeholder="补充任务的背景、目标、注意事项等">${escapeHtml(defaultDescription)}</textarea>
          </label>
        </div>
      </div>
      <label class="task-tracker-dialog-v3__field task-tracker-dialog-v3__field--full task-tracker-dialog-v3__field--detail">
        <span class="task-tracker-dialog-v3__label">任务详情</span>
        <textarea class="task-tracker-dialog-v3__textarea task-tracker-dialog-v3__textarea--detail" name="detail" rows="30" placeholder="编写任务正文内容、过程记录或补充说明"></textarea>
        <span class="task-tracker-dialog-v3__hint task-tracker-dialog-v3__detail-status" data-detail-status>${editMode ? "读取正文中..." : "将在创建任务文档时写入正文受控分区。"}</span>
      </label>
    </div>
    </div>
  </form>

  <div class="task-tracker-dialog-v3__footer">
    <button type="button" class="task-tracker-dialog-v3__btn-cancel" data-action="cancel">取消</button>
    <button type="submit" class="task-tracker-dialog-v3__btn-primary">${submitLabel}</button>
  </div>
</div>`,
      width: isMobileFrontend ? "calc(100vw - 16px)" : "1080px"
    });

    const root = dialog.element.querySelector<HTMLElement>(".task-tracker-dialog-v3");
    if (!root) {
      return;
    }

    const form = root.querySelector("form") as HTMLFormElement;
    const titleInput = root.querySelector<HTMLInputElement>("input[name='title']");
    const sourceDocIdInput = root.querySelector<HTMLInputElement>("input[name='sourceDocId']");
    const detailTextarea = root.querySelector<HTMLTextAreaElement>("textarea[name='detail']");
    const detailStatus = root.querySelector<HTMLElement>("[data-detail-status]");
    const submitButton = root.querySelector<HTMLButtonElement>(".task-tracker-dialog-v3__btn-primary") as HTMLButtonElement;
    const shouldAutoFocusTitle = !(isMobileFrontend && editMode);
    if (shouldAutoFocusTitle) {
      titleInput?.focus();
      titleInput?.select();
    }

    let detailLoadedValue = "";
    let detailSaveTimer: number | undefined;
    let detailSaving = false;
    let detailDirty = false;
    let destroyed = false;

    const setDetailStatus = (text: string, error = false) => {
      if (!detailStatus) return;
      detailStatus.textContent = text;
      detailStatus.classList.toggle("is-error", error);
    };

    const renderSourceMode = () => {
      if (sourceDocIdInput) {
        sourceDocIdInput.style.display = sourceMode === "note" ? "" : "none";
      }
      if (sourceMode === "manual") {
        selectedSource = undefined;
        if (sourceDocIdInput) sourceDocIdInput.value = "";
      }
      root.querySelectorAll<HTMLElement>("[data-segment-value]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.segmentValue === sourceMode);
      });
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
    };

    renderSourceMode();

    const openMenu = (menu: HTMLElement, trigger: HTMLElement) => {
      menu.style.display = "";
      positionPopup(menu, trigger);
    };

    const closeMenu = (menu: HTMLElement) => {
      menu.style.display = "none";
      resetPopupPosition(menu);
    };

    const initCombobox = (name: string) => {
      const combobox = root.querySelector<HTMLElement>(`[data-combobox="${name}"]`);
      if (!combobox) return;

      const mode = (combobox.dataset.comboboxMode as ComboboxMode | undefined) || "select-only";
      const toggle = combobox.querySelector<HTMLElement>(`[data-combobox-toggle="${name}"]`);
      const menu = combobox.querySelector<HTMLElement>(`[data-combobox-menu="${name}"]`);
      const hidden = mode === "editable" ? null : combobox.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      const input = mode === "editable" ? combobox.querySelector<HTMLInputElement>(`input[name="${name}"]`) : null;
      const valueEl = combobox.querySelector<HTMLElement>(`[data-combobox-value="${name}"]`);
      let isComposing = false;
      let ignoreBlur = false;

      const syncActiveOption = (val: string) => {
        menu?.querySelectorAll<HTMLElement>("[data-combobox-option]").forEach((opt) => {
          opt.classList.toggle("is-active", (opt.dataset.comboboxOption || "") === val);
        });
      };

      const updateDisplay = (val: string, label: string) => {
        if (input) {
          input.value = val;
        }
        if (hidden) {
          hidden.value = val;
        }
        if (valueEl) {
          valueEl.textContent = label || "无";
        }
        syncActiveOption(val);
        if (menu) closeMenu(menu);
        toggle?.classList.remove("is-open");
      };

      const openCurrentMenu = () => {
        if (!menu || !toggle) {
          return;
        }
        closeAllDropdowns();
        closeAllComboboxes(name);
        openMenu(menu, toggle);
        toggle.classList.add("is-open");
      };

      toggle?.addEventListener("click", (event) => {
        if (mode === "editable" && input && event.target === input) {
          return;
        }
        const isOpen = menu && menu.style.display !== "none";
        closeAllDropdowns();
        if (isOpen && menu) {
          closeMenu(menu);
          toggle?.classList.remove("is-open");
        } else if (!isOpen) {
          openCurrentMenu();
          if (input) {
            window.setTimeout(() => input.focus(), 0);
          }
        }
      });

      if (input) {
        input.addEventListener("focus", () => {
          openCurrentMenu();
        });
        input.addEventListener("input", () => {
          syncActiveOption(input.value);
          openCurrentMenu();
        });
        input.addEventListener("compositionstart", () => {
          isComposing = true;
        });
        input.addEventListener("compositionend", () => {
          isComposing = false;
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !isComposing) {
            event.preventDefault();
            updateDisplay(input.value.trim(), input.value.trim());
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            if (menu) closeMenu(menu);
            toggle?.classList.remove("is-open");
          }
        });
        input.addEventListener("blur", () => {
          if (ignoreBlur) {
            return;
          }
          window.setTimeout(() => {
            updateDisplay(input.value.trim(), input.value.trim());
          }, 0);
        });
      }

      menu?.addEventListener("mousedown", () => {
        ignoreBlur = true;
      });
      menu?.addEventListener("click", (e) => {
        const option = (e.target as HTMLElement).closest<HTMLElement>("[data-combobox-option]");
        if (!option) return;
        e.stopPropagation();
        const val = option.dataset.comboboxOption || "";
        const label = option.querySelector<HTMLElement>(".task-tracker-dialog-v3__menu-label")?.textContent || val;
        updateDisplay(val, val ? label : "");
        ignoreBlur = false;
      });
      menu?.addEventListener("mouseup", () => {
        ignoreBlur = false;
      });
    };

    initCombobox("project");
    initCombobox("parentId");

    const closeAllComboboxes = (except?: string) => {
      root.querySelectorAll<HTMLElement>("[data-combobox-menu]").forEach((menu) => {
        const name = menu.dataset.comboboxMenu;
        if (name !== except) {
          closeMenu(menu);
        }
      });
      root.querySelectorAll<HTMLElement>("[data-combobox-toggle]").forEach((toggle) => {
        const name = toggle.dataset.comboboxToggle;
        if (name !== except) {
          toggle.classList.remove("is-open");
        }
      });
    };

    const closeAllDropdowns = () => {
      root.querySelectorAll<HTMLElement>("[data-dropdown-menu]").forEach((menu) => {
        closeMenu(menu);
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
        openMenu(menu, toggle);
        toggle.classList.add("is-open");
      }
    };

    const saveDetail = async (force = false) => {
      if (!editMode || !editingTask || !detailTextarea || destroyed) {
        return;
      }
      const value = detailTextarea.value;
      if (!force && value === detailLoadedValue) {
        detailDirty = false;
        return;
      }
      if (detailSaving) {
        detailDirty = true;
        return;
      }
      detailSaving = true;
      detailDirty = false;
      setDetailStatus("正在保存正文详情...");
      try {
        const saved = await this.options.service.saveTaskDetailByTaskId(editingTask.id, value, {
          expectedRevision: revisionCursor,
          opId: newSiyuanId()
        });
        revisionCursor = saved.taskRevision;
        detailLoadedValue = value;
        setDetailStatus("任务详情已保存到正文。", false);
      } catch (error) {
        detailDirty = true;
        setDetailStatus(error instanceof Error ? error.message : "任务详情保存失败", true);
        showMessage(error instanceof Error ? error.message : "任务详情保存失败", 5000, "error");
      } finally {
        detailSaving = false;
        if (detailDirty && !destroyed) {
          window.clearTimeout(detailSaveTimer);
          detailSaveTimer = window.setTimeout(() => {
            void saveDetail();
          }, 800);
        }
      }
    };

    const scheduleDetailSave = () => {
      if (!editMode || !detailTextarea) {
        return;
      }
      detailDirty = detailTextarea.value !== detailLoadedValue;
      if (!detailDirty) {
        setDetailStatus("任务详情已保存到正文。", false);
        return;
      }
      setDetailStatus("检测到变更，稍后写回正文...");
      window.clearTimeout(detailSaveTimer);
      detailSaveTimer = window.setTimeout(() => {
        void saveDetail();
      }, 800);
    };

    if (detailTextarea) {
      if (editMode && editingTask) {
        detailTextarea.disabled = true;
        setDetailStatus("读取正文中...");
        void this.options.service.getTaskDetail(editingTask.docId)
          .then((detail) => {
            if (destroyed || !detailTextarea) {
              return;
            }
            detailTextarea.value = detail;
            detailLoadedValue = detail;
            detailTextarea.disabled = false;
            setDetailStatus("任务详情会近实时写回正文受控分区。");
          })
          .catch((error) => {
            if (destroyed || !detailTextarea) {
              return;
            }
            detailTextarea.value = "";
            detailLoadedValue = "";
            detailTextarea.disabled = false;
            setDetailStatus(error instanceof Error ? error.message : "任务详情读取失败", true);
          });
        detailTextarea.addEventListener("input", scheduleDetailSave);
        detailTextarea.addEventListener("blur", () => {
          if (detailTextarea.value !== detailLoadedValue) {
            window.clearTimeout(detailSaveTimer);
            void saveDetail(true);
          }
        });
      } else {
        setDetailStatus("将在创建任务文档时写入正文受控分区。");
      }
    }

    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;

      const dropdownToggle = target.closest<HTMLElement>("[data-dropdown-toggle]");
      if (dropdownToggle) {
        event.stopPropagation();
        const name = dropdownToggle.dataset.dropdown;
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

    const cleanupDialog = () => {
      destroyed = true;
      window.clearTimeout(detailSaveTimer);
      document.removeEventListener("click", handleOutsideClick);
      dialog.destroy();
    };

    const handleOpenTask = async () => {
      if (!editMode || !editingTask) {
        return;
      }
      if (detailTextarea && detailTextarea.value !== detailLoadedValue) {
        window.clearTimeout(detailSaveTimer);
        await saveDetail(true);
      }
      this.options.onOpenTask?.(editingTask);
      cleanupDialog();
    };

    root.querySelectorAll<HTMLElement>("[data-action='cancel']").forEach((btn) => {
      btn.addEventListener("click", () => cleanupDialog());
    });
    root.querySelector<HTMLElement>("[data-action='open-note']")?.addEventListener("click", () => {
      void handleOpenTask();
    });

    root.querySelectorAll<HTMLElement>("[data-segment-value]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = btn.dataset.segmentValue as SourceMode;
        if (val) {
          sourceMode = val;
          renderSourceMode();
        }
      });
    });

    submitButton?.addEventListener("click", () => form.requestSubmit());

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      submitButton.textContent = submittingLabel;

      try {
        const opId = newSiyuanId();
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
          description: String(data.get("description") || "").trim() || undefined,
          detail: String(data.get("detail") || "")
        };
        if (!input.title) {
          throw new Error("请填写任务标题");
        }
        if (editMode && editingTask && detailTextarea && detailTextarea.value !== detailLoadedValue) {
          await saveDetail(true);
        }
        let task: TaskItem;
        if (editMode && editingTask) {
          const parentChanged = (input.parentId || undefined) !== (editingTask.parentId || undefined);
          if (parentChanged && !allowStructureEdit) {
            throw new Error("当前端仅支持轻编辑，不可修改父任务关系");
          }
          const updatePatch: Partial<TaskItem> = {
            ...input,
            parentId: editingTask.parentId
          };
          task = await this.options.service.updateTask(editingTask.id, updatePatch, {
            expectedRevision: revisionCursor,
            opId
          });
          revisionCursor = task.taskRevision;
          if (parentChanged) {
            task = await this.options.service.changeTaskParent(editingTask.id, input.parentId, { opId });
            revisionCursor = task.taskRevision;
          }
        } else {
          task = await this.options.service.createTask(input);
        }
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

export function statusOptions(current: TaskStatus): string {
  return (Object.entries(TASK_STATUS_LABELS) as Array<[TaskStatus, string]>)
    .map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`)
    .join("");
}

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

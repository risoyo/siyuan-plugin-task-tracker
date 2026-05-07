import { Dialog, showMessage } from "siyuan";
import { fromDatetimeLocal } from "../date";
import type { TaskService } from "../document";
import {
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
  onSaved?: (task: TaskItem) => void;
}

export class TaskDialog {
  constructor(private options: TaskDialogOptions) {}

  show(): void {
    const tasks = this.options.service.store.all();
    const activeTasks = tasks.filter((task) => {
      return task.id === this.options.parentId || (task.status !== "completed" && task.status !== "cancelled");
    });
    const projects = this.options.service.store.getProjects();
    const defaultTitle = this.options.presetTitle || this.options.source?.text || "";
    const defaultPlanStart = this.options.presetPlanDate ? `${this.options.presetPlanDate}T09:00` : "";

    const dialog = new Dialog({
      title: this.options.parentId ? "新建子任务" : "新建任务",
      content: `<form class="task-tracker-dialog">
  <div class="b3-dialog__content task-tracker-dialog__content">
    <label class="task-tracker-field">
      <span>任务标题</span>
      <input class="b3-text-field fn__block" name="title" value="${escapeAttr(defaultTitle)}" required />
    </label>
    <div class="task-tracker-dialog__grid">
      <label class="task-tracker-field">
        <span>项目</span>
        <input class="b3-text-field fn__block" name="project" list="task-tracker-projects" value="${escapeAttr(this.options.service.store.getSettings().defaultProject || "")}" />
        <datalist id="task-tracker-projects">
          ${projects.map((project) => `<option value="${escapeAttr(project)}"></option>`).join("")}
        </datalist>
      </label>
      <label class="task-tracker-field">
        <span>父任务</span>
        <select class="b3-select fn__block" name="parentId">
          <option value="">无</option>
          ${activeTasks.map((task) => `<option value="${task.id}" ${task.id === this.options.parentId ? "selected" : ""}>${escapeHtml(task.title)}</option>`).join("")}
        </select>
      </label>
      <label class="task-tracker-field">
        <span>状态</span>
        <select class="b3-select fn__block" name="status">
          ${statusOptions("todo")}
        </select>
      </label>
      <label class="task-tracker-field">
        <span>优先级</span>
        <select class="b3-select fn__block" name="priority">
          ${priorityOptions("medium")}
        </select>
      </label>
      <label class="task-tracker-field">
        <span>计划开始</span>
        <input class="b3-text-field fn__block" name="planStart" type="datetime-local" value="${escapeAttr(defaultPlanStart)}" />
      </label>
      <label class="task-tracker-field">
        <span>计划结束</span>
        <input class="b3-text-field fn__block" name="planEnd" type="datetime-local" />
      </label>
      <label class="task-tracker-field">
        <span>截止日期</span>
        <input class="b3-text-field fn__block" name="dueDate" type="date" />
      </label>
      <label class="task-tracker-field task-tracker-field--wide">
        <span>来源</span>
        <input class="b3-text-field fn__block" value="${escapeAttr(this.options.source?.text || "手动创建")}" disabled />
      </label>
    </div>
  </div>
  <div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">取消</button>
    <div class="fn__space"></div>
    <button type="submit" class="b3-button b3-button--text">创建任务文档</button>
  </div>
</form>`,
      width: "680px"
    });

    const form = dialog.element.querySelector("form") as HTMLFormElement;
    const titleInput = dialog.element.querySelector<HTMLInputElement>("input[name='title']");
    titleInput?.focus();
    titleInput?.select();

    dialog.element.querySelector("[data-action='cancel']")?.addEventListener("click", () => dialog.destroy());
    dialog.bindInput(titleInput, () => form.requestSubmit());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit']");
      submitButton.disabled = true;
      submitButton.textContent = "创建中...";

      try {
        const data = new FormData(form);
        const input: TaskCreateInput = {
          title: String(data.get("title") || "").trim(),
          parentId: String(data.get("parentId") || "") || undefined,
          sourceBlockId: this.options.source?.blockId,
          sourceDocId: this.options.source?.docId,
          sourceText: this.options.source?.text,
          project: String(data.get("project") || "").trim() || undefined,
          status: String(data.get("status") || "todo") as TaskStatus,
          priority: String(data.get("priority") || "medium") as TaskPriority,
          dueDate: String(data.get("dueDate") || "") || undefined,
          planStart: fromDatetimeLocal(String(data.get("planStart") || "")),
          planEnd: fromDatetimeLocal(String(data.get("planEnd") || ""))
        };
        if (!input.title) {
          throw new Error("请填写任务标题");
        }
        const task = await this.options.service.createTask(input);
        showMessage("任务文档已创建");
        this.options.onSaved?.(task);
        dialog.destroy();
      } catch (error) {
        showMessage(error instanceof Error ? error.message : "创建任务失败", 5000, "error");
        submitButton.disabled = false;
        submitButton.textContent = "创建任务文档";
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
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

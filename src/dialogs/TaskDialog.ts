import { Dialog, showMessage } from "siyuan";
import { fromDatetimeLocal } from "../date";
import { getDocById, searchDocs, type DocSearchResult } from "../api";
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
    let selectedSource = this.options.source ? { ...this.options.source } : undefined as SourceContext | undefined;
    let searchResults: DocSearchResult[] = [];
    let searching = false;
    let latestSearchToken = 0;
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
      <div class="task-tracker-field task-tracker-field--wide task-tracker-source">
        <span>来源</span>
        <div class="task-tracker-source__summary" data-source-summary></div>
        <div class="task-tracker-source__inputs">
          <input class="b3-text-field fn__block" name="sourceSearch" placeholder="搜索笔记标题或路径关键词" />
          <input class="b3-text-field fn__block" name="sourceDocId" placeholder="或手动填写笔记 ID" />
        </div>
        <div class="task-tracker-source__actions">
          <button type="button" class="b3-button b3-button--outline" data-action="search-source">搜索笔记</button>
          <button type="button" class="b3-button b3-button--outline" data-action="apply-source-doc-id">使用笔记 ID</button>
          <button type="button" class="b3-button b3-button--cancel" data-action="clear-source">清除覆盖</button>
        </div>
        <div class="task-tracker-source__results" data-source-results></div>
      </div>
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
    const sourceSearchInput = dialog.element.querySelector<HTMLInputElement>("input[name='sourceSearch']");
    const sourceDocIdInput = dialog.element.querySelector<HTMLInputElement>("input[name='sourceDocId']");
    const sourceSummary = dialog.element.querySelector<HTMLElement>("[data-source-summary]");
    const sourceResults = dialog.element.querySelector<HTMLElement>("[data-source-results]");
    titleInput?.focus();
    titleInput?.select();

    const renderSourceSummary = () => {
      if (!sourceSummary) {
        return;
      }
      sourceSummary.innerHTML = `<div class="task-tracker-source__current">当前来源：${escapeHtml(selectedSource?.text || "手动创建")}</div>`;
    };

    const renderSourceResults = () => {
      if (!sourceResults) {
        return;
      }
      if (searching) {
        sourceResults.innerHTML = `<div class="task-tracker-source__empty">正在搜索笔记...</div>`;
        return;
      }
      if (!searchResults.length) {
        sourceResults.innerHTML = `<div class="task-tracker-source__empty">暂无搜索结果</div>`;
        return;
      }
      sourceResults.innerHTML = searchResults.map((doc) => {
        const label = doc.content || doc.hpath || doc.id;
        const detail = doc.hpath || doc.path || doc.box || "";
        return `<button type="button" class="task-tracker-source__result" data-source-doc-id="${escapeAttr(doc.id)}" title="${escapeAttr(label)}">
  <span class="task-tracker-source__result-title">${escapeHtml(label)}</span>
  <span class="task-tracker-source__result-detail">${escapeHtml(detail || doc.id)}</span>
</button>`;
      }).join("");
      sourceResults.querySelectorAll<HTMLElement>("[data-source-doc-id]").forEach((button) => {
        button.addEventListener("click", () => {
          const doc = searchResults.find((item) => item.id === button.dataset.sourceDocId);
          if (!doc) {
            return;
          }
          selectedSource = {
            blockId: doc.id,
            docId: doc.id,
            text: doc.content || doc.hpath || doc.id
          };
          if (sourceDocIdInput) {
            sourceDocIdInput.value = doc.id;
          }
          renderSourceSummary();
        });
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
      renderSourceSummary();
    };

    const runSearch = async (): Promise<void> => {
      const keyword = sourceSearchInput?.value.trim() || "";
      if (!keyword) {
        searchResults = [];
        renderSourceResults();
        return;
      }
      const token = ++latestSearchToken;
      searching = true;
      renderSourceResults();
      try {
        const results = await searchDocs(keyword, 20);
        if (token !== latestSearchToken) {
          return;
        }
        searchResults = results;
      } finally {
        if (token === latestSearchToken) {
          searching = false;
          renderSourceResults();
        }
      }
    };

    renderSourceSummary();
    renderSourceResults();

    dialog.element.querySelector("[data-action='cancel']")?.addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector("[data-action='search-source']")?.addEventListener("click", () => {
      void runSearch().catch((error) => showMessage(error instanceof Error ? error.message : "搜索笔记失败", 5000, "error"));
    });
    dialog.element.querySelector("[data-action='apply-source-doc-id']")?.addEventListener("click", () => {
      void applyDocIdSource().catch((error) => showMessage(error instanceof Error ? error.message : "设置来源失败", 5000, "error"));
    });
    dialog.element.querySelector("[data-action='clear-source']")?.addEventListener("click", () => {
      selectedSource = this.options.source ? { ...this.options.source } : undefined;
      if (sourceDocIdInput) {
        sourceDocIdInput.value = "";
      }
      renderSourceSummary();
    });
    sourceSearchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void runSearch().catch((error) => showMessage(error instanceof Error ? error.message : "搜索笔记失败", 5000, "error"));
      }
    });
    dialog.bindInput(titleInput, () => form.requestSubmit());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit']");
      submitButton.disabled = true;
      submitButton.textContent = "创建中...";

      try {
        const data = new FormData(form);
        const manualSourceDocId = String(data.get("sourceDocId") || "").trim();
        if (manualSourceDocId && (!selectedSource || selectedSource.docId !== manualSourceDocId)) {
          await applyDocIdSource();
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

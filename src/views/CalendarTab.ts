import { showMessage } from "siyuan";
import {
  addMonths,
  formatDateKey,
  fromDateInput,
  monthStart,
  monthTitle,
  sameMonth,
  toDateKey
} from "../date";
import type { TaskService } from "../document";
import { escapeHtml } from "../dialogs/TaskDialog";
import { TASK_STATUS_LABELS, type TaskItem } from "../types";

export class CalendarTab {
  private month = monthStart(new Date());
  private unsubscribe?: () => void;

  constructor(
    private container: HTMLElement,
    private service: TaskService,
    private actions: {
      newTask: (presetPlanDate?: string) => void;
      openTask: (task: TaskItem) => void;
    },
    data?: { month?: string }
  ) {
    if (data?.month) {
      const date = new Date(`${data.month}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
      }
    }
    this.unsubscribe = this.service.onChange(() => this.render());
  }

  destroy(): void {
    this.unsubscribe?.();
  }

  render(): void {
    const days = calendarDays(this.month);
    const tasksByDate = groupTasksByDate(this.service.activeTasks());
    const unplanned = this.service.activeTasks().filter((task) => !task.planStart);
    const monthValue = monthInputValue(this.month);

    this.container.innerHTML = `<div class="task-tracker task-tracker--calendar">
  <div class="task-tracker-calendar__toolbar">
    <div class="task-tracker-calendar__month">
      <button class="block__icon ariaLabel" data-action="prev" aria-label="上个月" data-position="south"><svg><use xlink:href="#iconLeft"></use></svg></button>
      <div class="task-tracker-calendar__title">${monthTitle(this.month)}</div>
      <button class="block__icon ariaLabel" data-action="next" aria-label="下个月" data-position="south"><svg><use xlink:href="#iconRight"></use></svg></button>
      <input class="b3-text-field task-tracker-calendar__month-input" data-field="month" type="month" value="${monthValue}" aria-label="选择月份" />
      <button class="block__icon ariaLabel" data-action="today" aria-label="回到今天" data-position="south"><svg><use xlink:href="#iconRefresh"></use></svg></button>
    </div>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--text" data-action="new">新建任务</button>
  </div>
  <div class="task-tracker-calendar__layout">
    <section class="task-tracker-calendar__main">
      <div class="task-tracker-calendar__weekdays">
        ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div>${day}</div>`).join("")}
      </div>
      <div class="task-tracker-calendar__grid">
        ${days.map((day) => this.renderDay(day, tasksByDate[formatDateKey(day)] || [])).join("")}
      </div>
    </section>
    <aside class="task-tracker-calendar__aside">
      <div class="task-tracker-calendar__aside-title">未登记计划时间</div>
      <div class="task-tracker-calendar__unplanned">
        ${unplanned.length ? unplanned.map((task) => renderPill(task, "aside")).join("") : `<div class="task-tracker-empty">没有未安排任务。</div>`}
      </div>
    </aside>
  </div>
</div>`;

    this.bind();
  }

  private renderDay(day: Date, tasks: TaskItem[]): string {
    const dateKey = formatDateKey(day);
    const isToday = dateKey === formatDateKey(new Date());
    const outside = !sameMonth(day, this.month);
    return `<div class="task-tracker-day ${outside ? "is-outside" : ""} ${isToday ? "is-today" : ""}" data-date="${dateKey}" role="button" tabindex="0">
  <span class="task-tracker-day__num">${day.getDate()}</span>
  <div class="task-tracker-day__tasks">
    ${tasks.slice(0, 4).map((task) => renderPill(task, "calendar")).join("")}
    ${tasks.length > 4 ? `<span class="task-tracker-day__more">+${tasks.length - 4}</span>` : ""}
  </div>
</div>`;
  }

  private bind(): void {
    this.container.querySelector("[data-action='prev']")?.addEventListener("click", () => {
      this.month = addMonths(this.month, -1);
      this.render();
    });
    this.container.querySelector("[data-action='today']")?.addEventListener("click", () => {
      this.month = monthStart(new Date());
      this.render();
    });
    this.container.querySelector("[data-action='next']")?.addEventListener("click", () => {
      this.month = addMonths(this.month, 1);
      this.render();
    });
    this.container.querySelector<HTMLInputElement>("[data-field='month']")?.addEventListener("change", (event) => {
      const value = (event.target as HTMLInputElement).value;
      const date = new Date(`${value}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
        this.render();
      }
    });
    this.container.querySelector("[data-action='new']")?.addEventListener("click", () => this.actions.newTask());

    this.container.querySelectorAll<HTMLElement>(".task-tracker-day").forEach((day) => {
      day.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-task-id]")) {
          return;
        }
        this.actions.newTask(day.dataset.date);
      });
      day.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.actions.newTask(day.dataset.date);
        }
      });
    });

    this.container.querySelectorAll<HTMLElement>("[data-task-id]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-action='plan-today']")) {
          return;
        }
        event.stopPropagation();
        const task = this.service.store.get(element.dataset.taskId || "");
        if (task) {
          this.actions.openTask(task);
        }
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>("[data-action='plan-today']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await this.service.updateTask(button.dataset.taskId || "", {
            planStart: fromDateInput(formatDateKey(new Date()))
          });
        } catch (error) {
          showMessage(error instanceof Error ? error.message : "更新任务失败", 5000, "error");
        }
      });
    });
  }
}

function calendarDays(month: Date): Date[] {
  const first = monthStart(month);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - startOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function groupTasksByDate(tasks: TaskItem[]): Record<string, TaskItem[]> {
  const result: Record<string, TaskItem[]> = {};
  for (const task of tasks) {
    const key = toDateKey(task.planStart || task.dueDate);
    if (!key) {
      continue;
    }
    result[key] ||= [];
    result[key].push(task);
  }
  return result;
}

function monthInputValue(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

function renderPill(task: TaskItem, mode: "calendar" | "aside"): string {
  const title = escapeHtml(task.title);
  const status = TASK_STATUS_LABELS[task.status];
  if (mode === "aside") {
    return `<div class="task-tracker-pill task-tracker-pill--aside task-status-${task.status}" data-task-id="${task.id}">
  <span>${title}</span>
  <small>${escapeHtml(task.project || status)}</small>
  <button class="block__icon ariaLabel" data-action="plan-today" data-task-id="${task.id}" aria-label="安排到今天" data-position="north"><svg><use xlink:href="#iconCalendar"></use></svg></button>
</div>`;
  }
  return `<span class="task-tracker-pill task-status-${task.status}" data-task-id="${task.id}" title="${title}">${title}</span>`;
}

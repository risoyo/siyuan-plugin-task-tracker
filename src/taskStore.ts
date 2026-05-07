import type { Plugin } from "siyuan";
import {
  DEFAULT_SETTINGS,
  SETTINGS_DATA_FILE,
  TASKS_DATA_FILE,
  type TaskItem,
  type TaskSettings
} from "./types";

export class TaskStore {
  private tasks: TaskItem[] = [];
  private settings: TaskSettings = { ...DEFAULT_SETTINGS };

  constructor(private plugin: Plugin) {}

  async load(): Promise<void> {
    const [tasksData, settingsData] = await Promise.all([
      this.plugin.loadData(TASKS_DATA_FILE).catch(() => undefined),
      this.plugin.loadData(SETTINGS_DATA_FILE).catch(() => undefined)
    ]);

    if (Array.isArray(tasksData)) {
      this.tasks = tasksData;
    } else if (Array.isArray((tasksData as any)?.tasks)) {
      this.tasks = (tasksData as any).tasks;
    }

    if (settingsData && typeof settingsData === "object") {
      this.settings = { ...DEFAULT_SETTINGS, ...(settingsData as TaskSettings) };
    }
  }

  all(): TaskItem[] {
    return [...this.tasks].sort((a, b) => {
      const aPlan = a.planStart || a.dueDate || "";
      const bPlan = b.planStart || b.dueDate || "";
      if (a.status === "completed" && b.status !== "completed") {
        return 1;
      }
      if (b.status === "completed" && a.status !== "completed") {
        return -1;
      }
      return aPlan.localeCompare(bPlan) || b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  get(id: string): TaskItem | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  getSettings(): TaskSettings {
    return { ...this.settings };
  }

  getProjects(): string[] {
    return Array.from(new Set(this.tasks.map((task) => task.project?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }

  async setSettings(settings: TaskSettings): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    await this.plugin.saveData(SETTINGS_DATA_FILE, this.settings);
  }

  async upsert(task: TaskItem): Promise<void> {
    const index = this.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      this.tasks[index] = task;
    } else {
      this.tasks.push(task);
    }
    await this.saveTasks();
  }

  async update(id: string, patch: Partial<TaskItem>): Promise<TaskItem> {
    const current = this.get(id);
    if (!current) {
      throw new Error(`Task not found: ${id}`);
    }
    const next: TaskItem = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await this.upsert(next);
    return next;
  }

  async removeMany(ids: string[]): Promise<number> {
    const idSet = new Set(ids);
    if (!idSet.size) {
      return 0;
    }

    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => !idSet.has(task.id));
    const removed = before - this.tasks.length;
    if (removed > 0) {
      await this.saveTasks();
    }
    return removed;
  }

  private async saveTasks(): Promise<void> {
    await this.plugin.saveData(TASKS_DATA_FILE, { tasks: this.tasks });
  }
}

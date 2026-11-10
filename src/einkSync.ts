import type { Plugin } from "siyuan";
import type { TaskService } from "./document";
import type { TaskItem } from "./types";

const CONFIG_FILE = "eink-hub-sync.json";
const MANIFEST_FILE = "eink-hub-manifest.json";
const SOURCE = "siyuan-task-tracker";

export interface EinkHubConfig {
  enabled: boolean;
  baseUrl: string;
  feed: string;
  token: string;
  allowInsecureHttp: boolean;
}

interface Manifest {
  fingerprints: Record<string, string>;
  lastTimestamp: number;
}

const DEFAULT_CONFIG: EinkHubConfig = {
  enabled: false,
  baseUrl: "",
  feed: "home",
  token: "",
  allowInsecureHttp: false
};

export class EinkHubSync {
  private config: EinkHubConfig = { ...DEFAULT_CONFIG };
  private manifest: Manifest = { fingerprints: {}, lastTimestamp: 0 };
  private unsubscribe?: () => void;
  private timer?: number;
  private retryTimer?: number;
  private syncing = false;
  private pending = false;

  constructor(private plugin: Plugin, private service: TaskService) {}

  async load(): Promise<void> {
    const stored = await this.plugin.loadData(CONFIG_FILE).catch(() => undefined);
    if (stored && typeof stored === "object") {
      this.config = { ...DEFAULT_CONFIG, ...stored };
    }
    const manifest = await this.plugin.loadData(MANIFEST_FILE).catch(() => undefined);
    if (manifest && typeof manifest === "object") {
      this.manifest = {
        fingerprints: manifest.fingerprints && typeof manifest.fingerprints === "object" ? manifest.fingerprints : {},
        lastTimestamp: Number(manifest.lastTimestamp) || 0
      };
    }
  }

  getConfig(): EinkHubConfig {
    return { ...this.config };
  }

  async setConfig(config: EinkHubConfig): Promise<void> {
    const destinationChanged = this.config.baseUrl !== config.baseUrl.trim().replace(/\/+$/, "")
      || this.config.feed !== (config.feed.trim() || "home");
    this.config = {
      enabled: !!config.enabled,
      baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
      feed: config.feed.trim() || "home",
      token: config.token.trim(),
      allowInsecureHttp: !!config.allowInsecureHttp
    };
    await this.plugin.saveData(CONFIG_FILE, this.config);
    if (destinationChanged) {
      this.manifest.fingerprints = {};
      await this.plugin.saveData(MANIFEST_FILE, this.manifest);
    }
    this.queue();
  }

  start(): void {
    this.unsubscribe = this.service.onChange(() => this.queue());
    this.retryTimer = window.setInterval(() => this.queue(), 5 * 60 * 1000);
    this.queue();
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.timer) window.clearTimeout(this.timer);
    if (this.retryTimer) window.clearInterval(this.retryTimer);
  }

  queue(): void {
    if (!this.config.enabled) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      void this.sync().catch((error) => console.warn("Task Tracker: E-Ink 同步失败", error));
    }, 2000);
  }

  async sync(force = false): Promise<number> {
    if (!this.config.enabled) return 0;
    if (this.syncing) {
      this.pending = true;
      return 0;
    }
    this.syncing = true;
    try {
      return await this.syncCurrent(force);
    } finally {
      this.syncing = false;
      if (this.pending) {
        this.pending = false;
        this.queue();
      }
    }
  }

  private async syncCurrent(force: boolean): Promise<number> {
    const { baseUrl, feed, token, allowInsecureHttp } = this.config;
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || !token || !feed) {
      throw new Error("请先配置 E-Ink Server 地址、feed 和写入 Token");
    }
    if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) && !allowInsecureHttp) {
      throw new Error("公网 HTTP 需要在插件设置中显式允许明文连接");
    }
    const tasks = this.service.store.all().filter((task) => task.category === "weekly" || task.category === "daily");
    const current = new Map(tasks.map((task) => [task.id, JSON.stringify(this.payloadFor(task))]));
    const previous = this.manifest.fingerprints;
    if (tasks.length === 0 && Object.keys(previous).length > 0) {
      throw new Error("任务索引为空，已暂停删除同步；请先检查思源任务库");
    }
    const changed = tasks.filter((task) => force || current.get(task.id) !== previous[task.id]);
    const removed = Object.keys(previous).filter((id) => !current.has(id));
    const operations = [
      ...changed.map((task) => ({ kind: "upsert" as const, task })),
      ...removed.map((id) => ({ kind: "delete" as const, id }))
    ];
    let applied = 0;
    for (let offset = 0; offset < operations.length; offset += 500) {
      const chunk = operations.slice(offset, offset + 500);
      const stamp = this.nextTimestamp();
      const upserts = chunk.filter((entry) => entry.kind === "upsert").map((entry) => ({
        ...this.payloadFor(entry.task), source_updated_at: stamp
      }));
      const deletes = chunk.filter((entry) => entry.kind === "delete").map((entry) => ({
        id: entry.id, source_updated_at: stamp
      }));
      const response = await fetch(`${baseUrl}/api/v1/feeds/${encodeURIComponent(feed)}/items:batch`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-Request-Timestamp": new Date().toISOString()
        },
        body: JSON.stringify({ source: SOURCE, upserts, deletes })
      });
      if (!response.ok) throw new Error(`E-Ink Server 返回 HTTP ${response.status}`);
      const result = await response.json();
      if (result.skipped_stale) {
        throw new Error(`E-Ink Server 拒绝了 ${result.skipped_stale} 项较旧的任务更新`);
      }
      for (const entry of chunk) {
        if (entry.kind === "upsert") previous[entry.task.id] = current.get(entry.task.id)!;
        else delete previous[entry.id];
      }
      await this.plugin.saveData(MANIFEST_FILE, this.manifest);
      applied += chunk.length;
    }
    return applied;
  }

  private nextTimestamp(): string {
    this.manifest.lastTimestamp = Math.max(Date.now(), this.manifest.lastTimestamp + 1);
    return new Date(this.manifest.lastTimestamp).toISOString();
  }

  private payloadFor(task: TaskItem): Record<string, unknown> {
    return {
      id: task.id,
      type: "task",
      title: task.title,
      status: task.status,
      category: task.category,
      plan_start: task.planStart || null,
      plan_end: task.planEnd || null,
      due_at: task.dueDate || null,
      attributes: { priority: task.priority, project: task.project || "", doc_id: task.docId }
    };
  }
}

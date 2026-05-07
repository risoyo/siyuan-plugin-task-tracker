import {
  Dialog,
  Menu,
  Plugin,
  Setting,
  openTab,
  showMessage
} from "siyuan";
import pluginManifest from "../plugin.json";
import "./index.scss";
import { sourceFromBlock, TaskService } from "./document";
import { TaskDialog } from "./dialogs/TaskDialog";
import { createTaskSettings } from "./settings";
import { TaskStore } from "./taskStore";
import type { SourceContext, TaskItem } from "./types";
import { CalendarTab } from "./views/CalendarTab";
import { TaskDock } from "./views/TaskDock";
import { TaskManagerTab } from "./views/TaskManagerTab";

const DOCK_TYPE = "task_tracker_dock";
const CALENDAR_TAB_TYPE = "task_tracker_calendar_tab";
const MANAGER_TAB_TYPE = "task_tracker_manager_tab";

export default class TaskTrackerPlugin extends Plugin {
  private store: TaskStore;
  private service: TaskService;
  private ready: Promise<void>;
  private taskDock?: TaskDock;
  private calendarViews = new Map<HTMLElement, CalendarTab>();
  private managerViews = new Map<HTMLElement, TaskManagerTab>();
  private docMenuHandler = this.handleDocumentMenu.bind(this);
  private blockMenuHandler = this.handleBlockMenu.bind(this);
  private wsMainHandler = this.handleWsMain.bind(this);

  onload(): void {
    this.addIcons(`<symbol id="iconTaskTracker" viewBox="0 0 32 32">
<path d="M8 4h16c1.47 0 2.667 1.197 2.667 2.667v18.667c0 1.47-1.197 2.667-2.667 2.667h-16c-1.47 0-2.667-1.197-2.667-2.667v-18.667c0-1.47 1.197-2.667 2.667-2.667zM8 6.667v18.667h16v-18.667h-16zM12 11.333h8v2.667h-8v-2.667zM12 17.333h8v2.667h-8v-2.667zM20.92 10.2l1.88 1.88-4.547 4.547-2.387-2.387 1.88-1.88.507.507 2.667-2.667z"></path>
</symbol>
<symbol id="iconTaskManagerTable" viewBox="0 0 32 32">
<path d="M5.333 7.333c0-1.105.895-2 2-2h17.333c1.105 0 2 .895 2 2v17.333c0 1.105-.895 2-2 2h-17.333c-1.105 0-2-.895-2-2v-17.333zM8 10.667h16v-2.667h-16v2.667zM8 13.333v4h4.667v-4h-4.667zM15.333 13.333v4h8.667v-4h-8.667zM8 20v4h4.667v-4h-4.667zM15.333 20v4h8.667v-4h-8.667z"></path>
</symbol>
<symbol id="iconTaskManagerList" viewBox="0 0 32 32">
<path d="M8 8.667h2.667v2.667h-2.667v-2.667zM13.333 8.667h12v2.667h-12v-2.667zM8 14.667h2.667v2.667h-2.667v-2.667zM13.333 14.667h12v2.667h-12v-2.667zM8 20.667h2.667v2.667h-2.667v-2.667zM13.333 20.667h12v2.667h-12v-2.667z"></path>
</symbol>
<symbol id="iconTaskManagerTimeline" viewBox="0 0 32 32">
<path d="M8 6.667h2.667v18.667h-2.667v-18.667zM13.333 9.333h10.667v3.333h-10.667v-3.333zM13.333 15h14v3.333h-14v-3.333zM13.333 20.667h8v3.333h-8v-3.333z"></path>
</symbol>
<symbol id="iconTaskManagerKanban" viewBox="0 0 32 32">
<path d="M6 6h20c1.105 0 2 .895 2 2v16c0 1.105-.895 2-2 2h-20c-1.105 0-2-.895-2-2v-16c0-1.105.895-2 2-2zM6.667 8.667v14.667h5.333v-14.667h-5.333zM14.667 8.667v14.667h4.667v-14.667h-4.667zM22 8.667v14.667h3.333v-14.667h-3.333z"></path>
</symbol>`);

    this.store = new TaskStore(this);
    this.service = new TaskService(this.store);
    this.ready = this.store.load().then(async () => {
      this.setting = this.createSettingPanel();
      await this.service.syncDeletedDocs();
      await this.service.syncAllTaskDocuments();
    });

    this.registerDock();
    this.registerCalendarTab();
    this.registerManagerTab();
    this.registerCommands();
    this.registerContextMenus();
  }

  onLayoutReady(): void {
    this.addTopBar({
      icon: "iconTaskTracker",
      title: "任务追踪",
      position: "right",
      callback: (event) => {
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        this.openTopBarMenu(rect);
      }
    });
  }

  onunload(): void {
    this.taskDock?.destroy();
    for (const view of this.calendarViews.values()) {
      view.destroy();
    }
    for (const view of this.managerViews.values()) {
      view.destroy();
    }
    this.eventBus.off("click-editortitleicon", this.docMenuHandler);
    this.eventBus.off("click-blockicon", this.blockMenuHandler);
    this.eventBus.off("ws-main", this.wsMainHandler);
  }

  private registerDock(): void {
    this.addDock({
      type: DOCK_TYPE,
      config: {
        position: "LeftBottom",
        size: { width: 320, height: 0 },
        icon: "iconTaskTracker",
        title: "任务追踪",
        hotkey: "⌥⌘T"
      },
      data: {},
      init: (dock) => {
        dock.element.innerHTML = `<div class="task-tracker task-tracker-empty">任务追踪加载中...</div>`;
        void this.ready.then(() => {
          this.taskDock?.destroy();
          this.taskDock = new TaskDock(dock.element as HTMLElement, this.service, this.viewActions());
          this.taskDock.render();
        }).catch((error) => {
          dock.element.innerHTML = `<div class="task-tracker task-tracker-empty">加载失败：${error?.message || error}</div>`;
        });
      },
      update: () => {
        this.taskDock?.render();
      },
      destroy: () => {
        this.taskDock?.destroy();
        this.taskDock = undefined;
      }
    });
  }

  private registerCalendarTab(): void {
    const plugin = this;
    this.addTab({
      type: CALENDAR_TAB_TYPE,
      init() {
        const tab = this as any;
        tab.element.innerHTML = `<div class="task-tracker task-tracker-empty">任务日历加载中...</div>`;
        void plugin.ready.then(() => {
          const view = new CalendarTab(tab.element, plugin.service, {
            newTask: (presetPlanDate?: string) => void plugin.showTaskDialog({ presetPlanDate }),
            openTask: (task: TaskItem) => void plugin.openTask(task)
          }, tab.data || {});
          plugin.calendarViews.set(tab.element, view);
          view.render();
        }).catch((error) => {
          tab.element.innerHTML = `<div class="task-tracker task-tracker-empty">加载失败：${error?.message || error}</div>`;
        });
      },
      destroy() {
        const tab = this as any;
        const view = plugin.calendarViews.get(tab.element);
        view?.destroy();
        plugin.calendarViews.delete(tab.element);
      }
    });
  }

  private registerManagerTab(): void {
    const plugin = this;
    this.addTab({
      type: MANAGER_TAB_TYPE,
      init() {
        const tab = this as any;
        tab.element.innerHTML = `<div class="task-manager task-manager-empty">任务管理器加载中...</div>`;
        void plugin.ready.then(() => {
          const view = new TaskManagerTab(tab.element, plugin.service, {
            newTask: (options) => void plugin.showTaskDialog(options || {}),
            createSubtask: (parentId: string) => void plugin.showTaskDialog({ parentId }),
            openTask: (task: TaskItem) => void plugin.openTask(task),
            sync: () => plugin.syncDeletedTasks()
          });
          plugin.managerViews.set(tab.element, view);
          view.render();
        }).catch((error) => {
          tab.element.innerHTML = `<div class="task-manager task-manager-empty">加载失败：${error?.message || error}</div>`;
        });
      },
      destroy() {
        const tab = this as any;
        const view = plugin.managerViews.get(tab.element);
        view?.destroy();
        plugin.managerViews.delete(tab.element);
      }
    });
  }

  private registerCommands(): void {
    this.addCommand({
      langKey: "newTask",
      hotkey: "",
      callback: () => void this.showTaskDialog()
    });
    this.addCommand({
      langKey: "openCalendar",
      hotkey: "",
      callback: () => void this.openCalendar()
    });
    this.addCommand({
      langKey: "openTaskManager",
      hotkey: "",
      callback: () => void this.openTaskManager()
    });
    this.addCommand({
      langKey: "setTaskRoot",
      hotkey: "",
      editorCallback: (protyle: any) => void this.setCurrentDocAsRoot(protyle),
      callback: () => void this.setCurrentDocAsRoot()
    });
  }

  private registerContextMenus(): void {
    this.eventBus.on("click-editortitleicon", this.docMenuHandler);
    this.eventBus.on("click-blockicon", this.blockMenuHandler);
    this.eventBus.on("ws-main", this.wsMainHandler);
  }

  private createSettingPanel(): Setting {
    return createTaskSettings(this.service, {
      setCurrentDocAsRoot: () => this.setCurrentDocAsRoot(),
      setRootDocId: (docId: string) => this.setRootDocId(docId),
      openRootDoc: () => this.openRootDoc(),
      refreshViews: () => this.refreshViews()
    }, pluginManifest.version);
  }

  private viewActions() {
    return {
      newTask: () => void this.showTaskDialog(),
      createSubtask: (parentId: string) => void this.showTaskDialog({ parentId }),
      openTask: (task: TaskItem) => void this.openTask(task),
      openCalendar: () => void this.openCalendar(),
      setCurrentDocAsRoot: () => void this.setCurrentDocAsRoot()
    };
  }

  private openTopBarMenu(rect: DOMRect): void {
    const menu = new Menu("taskTrackerTopBar");
    menu.addItem({
      icon: "iconAdd",
      label: "新建任务",
      click: () => void this.showTaskDialog()
    });
    menu.addItem({
      icon: "iconTaskTracker",
      label: "打开任务管理器",
      click: () => void this.openTaskManager()
    });
    menu.addItem({
      icon: "iconCalendar",
      label: "打开任务日历",
      click: () => void this.openCalendar()
    });
    menu.addItem({
      icon: "iconFolder",
      label: "打开事项库",
      click: () => void this.openRootDoc()
    });
    menu.addSeparator();
    menu.addItem({
      icon: "iconDatabase",
      label: "设置事项库文档 ID",
      click: () => void this.showRootDocIdDialog()
    });
    menu.addItem({
      icon: "iconFile",
      label: "从当前文档创建任务",
      click: () => void this.createTaskFromCurrentDocument()
    });
    menu.addItem({
      icon: "iconRefresh",
      label: "清理已删除任务记录",
      click: () => void this.syncDeletedTasks()
    });
    menu.addItem({
      icon: "iconSettings",
      label: "插件设置",
      click: () => {
        this.openSetting();
      }
    });
    menu.open({
      x: rect.right,
      y: rect.bottom,
      isLeft: true
    });
  }

  private handleDocumentMenu({ detail }: any): void {
    const docId = detail?.protyle?.block?.rootID;
    if (!detail?.menu || !docId) {
      return;
    }

    detail.menu.addItem({
      icon: "iconAdd",
      label: "从当前文档创建任务",
      click: () => void this.createTaskFromCurrentDocument(detail.protyle)
    });
    detail.menu.addItem({
      icon: "iconDatabase",
      label: "将当前文档设为事项库",
      click: () => void this.setCurrentDocAsRoot(detail.protyle)
    });
  }

  private handleBlockMenu({ detail }: any): void {
    const blockElements = Array.isArray(detail?.blockElements) ? detail.blockElements : [];
    const firstBlockId = blockElements[0]?.getAttribute?.("data-node-id");
    if (!detail?.menu || !firstBlockId) {
      return;
    }

    detail.menu.addItem({
      icon: "iconAdd",
      label: blockElements.length > 1 ? "从第一个选中块创建任务" : "从当前块创建任务",
      click: () => void this.createTaskFromBlock(firstBlockId)
    });
  }

  private handleWsMain({ detail }: any): void {
    if (detail?.cmd !== "removeDoc") {
      return;
    }

    void this.ready
      .then(() => this.service.syncDeletedDocs())
      .catch((error) => console.warn("Task Tracker: failed to sync deleted docs", error));
  }

  private async showTaskDialog(options: {
    parentId?: string;
    source?: SourceContext;
    presetTitle?: string;
    presetPlanDate?: string;
  } = {}): Promise<void> {
    await this.ready;
    new TaskDialog({
      service: this.service,
      parentId: options.parentId,
      source: options.source,
      presetTitle: options.presetTitle,
      presetPlanDate: options.presetPlanDate,
      onSaved: (task) => void this.openTask(task)
    }).show();
  }

  private async setCurrentDocAsRoot(protyle?: any): Promise<void> {
    await this.ready;
    const currentProtyle = protyle || this.getCurrentProtyle();
    const docId = currentProtyle?.block?.rootID;
    if (!docId) {
      showMessage("未识别到当前文档，请使用文档 ID 设置事项库", 5000, "info");
      return;
    }
    await this.setRootDocId(docId);
  }

  private async setRootDocId(docId: string): Promise<void> {
    await this.ready;
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      showMessage("请先填写事项库文档 ID", 4000, "info");
      return;
    }
    if (!/^\d{14}-[a-z0-9]{7}$/i.test(normalizedDocId)) {
      showMessage("文档 ID 格式看起来不正确，请确认是否从思源复制了文档 ID", 5000, "error");
      return;
    }
    try {
      const settings = await this.service.setRootFromDoc(normalizedDocId);
      this.setting = this.createSettingPanel();
      this.refreshViews();
      showMessage(`已将 ${settings.taskRootTitle || "当前文档"} 设为事项库`);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "设置事项库失败", 5000, "error");
    }
  }

  private async showRootDocIdDialog(): Promise<void> {
    await this.ready;
    const currentId = this.service.store.getSettings().taskRootDocId || "";
    const dialog = new Dialog({
      title: "设置事项库文档 ID",
      content: `<form class="task-tracker-dialog">
  <div class="b3-dialog__content task-tracker-dialog__content">
    <label class="task-tracker-field">
      <span>文档 ID</span>
      <input class="b3-text-field fn__block" name="docId" value="${escapeAttr(currentId)}" placeholder="例如：20260506092200-qynf33g" required />
    </label>
  </div>
  <div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">取消</button>
    <div class="fn__space"></div>
    <button type="submit" class="b3-button b3-button--text">绑定事项库</button>
  </div>
</form>`,
      width: "520px"
    });
    const form = dialog.element.querySelector("form") as HTMLFormElement;
    const input = dialog.element.querySelector<HTMLInputElement>("input[name='docId']");
    input?.focus();
    input?.select();
    dialog.element.querySelector("[data-action='cancel']")?.addEventListener("click", () => dialog.destroy());
    dialog.bindInput(input, () => form.requestSubmit());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.setRootDocId(input?.value || "");
      if (this.service.store.getSettings().taskRootDocId === (input?.value || "").trim()) {
        dialog.destroy();
      }
    });
  }

  private async createTaskFromCurrentDocument(protyle?: any): Promise<void> {
    await this.ready;
    const currentProtyle = protyle || this.getCurrentProtyle();
    const docId = currentProtyle?.block?.rootID;
    if (!docId) {
      showMessage("请先打开一个文档", 4000, "info");
      return;
    }
    try {
      const source = await sourceFromBlock(docId);
      await this.showTaskDialog({
        source,
        presetTitle: source.text || "新任务"
      });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "读取当前文档失败", 5000, "error");
    }
  }

  private async createTaskFromBlock(blockId: string): Promise<void> {
    await this.ready;
    try {
      const source = await sourceFromBlock(blockId);
      await this.showTaskDialog({
        source,
        presetTitle: source.text || "新任务"
      });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "读取当前块失败", 5000, "error");
    }
  }

  private async openCalendar(): Promise<void> {
    await this.ready;
    openTab({
      app: this.app,
      custom: {
        icon: "iconCalendar",
        title: "任务日历",
        id: `${this.name}${CALENDAR_TAB_TYPE}`,
        data: {}
      }
    });
  }

  private async openTaskManager(): Promise<void> {
    await this.ready;
    openTab({
      app: this.app,
      custom: {
        icon: "iconTaskTracker",
        title: "任务管理器",
        id: `${this.name}${MANAGER_TAB_TYPE}`,
        data: {}
      }
    });
  }

  private async openTask(task: TaskItem): Promise<void> {
    openTab({
      app: this.app,
      doc: {
        id: task.docId
      }
    });
  }

  private async openRootDoc(): Promise<void> {
    await this.ready;
    const rootDocId = this.service.store.getSettings().taskRootDocId;
    if (!rootDocId) {
      showMessage("还没有设置事项库", 4000, "info");
      return;
    }
    openTab({
      app: this.app,
      doc: {
        id: rootDocId
      }
    });
  }

  private async syncDeletedTasks(): Promise<void> {
    await this.ready;
    const count = await this.service.syncDeletedDocs();
    showMessage(count > 0 ? `已清理 ${count} 个已删除任务记录` : "没有需要清理的任务记录");
  }

  private refreshViews(): void {
    this.taskDock?.render();
    for (const view of this.calendarViews.values()) {
      view.render();
    }
    for (const view of this.managerViews.values()) {
      view.render();
    }
  }

  private getCurrentProtyle(): any {
    return (this as any).getEditor?.()?.protyle;
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

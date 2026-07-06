import {
  getFrontend,
  openMobileFileById,
  Plugin,
  Setting,
  openTab,
  showMessage
} from "siyuan";
import pluginManifest from "../plugin.json";
import "./index.scss";
import { getBlockById } from "./api";
import { sourceFromBlock, TaskService } from "./document";
import { TaskDialog } from "./dialogs/TaskDialog";
import { createTaskSettings } from "./settings";
import { TaskStore } from "./taskStore";
import { CANCELLED_TASK_STATUS, COMPLETED_TASK_STATUS, type SourceContext, type TaskItem } from "./types";
import { TaskDock } from "./views/TaskDock";
import { TaskManagerTab } from "./views/TaskManagerTab";

const DOCK_TYPE = "task_tracker_dock";
const MANAGER_TAB_TYPE = "task_tracker_manager_tab";
const RUNTIME_STATE_KEY = "__taskTrackerPluginRuntimeState";
const TOP_BAR_OWNER_ATTR = "data-task-tracker-topbar-owner";

type TaskTrackerRuntimeState = {
  activeLifecycleToken?: string;
};

type TaskTrackerAgentAction = {
  name: string;
  description: string;
  handler: () => Promise<string> | string;
};

type TaskTrackerAgentContext = {
  protyle?: any;
  docId?: string;
  blockId?: string;
  selectedText?: string;
};

function getRuntimeState(): TaskTrackerRuntimeState {
  const globalState = globalThis as typeof globalThis & Record<string, unknown>;
  const current = globalState[RUNTIME_STATE_KEY];
  if (current && typeof current === "object") {
    return current as TaskTrackerRuntimeState;
  }
  const state: TaskTrackerRuntimeState = {};
  globalState[RUNTIME_STATE_KEY] = state;
  return state;
}

export default class TaskTrackerPlugin extends Plugin {
  private store: TaskStore;
  private service: TaskService;
  private ready: Promise<void>;
  private taskDock?: TaskDock;
  private topBarElement?: HTMLElement;
  private topBarObserver?: MutationObserver;
  private frontend = getFrontend();
  private managerViews = new Map<HTMLElement, TaskManagerTab>();
  private startupRetryTimers = new Set<number>();
  private topBarRecoveryTimers = new Set<number>();
  private readonly lifecycleToken = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  private dockRegistered = false;
  private managerTabRegistered = false;
  private commandsRegistered = false;
  private contextMenusRegistered = false;
  private docMenuHandler = this.handleDocumentMenu.bind(this);
  private blockMenuHandler = this.handleBlockMenu.bind(this);
  private contentMenuHandler = this.handleContentMenu.bind(this);
  private wsMainHandler = this.handleWsMain.bind(this);

  onload(): void {
    this.markAsActiveInstance();
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
</symbol>
<symbol id="iconTaskTrackerTrash" viewBox="0 0 32 32">
<path d="M11.333 5.333h9.333l1.333 2.667h4.667v2.667h-21.333v-2.667h4.667l1.333-2.667zM8 13.333h16l-1.333 13.333c-.073.752-.705 1.333-1.46 1.333h-10.413c-.755 0-1.387-.581-1.46-1.333l-1.333-13.333zM12 16v8h2.667v-8h-2.667zM17.333 16v8h2.667v-8h-2.667z"></path>
</symbol>`);

    this.store = new TaskStore(this);
    this.service = new TaskService(this.store);
    this.ready = this.store.load().then(async () => {
      this.setting = this.createSettingPanel();
      await this.service.startupSync();
      this.scheduleStartupRecoveryRetries();
    });

    this.registerDock();
    this.registerManagerTab();
    this.registerCommands();
    this.registerAgentActions();
    this.registerContextMenus();
    this.installTopBarRecovery();
  }

  onLayoutReady(): void {
    if (this.isMobileFrontend() || !this.isActiveInstance()) {
      return;
    }

    this.installTopBarRecovery();
    this.ensureTopBar();
  }

  onunload(): void {
    for (const timer of this.startupRetryTimers) {
      window.clearTimeout(timer);
    }
    this.startupRetryTimers.clear();
    for (const timer of this.topBarRecoveryTimers) {
      window.clearTimeout(timer);
    }
    this.topBarRecoveryTimers.clear();
    this.topBarObserver?.disconnect();
    this.topBarObserver = undefined;
    this.removeTopBar();
    this.taskDock?.destroy();
    this.taskDock = undefined;
    for (const view of this.managerViews.values()) {
      view.destroy();
    }
    this.managerViews.clear();
    this.unregisterContextMenus();
    if (this.isActiveInstance()) {
      const state = getRuntimeState();
      if (state.activeLifecycleToken === this.lifecycleToken) {
        delete state.activeLifecycleToken;
      }
    }
  }

  private registerDock(): void {
    if (this.dockRegistered) {
      return;
    }
    this.dockRegistered = true;
    this.addDock({
      type: DOCK_TYPE,
      config: {
        position: "LeftBottom",
        size: { width: 320, height: 0 },
        icon: "iconTaskTracker",
        title: "任务追踪",
        hotkey: "⌥⌘T",
        index: 0
      },
      data: {},
      init: (dock) => {
        if (!this.isActiveInstance()) {
          return;
        }
        dock.element.innerHTML = `<div class="task-tracker task-tracker-empty">任务追踪加载中...</div>`;
        void this.ready.then(() => {
          if (!this.isActiveInstance()) {
            return;
          }
          this.taskDock?.destroy();
          this.taskDock = new TaskDock(dock.element as HTMLElement, this.service, this.viewActions(), {
            mode: this.isMobileFrontend() ? "mobile" : "desktop"
          });
          this.taskDock.render();
        }).catch((error) => {
          dock.element.innerHTML = `<div class="task-tracker task-tracker-empty">加载失败：${error?.message || error}</div>`;
        });
      },
      update: () => {
        if (this.isActiveInstance()) {
          this.taskDock?.render();
        }
      },
      destroy: () => {
        this.taskDock?.destroy();
        this.taskDock = undefined;
      }
    });
  }

  private registerManagerTab(): void {
    if (this.managerTabRegistered) {
      return;
    }
    this.managerTabRegistered = true;
    const plugin = this;
    this.addTab({
      type: MANAGER_TAB_TYPE,
      init() {
        if (!plugin.isActiveInstance()) {
          return;
        }
        const tab = this as any;
        tab.element.innerHTML = `<div class="task-manager task-manager-empty">任务控制面板加载中...</div>`;
        void plugin.ready.then(() => {
          if (!plugin.isActiveInstance()) {
            return;
          }
          plugin.managerViews.get(tab.element)?.destroy();
          const view = new TaskManagerTab(tab.element, plugin.service, {
            newTask: (options) => void plugin.showTaskDialog({ ...(options || {}), preserveManagerScroll: true }),
            createSubtask: (parentId: string) => void plugin.showTaskDialog({ parentId, preserveManagerScroll: true }),
            editTask: (task: TaskItem) => void plugin.showTaskDialog({ task, preserveManagerScroll: true }),
            openTask: (task: TaskItem) => void plugin.openTask(task),
            openSourceDoc: (docId: string) => void plugin.openDocById(docId),
            sync: () => plugin.syncDeletedTasks()
          }, tab.data || {});
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
    if (this.commandsRegistered) {
      return;
    }
    this.commandsRegistered = true;
    this.addCommand({
      langKey: "newTask",
      hotkey: "",
      callback: () => void this.showTaskDialog()
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

  private registerAgentActions(): void {
    const addAgentAction = (this as unknown as {
      addAgentAction?: (action: TaskTrackerAgentAction) => string;
    }).addAgentAction;
    if (typeof addAgentAction !== "function") {
      return;
    }

    const actions: TaskTrackerAgentAction[] = [
      {
        name: "open-task-manager",
        description: "Open the Task Tracker manager tab.",
        handler: async () => {
          await this.openTaskManager();
          return this.isMobileFrontend()
            ? "移动端请从插件侧栏入口打开任务追踪页面。"
            : "已打开任务控制面板。";
        }
      },
      {
        name: "open-current-linked-task",
        description: "Open the task linked to the current document or block in the Task Tracker dialog.",
        handler: async () => {
          const context = await this.requireAgentContext("未识别到当前文档或块。请先聚焦到相关内容。");
          const linkedTask = this.findLinkedTaskFromContext(context);
          if (!linkedTask) {
            throw new Error("当前笔记未关联任务。");
          }
          await this.showTaskDialog({ task: linkedTask });
          return "已打开当前上下文关联的任务。";
        }
      },
      {
        name: "create-task-from-current-document",
        description: "Create a new task using the current document as the source context.",
        handler: async () => {
          const context = await this.requireAgentContext("未识别到当前文档。请先打开一个文档。");
          if (!context.docId) {
            throw new Error("未识别到当前文档。请先打开一个文档。");
          }
          const source = await sourceFromBlock(context.docId);
          await this.showTaskDialog({
            source,
            presetTitle: source.text || "新任务"
          });
          return "已打开基于当前文档的新任务对话框。";
        }
      },
      {
        name: "create-task-from-current-block-or-selection",
        description: "Create a new task from the current block, or use the current single-block selection as the task title when available.",
        handler: async () => {
          const context = await this.requireAgentContext("未识别到当前块或文档。请先聚焦到相关内容。");
          if (context.blockId && context.selectedText) {
            const source = await sourceFromBlock(context.blockId);
            await this.showTaskDialog({
              source: {
                ...source,
                text: context.selectedText
              },
              presetTitle: context.selectedText
            });
            return "已打开基于当前选中文本的新任务对话框。";
          }
          if (context.blockId) {
            const source = await sourceFromBlock(context.blockId);
            await this.showTaskDialog({
              source,
              presetTitle: source.text || "新任务"
            });
            return "已打开基于当前块的新任务对话框。";
          }
          if (!context.docId) {
            throw new Error("未识别到当前文档。请先打开一个文档。");
          }
          const source = await sourceFromBlock(context.docId);
          await this.showTaskDialog({
            source,
            presetTitle: source.text || "新任务"
          });
          return "已打开基于当前文档的新任务对话框。";
        }
      },
      {
        name: "complete-current-linked-task",
        description: "Mark the task linked to the current document or block as completed.",
        handler: async () => {
          const task = await this.requireLinkedTaskForAgent();
          if (task.status === COMPLETED_TASK_STATUS) {
            return "当前关联任务已是完成状态。";
          }
          await this.service.completeTask(task.id);
          return `已完成任务：${task.title}`;
        }
      },
      {
        name: "reopen-current-linked-task",
        description: "Reopen the completed task linked to the current document or block.",
        handler: async () => {
          const task = await this.requireLinkedTaskForAgent();
          if (task.status !== COMPLETED_TASK_STATUS) {
            return "当前关联任务不是已完成状态，无需重新打开。";
          }
          await this.service.reopenTask(task.id);
          return `已重新打开任务：${task.title}`;
        }
      },
      {
        name: "sync-deleted-tasks",
        description: "Clean up task records whose task documents have been deleted.",
        handler: async () => {
          const count = await this.syncDeletedTasks();
          return count > 0
            ? `已清理 ${count} 个已删除任务记录。`
            : "没有需要清理的任务记录。";
        }
      },
      {
        name: "rebuild-task-index",
        description: "Rebuild the task index from task documents under the current task library.",
        handler: async () => {
          const count = await this.rebuildTaskIndex();
          return count > 0
            ? `已重建 ${count} 个任务索引。`
            : "事项库中没有可重建的任务文档。";
        }
      },
      {
        name: "set-current-document-as-task-root",
        description: "Set the current document as the Task Tracker library root.",
        handler: async () => {
          const context = await this.requireAgentContext("未识别到当前文档。请先打开一个文档。");
          if (!context.docId) {
            throw new Error("未识别到当前文档。请先打开一个文档。");
          }
          const title = await this.assignTaskRootDoc(context.docId);
          return `已将 ${title || "当前文档"} 设为事项库。`;
        }
      }
    ];

    for (const action of actions) {
      addAgentAction.call(this, {
        ...action,
        handler: async () => {
          try {
            return await action.handler();
          } catch (error) {
            const message = error instanceof Error ? error.message : "任务追踪动作执行失败";
            showMessage(message, 5000, "error");
            throw error;
          }
        }
      });
    }
  }

  private registerContextMenus(): void {
    if (this.contextMenusRegistered) {
      return;
    }
    this.unregisterContextMenus();
    this.eventBus.on("click-editortitleicon", this.docMenuHandler);
    this.eventBus.on("click-blockicon", this.blockMenuHandler);
    this.eventBus.on("open-menu-content", this.contentMenuHandler);
    this.eventBus.on("ws-main", this.wsMainHandler);
    this.contextMenusRegistered = true;
  }

  private createSettingPanel(): Setting {
    return createTaskSettings(this.service, {
      setCurrentDocAsRoot: () => this.setCurrentDocAsRoot(),
      setRootDocId: (docId: string) => this.setRootDocId(docId),
      syncDeletedTasks: async () => {
        await this.syncDeletedTasks();
      },
      rebuildTaskIndex: async () => {
        await this.rebuildTaskIndex();
      },
      refreshViews: () => this.refreshViews()
    }, pluginManifest.version);
  }

  private viewActions() {
    return {
      newTask: (options?: { presetPlanDate?: string; parentId?: string }) => void this.showTaskDialog(options || {}),
      createSubtask: (parentId: string) => void this.showTaskDialog({ parentId }),
      editTask: (task: TaskItem) => void this.showTaskDialog({ task }),
      openTask: (task: TaskItem) => void this.openTask(task),
      openTaskManager: () => void this.openTaskManager(),
      setCurrentDocAsRoot: () => void this.setCurrentDocAsRoot()
    };
  }

  private handleDocumentMenu({ detail }: any): void {
    if (!this.isActiveInstance()) {
      return;
    }
    const docId = detail?.protyle?.block?.rootID;
    if (!detail?.menu || !docId) {
      return;
    }

    detail.menu.addItem({
      icon: "iconTaskTracker",
      label: "打开任务",
      click: () => void this.openTaskFromContext({ docId })
    });
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
    if (!this.isActiveInstance()) {
      return;
    }
    const blockElements = Array.isArray(detail?.blockElements) ? detail.blockElements : [];
    const firstBlockId = blockElements[0]?.getAttribute?.("data-node-id");
    const docId = detail?.protyle?.block?.rootID;
    if (!detail?.menu || !firstBlockId) {
      return;
    }

    detail.menu.addItem({
      icon: "iconTaskTracker",
      label: "打开任务",
      click: () => void this.openTaskFromContext({ blockId: firstBlockId, docId })
    });
    detail.menu.addItem({
      icon: "iconAdd",
      label: blockElements.length > 1 ? "从第一个选中块创建任务" : "从当前块创建任务",
      click: () => void this.createTaskFromBlock(firstBlockId)
    });
  }

  private handleContentMenu({ detail }: any): void {
    if (!this.isActiveInstance()) {
      return;
    }
    const menu = detail?.menu;
    const range = detail?.range as Range | undefined;
    if (!menu || !range || range.collapsed) {
      return;
    }

    const selectedText = this.normalizeSelectedText(range.toString());
    if (!selectedText) {
      return;
    }

    const startBlockId = this.findBlockIdFromNode(range.startContainer, detail?.element);
    const endBlockId = this.findBlockIdFromNode(range.endContainer, detail?.element);
    if (!startBlockId || !endBlockId || startBlockId !== endBlockId) {
      return;
    }

    menu.addItem({
      icon: "iconAdd",
      label: "以选中文本创建任务",
      click: () => void this.createTaskFromSelection(startBlockId, selectedText)
    });
  }

  private handleWsMain({ detail }: any): void {
    if (!this.isActiveInstance()) {
      return;
    }
    const cmd = typeof detail?.cmd === "string" ? detail.cmd : "";
    if (/^removeDocs?$/iu.test(cmd) || /removeDoc/iu.test(cmd)) {
      void this.ready
        .then(() => this.service.syncDeletedDocs())
        .catch((error) => console.warn("Task Tracker: failed to sync deleted docs", error));
      return;
    }

    if (detail?.cmd === "sync-end" || detail?.cmd === "syncFinish" || detail?.cmd === "sync-finish") {
      this.queueTopBarRecovery([0, 600, 1500]);
      void this.ready
        .then(() => this.service.startupSync({ skipDeletedCleanup: true }))
        .catch((error) => console.warn("Task Tracker: failed to refresh after sync", error));
    }
  }

  private async showTaskDialog(options: {
    parentId?: string;
    source?: SourceContext;
    presetTitle?: string;
    presetPlanDate?: string;
    task?: TaskItem;
    preserveManagerScroll?: boolean;
  } = {}): Promise<void> {
    await this.ready;
    new TaskDialog({
      service: this.service,
      parentId: options.parentId,
      source: options.source,
      presetTitle: options.presetTitle,
      presetPlanDate: options.presetPlanDate,
      task: options.task,
      onSaved: () => this.refreshViews(options.preserveManagerScroll === true),
      onOpenTask: (task) => void this.openTask(task),
      onOpenSourceDoc: (docId) => void this.openDocById(docId)
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
      const title = await this.assignTaskRootDoc(normalizedDocId);
      showMessage(`已将 ${title || "当前文档"} 设为事项库`);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "设置事项库失败", 5000, "error");
    }
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

  private async createTaskFromSelection(blockId: string, selectedText: string): Promise<void> {
    await this.ready;
    try {
      const source = await sourceFromBlock(blockId);
      await this.showTaskDialog({
        source: {
          ...source,
          text: selectedText
        },
        presetTitle: selectedText
      });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "读取选中内容失败", 5000, "error");
    }
  }

  private async openTaskManager(): Promise<void> {
    if (this.isMobileFrontend()) {
      showMessage("移动端请从插件侧栏入口打开任务追踪页面", 4000, "info");
      return;
    }
    await this.ready;
    openTab({
      app: this.app,
      custom: {
        icon: "iconTaskTracker",
        title: "任务控制面板",
        id: `${this.name}${MANAGER_TAB_TYPE}`,
        data: {}
      }
    });
  }

  private async openTask(task: TaskItem): Promise<void> {
    const doc = await getBlockById(task.docId).catch(() => undefined);
    if (!doc) {
      const removed = await this.service.syncDeletedDocs().catch(() => 0);
      showMessage(
        removed > 0
          ? `任务“${task.title}”对应的笔记已不存在，已从列表中清理`
          : `任务“${task.title}”对应的笔记不存在`,
        5000,
        "error"
      );
      return;
    }
    this.openDocById(task.docId);
  }

  private openDocById(docId: string): void {
    if (this.isMobileFrontend()) {
      openMobileFileById(this.app, docId);
      return;
    }
    openTab({
      app: this.app,
      doc: {
        id: docId
      }
    });
  }

  private async syncDeletedTasks(): Promise<number> {
    await this.ready;
    const count = await this.service.syncDeletedDocs();
    showMessage(count > 0 ? `已清理 ${count} 个已删除任务记录` : "没有需要清理的任务记录");
    return count;
  }

  private async rebuildTaskIndex(): Promise<number> {
    await this.ready;
    const count = await this.service.rebuildTaskIndex();
    showMessage(count > 0 ? `已重建 ${count} 个任务索引` : "事项库中没有可重建的任务文档");
    return count;
  }

  private refreshViews(preserveManagerScroll = false): void {
    this.taskDock?.render();
    for (const view of this.managerViews.values()) {
      view.render({ preserveTableScroll: preserveManagerScroll });
    }
  }

  private scheduleStartupRecoveryRetries(): void {
    if (!this.isActiveInstance()) {
      return;
    }
    if (!this.store.getSettings().taskRootDocId) {
      return;
    }

    const delays = [5000, 12000, 20000];
    for (const delayMs of delays) {
      const timer = window.setTimeout(() => {
        this.startupRetryTimers.delete(timer);
        if (!this.isActiveInstance()) {
          return;
        }
        void this.service.startupSync({ skipDeletedCleanup: true })
          .catch((error) => console.warn("Task Tracker: deferred startup recovery failed", error));
      }, delayMs);
      this.startupRetryTimers.add(timer);
    }
  }

  private markAsActiveInstance(): void {
    getRuntimeState().activeLifecycleToken = this.lifecycleToken;
  }

  private isActiveInstance(): boolean {
    return getRuntimeState().activeLifecycleToken === this.lifecycleToken;
  }

  private ensureTopBar(): void {
    if (!this.isActiveInstance() || this.isMobileFrontend()) {
      return;
    }
    const anchor = this.getTopBarAnchor();
    if (!anchor) {
      this.queueTopBarRecovery([400, 1200, 3000]);
      return;
    }
    if (this.topBarElement instanceof HTMLElement && document.contains(this.topBarElement)) {
      this.markTopBarOwner(this.topBarElement);
      this.topBarElement.classList.remove("fn__none");
      this.removeDuplicateTopBarElements();
      return;
    }
    if (this.topBarElement instanceof HTMLElement) {
      this.removeTopBarIconReference(this.topBarElement);
      this.topBarElement = undefined;
    }
    const nextTopBarElement = this.addTopBar({
      icon: "iconTaskTracker",
      title: "任务追踪",
      position: "right",
      callback: () => {
        if (!this.isActiveInstance()) {
          return;
        }
        void this.openTaskManager();
      }
    });
    if (!(nextTopBarElement instanceof HTMLElement)) {
      return;
    }
    this.topBarElement = nextTopBarElement;
    this.markTopBarOwner(this.topBarElement);
    this.topBarElement.classList.remove("fn__none");
    this.removeDuplicateTopBarElements();
  }

  private removeTopBar(): void {
    if (!(this.topBarElement instanceof HTMLElement)) {
      return;
    }
    this.removeTopBarIconReference(this.topBarElement);
    this.topBarElement.remove();
    this.topBarElement = undefined;
  }

  private removeDuplicateTopBarElements(): void {
    if (!(this.topBarElement instanceof HTMLElement) || !document.contains(this.topBarElement)) {
      return;
    }
    const selector = `[id^="plugin_${this.name}_"]`;
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (element === this.topBarElement) {
        return;
      }
      this.removeTopBarIconReference(element);
      element.remove();
    });
  }

  private markTopBarOwner(element: HTMLElement): void {
    element.setAttribute(TOP_BAR_OWNER_ATTR, this.lifecycleToken);
  }

  private removeTopBarIconReference(element: HTMLElement): void {
    const topBarIcons = (this as any).topBarIcons as HTMLElement[] | undefined;
    const index = topBarIcons?.indexOf(element) ?? -1;
    if (index >= 0) {
      topBarIcons?.splice(index, 1);
    }
  }

  private installTopBarRecovery(): void {
    if (this.isMobileFrontend() || !this.isActiveInstance()) {
      return;
    }
    this.queueTopBarRecovery([0, 600, 1800, 4000]);
    if (this.topBarObserver) {
      return;
    }
    this.topBarObserver = new MutationObserver(() => {
      this.queueTopBarRecovery([0]);
    });
    this.topBarObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private queueTopBarRecovery(delays: number[]): void {
    if (this.isMobileFrontend() || !this.isActiveInstance()) {
      return;
    }
    for (const delayMs of delays) {
      const timer = window.setTimeout(() => {
        this.topBarRecoveryTimers.delete(timer);
        if (!this.isActiveInstance()) {
          return;
        }
        this.ensureTopBar();
      }, delayMs);
      this.topBarRecoveryTimers.add(timer);
    }
  }

  private getTopBarAnchor(): Element | null {
    return document.querySelector("#barPlugins") || document.querySelector("#drag");
  }

  private unregisterContextMenus(): void {
    this.eventBus.off("click-editortitleicon", this.docMenuHandler);
    this.eventBus.off("click-blockicon", this.blockMenuHandler);
    this.eventBus.off("open-menu-content", this.contentMenuHandler);
    this.eventBus.off("ws-main", this.wsMainHandler);
    this.contextMenusRegistered = false;
  }

  private getCurrentProtyle(): any {
    return (this as any).getEditor?.()?.protyle;
  }

  private normalizeSelectedText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private resolveTaskForSourceBlock(blockId: string): TaskItem | undefined {
    const linkedTasks = this.store.all().filter((task) => task.sourceBlockId === blockId);
    if (!linkedTasks.length) {
      return undefined;
    }
    return [...linkedTasks].sort((left, right) => {
      const leftActive = left.status !== COMPLETED_TASK_STATUS && left.status !== CANCELLED_TASK_STATUS;
      const rightActive = right.status !== COMPLETED_TASK_STATUS && right.status !== CANCELLED_TASK_STATUS;
      if (leftActive !== rightActive) {
        return leftActive ? -1 : 1;
      }
      return right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt);
    })[0];
  }

  private resolveTaskForDoc(docId: string): TaskItem | undefined {
    const matchedTasks = this.store.all().filter((task) => task.docId === docId || task.id === docId);
    if (!matchedTasks.length) {
      return undefined;
    }
    return [...matchedTasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))[0];
  }

  private async openTaskFromContext(context: { blockId?: string; docId?: string }): Promise<void> {
    await this.ready;
    const linkedTask = this.findLinkedTaskFromContext(context);
    if (!linkedTask) {
      showMessage("当前笔记未关联任务", 3000, "info");
      return;
    }
    await this.showTaskDialog({ task: linkedTask });
  }

  private async requireLinkedTaskForAgent(): Promise<TaskItem> {
    const context = await this.requireAgentContext("未识别到当前文档或块。请先聚焦到相关内容。");
    const linkedTask = this.findLinkedTaskFromContext(context);
    if (!linkedTask) {
      throw new Error("当前笔记未关联任务。");
    }
    return linkedTask;
  }

  private findLinkedTaskFromContext(context: { blockId?: string; docId?: string }): TaskItem | undefined {
    return (context.docId ? this.resolveTaskForDoc(context.docId) : undefined)
      || (context.blockId ? this.resolveTaskForSourceBlock(context.blockId) : undefined);
  }

  private async assignTaskRootDoc(docId: string): Promise<string | undefined> {
    const settings = await this.service.setRootFromDoc(docId);
    this.setting = this.createSettingPanel();
    this.refreshViews();
    return settings.taskRootTitle;
  }

  private async requireAgentContext(errorMessage: string): Promise<TaskTrackerAgentContext> {
    await this.ready;
    const context = this.resolveAgentContext();
    if (!context.docId && !context.blockId) {
      throw new Error(errorMessage);
    }
    return context;
  }

  private resolveAgentContext(): TaskTrackerAgentContext {
    const protyle = this.getCurrentProtyle();
    const docId = protyle?.block?.rootID;
    const rootElement = protyle?.wysiwyg?.element as HTMLElement | undefined;
    const selection = globalThis.getSelection?.();

    let blockId: string | undefined;
    let selectedText: string | undefined;
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      const selectionInsideCurrentProtyle = !rootElement
        || (rootElement.contains(range.startContainer) && rootElement.contains(range.endContainer));
      if (selectionInsideCurrentProtyle) {
        const normalizedSelection = this.normalizeSelectedText(range.toString());
        const startBlockId = this.findBlockIdFromNode(range.startContainer);
        const endBlockId = this.findBlockIdFromNode(range.endContainer);
        if (startBlockId && startBlockId === endBlockId) {
          blockId = startBlockId;
          selectedText = normalizedSelection || undefined;
        }
      }
    }

    if (!blockId) {
      const activeElement = document.activeElement instanceof Element ? document.activeElement : undefined;
      if (activeElement && (!rootElement || rootElement.contains(activeElement))) {
        blockId = this.findBlockIdFromNode(activeElement);
      }
    }

    return {
      protyle,
      docId,
      blockId,
      selectedText
    };
  }

  private findBlockIdFromNode(node: Node | null | undefined, fallbackElement?: Element | null): string | undefined {
    const startElement = node instanceof Element
      ? node
      : node?.parentElement || fallbackElement || undefined;
    return startElement?.closest?.("[data-node-id]")?.getAttribute("data-node-id") || undefined;
  }

  private isMobileFrontend(): boolean {
    return this.frontend === "mobile" || this.frontend === "browser-mobile";
  }
}

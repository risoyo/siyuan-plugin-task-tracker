import {
  appendBlock,
  deleteBlock,
  createDocWithMd,
  getChildBlocks,
  getBlockAttrs,
  getBlockById,
  getDocMarkdown,
  getSyncInfo,
  getHPathById,
  moveDocs,
  removeDoc,
  renameDocById,
  setBlockAttrs,
  sql,
  sqlText,
  updateBlock
} from "./api";
import {
  formatCompletedWeekLabel,
  formatLocalDateTimeOrEmpty,
  newSiyuanId,
  nowIso,
  startOfWeek,
  toDateKey,
  weekKey
} from "./date";
import { TaskStore } from "./taskStore";
import {
  ACTIVE_TASK_STATUSES,
  TASK_INDEX_SCHEMA_VERSION,
  DEFAULT_TASK_TEMPLATE,
  ARCHIVE_ROOT_KIND,
  ARCHIVE_WEEK_KIND,
  REPORT_ATTRS,
  SOURCE_TASK_IDS_ATTR,
  TASK_ATTRS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  WEEKLY_REPORT_ROOT_KIND,
  WEEKLY_REPORT_KIND,
  type BlockRow,
  type SourceContext,
  type StructureTransactionOptions,
  type TaskCreateInput,
  type TaskItem,
  type TaskRevisionSnapshot,
  type TaskSettings
} from "./types";

const WEEKDAY_LABELS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"] as const;
const TASK_DETAIL_HEADING = "任务详情";
const SYNC_INCREMENTAL_OVERLAP_MS = 90 * 1000;
const SESSION_EDITOR_ID = `session:${Math.random().toString(36).slice(2, 10)}`;

type ChangeListener = () => void;
type CollectedTaskResult = {
  tasks: TaskItem[];
  recoveredDocIds: string[];
};

export class RevisionConflictError extends Error {
  constructor(message = "该任务已在其他设备更新，请先刷新后再编辑") {
    super(message);
    this.name = "RevisionConflictError";
  }
}

export class TaskService {
  private listeners = new Set<ChangeListener>();

  constructor(public readonly store: TaskStore) {}

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async setRootFromDoc(docId: string): Promise<TaskSettings> {
    const block = await getBlockById(docId);
    if (!block || !block.box || !block.path) {
      throw new Error("无法读取当前文档信息");
    }
    const hpath = await getHPathById(docId).catch(() => block.content || docId);
    const settings: TaskSettings = {
      taskRootDocId: docId,
      taskRootNotebookId: block.box,
      taskRootPath: block.path,
      taskRootHPath: normalizeHPath(hpath || block.content || docId),
      taskRootTitle: hpath || block.content || docId
    };
    await this.store.setSettings(settings);
    this.emit();
    return settings;
  }

  private async getSettingsWithFreshRootPath(): Promise<TaskSettings> {
    const settings = this.store.getSettings();
    if (!settings.taskRootDocId) {
      return settings;
    }
    const [actualRootPath, actualRootHPath] = await Promise.all([
      getTaskPath(settings.taskRootDocId).catch(() => undefined),
      getHPathById(settings.taskRootDocId).catch(() => undefined)
    ]);
    const normalizedRootHPath = actualRootHPath ? normalizeHPath(actualRootHPath) : settings.taskRootHPath;
    const nextRootTitle = actualRootHPath || settings.taskRootTitle;
    if (
      (!actualRootPath || actualRootPath === settings.taskRootPath)
      && normalizedRootHPath === settings.taskRootHPath
      && nextRootTitle === settings.taskRootTitle
    ) {
      return settings;
    }
    await this.store.setSettings({
      taskRootPath: actualRootPath || settings.taskRootPath,
      taskRootHPath: normalizedRootHPath,
      taskRootTitle: nextRootTitle
    });
    return {
      ...settings,
      taskRootPath: actualRootPath || settings.taskRootPath,
      taskRootHPath: normalizedRootHPath,
      taskRootTitle: nextRootTitle
    };
  }

  async createTask(input: TaskCreateInput, options: StructureTransactionOptions = {}): Promise<TaskItem> {
    const settings = this.store.getSettings();
    if (!settings.taskRootDocId || !settings.taskRootNotebookId) {
      throw new Error("请先将一个文档设为事项库");
    }

    const parent = input.parentId ? this.store.get(input.parentId) : undefined;
    const docId = newSiyuanId();
    const title = input.title.trim();
    const notebookId = parent?.notebookId || settings.taskRootNotebookId;
    const parentHPath = await resolveParentHPath(settings, parent);
    const now = nowIso();
    const createdAt = input.createdAt || now;
    const draftTask: TaskItem = {
      id: docId,
      title,
      docId,
      notebookId,
      path: "",
      parentId: input.parentId,
      sourceBlockId: input.sourceBlockId,
      sourceDocId: input.sourceDocId,
      sourceText: input.sourceText,
      project: input.project?.trim() || undefined,
      priority: input.priority || "none",
      status: input.status || "todo",
      dueDate: input.dueDate || undefined,
      planStart: input.planStart || undefined,
      planEnd: input.planEnd || undefined,
      description: input.description?.trim() || undefined,
      createdAt,
      updatedAt: now,
      completedAt: input.status === "completed" ? now : undefined,
      taskRevision: 0,
      taskLastEditedAt: now,
      taskLastEditedBy: undefined,
      taskLastOpId: undefined
    };

    const opId = options.opId || defaultOpId();
    const editorId = options.editorId || defaultEditorId();
    let actualTask: TaskItem | undefined;
    const doCreate = async () => {
      const created = await createTaskDocWithTitle(
        notebookId,
        parentHPath,
        taskDocumentTitle(draftTask),
        renderTaskMarkdown(draftTask, parent, [], settings, input.detail)
      );
      const resolvedPath = await requireTaskPath(created.docId, `创建任务后无法读取真实路径：${title}`);
      actualTask = {
        ...draftTask,
        id: created.docId || docId,
        docId: created.docId || docId,
        path: resolvedPath,
        taskRevision: 1,
        taskLastEditedAt: now,
        taskLastEditedBy: editorId,
        taskLastOpId: opId
      };

      await setTaskAttrs(actualTask);
      if (actualTask.sourceBlockId) {
        await appendSourceTaskId(actualTask.sourceBlockId, actualTask.id);
      }
      await this.store.upsert(actualTask);
    };

    if (parent?.id) {
      await this.runStructureTransaction({
        rootTaskId: parent.id,
        affectedTaskIds: [parent.id]
      }, doCreate, { opId, editorId });
    } else {
      await doCreate();
    }

    if (!actualTask) {
      throw new Error("创建任务失败");
    }

    if (actualTask.status === "completed" && !actualTask.parentId) {
      actualTask = await this.archiveCompletedParentTask(actualTask, { opId, editorId });
    }
    const reconcileIds = new Set<string>([actualTask.id]);
    if (actualTask.parentId) {
      reconcileIds.add(actualTask.parentId);
    }
    await this.syncTaskDocuments(Array.from(reconcileIds));
    await this.clearTasksNeedsReconcile(Array.from(reconcileIds));
    this.emit();
    return actualTask;
  }

  async updateTask(
    id: string,
    patch: Partial<TaskItem>,
    options: {
      expectedRevision?: number;
      opId?: string;
      editorId?: string;
      allowStructural?: boolean;
    } = {}
  ): Promise<TaskItem> {
    const current = this.store.get(id);
    if (!current) {
      throw new Error("任务不存在");
    }

    const normalizedPatch = normalizeTaskPatch(patch);
    if (!options.allowStructural && "parentId" in normalizedPatch && normalizedPatch.parentId !== current.parentId) {
      throw new Error("当前操作属于结构变更，请使用结构事务接口");
    }

    const opId = options.opId || defaultOpId();
    const editorId = options.editorId || defaultEditorId();
    const latestSnapshot = await this.readTaskRevisionSnapshot(current.docId, current.id);
    const expectedRevision = options.expectedRevision ?? current.taskRevision;
    if (latestSnapshot.taskLastOpId && latestSnapshot.taskLastOpId === opId) {
      return current;
    }
    if (latestSnapshot.revision !== expectedRevision) {
      throw new RevisionConflictError();
    }

    const title = normalizedPatch.title?.trim();
    if (title === "") {
      throw new Error("请填写任务标题");
    }

    const renamePreview = {
      ...current,
      ...normalizedPatch,
      ...(title ? { title } : {})
    };
    const shouldRename = (title && title !== current.title) || (normalizedPatch.createdAt && normalizedPatch.createdAt !== current.createdAt);
    if (shouldRename) {
      await renameDocById(current.docId, taskDocumentTitle(renamePreview));
      const refreshedPath = await getTaskPath(current.docId);
      if (refreshedPath) {
        normalizedPatch.path = refreshedPath;
      }
    }

    const normalized = normalizeCompletion(current, title ? { ...normalizedPatch, title } : normalizedPatch);
    if ((normalized.status ?? current.status) === "completed" && !normalized.completedAt) {
      throw new Error("已完成任务必须填写完成时间");
    }
    let task = await this.store.update(id, {
      ...normalized,
      taskRevision: latestSnapshot.revision + 1,
      taskLastEditedAt: nowIso(),
      taskLastEditedBy: editorId,
      taskLastOpId: opId
    });

    await syncSourceTaskReference(current.sourceBlockId, task.sourceBlockId, task.id);
    await setTaskAttrs(task);
    await this.syncTaskDocument(task.id);
    await this.clearTasksNeedsReconcile([task.id, task.parentId || ""]);

    const savedSnapshot = await this.readTaskRevisionSnapshot(task.docId, task.id);
    if (savedSnapshot.taskLastOpId !== opId) {
      throw new RevisionConflictError("任务已被更新覆盖，请刷新后重试");
    }

    if (current.status !== "completed" && task.status === "completed" && !task.parentId) {
      task = await this.archiveCompletedParentTask(task, {
        opId,
        editorId
      });
    }
    this.emit();
    return task;
  }

  async completeTask(id: string): Promise<TaskItem> {
    return this.updateTask(id, {
      status: "completed"
    });
  }

  async reopenTask(id: string): Promise<TaskItem> {
    return this.updateTask(id, {
      status: "todo"
    });
  }

  async removeTaskRecord(id: string, options: { cascade?: boolean } = {}): Promise<number> {
    const task = this.store.get(id);
    if (!task) {
      return 0;
    }

    const ids = options.cascade ? collectTaskTreeIds(this.store.all(), id) : [id];
    const parentIds = parentIdsForTasks(this.store.all(), ids);
    const removed = await this.store.removeMany(ids);
    if (removed > 0) {
      await this.syncTaskDocuments(parentIds);
      await this.clearTasksNeedsReconcile(parentIds);
      this.emit();
    }
    return removed;
  }

  async deleteTaskTree(id: string): Promise<number> {
    const task = this.store.get(id);
    if (!task) {
      return 0;
    }

    const tasks = this.store.all();
    const ids = expandWithDescendantsAndPaths(tasks, [id]);
    const idSet = new Set(ids);
    const selectedTasks = tasks.filter((item) => idSet.has(item.id));
    const parentIds = parentIdsForTasks(tasks, ids).filter((parentId) => !idSet.has(parentId));

    for (const item of selectedTasks) {
      if (!item.sourceBlockId) {
        continue;
      }
      await removeSourceTaskId(item.sourceBlockId, item.id).catch((error) => {
        console.warn("Task Tracker: failed to remove source task reference", item.id, error);
      });
    }

    await this.runStructureTransaction(
      {
        rootTaskId: id,
        affectedTaskIds: Array.from(new Set([...ids, ...parentIds]))
      },
      async () => {
        await deleteTaskDocuments(selectedTasks);
      }
    );

    const removed = await this.store.removeMany(ids);
    if (removed > 0) {
      await this.syncTaskDocuments(parentIds);
      await this.clearTasksNeedsReconcile(parentIds);
      this.emit();
    }
    return removed;
  }

  async syncDeletedDocs(options: { reconcileParents?: boolean } = {}): Promise<number> {
    const missingIds: string[] = [];

    for (const task of this.store.all()) {
      try {
        const block = await getBlockById(task.docId);
        if (!block) {
          missingIds.push(task.id);
        }
      } catch (error) {
        console.warn("Task Tracker: failed to check task document", task.docId, error);
      }
    }

    const ids = expandWithDescendants(this.store.all(), missingIds);
    const parentIds = parentIdsForTasks(this.store.all(), ids);
    const removed = await this.store.removeMany(ids);
    if (removed > 0 && options.reconcileParents !== false) {
      await this.syncTaskDocuments(parentIds);
      await this.clearTasksNeedsReconcile(parentIds);
    }
    if (removed > 0 && options.reconcileParents === false) {
      await this.markTasksNeedsReconcile(parentIds);
    }
    if (removed > 0) {
      this.emit();
    }
    return removed;
  }

  async syncAllTaskDocuments(): Promise<number> {
    // 4.0: this is now an explicit reconcile entry that only processes pending items.
    const result = await this.reconcilePendingTaskDocuments();
    return result.reconciled;
  }

  async reconcilePendingTaskDocuments(): Promise<{ total: number; reconciled: number; failedTaskIds: string[] }> {
    const ids = this.store.all().filter((task) => task.needsReconcile).map((task) => task.id);
    if (!ids.length) {
      return { total: 0, reconciled: 0, failedTaskIds: [] };
    }

    const succeeded: string[] = [];
    const failedTaskIds: string[] = [];
    for (const id of Array.from(new Set(ids))) {
      try {
        await this.syncTaskDocument(id);
        succeeded.push(id);
      } catch (error) {
        failedTaskIds.push(id);
        console.warn("Task Tracker: failed to reconcile task summary", id, error);
      }
    }

    if (succeeded.length) {
      await this.clearTasksNeedsReconcile(succeeded);
      this.emit();
    }

    return {
      total: ids.length,
      reconciled: succeeded.length,
      failedTaskIds
    };
  }

  activeTasks(): TaskItem[] {
    return this.store.all().filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  }

  async waitForStartupSync(options: { maxWaitMs?: number; pollMs?: number } = {}): Promise<void> {
    const maxWaitMs = options.maxWaitMs ?? 12000;
    const pollMs = options.pollMs ?? 800;
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < maxWaitMs) {
      const syncInfo = await getSyncInfo();
      if (!syncInfo?.syncing) {
        return;
      }
      await delay(pollMs);
    }
  }

  async startupSync(options: { skipDeletedCleanup?: boolean; forceRebuild?: boolean } = {}): Promise<{ removed: number; refreshed: number; rebuilt: boolean }> {
    await this.waitForStartupSync({
      maxWaitMs: this.store.getSettings().startupSyncGraceMs ?? 12000
    });

    const settings = await this.getSettingsWithFreshRootPath();
    const cacheMeta = this.store.getCacheMeta();
    const shouldRebuild = options.forceRebuild
      || this.shouldRebuildIndex({
        settings,
        cacheMeta,
        hasCacheTasks: this.store.all().length > 0
      });

    if (shouldRebuild) {
      const collected = await this.collectTasksFromRoot(settings);
      await this.backfillRecoveredTaskAttrs(collected);
      await this.store.replaceAll(collected.tasks, {
        schemaVersion: TASK_INDEX_SCHEMA_VERSION,
        lastRootDocId: settings.taskRootDocId,
        lastRootPath: settings.taskRootPath,
        lastDocUpdatedMax: maxDocUpdated(collected.tasks),
        corrupt: false
      });
      this.emit();
      return { removed: 0, refreshed: collected.tasks.length, rebuilt: true };
    }

    let removed = 0;
    if (!options.skipDeletedCleanup) {
      removed = await this.syncDeletedDocs({ reconcileParents: false });
    }

    const refreshed = await this.refreshIndexIncremental({
      reason: "startup",
      forceWindow: true
    });
    return { removed, refreshed, rebuilt: false };
  }

  async rebuildTaskIndex(): Promise<number> {
    const settings = await this.getSettingsWithFreshRootPath();
    const collected = await this.collectTasksFromRoot(settings);
    await this.backfillRecoveredTaskAttrs(collected);
    await this.store.replaceAll(collected.tasks, {
      schemaVersion: TASK_INDEX_SCHEMA_VERSION,
      lastRootDocId: settings.taskRootDocId,
      lastRootPath: settings.taskRootPath,
      lastDocUpdatedMax: maxDocUpdated(collected.tasks),
      corrupt: false
    });
    this.emit();
    return collected.tasks.length;
  }

  async refreshAfterSync(): Promise<{ refreshed: number; rebuilt: boolean }> {
    await this.waitForStartupSync({
      maxWaitMs: 6000,
      pollMs: 500
    });

    const settings = await this.getSettingsWithFreshRootPath();
    const cacheMeta = this.store.getCacheMeta();
    const shouldRebuild = this.shouldRebuildIndex({
      settings,
      cacheMeta,
      hasCacheTasks: this.store.all().length > 0
    });
    if (shouldRebuild) {
      const count = await this.rebuildTaskIndex();
      return { refreshed: count, rebuilt: true };
    }

    const refreshed = await this.refreshIndexIncremental({
      reason: "sync-end",
      forceWindow: false
    });
    await this.validateIndexedTasksExistence(80);
    if (refreshed > 0) {
      this.emit();
    }
    return { refreshed, rebuilt: false };
  }

  async exportCompletedWeekReport(week: string): Promise<{ docId: string; title: string }> {
    const settings = this.store.getSettings();
    if (!settings.taskRootDocId || !settings.taskRootNotebookId) {
      throw new Error("请先将一个文档设为事项库");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      throw new Error("无效的周标识");
    }

    const tasks = this.store.all()
      .filter((task) => task.status === "completed" && weekKey(task.completedAt || task.createdAt) === week)
      .sort(compareWeeklyReportTaskOrder);
    const weekLabel = formatCompletedWeekLabel(week);
    const title = `${weekLabel}工作`;
    const reportRoot = await ensureWeeklyReportRoot(settings);
    const reportHPath = `${reportRoot.hpath === "/" ? "" : reportRoot.hpath}/${title}`;
    const existing = await getDocRefByHPath(settings.taskRootNotebookId, reportHPath);
    const itemsBody = renderWeeklyReportItemsBody(week, tasks);

    if (!existing) {
      const markdown = buildWeeklyReportMarkdown(title, itemsBody, "", "");
      const created = await createWeeklyReportDoc(settings.taskRootNotebookId, reportRoot.hpath, title, markdown);
      await markWeeklyReportDoc(created.docId);
      return { docId: created.docId, title };
    }

    await replaceManagedHeadingSection(existing.id, ["一、本周工作事项", "本周工作事项"], itemsBody, {
      createIfMissing: false
    });
    await markWeeklyReportDoc(existing.id);
    return { docId: existing.id, title };
  }

  async getTaskDetail(docId: string): Promise<string> {
    const markdown = await readDocMarkdown(docId);
    return extractTaskDetail(markdown);
  }

  async saveTaskDetail(docId: string, detail: string): Promise<void> {
    await replaceManagedHeadingSection(docId, [TASK_DETAIL_HEADING], normalizeTaskDetailBody(detail), {
      createIfMissing: true
    });
  }

  async saveTaskDetailByTaskId(
    taskId: string,
    detail: string,
    options: {
      expectedRevision?: number;
      opId?: string;
      editorId?: string;
    } = {}
  ): Promise<TaskItem> {
    const task = this.store.get(taskId);
    if (!task) {
      throw new Error("任务不存在");
    }
    const opId = options.opId || defaultOpId();
    const editorId = options.editorId || defaultEditorId();
    const snapshot = await this.readTaskRevisionSnapshot(task.docId, task.id);
    const expectedRevision = options.expectedRevision ?? task.taskRevision;
    if (snapshot.taskLastOpId && snapshot.taskLastOpId === opId) {
      return task;
    }
    if (snapshot.revision !== expectedRevision) {
      throw new RevisionConflictError();
    }
    await replaceManagedHeadingSection(task.docId, [TASK_DETAIL_HEADING], normalizeTaskDetailBody(detail), {
      createIfMissing: true
    });
    const next = await this.store.update(task.id, {
      taskRevision: snapshot.revision + 1,
      taskLastEditedAt: nowIso(),
      taskLastEditedBy: editorId,
      taskLastOpId: opId
    });
    await setTaskAttrs(next);
    const savedSnapshot = await this.readTaskRevisionSnapshot(next.docId, next.id);
    if (savedSnapshot.taskLastOpId !== opId) {
      throw new RevisionConflictError("任务详情已被其他设备覆盖，请刷新后重试");
    }
    await this.clearTasksNeedsReconcile([next.id, next.parentId || ""]);
    this.emit();
    return next;
  }

  async readTaskRevisionSnapshot(docId: string, taskId: string): Promise<TaskRevisionSnapshot> {
    const attrs = await getBlockAttrs(docId).catch(() => ({}));
    const revision = parseTaskRevision(attrs[TASK_ATTRS.taskRevision]);
    return {
      taskId,
      docId,
      revision,
      taskLastOpId: attrs[TASK_ATTRS.taskLastOpId] || undefined
    };
  }

  private async runStructureTransaction(
    payload: {
      rootTaskId: string;
      affectedTaskIds: string[];
    },
    action: () => Promise<void>,
    options: StructureTransactionOptions = {}
  ): Promise<void> {
    const opId = options.opId || defaultOpId();
    const editorId = options.editorId || defaultEditorId();
    const snapshots = await this.collectRevisionSnapshots(payload.affectedTaskIds);
    for (const [taskId, snapshot] of snapshots.entries()) {
      const cached = this.store.get(taskId);
      if (!cached) {
        continue;
      }
      if ((cached.taskRevision || 0) !== snapshot.revision) {
        throw new RevisionConflictError();
      }
    }

    await action();

    const verify = await this.collectRevisionSnapshots(payload.affectedTaskIds);
    for (const [taskId, before] of snapshots.entries()) {
      const current = this.store.get(taskId);
      if (!current) {
        continue;
      }
      const after = verify.get(taskId);
      if (!after) {
        throw new RevisionConflictError("结构操作完成后校验失败，请刷新后重试");
      }
      if (after.revision < before.revision) {
        throw new RevisionConflictError("结构操作检测到过期状态，请刷新后重试");
      }
      if (after.revision === before.revision) {
        const bumped = await this.store.update(taskId, {
          taskRevision: before.revision + 1,
          taskLastEditedAt: nowIso(),
          taskLastEditedBy: editorId,
          taskLastOpId: opId
        });
        await setTaskAttrs(bumped);
      }
    }
  }

  private async collectRevisionSnapshots(taskIds: string[]): Promise<Map<string, TaskRevisionSnapshot>> {
    const result = new Map<string, TaskRevisionSnapshot>();
    for (const id of Array.from(new Set(taskIds))) {
      const task = this.store.get(id);
      if (!task) {
        continue;
      }
      result.set(id, await this.readTaskRevisionSnapshot(task.docId, task.id));
    }
    return result;
  }

  async changeTaskParent(
    taskId: string,
    parentId: string | undefined,
    options: StructureTransactionOptions = {}
  ): Promise<TaskItem> {
    const current = this.store.get(taskId);
    if (!current) {
      throw new Error("任务不存在");
    }
    if (current.parentId === parentId) {
      return current;
    }

    const allTasks = this.store.all();
    const subtreeIds = expandWithDescendants(allTasks, [taskId]);
    if (parentId && subtreeIds.includes(parentId)) {
      throw new Error("不能将任务移动到自己的子任务下");
    }

    const affectedTaskIds = new Set<string>(subtreeIds);
    if (current.parentId) {
      affectedTaskIds.add(current.parentId);
    }
    if (parentId) {
      affectedTaskIds.add(parentId);
    }

    const now = nowIso();
    const opId = options.opId || defaultOpId();
    const editorId = options.editorId || defaultEditorId();
    await this.runStructureTransaction(
      {
        rootTaskId: taskId,
        affectedTaskIds: Array.from(affectedTaskIds)
      },
      async () => {
        const previous = this.store.get(taskId) || current;
        const updated = await this.store.update(taskId, {
          parentId,
          taskRevision: previous.taskRevision + 1,
          taskLastEditedAt: now,
          taskLastEditedBy: editorId,
          taskLastOpId: opId
        });
        await setTaskAttrs(updated);
        try {
          await this.moveTaskToParent(updated);
        } catch (error) {
          try {
            const actualPath = await getTaskPath(previous.docId);
            if (actualPath && previous.path && actualPath !== previous.path) {
              const settings = await this.getSettingsWithFreshRootPath();
              let rollbackTargetPath = "";
              if (previous.parentId) {
                const previousParent = this.store.get(previous.parentId);
                if (previousParent) {
                  const previousParentPath = await requireTaskPath(previousParent.docId, `回滚时无法读取旧父任务路径：${previousParent.title}`);
                  rollbackTargetPath = previousParentPath;
                }
              } else if (settings.taskRootDocId) {
                const rootPath = await requireTaskPath(settings.taskRootDocId, "回滚时无法读取事项库根文档路径");
                rollbackTargetPath = rootPath;
              }
              if (rollbackTargetPath) {
                await moveDocs([actualPath], previous.notebookId, rollbackTargetPath);
              }
            }
          } catch (rollbackMoveError) {
            console.warn("Task Tracker: failed to rollback task document move", rollbackMoveError);
          }
          const rollback = await this.store.update(taskId, {
            parentId: previous.parentId,
            path: previous.path,
            taskRevision: previous.taskRevision,
            taskLastEditedAt: previous.taskLastEditedAt,
            taskLastEditedBy: previous.taskLastEditedBy,
            taskLastOpId: previous.taskLastOpId
          });
          await setTaskAttrs(rollback).catch(() => undefined);
          throw error;
        }
      },
      { ...options, opId, editorId }
    );

    const task = this.store.get(taskId);
    if (!task) {
      throw new Error("任务不存在");
    }
    await this.syncTaskDocuments(Array.from(affectedTaskIds));
    await this.clearTasksNeedsReconcile(Array.from(affectedTaskIds));
    this.emit();
    return task;
  }

  private async syncTaskDocument(id: string): Promise<boolean> {
    const task = this.store.get(id);
    if (!task) {
      return false;
    }

    const metadataBlock = await findManagedTaskSummaryBlock(task.docId);
    if (!metadataBlock) {
      return await syncManagedTaskDescriptionSection(task, false);
    }

    const parent = task.parentId ? this.store.get(task.parentId) : undefined;
    const children = this.store.all().filter((item) => item.parentId === task.id);
    let synced = false;
    if (metadataBlock.format === "table") {
      const summaryHeading = await findHeadingBlock(task.docId, ["任务概要"]);
      if (summaryHeading) {
        await replaceManagedHeadingSection(
          task.docId,
          ["任务概要"],
          renderManagedTaskSummarySectionBody(
            renderTaskSummaryTable(metadataBlock.markdown || "", task, parent, children),
            buildTaskSummaryLabelLines(task, parent, children)
          ),
          { createIfMissing: false }
        );
      } else {
        await updateBlock(metadataBlock.id, renderTaskSummaryTable(metadataBlock.markdown || "", task, parent, children));
      }
    } else {
      await updateBlock(metadataBlock.id, renderTaskMetadataBlock(task, parent, children));
    }
    synced = true;
    synced = await syncManagedTaskDescriptionSection(task, synced);
    return synced;
  }

  private async syncTaskDocuments(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of Array.from(new Set(ids))) {
      if (await this.syncTaskDocument(id)) {
        count += 1;
      }
    }
    return count;
  }

  private async markTasksNeedsReconcile(ids: string[]): Promise<number> {
    return this.store.markNeedsReconcile(ids);
  }

  private async clearTasksNeedsReconcile(ids: string[]): Promise<number> {
    return this.store.clearNeedsReconcile(ids);
  }

  private async archiveCompletedParentTask(
    task: TaskItem,
    options: StructureTransactionOptions = {}
  ): Promise<TaskItem> {
    if (task.parentId) {
      return task;
    }

    const settings = this.store.getSettings();
    if (!settings.taskRootDocId || !settings.taskRootNotebookId) {
      return task;
    }

    const week = archiveWeek(task.completedAt || task.createdAt);
    const archivePath = await ensureArchiveWeekDoc(settings, week);
    const taskPath = await requireTaskPath(task.docId, `无法读取待归档任务路径：${task.title}`);
    if (isTaskUnderArchivePath(taskPath, archivePath)) {
      return task;
    }
    const subtreeIds = expandWithDescendants(this.store.all(), [task.id]);

    await this.runStructureTransaction(
      {
        rootTaskId: task.id,
        affectedTaskIds: subtreeIds
      },
      async () => {
        await moveDocs([taskPath], settings.taskRootNotebookId, archivePath);
      },
      options
    );
    const ids = expandWithDescendants(this.store.all(), [task.id]);
    const pathMap = await refreshTaskPaths(this.store, ids);
    let archivedTask = this.store.get(task.id) || task;
    const refreshed = pathMap.get(task.id);
    if (refreshed) {
      archivedTask = refreshed;
    }
    await this.syncTaskDocuments(ids);
    await this.clearTasksNeedsReconcile(ids);
    return archivedTask;
  }

  private async moveTaskToParent(task: TaskItem): Promise<TaskItem> {
    const settings = await this.getSettingsWithFreshRootPath();
    if (!settings.taskRootDocId || !settings.taskRootNotebookId) {
      return task;
    }

    const currentPath = await requireTaskPath(task.docId, `无法读取待移动任务路径：${task.title}`);

    let targetPath: string;
    if (task.parentId) {
      const parent = this.store.get(task.parentId);
      if (!parent) {
        return task;
      }
      const parentPath = await requireTaskPath(parent.docId, `无法读取父任务路径：${parent.title}`);
      targetPath = parentPath;
    } else {
      const rootPath = await requireTaskPath(settings.taskRootDocId, "无法读取事项库根文档路径");
      targetPath = rootPath;
    }

    const currentParentTaskPath = parentTaskPath(currentPath);
    if (currentParentTaskPath === targetPath) {
      return task;
    }

    await moveDocs([currentPath], task.notebookId, targetPath);

    const ids = expandWithDescendants(this.store.all(), [task.id]);
    const pathMap = await refreshTaskPaths(this.store, ids);
    const movedTask = pathMap.get(task.id) || this.store.get(task.id) || task;
    return movedTask;
  }

  private async collectTasksFromRoot(settings = this.store.getSettings()): Promise<CollectedTaskResult> {
    const candidates = await listTaskDocCandidates(settings);
    if (!candidates.length) {
      return { tasks: [], recoveredDocIds: [] };
    }

    const tasks: TaskItem[] = [];
    const taskByDocId = new Map<string, TaskItem>();
    const recoveredDocIds = new Set<string>();
    const legacySpecialContainerIds = collectLegacySpecialContainerDocIds(candidates, settings);
    const batchSize = 12;

    for (let start = 0; start < candidates.length; start += batchSize) {
      const batch = candidates.slice(start, start + batchSize);
      const batchTasks = await Promise.all(batch.map(async (doc) => {
        const attrs = await getBlockAttrs(doc.id).catch(() => ({}));
        const taskId = attrs[TASK_ATTRS.id]?.trim();
        if (legacySpecialContainerIds.has(doc.id) || isSpecialContainerDoc(doc, attrs, settings, taskId)) {
          return undefined;
        }
        if (!taskId) {
          recoveredDocIds.add(doc.id);
        }

        const task = taskFromDoc(doc, attrs);
        taskByDocId.set(doc.id, task);
        return task;
      }));

      for (const task of batchTasks) {
        if (task) {
          tasks.push(task);
        }
      }
    }

    for (const task of tasks) {
      if (task.parentId) {
        const parentById = tasks.find((candidate) => candidate.id === task.parentId || candidate.docId === task.parentId);
        if (parentById) {
          task.parentId = parentById.id;
          continue;
        }
      }
      const parent = parentTaskFromPath(task, taskByDocId);
      if (parent) {
        task.parentId = parent.id;
      }
    }

    return {
      tasks: tasks.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN")),
      recoveredDocIds: Array.from(recoveredDocIds)
    };
  }

  private async backfillRecoveredTaskAttrs(collected: CollectedTaskResult): Promise<void> {
    if (!collected.recoveredDocIds.length) {
      return;
    }
    const recoveredSet = new Set(collected.recoveredDocIds);
    const recoveredTasks = collected.tasks.filter((task) => recoveredSet.has(task.docId));
    const batchSize = 12;
    for (let start = 0; start < recoveredTasks.length; start += batchSize) {
      const batch = recoveredTasks.slice(start, start + batchSize);
      await Promise.all(batch.map((task) => setTaskAttrs(task)));
    }
  }

  private shouldRebuildIndex(options: {
    settings: TaskSettings;
    cacheMeta: ReturnType<TaskStore["getCacheMeta"]>;
    hasCacheTasks: boolean;
  }): boolean {
    const { settings, cacheMeta, hasCacheTasks } = options;
    if (!settings.taskRootDocId || !settings.taskRootPath || !settings.taskRootNotebookId) {
      return !hasCacheTasks;
    }
    if (!hasCacheTasks && !cacheMeta.lastRootDocId) {
      return true;
    }
    if (!cacheMeta || cacheMeta.corrupt) {
      return true;
    }
    if (cacheMeta.schemaVersion !== TASK_INDEX_SCHEMA_VERSION) {
      return true;
    }
    if (cacheMeta.lastRootDocId !== settings.taskRootDocId) {
      return true;
    }
    if (cacheMeta.lastRootPath !== settings.taskRootPath) {
      return true;
    }
    return false;
  }

  private async refreshIndexIncremental(options: { reason: "startup" | "sync-end"; forceWindow: boolean }): Promise<number> {
    const settings = this.store.getSettings();
    if (!settings.taskRootDocId || !settings.taskRootNotebookId || !settings.taskRootPath) {
      return 0;
    }
    const cacheMeta = this.store.getCacheMeta();
    const indexedById = new Map(this.store.all().map((task) => [task.id, task]));
    const indexedByDocId = new Map(this.store.all().map((task) => [task.docId, task]));
    const changedDocs = await this.listChangedTaskDocCandidates({
      settings,
      cacheMeta,
      forceWindow: options.forceWindow
    });

    if (!changedDocs.length) {
      return 0;
    }

    const nextTasks = [...this.store.all()];
    const reconcileCandidates = new Set<string>();
    let changedCount = 0;
    for (const doc of changedDocs) {
      const attrs = await getBlockAttrs(doc.id).catch(() => ({}));
      const taskId = attrs[TASK_ATTRS.id]?.trim();
      if (isSpecialContainerDoc(doc, attrs, settings, taskId)) {
        continue;
      }
      if (!taskId) {
        continue;
      }
      const recovered = taskFromDoc(doc, attrs);
      recovered.docUpdated = updatedToIso(doc.updated);
      const current = indexedById.get(taskId) || indexedByDocId.get(recovered.docId);
      if (!current) {
        nextTasks.push(recovered);
        indexedById.set(recovered.id, recovered);
        indexedByDocId.set(recovered.docId, recovered);
        this.collectReconcileCandidatesForExternalChange(reconcileCandidates, undefined, recovered);
        changedCount += 1;
        continue;
      }

      const merged = normalizeRecoveredTaskFromDoc(current, recovered);
      if (hasTaskMeaningfulDiff(current, merged)) {
        const idx = nextTasks.findIndex((task) => task.id === current.id);
        if (idx >= 0) {
          nextTasks[idx] = merged;
          indexedById.set(merged.id, merged);
          indexedByDocId.set(merged.docId, merged);
          this.collectReconcileCandidatesForExternalChange(reconcileCandidates, current, merged);
          changedCount += 1;
        }
      }
    }

    if (changedCount > 0) {
      for (const task of nextTasks) {
        if (reconcileCandidates.has(task.id)) {
          task.needsReconcile = true;
        }
      }
      await this.store.replaceAll(nextTasks, {
        lastRootDocId: settings.taskRootDocId,
        lastRootPath: settings.taskRootPath,
        lastDocUpdatedMax: maxDocUpdated(nextTasks),
        corrupt: false
      });
      this.emit();
    } else {
      await this.store.setCacheMeta({
        lastRootDocId: settings.taskRootDocId,
        lastRootPath: settings.taskRootPath,
        lastDocUpdatedMax: maxDocUpdated(this.store.all()),
        corrupt: false
      });
    }

    return changedCount;
  }

  private async listChangedTaskDocCandidates(options: {
    settings: TaskSettings;
    cacheMeta: ReturnType<TaskStore["getCacheMeta"]>;
    forceWindow: boolean;
  }): Promise<BlockRow[]> {
    const { settings, cacheMeta, forceWindow } = options;
    if (!settings.taskRootNotebookId || !settings.taskRootPath || !settings.taskRootDocId) {
      return [];
    }
    const rootPath = stripDocSuffix(settings.taskRootPath);
    const since = forceWindow
      ? toSiyuanUpdated(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      : (toSiyuanUpdated(cacheMeta.lastDocUpdatedMax)
        || toSiyuanUpdated(new Date(Date.now() - SYNC_INCREMENTAL_OVERLAP_MS).toISOString()));
    const rows = await sql<BlockRow>(`select id, box, path, content, hpath, updated from blocks
where box = '${sqlText(settings.taskRootNotebookId)}'
  and type = 'd'
  and id != '${sqlText(settings.taskRootDocId)}'
  and path like '${sqlText(rootPath)}/%'
  and updated >= '${sqlText(since)}'
order by updated asc, path asc`);
    return rows;
  }

  private async validateIndexedTasksExistence(limit: number): Promise<void> {
    const tasks = this.store.all()
      .sort((a, b) => (b.docUpdated || b.updatedAt || "").localeCompare(a.docUpdated || a.updatedAt || ""))
      .slice(0, Math.max(1, limit));
    if (!tasks.length) {
      return;
    }
    const missingIds: string[] = [];
    for (const task of tasks) {
      const block = await getBlockById(task.docId).catch(() => undefined);
      if (!block) {
        missingIds.push(task.id);
      }
    }
    if (!missingIds.length) {
      return;
    }
    const ids = expandWithDescendants(this.store.all(), missingIds);
    const parentIds = parentIdsForTasks(this.store.all(), ids);
    const removed = await this.store.removeMany(ids);
    if (removed > 0) {
      await this.markTasksNeedsReconcile(parentIds);
      this.emit();
    }
  }

  private collectReconcileCandidatesForExternalChange(
    target: Set<string>,
    previous: TaskItem | undefined,
    current: TaskItem
  ): void {
    target.add(current.id);
    if (current.parentId) {
      target.add(current.parentId);
    }
    if (previous?.parentId) {
      target.add(previous.parentId);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function normalizeTaskPatch(patch: Partial<TaskItem>): Partial<TaskItem> {
  const normalized = { ...patch };

  if ("title" in normalized && typeof normalized.title === "string") {
    normalized.title = normalized.title.trim();
  }
  if ("project" in normalized && typeof normalized.project === "string") {
    normalized.project = normalized.project.trim() || undefined;
  }
  if ("parentId" in normalized && normalized.parentId === "") {
    normalized.parentId = undefined;
  }
  if ("sourceBlockId" in normalized && normalized.sourceBlockId === "") {
    normalized.sourceBlockId = undefined;
  }
  if ("sourceDocId" in normalized && normalized.sourceDocId === "") {
    normalized.sourceDocId = undefined;
  }
  if ("sourceText" in normalized && typeof normalized.sourceText === "string") {
    normalized.sourceText = normalized.sourceText.trim() || undefined;
  }
  if ("description" in normalized && typeof normalized.description === "string") {
    normalized.description = normalized.description.trim() || undefined;
  }
  if ("dueDate" in normalized && normalized.dueDate === "") {
    normalized.dueDate = undefined;
  }
  if ("completedAt" in normalized && normalized.completedAt === "") {
    normalized.completedAt = undefined;
  }
  if ("planStart" in normalized && normalized.planStart === "") {
    normalized.planStart = undefined;
  }
  if ("planEnd" in normalized && normalized.planEnd === "") {
    normalized.planEnd = undefined;
  }
  if ("createdAt" in normalized && normalized.createdAt === "") {
    normalized.createdAt = undefined;
  }

  return normalized;
}

function normalizeCompletion(current: TaskItem, patch: Partial<TaskItem>): Partial<TaskItem> {
  if (patch.status === "completed") {
    if (current.status !== "completed") {
      return { ...patch, completedAt: patch.completedAt || nowIso() };
    }
    return { ...patch, completedAt: patch.completedAt ?? current.completedAt };
  }
  if (current.status === "completed") {
    if (patch.status) {
      return { ...patch, completedAt: undefined };
    }
  }
  return patch;
}

function collectTaskTreeIds(tasks: TaskItem[], rootId: string): string[] {
  return expandWithDescendants(tasks, [rootId]);
}

function expandWithDescendants(tasks: TaskItem[], ids: string[]): string[] {
  const selected = new Set(ids);
  let changed = true;

  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (task.parentId && selected.has(task.parentId) && !selected.has(task.id)) {
        selected.add(task.id);
        changed = true;
      }
    }
  }

  return Array.from(selected);
}

function expandWithDescendantsAndPaths(tasks: TaskItem[], ids: string[]): string[] {
  const selected = new Set(expandWithDescendants(tasks, ids));
  let changed = true;

  while (changed) {
    changed = false;
    const selectedPaths = tasks
      .filter((task) => selected.has(task.id))
      .map((task) => taskPathKey(task.path))
      .filter(Boolean);

    for (const task of tasks) {
      if (selected.has(task.id)) {
        continue;
      }
      const path = taskPathKey(task.path);
      if (path && selectedPaths.some((parentPath) => isDescendantPath(path, parentPath))) {
        selected.add(task.id);
        changed = true;
      }
    }
  }

  return Array.from(selected);
}

async function deleteTaskDocuments(tasks: TaskItem[]): Promise<void> {
  const documents = await resolveTaskDocuments(tasks);
  const topLevelDocs = documents.filter((doc) => doc.exists && !documents.some((other) => {
    if (other.taskId === doc.taskId || other.notebookId !== doc.notebookId) {
      return false;
    }
    return other.exists && other.key ? isDescendantPath(doc.key, other.key) : false;
  }));

  for (const doc of topLevelDocs) {
    await removeDoc(doc.notebookId, doc.path).catch(async (error) => {
      if (!await taskDocumentExists(doc.docId)) {
        return;
      }
      throw error;
    });
  }

  await waitForTaskDocumentsRemoved(documents.map((doc) => doc.docId));
}

async function resolveTaskDocuments(tasks: TaskItem[]): Promise<Array<{ taskId: string; docId: string; title: string; notebookId: string; path: string; key: string; exists: boolean }>> {
  const documents: Array<{ taskId: string; docId: string; title: string; notebookId: string; path: string; key: string; exists: boolean }> = [];
  for (const task of tasks) {
    const block = await getBlockById(task.docId).catch(() => undefined);
    if (!block) {
      documents.push({
        taskId: task.id,
        docId: task.docId,
        title: task.title,
        notebookId: task.notebookId,
        path: task.path,
        key: taskPathKey(task.path),
        exists: false
      });
      continue;
    }
    if (!block.box || !block.path) {
      throw new Error(`无法读取任务文档路径：${task.title}`);
    }
    const key = taskPathKey(block.path);
    if (!key) {
      throw new Error(`无法读取任务文档路径：${task.title}`);
    }
    documents.push({ taskId: task.id, docId: task.docId, title: task.title, notebookId: block.box, path: block.path, key, exists: true });
  }
  return documents;
}

async function waitForTaskDocumentsRemoved(docIds: string[]): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const exists = await Promise.all(docIds.map(taskDocumentExists));
    if (exists.every((value) => !value)) {
      return;
    }
    await delay(80);
  }
}

async function taskDocumentExists(docId: string): Promise<boolean> {
  return Boolean(await getBlockById(docId).catch(() => undefined));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function defaultEditorId(): string {
  return SESSION_EDITOR_ID;
}

function defaultOpId(): string {
  return newSiyuanId();
}

function isDescendantPath(path: string, parentPath: string): boolean {
  return path.startsWith(`${parentPath}/`);
}

function parentIdsForTasks(tasks: TaskItem[], ids: string[]): string[] {
  const idSet = new Set(ids);
  return Array.from(new Set(tasks.filter((task) => idSet.has(task.id) && task.parentId).map((task) => task.parentId as string)));
}

async function listTaskDocCandidates(settings: TaskSettings): Promise<BlockRow[]> {
  if (!settings.taskRootNotebookId || !settings.taskRootPath || !settings.taskRootDocId) {
    return [];
  }

  const rootPath = stripDocSuffix(settings.taskRootPath);
  const rows = await sql<BlockRow>(`select id, box, path, content, hpath, updated from blocks
where box = '${sqlText(settings.taskRootNotebookId)}'
  and type = 'd'
  and id != '${sqlText(settings.taskRootDocId)}'
  and path like '${sqlText(rootPath)}/%'
order by path asc`);
  return rows;
}

function taskFromDoc(doc: BlockRow, attrs: Record<string, string>): TaskItem {
  const status = normalizeTaskStatus(attrs[TASK_ATTRS.status]);
  const priority = normalizeTaskPriority(attrs[TASK_ATTRS.priority]);
  const sourceText = attrs[TASK_ATTRS.sourceText]?.trim() || undefined;
  return {
    id: attrs[TASK_ATTRS.id] || doc.id,
    title: normalizeRecoveredTitle(doc),
    docId: doc.id,
    notebookId: doc.box,
    path: doc.path,
    parentId: attrs[TASK_ATTRS.parentId] || undefined,
    sourceBlockId: attrs[TASK_ATTRS.sourceBlockId] || undefined,
    sourceDocId: attrs[TASK_ATTRS.sourceDocId] || undefined,
    sourceText,
    project: attrs[TASK_ATTRS.project]?.trim() || undefined,
    priority,
    status,
    dueDate: attrs[TASK_ATTRS.dueDate] || undefined,
    planStart: attrs[TASK_ATTRS.planStart] || undefined,
    planEnd: attrs[TASK_ATTRS.planEnd] || undefined,
    createdAt: attrs[TASK_ATTRS.createdAt] || updatedToIso(doc.updated) || nowIso(),
    updatedAt: updatedToIso(doc.updated) || nowIso(),
    completedAt: attrs[TASK_ATTRS.completedAt] || undefined,
    description: attrs[TASK_ATTRS.description]?.trim() || undefined,
    taskRevision: parseTaskRevision(attrs[TASK_ATTRS.taskRevision]),
    taskLastEditedAt: attrs[TASK_ATTRS.taskLastEditedAt] || updatedToIso(doc.updated) || nowIso(),
    taskLastEditedBy: attrs[TASK_ATTRS.taskLastEditedBy] || undefined,
    taskLastOpId: attrs[TASK_ATTRS.taskLastOpId] || undefined,
    docUpdated: updatedToIso(doc.updated)
  };
}

function normalizeRecoveredTitle(doc: BlockRow): string {
  const title = doc.content?.trim();
  if (title) {
    return stripTaskTitlePrefix(title);
  }
  const fromPath = doc.path.split("/").pop()?.replace(/\.sy$/i, "").trim();
  if (!fromPath) {
    return doc.id;
  }
  const normalized = stripTaskTitlePrefix(fromPath);
  return normalized || fromPath;
}

function stripTaskTitlePrefix(value: string): string {
  return value.replace(/^\d{4}-/u, "").trim();
}

function normalizeTaskStatus(value?: string): TaskItem["status"] {
  switch (value) {
    case "doing":
    case "waiting":
    case "completed":
    case "cancelled":
    case "todo":
      return value;
    default:
      return "todo";
  }
}

function normalizeTaskPriority(value?: string): TaskItem["priority"] {
  switch (value) {
    case "none":
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      return "medium";
  }
}

function updatedToIso(value?: string): string | undefined {
  if (!value || !/^\d{14}$/.test(value)) {
    return undefined;
  }
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(8, 10);
  const minute = value.slice(10, 12);
  const second = value.slice(12, 14);
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toSiyuanUpdated(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseTaskRevision(value?: string): number {
  const n = Number(value || "0");
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

function parentTaskFromPath(task: TaskItem, byDocId: Map<string, TaskItem>): TaskItem | undefined {
  const parentPath = parentTaskPath(task.path);
  if (!parentPath) {
    return undefined;
  }
  for (const candidate of byDocId.values()) {
    if (task.docId !== candidate.docId && candidate.path === parentPath) {
      return candidate;
    }
  }
  return undefined;
}

function parentTaskPath(path?: string): string | undefined {
  const parentContainer = docParentContainerPath(path);
  if (!parentContainer || parentContainer === "/") {
    return undefined;
  }
  if (parentContainer.endsWith(".sy")) {
    return normalizeHPath(parentContainer);
  }
  return normalizeHPath(`${parentContainer}.sy`);
}

function mergeRecoveredTasks(currentTasks: TaskItem[], recoveredTasks: TaskItem[]): TaskItem[] {
  const merged = [...currentTasks];
  const currentIds = new Set(currentTasks.map((task) => task.id));
  for (const task of recoveredTasks) {
    if (!currentIds.has(task.id)) {
      merged.push(task);
    }
  }
  return merged.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
}

function normalizeRecoveredTaskFromDoc(current: TaskItem, recovered: TaskItem): TaskItem {
  return {
    ...current,
    ...recovered,
    needsReconcile: current.needsReconcile || recovered.needsReconcile
  };
}

function hasTaskMeaningfulDiff(a: TaskItem, b: TaskItem): boolean {
  const keys: Array<keyof TaskItem> = [
    "title",
    "path",
    "parentId",
    "sourceBlockId",
    "sourceDocId",
    "sourceText",
    "project",
    "priority",
    "status",
    "dueDate",
    "planStart",
    "planEnd",
    "createdAt",
    "updatedAt",
    "completedAt",
    "description",
    "taskRevision",
    "taskLastEditedAt",
    "taskLastEditedBy",
    "taskLastOpId",
    "docUpdated"
  ];
  return keys.some((key) => a[key] !== b[key]);
}

function maxDocUpdated(tasks: TaskItem[]): string | undefined {
  const values = tasks.map((task) => task.docUpdated || task.updatedAt).filter(Boolean);
  if (!values.length) {
    return undefined;
  }
  return values.sort().at(-1);
}

async function resolveParentHPath(settings: TaskSettings, parent?: TaskItem): Promise<string> {
  if (parent?.docId) {
    const parentHPath = await getHPathById(parent.docId).catch(() => "");
    if (parentHPath) {
      return normalizeHPath(parentHPath);
    }
    return stripDocSuffix(parent.path || "/");
  }

  if (settings.taskRootDocId) {
    const rootHPath = await getHPathById(settings.taskRootDocId).catch(() => "");
    if (rootHPath) {
      return normalizeHPath(rootHPath);
    }
  }

  return normalizeHPath(settings.taskRootHPath || settings.taskRootTitle || stripDocSuffix(settings.taskRootPath || "/"));
}

async function createTaskDocWithTitle(
  notebookId: string,
  parentHPath: string,
  title: string,
  markdown: string
): Promise<{ docId: string }> {
  const baseName = sanitizeDocName(title);
  const parent = normalizeHPath(parentHPath);
  let lastError: unknown;

  for (let index = 0; index < 50; index += 1) {
    const name = index === 0 ? baseName : `${baseName} (${index + 1})`;
    const path = `${parent === "/" ? "" : parent}/${name}.sy`;
    try {
      const docId = await createDocWithMd(notebookId, path, markdown);
      return { docId };
    } catch (error) {
      lastError = error;
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      if (message.includes("exist") || message.includes("已存在") || message.includes("duplicate")) {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("创建任务文档失败");
}

function taskDocumentTitle(task: Pick<TaskItem, "createdAt" | "title">): string {
  const dateKey = toDateKey(task.createdAt) || toDateKey(nowIso());
  const prefix = dateKey.slice(5).replace("-", "");
  return `${prefix}-${task.title}`;
}

async function getTaskPath(docId: string): Promise<string | undefined> {
  const block = await getBlockById(docId).catch(() => undefined);
  return block?.path;
}

async function getDocPathByHPath(notebookId: string, hpath: string): Promise<string | undefined> {
  const rows = await sql<{ id: string; path?: string }>(`select id, path from blocks
where box = '${sqlText(notebookId)}'
  and type = 'd'
  and hpath = '${sqlText(normalizeHPath(hpath))}'
limit 1`).catch(() => []);
  return rows[0]?.path;
}

async function ensureArchiveDoc(settings: TaskSettings, parentHPath: string, name: string): Promise<string> {
  if (!settings.taskRootNotebookId) {
    throw new Error("请先将一个文档设为事项库");
  }

  const docHPath = `${parentHPath === "/" ? "" : parentHPath}/${name}`;
  const existingPath = await getDocPathByHPath(settings.taskRootNotebookId, docHPath);
  if (existingPath) {
    return existingPath;
  }

  const path = `${docHPath}.sy`;
  try {
    const docId = await createDocWithMd(settings.taskRootNotebookId, path, `# ${name}\n`);
    const blockPath = await getTaskPath(docId);
    return blockPath || path;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).toLowerCase();
    if (!message.includes("exist") && !message.includes("已存在") && !message.includes("duplicate")) {
      throw error;
    }
    return await getDocPathByHPath(settings.taskRootNotebookId, docHPath) || path;
  }
}

async function ensureArchiveRootDoc(settings: TaskSettings): Promise<string> {
  const rootHPath = await resolveParentHPath(settings);
  const archivePath = await ensureArchiveDoc(settings, rootHPath, "已完成");
  await markContainerDocKindByHPath(settings, `${rootHPath === "/" ? "" : rootHPath}/已完成`, ARCHIVE_ROOT_KIND);
  return archivePath;
}

async function ensureArchiveWeekDoc(settings: TaskSettings, week: string): Promise<string> {
  const rootHPath = await resolveParentHPath(settings);
  const archiveHPath = normalizeHPath(`${rootHPath === "/" ? "" : rootHPath}/已完成`);
  await ensureArchiveRootDoc(settings);
  const weekPath = await ensureArchiveDoc(settings, archiveHPath, week);
  await markContainerDocKindByHPath(settings, `${archiveHPath === "/" ? "" : archiveHPath}/${week}`, ARCHIVE_WEEK_KIND);
  return weekPath;
}

interface WeeklyReportRootRef {
  hpath: string;
  path: string;
}

async function ensureWeeklyReportRoot(settings: TaskSettings): Promise<WeeklyReportRootRef> {
  const rootHPath = await resolveParentHPath(settings);
  const reportRootHPath = normalizeHPath(`${rootHPath === "/" ? "" : rootHPath}/周报`);
  const path = await ensureArchiveDoc(settings, rootHPath, "周报");
  await markContainerDocKindByHPath(settings, reportRootHPath, WEEKLY_REPORT_ROOT_KIND);
  return {
    hpath: reportRootHPath,
    path
  };
}

async function createWeeklyReportDoc(
  notebookId: string,
  parentHPath: string,
  title: string,
  markdown: string
): Promise<{ docId: string; path: string }> {
  const baseName = sanitizeDocName(title);
  const parent = normalizeHPath(parentHPath);
  let lastError: unknown;

  for (let index = 0; index < 50; index += 1) {
    const name = index === 0 ? baseName : `${baseName} (${index + 1})`;
    const hpath = `${parent === "/" ? "" : parent}/${name}`;
    try {
      const docId = await createDocWithMd(notebookId, `${hpath}.sy`, markdown);
      const path = await getTaskPath(docId);
      return { docId, path: path || `${hpath}.sy` };
    } catch (error) {
      lastError = error;
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      if (message.includes("exist") || message.includes("已存在") || message.includes("duplicate")) {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("创建周报文档失败");
}

async function getDocRefByHPath(notebookId: string, hpath: string): Promise<{ id: string; path: string } | undefined> {
  const rows = await sql<{ id: string; path: string }>(`select id, path from blocks
where box = '${sqlText(notebookId)}'
  and type = 'd'
  and hpath = '${sqlText(normalizeHPath(hpath))}'
limit 1`).catch(() => []);
  return rows[0];
}

async function readDocMarkdown(docId: string): Promise<string> {
  try {
    const markdown = await getDocMarkdown(docId);
    if (markdown.trim()) {
      return markdown;
    }
  } catch {
    // fall through to block markdown
  }
  const block = await getBlockById(docId).catch(() => undefined);
  return block?.markdown || "";
}

async function markWeeklyReportDoc(docId: string): Promise<void> {
  await setBlockAttrs(docId, {
    [REPORT_ATTRS.kind]: WEEKLY_REPORT_KIND
  });
}

async function markContainerDocKindByHPath(settings: TaskSettings, hpath: string, kind: string): Promise<void> {
  if (!settings.taskRootNotebookId) {
    return;
  }
  const doc = await getDocRefByHPath(settings.taskRootNotebookId, hpath).catch(() => undefined);
  if (!doc?.id) {
    return;
  }
  await setBlockAttrs(doc.id, {
    [REPORT_ATTRS.kind]: kind
  }).catch(() => undefined);
}

function collectLegacySpecialContainerDocIds(candidates: BlockRow[], settings: TaskSettings): Set<string> {
  const result = new Set<string>();
  const rootDocPath = settings.taskRootPath ? normalizeHPath(settings.taskRootPath) : undefined;
  if (!rootDocPath) {
    return result;
  }

  let archiveRootPath: string | undefined;
  let reportRootPath: string | undefined;

  for (const doc of candidates) {
    const title = doc.content?.trim();
    if (!title || parentTaskPath(doc.path) !== rootDocPath) {
      continue;
    }
    if (title === "已完成") {
      archiveRootPath = normalizeHPath(doc.path);
      result.add(doc.id);
      continue;
    }
    if (title === "周报") {
      reportRootPath = normalizeHPath(doc.path);
      result.add(doc.id);
    }
  }

  for (const doc of candidates) {
    const normalizedPath = normalizeHPath(doc.path);
    const title = doc.content?.trim() || "";
    if (reportRootPath && isDescendantPath(stripDocSuffix(normalizedPath), stripDocSuffix(reportRootPath))) {
      result.add(doc.id);
      continue;
    }
    if (archiveRootPath && parentTaskPath(normalizedPath) === archiveRootPath && /^\d{4}-\d{2}(?:-\d{2})?$/.test(title)) {
      result.add(doc.id);
    }
  }

  return result;
}

function isSpecialContainerDoc(
  doc: Pick<BlockRow, "hpath">,
  attrs: Record<string, string>,
  settings: TaskSettings,
  taskId?: string
): boolean {
  const kind = attrs[REPORT_ATTRS.kind];
  if (kind === WEEKLY_REPORT_KIND || kind === WEEKLY_REPORT_ROOT_KIND || kind === ARCHIVE_ROOT_KIND || kind === ARCHIVE_WEEK_KIND) {
    return true;
  }

  const docHPath = normalizeHPath(doc.hpath || "");
  if (!docHPath || docHPath === "/") {
    return false;
  }

  const rootHPath = normalizeHPath(settings.taskRootHPath || settings.taskRootTitle || "");
  if (!rootHPath || rootHPath === "/") {
    return false;
  }

  const reportRoot = normalizeHPath(`${rootHPath}/周报`);
  if (docHPath === reportRoot || docHPath.startsWith(`${reportRoot}/`)) {
    return true;
  }

  const archiveRoot = normalizeHPath(`${rootHPath}/已完成`);
  if (docHPath === archiveRoot) {
    return true;
  }

  if (docHPath.startsWith(`${archiveRoot}/`) && !taskId) {
    return true;
  }

  return false;
}

function archiveWeek(value?: string): string {
  return weekKey(value || nowIso());
}

function isTaskUnderArchivePath(taskPath: string, archivePath: string): boolean {
  const archiveKey = taskPathKey(archivePath);
  const taskKey = taskPathKey(taskPath);
  return Boolean(archiveKey && taskKey.startsWith(`${archiveKey}/`));
}

function taskPathKey(path?: string): string {
  return (path || "").replace(/\.sy$/i, "").replace(/\/+$/g, "").replace(/^\/+/, "");
}

function sanitizeDocName(value: string): string {
  const name = value
    .replace(/[\\/:*?"<>|#\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || "未命名任务";
}

function normalizeHPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function stripDocSuffix(path: string): string {
  const withoutSuffix = path.endsWith(".sy") ? path.slice(0, -3) : path;
  return normalizeHPath(withoutSuffix);
}

function docContainerPath(path: string): string {
  return stripDocSuffix(path);
}

function docParentContainerPath(path?: string): string {
  const normalized = normalizeHPath(path || "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return "/";
  }
  return normalizeHPath(normalized.slice(0, lastSlash));
}

function renderTaskMarkdown(
  task: TaskItem,
  parent?: TaskItem,
  children: TaskItem[] = [],
  settings: TaskSettings = {},
  detail?: string
): string {
  const template = settings.taskTemplate?.trim() || DEFAULT_TASK_TEMPLATE;
  const markdown = renderTemplate(template, task, parent, children);
  return rewriteTaskDetail(markdown, detail || "");
}

function renderTemplate(template: string, task: TaskItem, parent?: TaskItem, children: TaskItem[] = []): string {
  const replacements: Record<string, string> = {
    title: escapeMd(task.title),
    source: task.sourceBlockId ? blockRef(task.sourceBlockId, task.sourceText || "来源") : "手动创建",
    parent: parent ? blockRef(parent.docId, parent.title) : "无",
    project: task.project || "未设置",
    status: TASK_STATUS_LABELS[task.status],
    priority: TASK_PRIORITY_LABELS[task.priority],
    dueDate: formatTaskDate(task.dueDate),
    planStart: formatTaskDate(task.planStart),
    planEnd: formatTaskDate(task.planEnd),
    childTasks: renderChildRefs(children, "inline"),
    childTaskList: renderChildRefs(children, "list"),
    description: task.description || "无",
    createdAt: formatTaskDate(task.createdAt),
    updatedAt: formatTaskDate(task.updatedAt)
  };

  return `${template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => replacements[key] ?? "")}\n`;
}

function renderTaskMetadataBlock(task: TaskItem, parent?: TaskItem, children: TaskItem[] = []): string {
  const sourceRef = task.sourceBlockId ? blockRef(task.sourceBlockId, task.sourceText || "来源") : "手动创建";
  const parentRef = parent ? blockRef(parent.docId, parent.title) : "无";

  return `> 来源：${sourceRef}
> 父任务：${parentRef}
> 项目：${task.project || "未设置"}
> 状态：${TASK_STATUS_LABELS[task.status]}
> 优先级：${TASK_PRIORITY_LABELS[task.priority]}
> 任务描述：${task.description || "无"}
> 创建时间：${formatTaskDate(task.createdAt)}
> 完成时间：${formatTaskDate(task.completedAt)}
> 截止时间：${formatTaskDate(task.dueDate)}
> 计划时间：${formatTaskDate(task.planStart)}
> 子任务：${renderChildRefs(children, "inline")}
`;
}

function escapeMd(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function blockRef(id: string, text: string): string {
  return `((${id} "${escapeMd(text).replace(/"/g, "'")}"))`;
}

function renderChildRefs(children: TaskItem[], mode: "inline" | "list"): string {
  if (!children.length) {
    return "无";
  }

  const refs = children.map((task) => blockRef(task.docId, task.title));
  if (mode === "list") {
    return refs.map((ref) => `- ${ref}`).join("\n");
  }
  return refs.join("、");
}

function formatTaskDate(value?: string): string {
  return formatLocalDateTimeOrEmpty(value) || "未设置";
}

function buildTaskDetailSection(detail: string): string {
  const body = normalizeTaskDetailBody(detail);
  return `## ${TASK_DETAIL_HEADING}\n${body ? `\n${body}\n` : "\n"}`;
}

function extractTaskDetail(markdown: string): string {
  const section = findTaskDetailSection(markdown);
  if (!section) {
    return "";
  }
  return normalizeTaskDetailBody(markdown.slice(section.bodyStart, section.nextHeadingStart));
}

function rewriteTaskDetail(markdown: string, detail: string): string {
  const normalizedMarkdown = markdown.replace(/\s+$/u, "");
  const nextSection = buildTaskDetailSection(detail);
  const section = findTaskDetailSection(normalizedMarkdown);
  if (!section) {
    return `${normalizedMarkdown}\n\n${nextSection}`.trimStart() + "\n";
  }
  const before = normalizedMarkdown.slice(0, section.headingStart).replace(/\s+$/u, "");
  const after = normalizedMarkdown.slice(section.nextHeadingStart).replace(/^\s*/u, "");
  return `${before}\n\n${nextSection}${after ? `\n\n${after}` : ""}`.trimStart() + "\n";
}

function normalizeTaskDetailBody(value: string): string {
  return truncateTaskDetailDirtyTail(value)
    .replace(/^\n+/u, "")
    .replace(/\s+$/u, "");
}

function truncateTaskDetailDirtyTail(value: string): string {
  const footnoteStart = /(?:^|\n)\[\^[^\]]+\]:\s+/m.exec(value)?.index;
  return footnoteStart === undefined ? value : value.slice(0, footnoteStart);
}

function findTaskDetailSection(markdown: string): { headingStart: number; bodyStart: number; nextHeadingStart: number } | undefined {
  const sections = findNamedSectionBounds(markdown, TASK_DETAIL_HEADING, []);
  if (sections.length !== 1) {
    return undefined;
  }
  const [section] = sections;
  return section;
}

function buildWeeklyReportMarkdown(title: string, itemsBody: string, summaryBody: string, planBody: string): string {
  const normalizedSummary = normalizeSectionBody(summaryBody);
  const normalizedPlan = normalizeSectionBody(planBody);
  return `# ${title}

## 一、本周工作事项
${itemsBody}

## 二、本周工作总结
${normalizedSummary}${normalizedSummary ? "\n" : ""}

## 三、下周工作计划
${normalizedPlan}${normalizedPlan ? "\n" : ""}`.trimEnd() + "\n";
}

function renderWeeklyReportItemsBody(week: string, tasks: TaskItem[]): string {
  const weekStart = startOfWeek(new Date(`${week}T00:00:00`));
  const groups = new Map<string, TaskItem[]>();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset);
    groups.set(toDateKey(day.toISOString()), []);
  }
  for (const task of tasks) {
    const key = toDateKey(task.completedAt || task.createdAt);
    if (!key || !groups.has(key)) {
      continue;
    }
    groups.get(key)?.push(task);
  }
  return WEEKDAY_LABELS.map((label, index) => {
    const day = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index);
    const key = toDateKey(day.toISOString());
    const refs = (groups.get(key) || []).map((task) => `- ${blockRef(task.docId, task.title)}`).join("\n");
    return `### ${label}\n${refs}`.trimEnd();
  }).join("\n\n");
}

function rewriteWeeklyReportMarkdown(markdown: string, title: string, itemsBody: string): string {
  const report = parseWeeklyReportSections(markdown);
  return buildWeeklyReportMarkdown(title, itemsBody, report.summaryBody, report.planBody);
}

function parseWeeklyReportSections(markdown: string): { summaryBody: string; planBody: string } {
  const summaryBody = extractWeeklyReportSectionBody(markdown, ["二、本周工作总结", "本周工作总结"], ["三、下周工作计划", "下周工作计划"]);
  const planBody = extractWeeklyReportSectionBody(markdown, ["三、下周工作计划", "下周工作计划"], []);
  return { summaryBody, planBody };
}

function extractWeeklyReportSectionBody(markdown: string, headings: string[], nextHeadings: string[]): string {
  for (const heading of headings) {
    const sections = findNamedSectionBounds(markdown, heading, nextHeadings);
    if (sections.length === 1) {
      const section = sections[0];
      return normalizeSectionBody(markdown.slice(section.bodyStart, section.nextHeadingStart));
    }
  }
  return "";
}

function normalizeSectionBody(value: string): string {
  return truncateWeeklyReportDirtyTail(value)
    .replace(/^---\n[\s\S]*?\n---\n*/m, "")
    .replace(/^# .*$/gm, "")
    .replace(/^\[\^.+?\]:.*$/gm, "")
    .trim();
}

function truncateWeeklyReportDirtyTail(value: string): string {
  const taskMetadataStart = /(?:^|\n)(?:>\s*)?来源：[^\n]*(?:\n(?:>\s*)?父任务：[^\n]*)?(?:\n(?:>\s*)?项目：[^\n]*)?(?:\n(?:>\s*)?状态：[^\n]*)?/m.exec(value)?.index;
  const taskSummaryTableStart = /(?:^|\n)\|\s*项目\s*\|[^\n]*\|\s*来源\s*\|/m.exec(value)?.index;
  const starts = [taskMetadataStart, taskSummaryTableStart].filter((index): index is number => index !== undefined);
  if (!starts.length) {
    return value;
  }
  return value.slice(0, Math.min(...starts));
}

function findNamedSectionBounds(markdown: string, heading: string, nextHeadings: string[]): Array<{ headingStart: number; bodyStart: number; nextHeadingStart: number }> {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^## ${escapedHeading}$`, "gm");
  const matches = Array.from(markdown.matchAll(regex));
  return matches.map((match) => {
    const headingStart = match.index || 0;
    const headingEnd = headingStart + match[0].length;
    const bodyStart = headingEnd < markdown.length && markdown[headingEnd] === "\n" ? headingEnd + 1 : headingEnd;
    const nextHeadingStart = findNextWeeklyReportSectionStart(markdown, bodyStart, nextHeadings);
    return {
      headingStart,
      bodyStart,
      nextHeadingStart
    };
  });
}

function findNextWeeklyReportSectionStart(markdown: string, bodyStart: number, nextHeadings: string[]): number {
  const candidates = nextHeadings
    .map((heading) => findNamedHeadingStart(markdown, heading, bodyStart))
    .filter((index): index is number => index !== undefined);
  if (candidates.length) {
    return Math.min(...candidates);
  }

  const unexpectedReportSection = /^## (?:一、本周工作事项|本周工作事项|二、本周工作总结|本周工作总结|三、下周工作计划|下周工作计划)$/gm;
  unexpectedReportSection.lastIndex = bodyStart;
  const next = unexpectedReportSection.exec(markdown);
  return next?.index ?? markdown.length;
}

function findNamedHeadingStart(markdown: string, heading: string, fromIndex: number): number | undefined {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^## ${escapedHeading}$`, "gm");
  regex.lastIndex = fromIndex;
  return regex.exec(markdown)?.index;
}

function compareWeeklyReportTaskOrder(a: TaskItem, b: TaskItem): number {
  return (a.completedAt || a.createdAt || "").localeCompare(b.completedAt || b.createdAt || "")
    || (a.createdAt || "").localeCompare(b.createdAt || "")
    || a.title.localeCompare(b.title, "zh-Hans-CN");
}

type ManagedTaskSummaryBlock = {
  id: string;
  format: "quote" | "table";
  markdown?: string;
  content?: string;
};

type TaskSummaryValueMap = {
  项目: string;
  状态: string;
  来源: string;
  优先级: string;
  任务描述: string;
  创建时间: string;
  完成时间: string;
  截止时间: string;
  计划时间: string;
  父任务: string;
  子任务: string;
};

function buildTaskSummaryValueMap(task: TaskItem, parent?: TaskItem, children: TaskItem[] = []): TaskSummaryValueMap {
  const sourceRef = task.sourceBlockId ? blockRef(task.sourceBlockId, task.sourceText || "来源") : "手动创建";
  const parentRef = parent ? blockRef(parent.docId, parent.title) : "无";
  return {
    项目: task.project || "未设置",
    状态: TASK_STATUS_LABELS[task.status],
    来源: sourceRef,
    优先级: TASK_PRIORITY_LABELS[task.priority],
    任务描述: task.description || "无",
    创建时间: formatTaskDate(task.createdAt),
    完成时间: formatTaskDate(task.completedAt),
    截止时间: formatTaskDate(task.dueDate),
    计划时间: formatTaskDate(task.planStart),
    父任务: parentRef,
    子任务: renderChildRefs(children, "inline")
  };
}

function buildTaskSummaryLabelLines(task: TaskItem, parent?: TaskItem, children: TaskItem[] = []): string[] {
  const values = buildTaskSummaryValueMap(task, parent, children);
  return [
    `**父任务** ：${values["父任务"]}`,
    `**子任务** ：${values["子任务"]}`,
    `**任务描述** ：${values["任务描述"]}`
  ];
}

function renderManagedTaskSummarySectionBody(tableMarkdown: string, lines: string[]): string {
  const normalizedTable = tableMarkdown.replace(/\s+$/u, "");
  const normalizedLines = lines.map((line) => line.trim()).filter(Boolean);
  return [
    normalizedTable,
    "",
    ...normalizedLines,
    "",
    "---"
  ].join("\n");
}

async function requireTaskPath(docId: string, errorMessage: string, retries = 4): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const path = await getTaskPath(docId);
    if (path) {
      return path;
    }
    if (attempt < retries - 1) {
      await delay(80);
    }
  }
  throw new Error(errorMessage);
}

async function refreshTaskPaths(store: TaskStore, ids: string[]): Promise<Map<string, TaskItem>> {
  const updated = new Map<string, TaskItem>();
  for (const id of ids) {
    const current = store.get(id);
    if (!current) {
      continue;
    }
    const path = await getTaskPath(current.docId);
    if (!path || path === current.path) {
      continue;
    }
    updated.set(id, await store.update(id, { path }));
  }
  return updated;
}

function renderTaskSummaryTable(markdown: string, task: TaskItem, parent?: TaskItem, children: TaskItem[] = []): string {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\|/.test(line) && line.includes("来源"));
  if (headerIndex === -1 || headerIndex + 2 >= lines.length) {
    return markdown;
  }
  let headerCells = parseMarkdownTableRow(lines[headerIndex]);
  let alignCells = parseMarkdownTableRow(lines[headerIndex + 1]);
  const dataStart = headerIndex + 2;
  let dataLines = lines.slice(dataStart);

  if (!headerCells.includes("完成时间")) {
    const insertAfter = headerCells.indexOf("创建时间");
    const insertBefore = headerCells.indexOf("截止时间");
    let insertAt: number;
    if (insertAfter >= 0) {
      insertAt = insertAfter + 1;
    } else if (insertBefore >= 0) {
      insertAt = insertBefore;
    } else {
      insertAt = headerCells.length;
    }
    headerCells = [...headerCells.slice(0, insertAt), "完成时间", ...headerCells.slice(insertAt)];
    if (alignCells.length >= insertAt) {
      alignCells = [...alignCells.slice(0, insertAt), "---", ...alignCells.slice(insertAt)];
    }
    const values = buildTaskSummaryValueMap(task, parent, children);
    dataLines = dataLines.map((line) => {
      if (!/^\|/.test(line)) {
        return line;
      }
      const cells = parseMarkdownTableRow(line);
      if (cells.length === 0) {
        return line;
      }
      const completedAtValue = values["完成时间"] ?? "";
      const newCells = [...cells.slice(0, insertAt), completedAtValue, ...cells.slice(insertAt)];
      return `| ${newCells.join(" | ")} |`;
    });
    lines[headerIndex] = `| ${headerCells.join(" | ")} |`;
    lines[headerIndex + 1] = `| ${alignCells.join(" | ")} |`;
    for (let i = 0; i < dataLines.length && dataStart + i < lines.length; i++) {
      lines[dataStart + i] = dataLines[i];
    }
  }

  const values = buildTaskSummaryValueMap(task, parent, children);
  const nextRow = headerCells.map((cell) => values[cell as keyof TaskSummaryValueMap] ?? "");
  lines[dataStart] = `| ${nextRow.join(" | ")} |`;

  const alignmentLine = lines[headerIndex + 1];
  if (!/^\|/.test(alignmentLine)) {
    return markdown;
  }
  return lines.join("\n");
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTaskSummaryTable(markdown?: string, content?: string): boolean {
  const text = `${markdown || ""}\n${content || ""}`;
  return text.includes("| 来源 ") || text.includes("|来源|") || text.includes("| 来源|") || text.includes("|来源 |");
}

async function findManagedTaskSummaryBlock(docId: string): Promise<ManagedTaskSummaryBlock | undefined> {
  const quoteRows = await sql<ManagedTaskSummaryBlock>(`select id, markdown, content from blocks
where root_id = '${sqlText(docId)}'
  and type = 'b'
  and (markdown like '%来源：%' or content like '%来源：%')
limit 1`);
  if (quoteRows[0]) {
    return { ...quoteRows[0], format: "quote" };
  }

  const tableRows = await sql<ManagedTaskSummaryBlock>(`select id, markdown, content from blocks
where root_id = '${sqlText(docId)}'
  and type = 't'
order by sort asc`);
  const matched = tableRows.find((row) => isTaskSummaryTable(row.markdown, row.content));
  return matched ? { ...matched, format: "table" } : undefined;
}

async function syncManagedTaskDescriptionSection(task: TaskItem, currentSynced = false): Promise<boolean> {
  const heading = await findHeadingBlock(task.docId, ["任务描述"]);
  if (!heading) {
    return currentSynced;
  }
  await replaceManagedHeadingSection(task.docId, ["任务描述"], task.description || "", {
    createIfMissing: false
  });
  return true;
}

async function replaceManagedHeadingSection(
  docId: string,
  headings: string[],
  bodyMarkdown: string,
  options: {
    createIfMissing?: boolean;
    headingLevel?: number;
  } = {}
): Promise<void> {
  const normalizedBody = bodyMarkdown
    .replace(/^\n+/u, "")
    .replace(/\s+$/u, "");
  const heading = await findHeadingBlock(docId, headings);
  if (!heading) {
    if (!options.createIfMissing) {
      return;
    }
    const level = Math.min(Math.max(options.headingLevel || 2, 1), 6);
    const title = headings[0] || TASK_DETAIL_HEADING;
    const headingMarkdown = `${"#".repeat(level)} ${title}`;
    const nextMarkdown = normalizedBody ? `${headingMarkdown}\n\n${normalizedBody}` : headingMarkdown;
    await appendBlock(docId, nextMarkdown);
    return;
  }

  const children = await getChildBlocks(heading.id).catch(() => []);
  for (const child of [...children].reverse()) {
    await deleteBlock(child.id).catch(() => undefined);
  }
  if (!normalizedBody) {
    return;
  }
  await appendBlock(heading.id, normalizedBody);
}

async function findHeadingBlock(docId: string, headings: string[]): Promise<{ id: string; content?: string } | undefined> {
  const normalizedHeadings = headings
    .map((heading) => heading.trim())
    .filter(Boolean);
  if (!normalizedHeadings.length) {
    return undefined;
  }
  const conditions = normalizedHeadings
    .map((heading) => `content = '${sqlText(heading)}'`)
    .join(" or ");
  const rows = await sql<Array<{ id: string; content?: string }>[number]>(`select id, content from blocks
where root_id = '${sqlText(docId)}'
  and type = 'h'
  and (${conditions})
order by sort asc`);
  return rows[0];
}

async function setTaskAttrs(task: TaskItem): Promise<void> {
  await setBlockAttrs(task.docId, {
    [TASK_ATTRS.id]: task.id,
    [TASK_ATTRS.status]: task.status,
    [TASK_ATTRS.priority]: task.priority,
    [TASK_ATTRS.project]: task.project || "",
    [TASK_ATTRS.dueDate]: task.dueDate || "",
    [TASK_ATTRS.planStart]: task.planStart || "",
    [TASK_ATTRS.planEnd]: task.planEnd || "",
    [TASK_ATTRS.createdAt]: task.createdAt || "",
    [TASK_ATTRS.completedAt]: task.completedAt || "",
    [TASK_ATTRS.parentId]: task.parentId || "",
    [TASK_ATTRS.sourceBlockId]: task.sourceBlockId || "",
    [TASK_ATTRS.sourceDocId]: task.sourceDocId || "",
    [TASK_ATTRS.sourceText]: task.sourceText || "",
    [TASK_ATTRS.description]: task.description || "",
    [TASK_ATTRS.taskRevision]: String(Number.isFinite(task.taskRevision) ? task.taskRevision : 0),
    [TASK_ATTRS.taskLastEditedAt]: task.taskLastEditedAt || "",
    [TASK_ATTRS.taskLastEditedBy]: task.taskLastEditedBy || "",
    [TASK_ATTRS.taskLastOpId]: task.taskLastOpId || ""
  });
}

async function appendSourceTaskId(sourceBlockId: string, taskId: string): Promise<void> {
  const attrs = await getBlockAttrs(sourceBlockId).catch(() => ({}));
  const ids = new Set((attrs[SOURCE_TASK_IDS_ATTR] || "").split(",").map((id) => id.trim()).filter(Boolean));
  ids.add(taskId);
  await setBlockAttrs(sourceBlockId, {
    [SOURCE_TASK_IDS_ATTR]: Array.from(ids).join(",")
  });
}

async function removeSourceTaskId(sourceBlockId: string, taskId: string): Promise<void> {
  const attrs = await getBlockAttrs(sourceBlockId).catch(() => ({}));
  const ids = new Set((attrs[SOURCE_TASK_IDS_ATTR] || "").split(",").map((id) => id.trim()).filter(Boolean));
  ids.delete(taskId);
  await setBlockAttrs(sourceBlockId, {
    [SOURCE_TASK_IDS_ATTR]: Array.from(ids).join(",")
  });
}

async function syncSourceTaskReference(previousSourceBlockId: string | undefined, nextSourceBlockId: string | undefined, taskId: string): Promise<void> {
  if (previousSourceBlockId && previousSourceBlockId !== nextSourceBlockId) {
    await removeSourceTaskId(previousSourceBlockId, taskId);
  }
  if (nextSourceBlockId && nextSourceBlockId !== previousSourceBlockId) {
    await appendSourceTaskId(nextSourceBlockId, taskId);
  }
}

export async function sourceFromBlock(blockId: string): Promise<SourceContext> {
  const block = await getBlockById(blockId);
  return {
    blockId,
    docId: block?.root_id || blockId,
    text: block?.fcontent || block?.content || blockId
  };
}

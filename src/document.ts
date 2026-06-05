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
  insertBlock,
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
import {
  groupWeeklyProgressRecords,
  normalizeProgressRecords,
  parseProgressRecords,
  renderProgressRecordsMarkdown,
  serializeProgressRecords,
  TASK_PROGRESS_HEADING
} from "./progressRecords";
import { TaskStore } from "./taskStore";
import {
  defaultTaskStatus,
  getActiveTaskStatuses,
  getStatusLabel,
  isCompletedTaskStatus,
  normalizeStatusOptions,
  normalizeStoredTaskStatus
} from "./statusConfig";
import {
  COMPLETED_TASK_STATUS,
  DEFAULT_TASK_TEMPLATE,
  ROOT_ATTRS,
  REPORT_ATTRS,
  SOURCE_TASK_IDS_ATTR,
  TASK_ATTRS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  WEEKLY_REPORT_KIND,
  type BlockRow,
  type ProgressRecord,
  type SourceContext,
  type TaskCreateInput,
  type TaskItem,
  type TaskStatus,
  type TaskSettings
} from "./types";

const WEEKDAY_LABELS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"] as const;
const TASK_SUMMARY_HEADING = "任务概要";
const TASK_DETAIL_HEADING = "任务详情";
const TASK_LATEST_LABEL = "任务近况";
const TASK_DESCRIPTION_HEADINGS = [TASK_LATEST_LABEL, "任务描述"];
const MANAGED_TASK_SECTION_HEADINGS = [TASK_SUMMARY_HEADING, TASK_PROGRESS_HEADING, TASK_DETAIL_HEADING] as const;

type ChangeListener = () => void;

export class TaskService {
  private listeners = new Set<ChangeListener>();

  constructor(public readonly store: TaskStore) {}

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async setRootFromDoc(docId: string): Promise<TaskSettings> {
    const settings = await buildTaskRootSettings(docId);
    if (!settings) {
      throw new Error("无法读取当前文档信息");
    }
    const previousRootDocId = this.store.getSettings().taskRootDocId;
    await this.store.setSettings({
      ...settings,
      taskRootSource: "manual"
    });
    await syncTaskRootMarker(docId, {
      additionalStaleDocIds: previousRootDocId ? [previousRootDocId] : [],
      forceWrite: true
    });
    console.info("Task Tracker: set task root manually", {
      docId,
      previousRootDocId
    });
    this.emit();
    return {
      ...settings,
      taskRootSource: "manual"
    };
  }

  async createTask(input: TaskCreateInput): Promise<TaskItem> {
    await this.reconcileTaskRootSettings();
    const settings = this.store.getSettings();
    if (!settings.taskRootDocId || !settings.taskRootNotebookId) {
      throw new Error("请先将一个文档设为事项库");
    }

    const parent = input.parentId ? this.store.get(input.parentId) : undefined;
    const parentCreatePath = await resolveParentCreatePath(settings, parent);
    console.info("Task Tracker: creating task with root", {
      rootDocId: settings.taskRootDocId,
      rootNotebookId: settings.taskRootNotebookId,
      rootPath: settings.taskRootPath,
      rootHPath: settings.taskRootHPath,
      rootSource: settings.taskRootSource,
      parentCreatePath
    });
    const docId = newSiyuanId();
    const title = input.title.trim();
    const notebookId = parent?.notebookId || settings.taskRootNotebookId;
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
      status: input.status || defaultTaskStatus(settings),
      dueDate: input.dueDate || undefined,
      planStart: input.planStart || undefined,
      planEnd: input.planEnd || undefined,
      description: input.description?.trim() || undefined,
      progressRecords: normalizeProgressRecords(input.progressRecords, createdAt),
      noteFolderPath: input.noteFolderPath?.trim() || undefined,
      createdAt,
      updatedAt: now,
      completedAt: input.status === COMPLETED_TASK_STATUS ? now : undefined
    };

    const created = await createTaskDocWithTitle(
      notebookId,
      parentCreatePath,
      taskDocumentTitle(draftTask),
      renderTaskMarkdown(draftTask, parent, [], settings, input.detail)
    );
    let actualTask: TaskItem = {
      ...draftTask,
      id: created.docId || docId,
      docId: created.docId || docId,
      path: created.path || ""
    };

    await setTaskAttrs(actualTask);
    if (actualTask.sourceBlockId) {
      await appendSourceTaskId(actualTask.sourceBlockId, actualTask.id);
    }
    await this.store.upsert(actualTask);
    if (isCompletedTaskStatus(actualTask.status) && !actualTask.parentId) {
      actualTask = await this.archiveCompletedParentTask(actualTask);
    }
    await this.syncTaskDocument(actualTask.id);
    if (actualTask.parentId) {
      await this.syncTaskDocument(actualTask.parentId);
    }
    this.emit();
    return actualTask;
  }

  async updateTask(id: string, patch: Partial<TaskItem>): Promise<TaskItem> {
    const current = this.store.get(id);
    if (!current) {
      throw new Error("任务不存在");
    }

    const normalizedPatch = normalizeTaskPatch(patch);
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
    if (isCompletedTaskStatus(normalized.status ?? current.status) && !normalized.completedAt) {
      throw new Error("已完成任务必须填写完成时间");
    }
    let task = await this.store.update(id, normalized);
    const parentIdChanged = current.parentId !== task.parentId;
    if (!isCompletedTaskStatus(current.status) && isCompletedTaskStatus(task.status) && !task.parentId) {
      task = await this.archiveCompletedParentTask(task);
    }
    if (parentIdChanged) {
      try {
        task = await this.moveTaskToParent(task);
      } catch (error) {
        await this.store.update(id, {
          parentId: current.parentId,
          path: current.path
        });
        throw error;
      }
    }
    await syncSourceTaskReference(current.sourceBlockId, task.sourceBlockId, task.id);
    await setTaskAttrs(task);
    await this.syncTaskDocument(task.id);
    if (current.parentId && current.parentId !== task.id) {
      await this.syncTaskDocument(current.parentId);
    }
    if (task.parentId && task.parentId !== current.parentId) {
      await this.syncTaskDocument(task.parentId);
    }
    this.emit();
    return task;
  }

  async completeTask(id: string): Promise<TaskItem> {
    return this.updateTask(id, {
      status: COMPLETED_TASK_STATUS
    });
  }

  async reopenTask(id: string): Promise<TaskItem> {
    return this.updateTask(id, {
      status: defaultTaskStatus(this.store.getSettings())
    });
  }

  async migrateTaskStatuses(fromStatus: TaskStatus, toStatus: TaskStatus): Promise<number> {
    if (!fromStatus || !toStatus || fromStatus === toStatus) {
      return 0;
    }
    const tasks = this.store.all().filter((task) => task.status === fromStatus);
    let migrated = 0;
    for (const task of tasks) {
      await this.updateTask(task.id, { status: toStatus });
      migrated += 1;
    }
    return migrated;
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

    await deleteTaskDocuments(selectedTasks);

    const removed = await this.store.removeMany(ids);
    if (removed > 0) {
      await this.syncTaskDocuments(parentIds);
      this.emit();
    }
    return removed;
  }

  async syncDeletedDocs(): Promise<number> {
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
    if (removed > 0) {
      await this.syncTaskDocuments(parentIds);
      this.emit();
    }
    return removed;
  }

  async syncAllTaskDocuments(): Promise<number> {
    return this.syncTaskDocuments(this.store.all().map((task) => task.id));
  }

  activeTasks(): TaskItem[] {
    const activeStatuses = new Set(getActiveTaskStatuses(this.store.getSettings()));
    return this.store.all().filter((task) => activeStatuses.has(task.status));
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

  async startupSync(options: { skipDeletedCleanup?: boolean } = {}): Promise<{ removed: number; synced: number }> {
    await this.waitForStartupSync({
      maxWaitMs: this.store.getSettings().startupSyncGraceMs ?? 12000
    });
    await this.reconcileTaskRootSettings();

    let removed = 0;
    const indexedTasks = this.store.all();
    const discoveredTasks = await this.collectTasksFromRoot();
    if (discoveredTasks.length > 0) {
      if (!sameTaskCollections(indexedTasks, discoveredTasks)) {
        await this.store.replaceAll(discoveredTasks);
        console.info("Task Tracker: refreshed task index from task documents", {
          indexedCount: indexedTasks.length,
          discoveredCount: discoveredTasks.length
        });
        this.emit();
      }
    } else if (indexedTasks.length > 0 && !options.skipDeletedCleanup) {
      removed = await this.syncDeletedDocs();
    }

    return { removed, synced: 0 };
  }

  async rebuildTaskIndex(): Promise<number> {
    const tasks = await this.collectTasksFromRoot();
    await this.store.replaceAll(tasks);
    await this.syncAllTaskDocuments();
    this.emit();
    return tasks.length;
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
      .filter((task) => isCompletedTaskStatus(task.status) && weekKey(task.completedAt || task.createdAt) === week)
      .sort(compareWeeklyReportTaskOrder);
    const progressBody = renderWeeklyProgressBody(week, this.store.all());
    const weekLabel = formatCompletedWeekLabel(week);
    const title = `${weekLabel}工作`;
    const reportRoot = await ensureWeeklyReportRoot(settings);
    const reportHPath = `${reportRoot.hpath === "/" ? "" : reportRoot.hpath}/${title}`;
    const existing = await getDocRefByHPath(settings.taskRootNotebookId, reportHPath);
    const itemsBody = renderWeeklyReportItemsBody(week, tasks);

    if (!existing) {
      const markdown = buildWeeklyReportMarkdown(title, itemsBody, progressBody, "", "");
      const created = await createWeeklyReportDoc(settings.taskRootNotebookId, reportRoot.hpath, title, markdown);
      await markWeeklyReportDoc(created.docId);
      return { docId: created.docId, title };
    }

    const currentMarkdown = await readDocMarkdown(existing.id).catch(() => "");
    await updateBlock(existing.id, rewriteWeeklyReportMarkdown(currentMarkdown, title, itemsBody, progressBody));
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

  private async syncTaskDocument(id: string): Promise<boolean> {
    const task = this.store.get(id);
    if (!task) {
      return false;
    }

    const metadataBlock = await findManagedTaskSummaryBlock(task.docId);
    if (!metadataBlock) {
      let synced = await syncManagedTaskProgressSection(task, false);
      synced = await syncManagedTaskDescriptionSection(task, synced);
      synced = await healCorruptedTaskDocument(task, synced);
      return synced;
    }

    const parent = task.parentId ? this.store.get(task.parentId) : undefined;
    const children = this.store.all().filter((item) => item.parentId === task.id);
    const settings = this.store.getSettings();
    let synced = false;
    if (metadataBlock.format === "table") {
      const nextTableMarkdown = renderTaskSummaryTable(metadataBlock.markdown || "", task, parent, children, settings);
      const summaryHeading = await findHeadingBlock(task.docId, [TASK_SUMMARY_HEADING]);
      if (summaryHeading) {
        synced = await replaceManagedHeadingSectionBlocks(
          task.docId,
          [TASK_SUMMARY_HEADING],
          buildManagedTaskSummaryBlocks(
            nextTableMarkdown,
            buildTaskSummaryLabelLines(task, parent, children, settings)
          ),
          { createIfMissing: false }
        );
      } else if (!sameMarkdownContent(metadataBlock.markdown, nextTableMarkdown)) {
        await updateBlock(metadataBlock.id, nextTableMarkdown);
        synced = true;
      }
    } else {
      const nextMarkdown = renderTaskMetadataBlock(task, parent, children, settings);
      if (!sameMarkdownContent(metadataBlock.markdown, nextMarkdown)) {
        await updateBlock(metadataBlock.id, nextMarkdown);
        synced = true;
      }
    }
    synced = await syncManagedTaskProgressSection(task, synced);
    synced = await syncManagedTaskDescriptionSection(task, synced);
    synced = await healCorruptedTaskDocument(task, synced);
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

  private async archiveCompletedParentTask(task: TaskItem): Promise<TaskItem> {
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

    await moveDocs([taskPath], settings.taskRootNotebookId, archivePath);
    const ids = expandWithDescendants(this.store.all(), [task.id]);
    const pathMap = await refreshTaskPaths(this.store, ids);
    let archivedTask = this.store.get(task.id) || task;
    const refreshed = pathMap.get(task.id);
    if (refreshed) {
      archivedTask = refreshed;
    }
    await this.syncTaskDocuments(ids);
    return archivedTask;
  }

  private async moveTaskToParent(task: TaskItem): Promise<TaskItem> {
    const settings = this.store.getSettings();
    if (!settings.taskRootDocId || !settings.taskRootNotebookId) {
      return task;
    }

    const currentPath = await requireTaskPath(task.docId, `无法读取待移动任务路径：${task.title}`);

    let targetParentPath: string;
    if (task.parentId) {
      const parent = this.store.get(task.parentId);
      if (!parent) {
        return task;
      }
      const parentPath = await requireTaskPath(parent.docId, `无法读取父任务路径：${parent.title}`);
      targetParentPath = parentPath;
    } else {
      const rootPath = await requireTaskPath(settings.taskRootDocId, "无法读取事项库根文档路径");
      targetParentPath = rootPath;
    }

    const currentParentPath = parentTaskPath(currentPath);
    if (currentParentPath === targetParentPath) {
      return task;
    }

    await moveDocs([currentPath], task.notebookId, targetParentPath);

    const ids = expandWithDescendants(this.store.all(), [task.id]);
    const pathMap = await refreshTaskPaths(this.store, ids);
    const movedTask = pathMap.get(task.id) || this.store.get(task.id) || task;
    await this.syncTaskDocuments(ids);
    return movedTask;
  }

  private async collectTasksFromRoot(): Promise<TaskItem[]> {
    const settings = this.store.getSettings();
    const candidates = await listTaskDocCandidates(settings);
    if (!candidates.length) {
      return [];
    }

    const tasks: TaskItem[] = [];
    const taskByDocId = new Map<string, TaskItem>();
    const batchSize = 12;

    for (let start = 0; start < candidates.length; start += batchSize) {
      const batch = candidates.slice(start, start + batchSize);
      const attrsByDocId = await readTaskDocAttrs(batch.map((doc) => doc.id));
      const batchTasks = await Promise.all(batch.map(async (doc) => {
        const attrs = attrsByDocId.get(doc.id) || {};
        if (!shouldIncludeTaskDocInRebuild(doc, attrs, settings)) {
          return undefined;
        }
        const taskId = attrs[TASK_ATTRS.id]?.trim();
        if (taskId) {
          const task = taskFromDoc(doc, attrs, settings);
          taskByDocId.set(doc.id, task);
          return task;
        }

        const recovered = await recoverTaskFromDocument(doc, settings);
        if (recovered) {
          taskByDocId.set(doc.id, recovered);
        }
        return recovered;
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

    return tasks.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async reconcileTaskRootSettings(): Promise<void> {
    const currentSettings = this.store.getSettings();
    const resolution = await resolveTaskRootSettings(currentSettings, this.store.all());
    if (!resolution?.docId) {
      return;
    }

    const nextSettings = await buildTaskRootSettings(resolution.docId);
    if (!nextSettings) {
      return;
    }

    const changed = !sameTaskRootSettings(currentSettings, nextSettings);
    if (changed) {
      await this.store.setSettings({
        ...nextSettings,
        taskRootSource: "auto"
      });
      console.info("Task Tracker: reconciled task root", {
        from: currentSettings.taskRootDocId,
        to: nextSettings.taskRootDocId
      });
      this.emit();
    }

    if (resolution.needsMarkerSync) {
      await syncTaskRootMarker(resolution.docId, {
        additionalStaleDocIds: resolution.markerDocIds,
        forceWrite: true
      });
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
  if ("progressRecords" in normalized) {
    normalized.progressRecords = normalizeProgressRecords(
      normalized.progressRecords,
      typeof normalized.updatedAt === "string"
        ? normalized.updatedAt
        : (typeof normalized.createdAt === "string" ? normalized.createdAt : undefined)
    );
  }
  if ("noteFolderPath" in normalized && typeof normalized.noteFolderPath === "string") {
    normalized.noteFolderPath = normalized.noteFolderPath.trim() || undefined;
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
  if (patch.status === COMPLETED_TASK_STATUS) {
    if (!isCompletedTaskStatus(current.status)) {
      return { ...patch, completedAt: patch.completedAt || nowIso() };
    }
    return { ...patch, completedAt: patch.completedAt ?? current.completedAt };
  }
  if (isCompletedTaskStatus(current.status)) {
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

async function readTaskDocAttrs(docIds: string[]): Promise<Map<string, Record<string, string>>> {
  const ids = Array.from(new Set(docIds.map((id) => id.trim()).filter(Boolean)));
  if (!ids.length) {
    return new Map();
  }

  const conditions = ids.map((id) => `'${sqlText(id)}'`).join(", ");
  const rows = await sql<{ block_id: string; name: string; value: string }>(`select block_id, name, value from attributes
where block_id in (${conditions})
  and (
    name like '${sqlText("custom-task-tracker-%")}'
    or name = '${sqlText(REPORT_ATTRS.kind)}'
  )`);

  const attrsByDocId = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (!row.block_id || !row.name) {
      continue;
    }
    const attrs = attrsByDocId.get(row.block_id) || {};
    attrs[row.name] = row.value || "";
    attrsByDocId.set(row.block_id, attrs);
  }

  const apiAttrs = await Promise.all(ids.map(async (id) => ({
    id,
    attrs: await getBlockAttrs(id).catch(() => ({}))
  })));

  for (const { id, attrs } of apiAttrs) {
    const filtered = pickManagedTaskAttrs(attrs);
    if (Object.keys(filtered).length > 0) {
      const merged = {
        ...(attrsByDocId.get(id) || {}),
        ...filtered
      };
      attrsByDocId.set(id, merged);
    }
  }
  return attrsByDocId;
}

function pickManagedTaskAttrs(attrs: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs || {})) {
    if (name.startsWith("custom-task-tracker-")) {
      picked[name] = value || "";
    }
  }
  return picked;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  const rows = await queryDocumentRowsPaged(`select id, box, path, content, hpath, updated from blocks
where box = '${sqlText(settings.taskRootNotebookId)}'
  and type = 'd'
  and id != '${sqlText(settings.taskRootDocId)}'
  and path like '${sqlText(rootPath)}/%'
order by path asc`);
  return rows.filter((row) => !isWeeklyReportDoc(row, settings));
}

const DOCUMENT_QUERY_PAGE_SIZE = 64;

async function queryDocumentRowsPaged(stmt: string): Promise<BlockRow[]> {
  const rows: BlockRow[] = [];

  for (let offset = 0; ; offset += DOCUMENT_QUERY_PAGE_SIZE) {
    const page = await sql<BlockRow>(`${stmt}
limit ${DOCUMENT_QUERY_PAGE_SIZE} offset ${offset}`);
    rows.push(...page);
    if (page.length < DOCUMENT_QUERY_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

function taskFromDoc(doc: BlockRow, attrs: Record<string, string>, settings: TaskSettings): TaskItem {
  const status = normalizeRecoveredTaskStatus(attrs[TASK_ATTRS.status], doc.path, doc.hpath, settings);
  const priority = normalizeTaskPriority(attrs[TASK_ATTRS.priority]);
  const sourceText = attrs[TASK_ATTRS.sourceText]?.trim() || undefined;
  const progressRecords = parseProgressRecords(
    attrs[TASK_ATTRS.progressRecords],
    attrs[TASK_ATTRS.createdAt] || updatedToIso(doc.updated) || nowIso()
  );
  return {
    id: attrs[TASK_ATTRS.id] || doc.id,
    title: normalizeRecoveredTitle(doc, attrs[TASK_ATTRS.createdAt]),
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
    progressRecords,
    noteFolderPath: attrs[TASK_ATTRS.noteFolderPath]?.trim() || undefined
  };
}

function normalizeRecoveredTitle(doc: BlockRow, createdAt?: string): string {
  const title = doc.content?.trim();
  if (title) {
    return stripTaskDocumentTitlePrefix(title, createdAt) || title;
  }
  const fromPath = doc.path.split("/").pop()?.replace(/\.sy$/i, "").trim();
  if (!fromPath) {
    return doc.id;
  }
  return stripTaskDocumentTitlePrefix(fromPath, createdAt) || fromPath;
}

function normalizeTaskStatus(value?: string, settings?: TaskSettings): TaskItem["status"] {
  return normalizeStoredTaskStatus(value, settings);
}

function normalizeRecoveredTaskStatus(
  value: string | undefined,
  path: string | undefined,
  hpath: string | undefined,
  settings: TaskSettings
): TaskItem["status"] {
  const normalized = normalizeTaskStatus(value, settings);
  if (value === normalized && value !== undefined) {
    return normalized;
  }
  if (isArchivedTaskDoc(path, hpath, settings)) {
    return COMPLETED_TASK_STATUS;
  }
  return normalized;
}

function stripTaskDocumentTitlePrefix(title: string, createdAt?: string): string {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return "";
  }

  const dateKey = toDateKey(createdAt || "");
  if (dateKey) {
    const prefix = `${dateKey.slice(5).replace("-", "")}-`;
    if (normalizedTitle.startsWith(prefix)) {
      return normalizedTitle.slice(prefix.length).trim();
    }
  }

  const fallbackMatch = normalizedTitle.match(/^(\d{2})(\d{2})-(.+)$/u);
  if (!fallbackMatch) {
    return normalizedTitle;
  }
  const month = Number(fallbackMatch[1]);
  const day = Number(fallbackMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return normalizedTitle;
  }
  return fallbackMatch[3].trim() || normalizedTitle;
}

function shouldIncludeTaskDocInRebuild(
  doc: BlockRow,
  attrs: Record<string, string>,
  settings: TaskSettings
): boolean {
  if (attrs[REPORT_ATTRS.kind] === WEEKLY_REPORT_KIND || isWeeklyReportDoc(doc, settings)) {
    return false;
  }

  if (isArchivedTaskDoc(doc.path, doc.hpath, settings)) {
    return normalizeRecoveredTaskStatus(attrs[TASK_ATTRS.status], doc.path, doc.hpath, settings) === COMPLETED_TASK_STATUS
      && !isArchiveContainerDoc(doc.hpath, settings);
  }

  return true;
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

async function recoverTaskFromDocument(doc: BlockRow, settings: TaskSettings): Promise<TaskItem | undefined> {
  if (isWeeklyReportDoc(doc, settings) || isArchiveContainerDoc(doc.hpath, settings)) {
    return undefined;
  }

  const markdown = await readDocMarkdown(doc.id).catch(() => "");
  const summary = parseTaskSummaryFromMarkdown(markdown, settings);
  if (!summary) {
    return undefined;
  }

  return {
    id: doc.id,
    title: normalizeRecoveredTitle(doc, summary.createdAt),
    docId: doc.id,
    notebookId: doc.box,
    path: doc.path,
    parentId: undefined,
    sourceBlockId: summary.sourceBlockId,
    sourceDocId: undefined,
    sourceText: summary.sourceText,
    project: summary.project,
    priority: summary.priority || "medium",
    status: summary.status || defaultTaskStatus(settings),
    dueDate: summary.dueDate,
    planStart: summary.planStart,
    planEnd: summary.planEnd,
    createdAt: summary.createdAt || updatedToIso(doc.updated) || nowIso(),
    updatedAt: updatedToIso(doc.updated) || nowIso(),
    completedAt: summary.completedAt,
    description: summary.description
  };
}

function parseTaskSummaryFromMarkdown(markdown: string, settings: TaskSettings): Partial<TaskItem> | undefined {
  if (!markdown.trim()) {
    return undefined;
  }

  const fromTable = parseTaskSummaryTableMarkdown(markdown, settings);
  if (fromTable) {
    return fromTable;
  }
  return parseTaskSummaryQuoteMarkdown(markdown, settings);
}

function parseTaskSummaryTableMarkdown(markdown: string, settings: TaskSettings): Partial<TaskItem> | undefined {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\|/.test(line) && line.includes("来源"));
  if (headerIndex === -1 || headerIndex + 2 >= lines.length) {
    return undefined;
  }

  const headerCells = parseMarkdownTableRow(lines[headerIndex]);
  const dataCells = parseMarkdownTableRow(lines[headerIndex + 2] || "");
  if (!headerCells.length || !dataCells.length) {
    return undefined;
  }

  const values = new Map<string, string>();
  headerCells.forEach((cell, index) => {
    values.set(cell, dataCells[index] || "");
  });

  const source = parseTaskSourceValue(values.get("来源"));
  return {
    project: normalizeTaskFieldValue(values.get("项目")),
    status: parseTaskStatusLabel(values.get("状态"), settings),
    priority: parseTaskPriorityLabel(values.get("优先级")),
    createdAt: parseRenderedTaskDate(values.get("创建时间")),
    completedAt: parseRenderedTaskDate(values.get("完成时间")),
    dueDate: parseRenderedTaskDate(values.get("截止时间")),
    planStart: parseRenderedTaskDate(values.get("计划时间")),
    sourceBlockId: source.blockId,
    sourceText: source.text
  };
}

function parseTaskSummaryQuoteMarkdown(markdown: string, settings: TaskSettings): Partial<TaskItem> | undefined {
  const lines = markdown.split(/\r?\n/);
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^>\s*([^：]+)：\s*(.*)$/u);
    if (!match) {
      continue;
    }
    values.set(match[1].trim(), match[2].trim());
  }
  if (!values.size) {
    return undefined;
  }

  const source = parseTaskSourceValue(values.get("来源"));
  return {
    project: normalizeTaskFieldValue(values.get("项目")),
    status: parseTaskStatusLabel(values.get("状态"), settings),
    priority: parseTaskPriorityLabel(values.get("优先级")),
    description: normalizeTaskFieldValue(values.get(TASK_LATEST_LABEL) || values.get("任务描述")),
    createdAt: parseRenderedTaskDate(values.get("创建时间")),
    completedAt: parseRenderedTaskDate(values.get("完成时间")),
    dueDate: parseRenderedTaskDate(values.get("截止时间")),
    planStart: parseRenderedTaskDate(values.get("计划时间")),
    sourceBlockId: source.blockId,
    sourceText: source.text
  };
}

function parseTaskStatusLabel(value: string | undefined, settings: TaskSettings): TaskItem["status"] | undefined {
  const normalized = normalizeTaskFieldValue(value);
  if (!normalized) {
    return undefined;
  }
  return taskStatusFromLabel(normalized, settings);
}

function taskStatusFromLabel(label: string, settings: TaskSettings): TaskItem["status"] | undefined {
  const normalized = label.trim();
  if (!normalized) {
    return undefined;
  }
  const matched = normalizeStatusOptions(settings).find((option) => option.label === normalized);
  if (matched) {
    return matched.id;
  }
  for (const [statusId, statusLabel] of Object.entries(TASK_STATUS_LABELS)) {
    if (statusLabel === normalized) {
      return statusId;
    }
  }
  return undefined;
}

function parseTaskPriorityLabel(value?: string): TaskItem["priority"] | undefined {
  return (Object.entries(TASK_PRIORITY_LABELS).find(([, label]) => label === normalizeTaskFieldValue(value))?.[0] as TaskItem["priority"] | undefined);
}

function parseRenderedTaskDate(value?: string): string | undefined {
  const normalized = normalizeTaskFieldValue(value);
  if (!normalized) {
    return undefined;
  }
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?$/u);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour = "00", minute = "00"] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeTaskFieldValue(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized === "未设置" || normalized === "无" || normalized === "手动创建") {
    return undefined;
  }
  return normalized;
}

function parseTaskSourceValue(value?: string): { blockId?: string; text?: string } {
  const normalized = value?.trim();
  if (!normalized) {
    return {};
  }
  const match = normalized.match(/\(\(([a-z0-9-]{22})\s+"([^"]*)"\)\)/iu);
  if (!match) {
    return {};
  }
  return {
    blockId: match[1],
    text: match[2]?.trim() || undefined
  };
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
  const normalized = path?.trim();
  if (!normalized) {
    return undefined;
  }
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? `${normalized.slice(0, lastSlash)}.sy` : undefined;
}

async function buildTaskRootSettings(docId: string): Promise<TaskSettings | undefined> {
  const block = await getBlockById(docId).catch(() => undefined);
  if (!block || !block.box || !block.path) {
    return undefined;
  }
  const hpath = await getHPathById(docId).catch(() => block.content || docId);
  return {
    taskRootDocId: docId,
    taskRootNotebookId: block.box,
    taskRootPath: block.path,
    taskRootHPath: normalizeHPath(hpath || block.content || docId),
    taskRootTitle: hpath || block.content || docId
  };
}

interface TaskRootMarkerRef {
  docId: string;
  updatedAt?: string;
}

interface TaskRootScanResult {
  markers: TaskRootMarkerRef[];
  rootTaskCounts: Map<string, number>;
}

async function resolveTaskRootSettings(settings: TaskSettings, indexedTasks: TaskItem[] = []): Promise<{
  docId: string;
  markerDocIds: string[];
  needsMarkerSync: boolean;
} | undefined> {
  const indexedRootCounts = countTaskRootCandidatesFromTasks(indexedTasks);
  const primaryScan = await scanTaskRootCandidates(settings.taskRootNotebookId);
  const scan = shouldExpandTaskRootScan(primaryScan, settings.taskRootNotebookId)
    ? await scanTaskRootCandidates()
    : primaryScan;
  const currentRootDocId = settings.taskRootDocId;
  if (settings.taskRootSource === "manual") {
    if (currentRootDocId && await buildTaskRootSettings(currentRootDocId)) {
      return {
        docId: currentRootDocId,
        markerDocIds: scan.markers
          .map((marker) => marker.docId)
          .filter((docId) => docId !== currentRootDocId),
        needsMarkerSync: scan.markers.length !== 1 || scan.markers[0]?.docId !== currentRootDocId
      };
    }
  }
  const chosenDocId = pickTaskRootDocId({
    markers: scan.markers,
    rootTaskCounts: mergeTaskRootCounts(indexedRootCounts, scan.rootTaskCounts)
  }, currentRootDocId);

  if (!chosenDocId) {
    if (!currentRootDocId || !await buildTaskRootSettings(currentRootDocId)) {
      return undefined;
    }
    return {
      docId: currentRootDocId,
      markerDocIds: scan.markers.map((marker) => marker.docId),
      needsMarkerSync: scan.markers.length === 0
    };
  }

  return {
    docId: chosenDocId,
    markerDocIds: scan.markers.map((marker) => marker.docId),
    needsMarkerSync: scan.markers.length !== 1 || scan.markers[0]?.docId !== chosenDocId
  };
}

function shouldExpandTaskRootScan(scan: TaskRootScanResult, notebookId?: string): boolean {
  return Boolean(notebookId && scan.markers.length === 0 && scan.rootTaskCounts.size === 0);
}

async function scanTaskRootCandidates(notebookId?: string): Promise<TaskRootScanResult> {
  const docs = await listDocumentRows(notebookId);
  const markers: TaskRootMarkerRef[] = [];
  const taskDocs: BlockRow[] = [];
  const taskDocIds = new Set<string>();
  const batchSize = 24;

  for (let start = 0; start < docs.length; start += batchSize) {
    const batch = docs.slice(start, start + batchSize);
    const batchAttrs = await Promise.all(batch.map(async (doc) => ({
      doc,
      attrs: await getBlockAttrs(doc.id).catch(() => ({}))
    })));

    for (const { doc, attrs } of batchAttrs) {
      if (attrs[ROOT_ATTRS.active] === "1") {
        markers.push({
          docId: doc.id,
          updatedAt: attrs[ROOT_ATTRS.updatedAt] || undefined
        });
      }

      if (!attrs[TASK_ATTRS.id]?.trim() || attrs[REPORT_ATTRS.kind] === WEEKLY_REPORT_KIND) {
        continue;
      }
      taskDocs.push(doc);
      taskDocIds.add(doc.id);
    }
  }

  const rootTaskCounts = new Map<string, number>();
  for (const doc of taskDocs) {
    const rootDocId = inferTaskRootDocIdFromPath(doc.path, taskDocIds);
    if (!rootDocId) {
      continue;
    }
    rootTaskCounts.set(rootDocId, (rootTaskCounts.get(rootDocId) || 0) + 1);
  }

  return { markers, rootTaskCounts };
}

function pickTaskRootDocId(scan: TaskRootScanResult, currentRootDocId?: string): string | undefined {
  if (scan.markers.length) {
    return [...scan.markers]
      .sort((left, right) => compareTaskRootMarkers(left, right, currentRootDocId))[0]?.docId;
  }

  let bestDocId = currentRootDocId;
  let bestCount = currentRootDocId ? (scan.rootTaskCounts.get(currentRootDocId) || 0) : -1;
  for (const [docId, count] of scan.rootTaskCounts) {
    if (count > bestCount) {
      bestDocId = docId;
      bestCount = count;
      continue;
    }
    if (count === bestCount && docId === currentRootDocId) {
      bestDocId = docId;
    }
  }
  return bestCount > 0 ? bestDocId : currentRootDocId;
}

function compareTaskRootMarkers(
  left: TaskRootMarkerRef,
  right: TaskRootMarkerRef,
  currentRootDocId?: string
): number {
  const timeDiff = markerTimeValue(right.updatedAt) - markerTimeValue(left.updatedAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  if (right.docId === currentRootDocId && left.docId !== currentRootDocId) {
    return 1;
  }
  if (left.docId === currentRootDocId && right.docId !== currentRootDocId) {
    return -1;
  }
  return 0;
}

function markerTimeValue(value?: string): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

async function listDocumentRows(notebookId?: string): Promise<BlockRow[]> {
  const notebookFilter = notebookId ? ` and box = '${sqlText(notebookId)}'` : "";
  return queryDocumentRowsPaged(`select id, box, path, updated from blocks
where type = 'd'${notebookFilter}
order by path asc`);
}

function countTaskRootCandidatesFromTasks(tasks: TaskItem[]): Map<string, number> {
  const taskDocIds = new Set(tasks.map((task) => task.docId).filter(Boolean));
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const rootDocId = inferTaskRootDocIdFromPath(task.path, taskDocIds);
    if (!rootDocId) {
      continue;
    }
    counts.set(rootDocId, (counts.get(rootDocId) || 0) + 1);
  }
  return counts;
}

function mergeTaskRootCounts(...maps: Array<Map<string, number>>): Map<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [docId, count] of map) {
      merged.set(docId, (merged.get(docId) || 0) + count);
    }
  }
  return merged;
}

function inferTaskRootDocIdFromPath(path: string | undefined, taskDocIds: Set<string>): string | undefined {
  const segments = splitDocPathSegments(path);
  if (segments.length < 2 || taskDocIds.size === 0) {
    return undefined;
  }

  const firstTaskIndex = segments.findIndex((segment) => taskDocIds.has(segment));
  if (firstTaskIndex <= 0) {
    return undefined;
  }
  return segments[firstTaskIndex - 1];
}

function splitDocPathSegments(path?: string): string[] {
  return (path || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/\.sy$/i, "").trim())
    .filter(Boolean);
}

function sameTaskRootSettings(left: TaskSettings, right: TaskSettings): boolean {
  return left.taskRootDocId === right.taskRootDocId
    && left.taskRootNotebookId === right.taskRootNotebookId
    && left.taskRootPath === right.taskRootPath
    && left.taskRootHPath === right.taskRootHPath
    && left.taskRootTitle === right.taskRootTitle;
}

async function syncTaskRootMarker(
  docId: string,
  options: {
    additionalStaleDocIds?: string[];
    forceWrite?: boolean;
  } = {}
): Promise<void> {
  const staleDocIds = new Set((options.additionalStaleDocIds || []).filter(Boolean));
  staleDocIds.delete(docId);

  if (options.forceWrite || staleDocIds.size > 0) {
    await setBlockAttrs(docId, {
      [ROOT_ATTRS.active]: "1",
      [ROOT_ATTRS.updatedAt]: nowIso()
    });
  }

  for (const staleDocId of staleDocIds) {
    await setBlockAttrs(staleDocId, {
      [ROOT_ATTRS.active]: "",
      [ROOT_ATTRS.updatedAt]: ""
    }).catch(() => undefined);
  }
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

async function resolveParentCreatePath(settings: TaskSettings, parent?: TaskItem): Promise<string> {
  if (parent?.docId) {
    const parentPath = await getTaskPath(parent.docId).catch(() => undefined);
    if (parentPath) {
      return parentPath;
    }
  }

  if (parent?.path) {
    return parent.path;
  }

  if (settings.taskRootPath) {
    return settings.taskRootPath;
  }

  if (settings.taskRootDocId) {
    const rootPath = await getTaskPath(settings.taskRootDocId).catch(() => undefined);
    if (rootPath) {
      return rootPath;
    }
  }

  return await resolveParentHPath(settings, parent);
}

async function createTaskDocWithTitle(
  notebookId: string,
  parentPath: string,
  title: string,
  markdown: string
): Promise<{ docId: string; path?: string }> {
  const finalParentPath = normalizeCreatePath(parentPath);
  const tempName = `__task-tracker-tmp-${newSiyuanId()}`;
  const tempHPath = `/${tempName}.sy`;
  const created = await resolveCreatedDocRef(
    notebookId,
    await createDocWithMd(notebookId, tempHPath, markdown),
    tempHPath
  );
  const createdPath = created.path || tempHPath;

  if (finalParentPath !== "/") {
    await moveDocs([createdPath], notebookId, finalParentPath);
  }

  await renameDocWithUniqueTitle(created.docId, title);
  const finalPath = await getTaskPath(created.docId);
  return { docId: created.docId, path: finalPath || createdPath };
}

function taskDocumentTitle(task: Pick<TaskItem, "createdAt" | "title">): string {
  const dateKey = toDateKey(task.createdAt) || toDateKey(nowIso());
  const prefix = dateKey.slice(5).replace("-", "");
  return `${prefix}-${task.title}`;
}

function normalizeCreatePath(path: string): string {
  const normalized = (path || "").replace(/\\/g, "/").trim();
  if (!normalized || normalized === "/") {
    return "/";
  }
  return `/${normalized.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

async function renameDocWithUniqueTitle(docId: string, title: string): Promise<void> {
  const baseName = sanitizeDocName(title);
  let lastError: unknown;

  for (let index = 0; index < 50; index += 1) {
    const name = index === 0 ? baseName : `${baseName} (${index + 1})`;
    try {
      await renameDocById(docId, name);
      return;
    } catch (error) {
      lastError = error;
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      if (message.includes("exist") || message.includes("已存在") || message.includes("duplicate")) {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("重命名任务文档失败");
}

async function getTaskPath(docId: string): Promise<string | undefined> {
  const block = await getBlockById(docId).catch(() => undefined);
  return block?.path;
}

async function resolveCreatedDocRef(
  notebookId: string,
  createResult: string,
  requestedHPath: string
): Promise<{ docId: string; path?: string }> {
  const directPath = await getTaskPath(createResult).catch(() => undefined);
  if (directPath) {
    return {
      docId: createResult,
      path: directPath
    };
  }

  const docRef = await getDocRefByHPath(notebookId, requestedHPath).catch(() => undefined);
  if (docRef) {
    return {
      docId: docRef.id,
      path: docRef.path
    };
  }

  throw new Error("创建任务文档后无法定位真实文档路径");
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
  return ensureArchiveDoc(settings, rootHPath, "已完成");
}

async function ensureArchiveWeekDoc(settings: TaskSettings, week: string): Promise<string> {
  const rootHPath = await resolveParentHPath(settings);
  const archiveHPath = normalizeHPath(`${rootHPath === "/" ? "" : rootHPath}/已完成`);
  await ensureArchiveRootDoc(settings);
  return ensureArchiveDoc(settings, archiveHPath, week);
}

interface WeeklyReportRootRef {
  hpath: string;
  path: string;
}

async function ensureWeeklyReportRoot(settings: TaskSettings): Promise<WeeklyReportRootRef> {
  const rootHPath = await resolveParentHPath(settings);
  const reportRootHPath = normalizeHPath(`${rootHPath === "/" ? "" : rootHPath}/周报`);
  const path = await ensureArchiveDoc(settings, rootHPath, "周报");
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
      const created = await resolveCreatedDocRef(
        notebookId,
        await createDocWithMd(notebookId, `${hpath}.sy`, markdown),
        hpath
      );
      const path = await getTaskPath(created.docId);
      return { docId: created.docId, path: path || created.path || `${hpath}.sy` };
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

function isWeeklyReportPath(path: string | undefined, settings: TaskSettings): boolean {
  if (!path || !settings.taskRootPath) {
    return false;
  }
  const rootPath = stripDocSuffix(settings.taskRootPath);
  const reportRoot = `${rootPath}/周报`;
  return stripDocSuffix(path).startsWith(reportRoot);
}

function isWeeklyReportDoc(doc: Pick<BlockRow, "path" | "hpath">, settings: TaskSettings): boolean {
  return isTaskLibrarySpecialDoc(doc.hpath, settings, "周报") || isWeeklyReportPath(doc.path, settings);
}

function isArchivedTaskDoc(path: string | undefined, hpath: string | undefined, settings: TaskSettings): boolean {
  return isTaskLibrarySpecialDoc(hpath, settings, "已完成");
}

function isArchiveContainerDoc(hpath: string | undefined, settings: TaskSettings): boolean {
  const relative = relativeTaskLibraryHPath(hpath, settings);
  if (!relative) {
    return false;
  }
  return relative === "/已完成" || /^\/已完成\/\d{4}-\d{2}(?:-\d{2})?$/u.test(relative);
}

function isTaskLibrarySpecialDoc(hpath: string | undefined, settings: TaskSettings, folderName: "周报" | "已完成"): boolean {
  const relative = relativeTaskLibraryHPath(hpath, settings);
  return Boolean(relative && (relative === `/${folderName}` || relative.startsWith(`/${folderName}/`)));
}

function relativeTaskLibraryHPath(hpath: string | undefined, settings: TaskSettings): string | undefined {
  const normalizedDocHPath = normalizeOptionalHPath(hpath);
  const normalizedRootHPath = normalizeOptionalHPath(settings.taskRootHPath);
  if (!normalizedDocHPath || !normalizedRootHPath) {
    return undefined;
  }
  if (normalizedDocHPath === normalizedRootHPath) {
    return "/";
  }
  if (!normalizedDocHPath.startsWith(`${normalizedRootHPath}/`)) {
    return undefined;
  }
  return normalizedDocHPath.slice(normalizedRootHPath.length) || "/";
}

function normalizeOptionalHPath(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? normalizeHPath(trimmed) : undefined;
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

function renderTaskMarkdown(
  task: TaskItem,
  parent?: TaskItem,
  children: TaskItem[] = [],
  settings: TaskSettings = {},
  detail?: string
): string {
  const template = settings.taskTemplate?.trim() || DEFAULT_TASK_TEMPLATE;
  const markdown = renderTemplate(template, task, parent, children, settings);
  const withProgress = rewriteTaskProgressSection(markdown, task.progressRecords);
  return rewriteTaskDetail(withProgress, detail || "");
}

function renderTemplate(template: string, task: TaskItem, parent?: TaskItem, children: TaskItem[] = [], settings: TaskSettings = {}): string {
  const replacements: Record<string, string> = {
    title: escapeMd(task.title),
    source: task.sourceBlockId ? blockRef(task.sourceBlockId, task.sourceText || "来源") : "手动创建",
    parent: parent ? blockRef(parent.docId, parent.title) : "无",
    project: task.project || "未设置",
    status: getStatusLabel(task.status, settings),
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

function renderTaskMetadataBlock(task: TaskItem, parent?: TaskItem, children: TaskItem[] = [], settings: TaskSettings = {}): string {
  const sourceRef = task.sourceBlockId ? blockRef(task.sourceBlockId, task.sourceText || "来源") : "手动创建";
  const parentRef = parent ? blockRef(parent.docId, parent.title) : "无";

  return `> 来源：${sourceRef}
> 父任务：${parentRef}
> 项目：${task.project || "未设置"}
> 状态：${getStatusLabel(task.status, settings)}
> 优先级：${TASK_PRIORITY_LABELS[task.priority]}
> ${TASK_LATEST_LABEL}：${task.description || "无"}
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

function buildTaskProgressSection(records?: ProgressRecord[]): string {
  const body = renderManagedTaskProgressSectionBody(records);
  return `## ${TASK_PROGRESS_HEADING}\n\n${body}\n`;
}

function rewriteTaskProgressSection(markdown: string, records?: ProgressRecord[]): string {
  const normalizedMarkdown = markdown.replace(/\s+$/u, "");
  const nextSection = buildTaskProgressSection(records).replace(/\s+$/u, "");
  const progressSection = findTaskProgressSection(normalizedMarkdown);
  if (progressSection) {
    const before = normalizedMarkdown.slice(0, progressSection.headingStart).replace(/\s+$/u, "");
    const after = normalizedMarkdown.slice(progressSection.nextHeadingStart).replace(/^\s*/u, "");
    return `${before}\n\n${nextSection}${after ? `\n\n${after}` : ""}`.trimStart() + "\n";
  }

  const detailSection = findTaskDetailSection(normalizedMarkdown);
  if (detailSection) {
    const before = normalizedMarkdown.slice(0, detailSection.headingStart).replace(/\s+$/u, "");
    const after = normalizedMarkdown.slice(detailSection.headingStart).replace(/^\s*/u, "");
    return `${before}\n\n${nextSection}\n\n${after}`.trimStart() + "\n";
  }

  return `${normalizedMarkdown}\n\n${nextSection}`.trimStart() + "\n";
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

function buildManagedHeadingSectionMarkdown(title: string, bodyMarkdown: string, level = 2): string {
  const headingMarkdown = `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${title}`;
  return bodyMarkdown ? `${headingMarkdown}\n\n${bodyMarkdown}` : headingMarkdown;
}

async function insertManagedHeadingSectionBlock(
  docId: string,
  nextSectionMarkdown: string,
  options: {
    beforeHeadings?: string[];
    afterHeadings?: string[];
  } = {}
): Promise<void> {
  const nextSection = nextSectionMarkdown.replace(/\s+$/u, "");
  const beforeHeading = options.beforeHeadings?.length
    ? await findHeadingBlock(docId, options.beforeHeadings)
    : undefined;
  if (beforeHeading?.id) {
    await insertBlock(nextSection, { nextID: beforeHeading.id, parentID: docId });
    return;
  }

  const afterHeading = options.afterHeadings?.length
    ? await findHeadingBlock(docId, options.afterHeadings)
    : undefined;
  if (afterHeading?.id) {
    const nextSiblingId = await findNextSiblingBlockId(docId, afterHeading.id);
    if (nextSiblingId) {
      await insertBlock(nextSection, { nextID: nextSiblingId, parentID: docId });
      return;
    }
    await insertBlock(nextSection, { previousID: afterHeading.id, parentID: docId });
    return;
  }

  await appendBlock(docId, nextSection);
}

async function findNextSiblingBlockId(docId: string, blockId: string): Promise<string | undefined> {
  const rows = await sql<Array<{ id: string }>[number]>(`select id from blocks
where root_id = '${sqlText(docId)}'
  and parent_id = '${sqlText(docId)}'
order by sort asc`);
  const index = rows.findIndex((row) => row.id === blockId);
  if (index === -1) {
    return undefined;
  }
  return rows[index + 1]?.id;
}

function findTaskDetailSection(markdown: string): { headingStart: number; bodyStart: number; nextHeadingStart: number } | undefined {
  return findSectionBoundsByHeadings(markdown, [TASK_DETAIL_HEADING]);
}

function findTaskProgressSection(markdown: string): { headingStart: number; bodyStart: number; nextHeadingStart: number } | undefined {
  return findSectionBoundsByHeadings(markdown, [TASK_PROGRESS_HEADING]);
}

function findSectionBoundsByHeadings(markdown: string, headings: string[]): { headingStart: number; bodyStart: number; nextHeadingStart: number } | undefined {
  const normalizedHeadings = headings
    .map((heading) => heading.trim())
    .filter(Boolean);
  if (!normalizedHeadings.length) {
    return undefined;
  }

  const escapedHeadings = normalizedHeadings
    .map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const headingRegex = new RegExp(`^#{1,6}\\s+(?:${escapedHeadings})\\s*$`, "gm");
  const match = headingRegex.exec(markdown);
  if (!match) {
    return undefined;
  }

  const headingStart = match.index || 0;
  const headingEnd = headingStart + match[0].length;
  const bodyStart = headingEnd < markdown.length && markdown[headingEnd] === "\n" ? headingEnd + 1 : headingEnd;
  const nextHeadingRegex = /^#{1,6}\s+/gm;
  nextHeadingRegex.lastIndex = bodyStart;
  const nextHeading = nextHeadingRegex.exec(markdown);
  return {
    headingStart,
    bodyStart,
    nextHeadingStart: nextHeading?.index ?? markdown.length
  };
}

function buildWeeklyReportMarkdown(title: string, itemsBody: string, progressBody: string, summaryBody: string, planBody: string): string {
  const normalizedProgress = normalizeSectionBody(progressBody);
  const normalizedSummary = normalizeSectionBody(summaryBody);
  const normalizedPlan = normalizeSectionBody(planBody);
  const hasProgress = Boolean(normalizedProgress);
  const summaryHeading = hasProgress ? "## 三、本周工作总结" : "## 二、本周工作总结";
  const planHeading = hasProgress ? "## 四、下周工作计划" : "## 三、下周工作计划";
  return `# ${title}

## 一、本周完成事项
${itemsBody}

${hasProgress ? `## 二、本周推进事项
${normalizedProgress}

` : ""}${summaryHeading}
${normalizedSummary}${normalizedSummary ? "\n" : ""}

${planHeading}
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

function renderWeeklyProgressBody(week: string, tasks: TaskItem[]): string {
  const groups = groupWeeklyProgressRecords(tasks, week);
  if (!groups.length) {
    return "";
  }

  return groups.map(({ groupTask, entries }) => {
    const lines = entries.map(({ task, record }) => {
      const taskPrefix = task.id !== groupTask.id ? `【${task.title}】` : "";
      return `- ${record.date.slice(5)}${taskPrefix}：${normalizeWeeklyProgressLine(record.content)}`;
    }).join("\n");
    return `### ${groupTask.title}\n${lines}`;
  }).join("\n\n");
}

function rewriteWeeklyReportMarkdown(markdown: string, title: string, itemsBody: string, progressBody: string): string {
  const report = parseWeeklyReportSections(markdown);
  return buildWeeklyReportMarkdown(title, itemsBody, progressBody, report.summaryBody, report.planBody);
}

function parseWeeklyReportSections(markdown: string): { summaryBody: string; planBody: string } {
  const summaryBody = extractWeeklyReportSectionBody(
    markdown,
    ["三、本周工作总结", "二、本周工作总结", "本周工作总结"],
    ["四、下周工作计划", "三、下周工作计划", "下周工作计划"]
  );
  const planBody = extractWeeklyReportSectionBody(markdown, ["四、下周工作计划", "三、下周工作计划", "下周工作计划"], []);
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

function normalizeWeeklyProgressLine(value: string): string {
  return value.replace(/\r?\n+/g, " ").trim();
}

function truncateWeeklyReportDirtyTail(value: string): string {
  const footnoteStart = /(?:^|\n)\[\^[^\]]+\]:\s+/m.exec(value)?.index;
  const taskSectionHeadingStart = /(?:^|\n)\s*##\s+(?:任务概要|任务详情|推进记录)\s*$/m.exec(value)?.index;
  const taskMetadataStart = /(?:^|\n)\s*(?:>\s*)?来源：[^\n]*(?:\n\s*(?:>\s*)?父任务：[^\n]*)?(?:\n\s*(?:>\s*)?项目：[^\n]*)?(?:\n\s*(?:>\s*)?状态：[^\n]*)?/m.exec(value)?.index;
  const taskSummaryTableStart = /(?:^|\n)\s*\|\s*项目\s*\|[^\n]*\|\s*来源\s*\|/m.exec(value)?.index;
  const starts = [footnoteStart, taskSectionHeadingStart, taskMetadataStart, taskSummaryTableStart]
    .filter((index): index is number => index !== undefined);
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

  const unexpectedReportSection = /^## (?:一、本周完成事项|本周完成事项|二、本周推进事项|本周推进事项|三、本周工作总结|二、本周工作总结|本周工作总结|四、下周工作计划|三、下周工作计划|下周工作计划)$/gm;
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
  任务近况: string;
  创建时间: string;
  完成时间: string;
  截止时间: string;
  计划时间: string;
  父任务: string;
  子任务: string;
};

function buildTaskSummaryValueMap(task: TaskItem, parent?: TaskItem, children: TaskItem[] = [], settings: TaskSettings = {}): TaskSummaryValueMap {
  const sourceRef = task.sourceBlockId ? blockRef(task.sourceBlockId, task.sourceText || "来源") : "手动创建";
  const parentRef = parent ? blockRef(parent.docId, parent.title) : "无";
  return {
    项目: task.project || "未设置",
    状态: getStatusLabel(task.status, settings),
    来源: sourceRef,
    优先级: TASK_PRIORITY_LABELS[task.priority],
    任务近况: task.description || "无",
    创建时间: formatTaskDate(task.createdAt),
    完成时间: formatTaskDate(task.completedAt),
    截止时间: formatTaskDate(task.dueDate),
    计划时间: formatTaskDate(task.planStart),
    父任务: parentRef,
    子任务: renderChildRefs(children, "inline")
  };
}

function buildTaskSummaryLabelLines(task: TaskItem, parent?: TaskItem, children: TaskItem[] = [], settings: TaskSettings = {}): string[] {
  const values = buildTaskSummaryValueMap(task, parent, children, settings);
  return [
    `<strong>父任务</strong> ：${values["父任务"]}`,
    `<strong>子任务</strong> ：${values["子任务"]}`,
    `<strong>${TASK_LATEST_LABEL}</strong> ：${values["任务近况"]}`
  ];
}

function buildManagedTaskSummaryBlocks(tableMarkdown: string, lines: string[]): string[] {
  const normalizedTable = tableMarkdown.replace(/\s+$/u, "");
  const normalizedLines = lines.map((line) => line.trim()).filter(Boolean);
  return [
    normalizedTable,
    ...normalizedLines,
    "---"
  ];
}

function renderManagedTaskSummarySectionBody(tableMarkdown: string, lines: string[]): string {
  return buildManagedTaskSummaryBlocks(tableMarkdown, lines).join("\n\n");
}

function renderManagedTaskProgressSectionBody(records?: ProgressRecord[]): string {
  const content = renderProgressRecordsMarkdown(records).replace(/\s+$/u, "");
  return [
    content,
    "",
    "---"
  ].join("\n");
}

type RootTaskBlock = {
  id: string;
  type: string;
  content?: string;
};

async function healCorruptedTaskDocument(task: TaskItem, currentSynced = false): Promise<boolean> {
  const expectedTitles = [task.title, taskDocumentTitle(task)];
  const rootBlocks = await listRootTaskBlocks(task.docId).catch(() => []);
  const duplicateHeadingBlocks = rootBlocks.filter((block) => block.type === "h" && matchesDuplicatedTaskTitle(block.content, expectedTitles));
  const duplicateMetadataBlocks = rootBlocks.filter((block) => block.type === "p" && isDuplicatedTaskMetadataParagraph(block.content, expectedTitles));
  const managedSectionBlocks = rootBlocks.filter((block) => block.type === "h" && isManagedTaskSectionHeading(block.content));
  const separatorBlocks = rootBlocks.filter((block) => block.type === "tb");
  const duplicateManagedSections = hasDuplicateManagedSections(managedSectionBlocks);
  if (!duplicateHeadingBlocks.length && !duplicateMetadataBlocks.length && !duplicateManagedSections) {
    return currentSynced;
  }

  const currentMarkdown = await readDocMarkdown(task.docId).catch(() => "");
  if (!currentMarkdown) {
    return currentSynced;
  }

  const summaryBody = normalizeManagedSectionBody(extractHeadingSectionBody(currentMarkdown, [TASK_SUMMARY_HEADING]) || "");
  const detailBody = extractTaskDetail(currentMarkdown);
  const blocksToDelete = uniqueRootBlocks([
    ...duplicateHeadingBlocks,
    ...duplicateMetadataBlocks,
    ...separatorBlocks,
    ...(duplicateHeadingBlocks.length || duplicateMetadataBlocks.length || duplicateManagedSections ? managedSectionBlocks : [])
  ]);

  for (const block of blocksToDelete) {
    if (block.type === "h") {
      await deleteBlockTree(block.id).catch(() => undefined);
      continue;
    }
    await deleteBlock(block.id).catch(() => undefined);
  }

  if (summaryBody) {
    await appendBlock(task.docId, buildManagedHeadingSectionMarkdown(TASK_SUMMARY_HEADING, summaryBody, 2));
  }
  await appendBlock(task.docId, buildTaskProgressSection(task.progressRecords).replace(/\s+$/u, ""));
  await appendBlock(task.docId, buildTaskDetailSection(detailBody).replace(/\s+$/u, ""));
  return true;
}

async function listRootTaskBlocks(docId: string): Promise<RootTaskBlock[]> {
  return sql<RootTaskBlock>(`select id, type, content from blocks
where root_id = '${sqlText(docId)}'
  and parent_id = '${sqlText(docId)}'
order by sort asc`);
}

function isDuplicatedTaskMetadataParagraph(content?: string, title?: string | string[]): boolean {
  const expectedTitles = Array.isArray(title)
    ? title.map((item) => item.trim()).filter(Boolean)
    : [title?.trim()].filter(Boolean);
  const normalizedContent = content?.replace(/\r\n/g, "\n") || "";
  if (!expectedTitles.length || !normalizedContent) {
    return false;
  }

  const lines = normalizedContent.split("\n").map((line) => line.trimEnd());
  return expectedTitles.some((expectedTitle) => lines[0] === `title: ${expectedTitle}`)
    && /^date:\s+\S+/u.test(lines[1] || "")
    && /^lastmod:\s+\S+/u.test(lines[2] || "");
}

function matchesDuplicatedTaskTitle(content?: string, expectedTitles: string[] = []): boolean {
  const normalizedContent = content?.trim();
  if (!normalizedContent) {
    return false;
  }
  return expectedTitles.map((title) => title.trim()).filter(Boolean).includes(normalizedContent);
}

function isManagedTaskSectionHeading(content?: string): boolean {
  const normalizedContent = content?.trim();
  if (!normalizedContent) {
    return false;
  }
  return MANAGED_TASK_SECTION_HEADINGS.includes(normalizedContent as typeof MANAGED_TASK_SECTION_HEADINGS[number]);
}

function hasDuplicateManagedSections(blocks: RootTaskBlock[]): boolean {
  const seen = new Set<string>();
  for (const block of blocks) {
    const key = block.content?.trim();
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
}

function uniqueRootBlocks(blocks: RootTaskBlock[]): RootTaskBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (!block.id || seen.has(block.id)) {
      return false;
    }
    seen.add(block.id);
    return true;
  });
}

async function deleteBlockTree(blockId: string): Promise<void> {
  const children = await getChildBlocks(blockId).catch(() => []);
  for (const child of [...children].reverse()) {
    await deleteBlockTree(child.id).catch(() => undefined);
  }
  await deleteBlock(blockId);
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

function renderTaskSummaryTable(markdown: string, task: TaskItem, parent?: TaskItem, children: TaskItem[] = [], settings: TaskSettings = {}): string {
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
    const values = buildTaskSummaryValueMap(task, parent, children, settings);
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

  const values = buildTaskSummaryValueMap(task, parent, children, settings);
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
  const heading = await findHeadingBlock(task.docId, TASK_DESCRIPTION_HEADINGS);
  if (!heading) {
    return currentSynced;
  }
  const changed = await replaceManagedHeadingSection(task.docId, TASK_DESCRIPTION_HEADINGS, task.description || "", {
    createIfMissing: false
  });
  return currentSynced || changed;
}

async function syncManagedTaskProgressSection(task: TaskItem, currentSynced = false): Promise<boolean> {
  const changed = await replaceManagedHeadingSectionBlocks(task.docId, [TASK_PROGRESS_HEADING], [
    renderProgressRecordsMarkdown(task.progressRecords),
    "---"
  ], {
    createIfMissing: true,
    insertBeforeHeadings: [TASK_DETAIL_HEADING],
    insertAfterHeadings: [TASK_SUMMARY_HEADING]
  });
  return currentSynced || changed;
}

async function replaceManagedHeadingSectionBlocks(
  docId: string,
  headings: string[],
  bodyBlocks: string[],
  options: {
    createIfMissing?: boolean;
    headingLevel?: number;
    insertBeforeHeadings?: string[];
    insertAfterHeadings?: string[];
  } = {}
): Promise<boolean> {
  const normalizedBlocks = bodyBlocks
    .map((block) => normalizeManagedSectionBody(block))
    .filter(Boolean);
  const normalizedBody = normalizedBlocks.join("\n\n");
  const heading = await findHeadingBlock(docId, headings);
  if (!heading) {
    if (!options.createIfMissing || !normalizedBlocks.length) {
      return false;
    }
    const level = Math.min(Math.max(options.headingLevel || 2, 1), 6);
    const title = headings[0] || TASK_DETAIL_HEADING;
    const nextMarkdown = buildManagedHeadingSectionMarkdown(title, normalizedBody, level);
    await insertManagedHeadingSectionBlock(docId, nextMarkdown, {
      beforeHeadings: options.insertBeforeHeadings,
      afterHeadings: options.insertAfterHeadings
    });
    return true;
  }

  const currentMarkdown = await readDocMarkdown(docId).catch(() => "");
  const currentBody = normalizeManagedSectionBody(extractHeadingSectionBody(currentMarkdown, headings) || "");
  if (currentBody === normalizedBody) {
    return false;
  }

  const children = await getChildBlocks(heading.id).catch(() => []);
  for (const child of [...children].reverse()) {
    await deleteBlock(child.id).catch(() => undefined);
  }
  if (!normalizedBlocks.length) {
    return children.length > 0;
  }
  for (const block of normalizedBlocks) {
    await appendBlock(heading.id, block);
  }
  return true;
}

async function replaceManagedHeadingSection(
  docId: string,
  headings: string[],
  bodyMarkdown: string,
  options: {
    createIfMissing?: boolean;
    headingLevel?: number;
    insertBeforeHeadings?: string[];
    insertAfterHeadings?: string[];
  } = {}
): Promise<boolean> {
  const normalizedBody = normalizeManagedSectionBody(bodyMarkdown);
  const heading = await findHeadingBlock(docId, headings);
  if (!heading) {
    if (!options.createIfMissing) {
      return false;
    }
    if (!normalizedBody) {
      return false;
    }
    const level = Math.min(Math.max(options.headingLevel || 2, 1), 6);
    const title = headings[0] || TASK_DETAIL_HEADING;
    const nextMarkdown = buildManagedHeadingSectionMarkdown(title, normalizedBody, level);
    await insertManagedHeadingSectionBlock(docId, nextMarkdown, {
      beforeHeadings: options.insertBeforeHeadings,
      afterHeadings: options.insertAfterHeadings
    });
    return true;
  }

  const currentMarkdown = await readDocMarkdown(docId).catch(() => "");
  const currentBody = normalizeManagedSectionBody(extractHeadingSectionBody(currentMarkdown, headings) || "");
  if (currentBody === normalizedBody) {
    return false;
  }

  const children = await getChildBlocks(heading.id).catch(() => []);
  for (const child of [...children].reverse()) {
    await deleteBlock(child.id).catch(() => undefined);
  }
  if (!normalizedBody) {
    return children.length > 0;
  }
  await appendBlock(heading.id, normalizedBody);
  return true;
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

function extractHeadingSectionBody(markdown: string, headings: string[]): string | undefined {
  const normalizedHeadings = headings
    .map((heading) => heading.trim())
    .filter(Boolean);
  if (!normalizedHeadings.length) {
    return undefined;
  }

  const escapedHeadings = normalizedHeadings
    .map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const headingRegex = new RegExp(`^#{1,6}\\s+(?:${escapedHeadings})\\s*$`, "gm");
  const match = headingRegex.exec(markdown);
  if (!match) {
    return undefined;
  }

  const headingStart = match.index || 0;
  const headingEnd = headingStart + match[0].length;
  const bodyStart = headingEnd < markdown.length && markdown[headingEnd] === "\n" ? headingEnd + 1 : headingEnd;
  const nextHeadingRegex = /^#{1,6}\s+/gm;
  nextHeadingRegex.lastIndex = bodyStart;
  const nextHeading = nextHeadingRegex.exec(markdown);
  const nextHeadingStart = nextHeading?.index ?? markdown.length;
  return markdown.slice(bodyStart, nextHeadingStart);
}

function normalizeManagedSectionBody(value: string): string {
  return value
    .replace(/^\n+/u, "")
    .replace(/\s+$/u, "");
}

function sameMarkdownContent(left?: string, right?: string): boolean {
  return normalizeMarkdownContent(left) === normalizeMarkdownContent(right);
}

function normalizeMarkdownContent(value?: string): string {
  return (value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/u, "");
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
    [TASK_ATTRS.progressRecords]: serializeProgressRecords(task.progressRecords),
    [TASK_ATTRS.noteFolderPath]: task.noteFolderPath || ""
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

function sameTaskCollections(left: TaskItem[], right: TaskItem[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftSnapshots = new Map(left.map((task) => [task.id, taskSnapshot(task)]));
  for (const task of right) {
    if (leftSnapshots.get(task.id) !== taskSnapshot(task)) {
      return false;
    }
  }
  return true;
}

function taskSnapshot(task: TaskItem): string {
  return JSON.stringify({
    id: task.id,
    title: task.title,
    docId: task.docId,
    notebookId: task.notebookId,
    path: task.path,
    parentId: task.parentId || "",
    sourceBlockId: task.sourceBlockId || "",
    sourceDocId: task.sourceDocId || "",
    sourceText: task.sourceText || "",
    project: task.project || "",
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate || "",
    planStart: task.planStart || "",
    planEnd: task.planEnd || "",
    description: task.description || "",
    progressRecords: normalizeProgressRecords(task.progressRecords),
    noteFolderPath: task.noteFolderPath || "",
    createdAt: task.createdAt || "",
    updatedAt: task.updatedAt || "",
    completedAt: task.completedAt || ""
  });
}

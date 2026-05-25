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
  DEFAULT_TASK_TEMPLATE,
  ROOT_ATTRS,
  REPORT_ATTRS,
  SOURCE_TASK_IDS_ATTR,
  TASK_ATTRS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  WEEKLY_REPORT_KIND,
  type BlockRow,
  type SourceContext,
  type TaskCreateInput,
  type TaskItem,
  type TaskSettings
} from "./types";

const WEEKDAY_LABELS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"] as const;
const TASK_DETAIL_HEADING = "任务详情";

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
      status: input.status || "todo",
      dueDate: input.dueDate || undefined,
      planStart: input.planStart || undefined,
      planEnd: input.planEnd || undefined,
      description: input.description?.trim() || undefined,
      createdAt,
      updatedAt: now,
      completedAt: input.status === "completed" ? now : undefined
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
    if (actualTask.status === "completed" && !actualTask.parentId) {
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
    if ((normalized.status ?? current.status) === "completed" && !normalized.completedAt) {
      throw new Error("已完成任务必须填写完成时间");
    }
    let task = await this.store.update(id, normalized);
    const parentIdChanged = current.parentId !== task.parentId;
    if (current.status !== "completed" && task.status === "completed" && !task.parentId) {
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

  async startupSync(options: { skipDeletedCleanup?: boolean } = {}): Promise<{ removed: number; synced: number }> {
    await this.waitForStartupSync({
      maxWaitMs: this.store.getSettings().startupSyncGraceMs ?? 12000
    });
    await this.reconcileTaskRootSettings();

    let removed = 0;
    const indexedTasks = this.store.all();
    const discoveredTasks = await this.collectTasksFromRoot();
    if (indexedTasks.length === 0) {
      if (discoveredTasks.length > 0) {
        await this.store.replaceAll(discoveredTasks);
        this.emit();
      }
    } else {
      const discoveredIds = new Set(discoveredTasks.map((task) => task.id));
      const indexedIds = new Set(indexedTasks.map((task) => task.id));
      const missingCount = Array.from(discoveredIds).filter((id) => !indexedIds.has(id)).length;
      if (missingCount > 0) {
        const rebuilt = mergeRecoveredTasks(indexedTasks, discoveredTasks);
        await this.store.replaceAll(rebuilt);
        this.emit();
      } else if (!options.skipDeletedCleanup && discoveredTasks.length >= indexedTasks.length) {
        removed = await this.syncDeletedDocs();
      }
    }

    const synced = await this.syncAllTaskDocuments();
    return { removed, synced };
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
      const batchTasks = await Promise.all(batch.map(async (doc) => {
        const attrs = await getBlockAttrs(doc.id).catch(() => ({}));
        if (attrs[REPORT_ATTRS.kind] === WEEKLY_REPORT_KIND || isWeeklyReportPath(doc.path, settings)) {
          return undefined;
        }
        const taskId = attrs[TASK_ATTRS.id]?.trim();
        if (!taskId) {
          return undefined;
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
  return rows.filter((row) => !isWeeklyReportPath(row.path, settings));
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
    description: attrs[TASK_ATTRS.description]?.trim() || undefined
  };
}

function normalizeRecoveredTitle(doc: BlockRow): string {
  const title = doc.content?.trim();
  if (title) {
    return title;
  }
  const fromPath = doc.path.split("/").pop()?.replace(/\.sy$/i, "").trim();
  if (!fromPath) {
    return doc.id;
  }
  return fromPath.replace(/^\d{4}-/u, "").trim() || fromPath;
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
  return sql<BlockRow>(`select id, box, path, updated from blocks
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
  if (parent?.path) {
    return stripDocSuffix(parent.path);
  }

  if (parent?.docId) {
    const parentPath = await getTaskPath(parent.docId).catch(() => undefined);
    if (parentPath) {
      return stripDocSuffix(parentPath);
    }
  }

  if (settings.taskRootPath) {
    return stripDocSuffix(settings.taskRootPath);
  }

  if (settings.taskRootDocId) {
    const rootPath = await getTaskPath(settings.taskRootDocId).catch(() => undefined);
    if (rootPath) {
      return stripDocSuffix(rootPath);
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
  const docId = await createDocWithMd(notebookId, tempHPath, markdown);
  const createdPath = await getTaskPath(docId) || tempHPath;

  if (finalParentPath !== "/") {
    await moveDocs([createdPath], notebookId, finalParentPath);
  }

  await renameDocWithUniqueTitle(docId, title);
  const finalPath = await getTaskPath(docId);
  return { docId, path: finalPath || createdPath };
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

function isWeeklyReportPath(path: string | undefined, settings: TaskSettings): boolean {
  if (!path || !settings.taskRootPath) {
    return false;
  }
  const rootPath = stripDocSuffix(settings.taskRootPath);
  const reportRoot = `${rootPath}/周报`;
  return stripDocSuffix(path).startsWith(reportRoot);
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
    [TASK_ATTRS.description]: task.description || ""
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

import {
  createDocWithMd,
  getBlockAttrs,
  getBlockById,
  getHPathById,
  moveDocs,
  removeDoc,
  renameDocById,
  setBlockAttrs,
  sql,
  sqlText,
  updateBlock
} from "./api";
import { newSiyuanId, nowIso, toDateKey } from "./date";
import { TaskStore } from "./taskStore";
import {
  ACTIVE_TASK_STATUSES,
  DEFAULT_TASK_TEMPLATE,
  SOURCE_TASK_IDS_ATTR,
  TASK_ATTRS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type SourceContext,
  type TaskCreateInput,
  type TaskItem,
  type TaskSettings
} from "./types";

type ChangeListener = () => void;

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

  async createTask(input: TaskCreateInput): Promise<TaskItem> {
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
      createdAt,
      updatedAt: now,
      completedAt: input.status === "completed" ? now : undefined
    };

    const created = await createTaskDocWithTitle(
      notebookId,
      parentHPath,
      taskDocumentTitle(draftTask),
      renderTaskMarkdown(draftTask, parent, [], settings)
    );
    let actualTask: TaskItem = {
      ...draftTask,
      id: created.docId || docId,
      docId: created.docId || docId,
      path: created.path
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
    let task = await this.store.update(id, normalized);
    if (current.status !== "completed" && task.status === "completed" && !task.parentId) {
      task = await this.archiveCompletedParentTask(task);
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

    for (const doc of await resolveTopLevelTaskDocuments(selectedTasks)) {
      await removeDoc(doc.notebookId, doc.path);
    }

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

  private async syncTaskDocument(id: string): Promise<boolean> {
    const task = this.store.get(id);
    if (!task) {
      return false;
    }

    const metadataBlock = await findTaskMetadataBlock(task.docId);
    if (!metadataBlock) {
      return false;
    }

    const parent = task.parentId ? this.store.get(task.parentId) : undefined;
    const children = this.store.all().filter((item) => item.parentId === task.id);
    await updateBlock(metadataBlock.id, renderTaskMetadataBlock(task, parent, children));
    return true;
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
    if (!settings.taskRootDocId || !settings.taskRootNotebookId || !task.path) {
      return task;
    }

    const month = archiveMonth(task.createdAt);
    const archivePath = await ensureArchiveMonthDoc(settings, month);
    const taskPath = await getTaskPath(task.docId) || task.path;
    if (!taskPath || isTaskUnderArchiveMonth(taskPath, archivePath)) {
      return task;
    }

    await moveDocs([taskPath], settings.taskRootNotebookId, archivePath);
    const ids = expandWithDescendants(this.store.all(), [task.id]);
    let archivedTask = task;
    for (const id of ids) {
      const current = this.store.get(id);
      if (!current) {
        continue;
      }
      const path = await getTaskPath(current.docId);
      if (!path || path === current.path) {
        continue;
      }
      const updated = await this.store.update(id, { path });
      if (id === task.id) {
        archivedTask = updated;
      }
    }
    await this.syncTaskDocuments(ids);
    return archivedTask;
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
  if ("dueDate" in normalized && normalized.dueDate === "") {
    normalized.dueDate = undefined;
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
    if (patch.completedAt === undefined) {
      return patch;
    }
    return { ...patch, completedAt: current.completedAt ?? patch.completedAt };
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

async function resolveTopLevelTaskDocuments(tasks: TaskItem[]): Promise<Array<{ notebookId: string; path: string }>> {
  const documents: Array<{ taskId: string; notebookId: string; path: string; key: string }> = [];
  for (const task of tasks) {
    const doc = await resolveTaskDocument(task);
    const key = taskPathKey(doc?.path);
    if (doc && key) {
      documents.push({ taskId: task.id, notebookId: doc.notebookId, path: doc.path, key });
    }
  }

  return documents
    .filter((doc) => !documents.some((other) => {
      if (other.taskId === doc.taskId || other.notebookId !== doc.notebookId) {
        return false;
      }
      return isDescendantPath(doc.key, other.key);
    }))
    .map(({ notebookId, path }) => ({ notebookId, path }));
}

async function resolveTaskDocument(task: TaskItem): Promise<{ notebookId: string; path: string } | undefined> {
  if (task.notebookId && taskPathKey(task.path)) {
    return { notebookId: task.notebookId, path: task.path };
  }

  const block = await getBlockById(task.docId).catch(() => undefined);
  if (block?.box && block.path) {
    return { notebookId: block.box, path: block.path };
  }
  return undefined;
}

function isDescendantPath(path: string, parentPath: string): boolean {
  return path.startsWith(`${parentPath}/`);
}

function parentIdsForTasks(tasks: TaskItem[], ids: string[]): string[] {
  const idSet = new Set(ids);
  return Array.from(new Set(tasks.filter((task) => idSet.has(task.id) && task.parentId).map((task) => task.parentId as string)));
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
): Promise<{ docId: string; path: string }> {
  const baseName = sanitizeDocName(title);
  const parent = normalizeHPath(parentHPath);
  let lastError: unknown;

  for (let index = 0; index < 50; index += 1) {
    const name = index === 0 ? baseName : `${baseName} (${index + 1})`;
    const path = `${parent === "/" ? "" : parent}/${name}.sy`;
    try {
      const docId = await createDocWithMd(notebookId, path, markdown);
      return { docId, path };
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
  const rows = await sql<TaskMetadataBlock>(`select id, path from blocks
where box = '${sqlText(notebookId)}'
  and type = 'd'
  and hpath = '${sqlText(normalizeHPath(hpath))}'
limit 1`).catch(() => []);
  return rows[0]?.path;
}

async function ensureArchiveMonthDoc(settings: TaskSettings, month: string): Promise<string> {
  if (!settings.taskRootNotebookId) {
    throw new Error("请先将一个文档设为事项库");
  }

  const rootHPath = await resolveParentHPath(settings);
  const monthHPath = `${rootHPath === "/" ? "" : rootHPath}/${month}`;
  const existingPath = await getDocPathByHPath(settings.taskRootNotebookId, monthHPath);
  if (existingPath) {
    return existingPath;
  }

  const path = `${monthHPath}.sy`;
  try {
    const docId = await createDocWithMd(settings.taskRootNotebookId, path, `# ${month}\n`);
    const blockPath = await getTaskPath(docId);
    return blockPath || path;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).toLowerCase();
    if (!message.includes("exist") && !message.includes("已存在") && !message.includes("duplicate")) {
      throw error;
    }
    return await getDocPathByHPath(settings.taskRootNotebookId, monthHPath) || path;
  }
}

function archiveMonth(createdAt: string): string {
  const dateKey = toDateKey(createdAt) || toDateKey(nowIso());
  return dateKey.slice(0, 7);
}

function isTaskUnderArchiveMonth(taskPath: string, archivePath: string): boolean {
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
  settings: TaskSettings = {}
): string {
  const template = settings.taskTemplate?.trim() || DEFAULT_TASK_TEMPLATE;
  return renderTemplate(template, task, parent, children);
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
> 创建时间：${formatTaskDate(task.createdAt)}
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
  const dateKey = toDateKey(value);
  if (!dateKey) {
    return "未设置";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    return dateKey;
  }

  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  if (hours === "00" && minutes === "00") {
    return dateKey;
  }
  return `${dateKey} ${hours}:${minutes}`;
}

async function findTaskMetadataBlock(docId: string): Promise<TaskMetadataBlock | undefined> {
  const rows = await sql<TaskMetadataBlock>(`select id, markdown, content from blocks
where root_id = '${sqlText(docId)}'
  and type = 'b'
  and (markdown like '%来源：%' or content like '%来源：%')
limit 1`);
  return rows[0];
}

interface TaskMetadataBlock {
  id: string;
  path?: string;
  markdown?: string;
  content?: string;
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
    [TASK_ATTRS.parentId]: task.parentId || "",
    [TASK_ATTRS.sourceBlockId]: task.sourceBlockId || "",
    [TASK_ATTRS.sourceDocId]: task.sourceDocId || ""
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

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  default: () => TaskTrackerPlugin
});
module.exports = __toCommonJS(src_exports);
var import_siyuan7 = require("siyuan");

// plugin.json
var plugin_default = {
  name: "siyuan-plugin-task-tracker",
  author: "risoyo",
  url: "https://github.com/risoyo/siyuan-plugin-task-tracker",
  version: "0.4.0",
  minAppVersion: "3.6.4",
  backends: [
    "windows",
    "linux",
    "darwin",
    "docker",
    "all"
  ],
  frontends: [
    "desktop",
    "browser-desktop",
    "desktop-window"
  ],
  disabledInPublish: false,
  displayName: {
    default: "Task Tracker",
    zh_CN: "\u4EFB\u52A1\u8FFD\u8E2A"
  },
  description: {
    default: "Track task-note documents, subtasks, projects, priorities, dates, and calendar views.",
    zh_CN: "\u4EE5\u4EFB\u52A1\u6587\u6863\u4E3A\u4E2D\u5FC3\u7BA1\u7406\u4EFB\u52A1\u3001\u5B50\u4EFB\u52A1\u3001\u9879\u76EE\u3001\u4F18\u5148\u7EA7\u3001\u65E5\u671F\u548C\u65E5\u5386\u89C6\u56FE\u3002"
  },
  readme: {
    default: "README.md",
    zh_CN: "README_zh_CN.md"
  },
  keywords: [
    "task",
    "tasks",
    "calendar",
    "\u4EFB\u52A1\u7BA1\u7406",
    "\u4EFB\u52A1\u8FFD\u8E2A",
    "\u65E5\u5386\u89C6\u56FE"
  ]
};

// src/api.ts
var import_siyuan = require("siyuan");
async function request(url, data = {}) {
  const response = await (0, import_siyuan.fetchSyncPost)(url, data);
  if (!response || response.code !== 0) {
    throw new Error(`${url} failed: ${response?.msg || response?.code || "unknown error"}`);
  }
  return response.data;
}
function sqlText(value) {
  return value.replace(/'/g, "''");
}
async function sql(stmt) {
  return request("/api/query/sql", { stmt });
}
async function getBlockById(id) {
  const rows = await sql(`select * from blocks where id = '${sqlText(id)}' limit 1`);
  return rows[0];
}
async function getHPathById(id) {
  return request("/api/filetree/getHPathByID", { id });
}
async function createDocWithMd(notebook, path, markdown) {
  return request("/api/filetree/createDocWithMd", { notebook, path, markdown });
}
async function updateBlock(id, markdown) {
  await request("/api/block/updateBlock", { id, dataType: "markdown", data: markdown });
}
async function setBlockAttrs(id, attrs) {
  await request("/api/attr/setBlockAttrs", { id, attrs });
}
async function getBlockAttrs(id) {
  return request("/api/attr/getBlockAttrs", { id });
}

// src/date.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function compactDateTime(date = /* @__PURE__ */ new Date()) {
  const pad = (value) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}
function newSiyuanId() {
  const luteId = window.Lute?.NewNodeID?.();
  if (typeof luteId === "string" && luteId.length > 0) {
    return luteId;
  }
  const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0").slice(0, 7);
  return `${compactDateTime()}-${random}`;
}
function toDateKey(value) {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return formatDateKey(date);
}
function formatDateKey(date) {
  const pad = (value) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function fromDatetimeLocal(value) {
  if (!value) {
    return void 0;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return void 0;
  }
  return date.toISOString();
}
function fromDateInput(value, hour = 9) {
  if (!value) {
    return void 0;
  }
  const date = /* @__PURE__ */ new Date(`${value}T${hour.toString().padStart(2, "0")}:00:00`);
  if (Number.isNaN(date.getTime())) {
    return void 0;
  }
  return date.toISOString();
}
function isActiveDateBeforeToday(value) {
  const key = toDateKey(value);
  if (!key) {
    return false;
  }
  return key < formatDateKey(/* @__PURE__ */ new Date());
}
function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}
function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
function monthTitle(date) {
  return `${date.getFullYear()} \u5E74 ${date.getMonth() + 1} \u6708`;
}
function formatHumanDate(value) {
  const key = toDateKey(value);
  return key || "\u672A\u8BBE\u7F6E";
}

// src/types.ts
var TASKS_DATA_FILE = "tasks.json";
var SETTINGS_DATA_FILE = "settings.json";
var DEFAULT_SETTINGS = {};
var DEFAULT_TASK_TEMPLATE = `# {{title}}

> \u6765\u6E90\uFF1A{{source}}
> \u7236\u4EFB\u52A1\uFF1A{{parent}}
> \u9879\u76EE\uFF1A{{project}}
> \u72B6\u6001\uFF1A{{status}}
> \u4F18\u5148\u7EA7\uFF1A{{priority}}
> \u622A\u6B62\u65F6\u95F4\uFF1A{{dueDate}}
> \u8BA1\u5212\u65F6\u95F4\uFF1A{{planStart}}
> \u5B50\u4EFB\u52A1\uFF1A{{childTasks}}

## \u76EE\u6807


## \u80CC\u666F


## \u5206\u6790\u4E0E\u62C6\u89E3


## \u63A8\u8FDB\u8BB0\u5F55


## \u7ED3\u679C\u4E0E\u590D\u76D8

`;
var TASK_STATUS_LABELS = {
  todo: "\u5F85\u5904\u7406",
  doing: "\u8FDB\u884C\u4E2D",
  waiting: "\u7B49\u5F85\u4E2D",
  completed: "\u5DF2\u5B8C\u6210",
  cancelled: "\u5DF2\u53D6\u6D88"
};
var TASK_PRIORITY_LABELS = {
  none: "\u65E0",
  low: "\u4F4E",
  medium: "\u4E2D",
  high: "\u9AD8"
};
var ACTIVE_TASK_STATUSES = ["todo", "doing", "waiting"];
var TASK_ATTRS = {
  id: "custom-task-tracker-id",
  status: "custom-task-tracker-status",
  priority: "custom-task-tracker-priority",
  project: "custom-task-tracker-project",
  dueDate: "custom-task-tracker-due",
  planStart: "custom-task-tracker-plan-start",
  planEnd: "custom-task-tracker-plan-end",
  parentId: "custom-task-tracker-parent",
  sourceBlockId: "custom-task-tracker-source",
  sourceDocId: "custom-task-tracker-source-doc"
};
var SOURCE_TASK_IDS_ATTR = "custom-task-tracker-task-ids";

// src/document.ts
var TaskService = class {
  constructor(store) {
    this.store = store;
    __publicField(this, "listeners", /* @__PURE__ */ new Set());
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async setRootFromDoc(docId) {
    const block = await getBlockById(docId);
    if (!block || !block.box || !block.path) {
      throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u6587\u6863\u4FE1\u606F");
    }
    const hpath = await getHPathById(docId).catch(() => block.content || docId);
    const settings = {
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
  async createTask(input) {
    const settings = this.store.getSettings();
    if (!settings.taskRootDocId || !settings.taskRootNotebookId) {
      throw new Error("\u8BF7\u5148\u5C06\u4E00\u4E2A\u6587\u6863\u8BBE\u4E3A\u4E8B\u9879\u5E93");
    }
    const parent = input.parentId ? this.store.get(input.parentId) : void 0;
    const docId = newSiyuanId();
    const title = input.title.trim();
    const notebookId = parent?.notebookId || settings.taskRootNotebookId;
    const parentHPath = await resolveParentHPath(settings, parent);
    const now = nowIso();
    const draftTask = {
      id: docId,
      title,
      docId,
      notebookId,
      path: "",
      parentId: input.parentId,
      sourceBlockId: input.sourceBlockId,
      sourceDocId: input.sourceDocId,
      sourceText: input.sourceText,
      project: input.project?.trim() || void 0,
      priority: input.priority || "none",
      status: input.status || "todo",
      dueDate: input.dueDate || void 0,
      planStart: input.planStart || void 0,
      planEnd: input.planEnd || void 0,
      createdAt: now,
      updatedAt: now,
      completedAt: input.status === "completed" ? now : void 0
    };
    const created = await createTaskDocWithTitle(
      notebookId,
      parentHPath,
      title,
      renderTaskMarkdown(draftTask, parent, [], settings)
    );
    const actualTask = {
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
    await this.syncTaskDocument(actualTask.id);
    if (actualTask.parentId) {
      await this.syncTaskDocument(actualTask.parentId);
    }
    this.emit();
    return actualTask;
  }
  async updateTask(id, patch) {
    const current = this.store.get(id);
    if (!current) {
      throw new Error("\u4EFB\u52A1\u4E0D\u5B58\u5728");
    }
    const normalized = normalizeCompletion(current, patch);
    const task = await this.store.update(id, normalized);
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
  async completeTask(id) {
    return this.updateTask(id, {
      status: "completed",
      completedAt: nowIso()
    });
  }
  async reopenTask(id) {
    return this.updateTask(id, {
      status: "todo",
      completedAt: void 0
    });
  }
  async removeTaskRecord(id, options = {}) {
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
  async syncDeletedDocs() {
    const missingIds = [];
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
  async syncAllTaskDocuments() {
    return this.syncTaskDocuments(this.store.all().map((task) => task.id));
  }
  activeTasks() {
    return this.store.all().filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  }
  async syncTaskDocument(id) {
    const task = this.store.get(id);
    if (!task) {
      return false;
    }
    const metadataBlock = await findTaskMetadataBlock(task.docId);
    if (!metadataBlock) {
      return false;
    }
    const parent = task.parentId ? this.store.get(task.parentId) : void 0;
    const children = this.store.all().filter((item) => item.parentId === task.id);
    await updateBlock(metadataBlock.id, renderTaskMetadataBlock(task, parent, children));
    return true;
  }
  async syncTaskDocuments(ids) {
    let count = 0;
    for (const id of Array.from(new Set(ids))) {
      if (await this.syncTaskDocument(id)) {
        count += 1;
      }
    }
    return count;
  }
  emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }
};
function normalizeCompletion(current, patch) {
  if (patch.status === "completed" && !patch.completedAt) {
    return { ...patch, completedAt: nowIso() };
  }
  if (current.status === "completed" && patch.status && patch.status !== "completed") {
    return { ...patch, completedAt: void 0 };
  }
  return patch;
}
function collectTaskTreeIds(tasks, rootId) {
  return expandWithDescendants(tasks, [rootId]);
}
function expandWithDescendants(tasks, ids) {
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
function parentIdsForTasks(tasks, ids) {
  const idSet = new Set(ids);
  return Array.from(new Set(tasks.filter((task) => idSet.has(task.id) && task.parentId).map((task) => task.parentId)));
}
async function resolveParentHPath(settings, parent) {
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
async function createTaskDocWithTitle(notebookId, parentHPath, title, markdown) {
  const baseName = sanitizeDocName(title);
  const parent = normalizeHPath(parentHPath);
  let lastError;
  for (let index = 0; index < 50; index += 1) {
    const name = index === 0 ? baseName : `${baseName} (${index + 1})`;
    const path = `${parent === "/" ? "" : parent}/${name}.sy`;
    try {
      const docId = await createDocWithMd(notebookId, path, markdown);
      return { docId, path };
    } catch (error) {
      lastError = error;
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      if (message.includes("exist") || message.includes("\u5DF2\u5B58\u5728") || message.includes("duplicate")) {
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("\u521B\u5EFA\u4EFB\u52A1\u6587\u6863\u5931\u8D25");
}
function sanitizeDocName(value) {
  const name = value.replace(/[\\/:*?"<>|#\[\]]/g, " ").replace(/\s+/g, " ").trim();
  return name || "\u672A\u547D\u540D\u4EFB\u52A1";
}
function normalizeHPath(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}
function stripDocSuffix(path) {
  const withoutSuffix = path.endsWith(".sy") ? path.slice(0, -3) : path;
  return normalizeHPath(withoutSuffix);
}
function renderTaskMarkdown(task, parent, children = [], settings = {}) {
  const template = settings.taskTemplate?.trim() || DEFAULT_TASK_TEMPLATE;
  return renderTemplate(template, task, parent, children);
}
function renderTemplate(template, task, parent, children = []) {
  const replacements = {
    title: escapeMd(task.title),
    source: task.sourceBlockId ? blockRef(task.sourceBlockId, task.sourceText || "\u6765\u6E90") : "\u624B\u52A8\u521B\u5EFA",
    parent: parent ? blockRef(parent.docId, parent.title) : "\u65E0",
    project: task.project || "\u672A\u8BBE\u7F6E",
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
  return `${template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => replacements[key] ?? "")}
`;
}
function renderTaskMetadataBlock(task, parent, children = []) {
  const sourceRef = task.sourceBlockId ? blockRef(task.sourceBlockId, task.sourceText || "\u6765\u6E90") : "\u624B\u52A8\u521B\u5EFA";
  const parentRef = parent ? blockRef(parent.docId, parent.title) : "\u65E0";
  return `> \u6765\u6E90\uFF1A${sourceRef}
> \u7236\u4EFB\u52A1\uFF1A${parentRef}
> \u9879\u76EE\uFF1A${task.project || "\u672A\u8BBE\u7F6E"}
> \u72B6\u6001\uFF1A${TASK_STATUS_LABELS[task.status]}
> \u4F18\u5148\u7EA7\uFF1A${TASK_PRIORITY_LABELS[task.priority]}
> \u622A\u6B62\u65F6\u95F4\uFF1A${formatTaskDate(task.dueDate)}
> \u8BA1\u5212\u65F6\u95F4\uFF1A${formatTaskDate(task.planStart)}
> \u5B50\u4EFB\u52A1\uFF1A${renderChildRefs(children, "inline")}
`;
}
function escapeMd(value) {
  return value.replace(/\r?\n/g, " ").trim();
}
function blockRef(id, text) {
  return `((${id} "${escapeMd(text).replace(/"/g, "'")}"))`;
}
function renderChildRefs(children, mode) {
  if (!children.length) {
    return "\u65E0";
  }
  const refs = children.map((task) => blockRef(task.docId, task.title));
  if (mode === "list") {
    return refs.map((ref) => `- ${ref}`).join("\n");
  }
  return refs.join("\u3001");
}
function formatTaskDate(value) {
  const dateKey = toDateKey(value);
  if (!dateKey) {
    return "\u672A\u8BBE\u7F6E";
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
async function findTaskMetadataBlock(docId) {
  const rows = await sql(`select id, markdown, content from blocks
where root_id = '${sqlText(docId)}'
  and type = 'b'
  and (markdown like '%\u6765\u6E90\uFF1A%' or content like '%\u6765\u6E90\uFF1A%')
limit 1`);
  return rows[0];
}
async function setTaskAttrs(task) {
  await setBlockAttrs(task.docId, {
    [TASK_ATTRS.id]: task.id,
    [TASK_ATTRS.status]: task.status,
    [TASK_ATTRS.priority]: task.priority,
    [TASK_ATTRS.project]: task.project || "",
    [TASK_ATTRS.dueDate]: task.dueDate || "",
    [TASK_ATTRS.planStart]: task.planStart || "",
    [TASK_ATTRS.planEnd]: task.planEnd || "",
    [TASK_ATTRS.parentId]: task.parentId || "",
    [TASK_ATTRS.sourceBlockId]: task.sourceBlockId || "",
    [TASK_ATTRS.sourceDocId]: task.sourceDocId || ""
  });
}
async function appendSourceTaskId(sourceBlockId, taskId) {
  const attrs = await getBlockAttrs(sourceBlockId).catch(() => ({}));
  const ids = new Set((attrs[SOURCE_TASK_IDS_ATTR] || "").split(",").map((id) => id.trim()).filter(Boolean));
  ids.add(taskId);
  await setBlockAttrs(sourceBlockId, {
    [SOURCE_TASK_IDS_ATTR]: Array.from(ids).join(",")
  });
}
async function sourceFromBlock(blockId) {
  const block = await getBlockById(blockId);
  return {
    blockId,
    docId: block?.root_id || blockId,
    text: block?.fcontent || block?.content || blockId
  };
}

// src/dialogs/TaskDialog.ts
var import_siyuan2 = require("siyuan");
var TaskDialog = class {
  constructor(options) {
    this.options = options;
  }
  show() {
    const tasks = this.options.service.store.all();
    const activeTasks = tasks.filter((task) => {
      return task.id === this.options.parentId || task.status !== "completed" && task.status !== "cancelled";
    });
    const projects = this.options.service.store.getProjects();
    const defaultTitle = this.options.presetTitle || this.options.source?.text || "";
    const defaultPlanStart = this.options.presetPlanDate ? `${this.options.presetPlanDate}T09:00` : "";
    const dialog = new import_siyuan2.Dialog({
      title: this.options.parentId ? "\u65B0\u5EFA\u5B50\u4EFB\u52A1" : "\u65B0\u5EFA\u4EFB\u52A1",
      content: `<form class="task-tracker-dialog">
  <div class="b3-dialog__content task-tracker-dialog__content">
    <label class="task-tracker-field">
      <span>\u4EFB\u52A1\u6807\u9898</span>
      <input class="b3-text-field fn__block" name="title" value="${escapeAttr(defaultTitle)}" required />
    </label>
    <div class="task-tracker-dialog__grid">
      <label class="task-tracker-field">
        <span>\u9879\u76EE</span>
        <input class="b3-text-field fn__block" name="project" list="task-tracker-projects" value="${escapeAttr(this.options.service.store.getSettings().defaultProject || "")}" />
        <datalist id="task-tracker-projects">
          ${projects.map((project) => `<option value="${escapeAttr(project)}"></option>`).join("")}
        </datalist>
      </label>
      <label class="task-tracker-field">
        <span>\u7236\u4EFB\u52A1</span>
        <select class="b3-select fn__block" name="parentId">
          <option value="">\u65E0</option>
          ${activeTasks.map((task) => `<option value="${task.id}" ${task.id === this.options.parentId ? "selected" : ""}>${escapeHtml(task.title)}</option>`).join("")}
        </select>
      </label>
      <label class="task-tracker-field">
        <span>\u72B6\u6001</span>
        <select class="b3-select fn__block" name="status">
          ${statusOptions("todo")}
        </select>
      </label>
      <label class="task-tracker-field">
        <span>\u4F18\u5148\u7EA7</span>
        <select class="b3-select fn__block" name="priority">
          ${priorityOptions("medium")}
        </select>
      </label>
      <label class="task-tracker-field">
        <span>\u8BA1\u5212\u5F00\u59CB</span>
        <input class="b3-text-field fn__block" name="planStart" type="datetime-local" value="${escapeAttr(defaultPlanStart)}" />
      </label>
      <label class="task-tracker-field">
        <span>\u8BA1\u5212\u7ED3\u675F</span>
        <input class="b3-text-field fn__block" name="planEnd" type="datetime-local" />
      </label>
      <label class="task-tracker-field">
        <span>\u622A\u6B62\u65E5\u671F</span>
        <input class="b3-text-field fn__block" name="dueDate" type="date" />
      </label>
      <label class="task-tracker-field task-tracker-field--wide">
        <span>\u6765\u6E90</span>
        <input class="b3-text-field fn__block" value="${escapeAttr(this.options.source?.text || "\u624B\u52A8\u521B\u5EFA")}" disabled />
      </label>
    </div>
  </div>
  <div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">\u53D6\u6D88</button>
    <div class="fn__space"></div>
    <button type="submit" class="b3-button b3-button--text">\u521B\u5EFA\u4EFB\u52A1\u6587\u6863</button>
  </div>
</form>`,
      width: "680px"
    });
    const form = dialog.element.querySelector("form");
    const titleInput = dialog.element.querySelector("input[name='title']");
    titleInput?.focus();
    titleInput?.select();
    dialog.element.querySelector("[data-action='cancel']")?.addEventListener("click", () => dialog.destroy());
    dialog.bindInput(titleInput, () => form.requestSubmit());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector("button[type='submit']");
      submitButton.disabled = true;
      submitButton.textContent = "\u521B\u5EFA\u4E2D...";
      try {
        const data = new FormData(form);
        const input = {
          title: String(data.get("title") || "").trim(),
          parentId: String(data.get("parentId") || "") || void 0,
          sourceBlockId: this.options.source?.blockId,
          sourceDocId: this.options.source?.docId,
          sourceText: this.options.source?.text,
          project: String(data.get("project") || "").trim() || void 0,
          status: String(data.get("status") || "todo"),
          priority: String(data.get("priority") || "medium"),
          dueDate: String(data.get("dueDate") || "") || void 0,
          planStart: fromDatetimeLocal(String(data.get("planStart") || "")),
          planEnd: fromDatetimeLocal(String(data.get("planEnd") || ""))
        };
        if (!input.title) {
          throw new Error("\u8BF7\u586B\u5199\u4EFB\u52A1\u6807\u9898");
        }
        const task = await this.options.service.createTask(input);
        (0, import_siyuan2.showMessage)("\u4EFB\u52A1\u6587\u6863\u5DF2\u521B\u5EFA");
        this.options.onSaved?.(task);
        dialog.destroy();
      } catch (error) {
        (0, import_siyuan2.showMessage)(error instanceof Error ? error.message : "\u521B\u5EFA\u4EFB\u52A1\u5931\u8D25", 5e3, "error");
        submitButton.disabled = false;
        submitButton.textContent = "\u521B\u5EFA\u4EFB\u52A1\u6587\u6863";
      }
    });
  }
};
function statusOptions(current) {
  return Object.entries(TASK_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`).join("");
}
function priorityOptions(current) {
  return Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`).join("");
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

// src/settings.ts
var import_siyuan3 = require("siyuan");
function createTaskSettings(service, actions, version) {
  const defaultProjectInput = document.createElement("input");
  defaultProjectInput.className = "b3-text-field fn__block";
  defaultProjectInput.placeholder = "\u4F8B\u5982\uFF1A\u5DE5\u4F5C / \u4EA7\u54C1 / \u5BA2\u6237A";
  defaultProjectInput.value = service.store.getSettings().defaultProject || "";
  const rootDocIdInput = document.createElement("input");
  rootDocIdInput.className = "b3-text-field fn__block task-tracker-setting__doc-id";
  rootDocIdInput.placeholder = "\u7C98\u8D34\u6587\u6863 ID\uFF0C\u4F8B\u5982\uFF1A20260506092200-qynf33g";
  rootDocIdInput.value = service.store.getSettings().taskRootDocId || "";
  const templateInput = document.createElement("textarea");
  templateInput.className = "b3-text-field fn__block task-tracker-setting__template";
  templateInput.spellcheck = false;
  templateInput.value = service.store.getSettings().taskTemplate || DEFAULT_TASK_TEMPLATE;
  const setting = new import_siyuan3.Setting({
    confirmCallback: async () => {
      await service.store.setSettings({
        defaultProject: defaultProjectInput.value.trim() || void 0,
        taskTemplate: templateInput.value.trim() || void 0
      });
      actions.refreshViews();
      (0, import_siyuan3.showMessage)("\u4EFB\u52A1\u8FFD\u8E2A\u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    }
  });
  setting.addItem({
    title: "\u9ED8\u8BA4\u9879\u76EE",
    description: "\u65B0\u5EFA\u4EFB\u52A1\u65F6\u81EA\u52A8\u586B\u5165\uFF0C\u53EF\u5728\u521B\u5EFA\u65F6\u4FEE\u6539\u3002",
    createActionElement: () => defaultProjectInput
  });
  setting.addItem({
    title: "\u4E8B\u9879\u5E93",
    description: service.store.getSettings().taskRootTitle ? `\u5F53\u524D\uFF1A${service.store.getSettings().taskRootTitle}` : "\u5C1A\u672A\u8BBE\u7F6E\u3002\u8BF7\u5728\u6587\u6863\u83DC\u5355\u4E2D\u590D\u5236 ID\uFF0C\u7C98\u8D34\u5230\u53F3\u4FA7\u540E\u7ED1\u5B9A\u3002",
    createActionElement: () => {
      const wrapper = document.createElement("div");
      wrapper.className = "fn__flex task-tracker-setting__root";
      const bindButton = document.createElement("button");
      bindButton.className = "b3-button b3-button--outline fn__size160";
      bindButton.textContent = "\u7ED1\u5B9A ID";
      bindButton.addEventListener("click", () => {
        void actions.setRootDocId(rootDocIdInput.value);
      });
      const currentButton = document.createElement("button");
      currentButton.className = "b3-button b3-button--outline fn__size160";
      currentButton.textContent = "\u5F53\u524D\u6587\u6863";
      currentButton.title = "\u5FEB\u6377\u8BBE\u7F6E\uFF0C\u82E5\u8BC6\u522B\u5931\u8D25\u8BF7\u4F7F\u7528\u6587\u6863 ID";
      currentButton.addEventListener("click", () => {
        void actions.setCurrentDocAsRoot();
      });
      const openButton = document.createElement("button");
      openButton.className = "b3-button b3-button--outline fn__size160";
      openButton.textContent = "\u6253\u5F00\u4E8B\u9879\u5E93";
      openButton.addEventListener("click", () => {
        void actions.openRootDoc();
      });
      wrapper.append(rootDocIdInput, bindButton, currentButton, openButton);
      return wrapper;
    }
  });
  setting.addItem({
    title: "\u4EFB\u52A1\u6A21\u677F",
    description: "\u65B0\u5EFA\u4EFB\u52A1\u6587\u6863\u65F6\u4F7F\u7528\u3002\u4FDD\u7559\u5143\u4FE1\u606F\u5360\u4F4D\u7B26\u540E\uFF0C\u4EFB\u52A1\u8FFD\u8E2A\u9762\u677F\u4E2D\u7684\u72B6\u6001\u548C\u65E5\u671F\u4F1A\u540C\u6B65\u56DE\u7B14\u8BB0\u3002",
    createActionElement: () => {
      const wrapper = document.createElement("div");
      wrapper.className = "task-tracker-setting__template-wrap";
      const actionsRow = document.createElement("div");
      actionsRow.className = "fn__flex task-tracker-setting__template-actions";
      const resetButton = document.createElement("button");
      resetButton.className = "b3-button b3-button--outline";
      resetButton.textContent = "\u6062\u590D\u9ED8\u8BA4\u6A21\u677F";
      resetButton.addEventListener("click", () => {
        templateInput.value = DEFAULT_TASK_TEMPLATE;
      });
      actionsRow.append(resetButton);
      wrapper.append(templateInput, actionsRow);
      return wrapper;
    }
  });
  setting.addItem({
    title: "\u4F7F\u7528\u5E2E\u52A9",
    description: "\u67E5\u770B\u4E8B\u9879\u5E93\u8BBE\u7F6E\u3001\u4EFB\u52A1\u521B\u5EFA\u3001\u65E5\u5386\u89C6\u56FE\u3001\u4EFB\u52A1\u5220\u9664\u3001\u6A21\u677F\u5360\u4F4D\u7B26\u548C\u7248\u672C\u89C4\u5219\u3002",
    createActionElement: () => {
      const button = document.createElement("button");
      button.className = "b3-button b3-button--outline fn__size200";
      button.textContent = "\u6253\u5F00\u4F7F\u7528\u5E2E\u52A9";
      button.addEventListener("click", () => showHelpDialog());
      return button;
    }
  });
  setting.addItem({
    title: "\u63D2\u4EF6\u7248\u672C",
    description: `\u5F53\u524D\u7248\u672C\uFF1Av${version}`,
    createActionElement: () => {
      const value = document.createElement("div");
      value.className = "task-tracker-setting__version";
      value.textContent = `v${version}`;
      return value;
    }
  });
  return setting;
}
function showHelpDialog() {
  new import_siyuan3.Dialog({
    title: "\u4EFB\u52A1\u8FFD\u8E2A\u4F7F\u7528\u5E2E\u52A9",
    content: `<div class="b3-dialog__content task-tracker-help">
  <h2>\u4E00\u3001\u4E8B\u9879\u5E93</h2>
  <p>\u5148\u5728\u76EE\u6807\u7B14\u8BB0\u672C\u4E2D\u65B0\u5EFA\u4E00\u4E2A\u6587\u6863\uFF0C\u4F8B\u5982\u201C\u4E8B\u9879\u5E93\u201D\uFF0C\u5728\u601D\u6E90\u4E2D\u590D\u5236\u8BE5\u6587\u6863 ID\uFF0C\u7136\u540E\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u7ED1\u5B9A\u3002\u540E\u7EED\u65B0\u4EFB\u52A1\u4F1A\u4F5C\u4E3A\u4E8B\u9879\u5E93\u7684\u5B50\u6587\u6863\u521B\u5EFA\uFF0C\u5B50\u4EFB\u52A1\u4F1A\u4F5C\u4E3A\u7236\u4EFB\u52A1\u6587\u6863\u7684\u5B50\u6587\u6863\u521B\u5EFA\u3002</p>

  <h2>\u4E8C\u3001\u521B\u5EFA\u4EFB\u52A1</h2>
  <p>\u53EF\u4EE5\u4ECE\u53F3\u4E0A\u89D2\u63D2\u4EF6\u83DC\u5355\u65B0\u5EFA\u4EFB\u52A1\uFF0C\u4E5F\u53EF\u4EE5\u4ECE\u5F53\u524D\u6587\u6863\u6216\u5F53\u524D\u5757\u521B\u5EFA\u4EFB\u52A1\u3002\u4EFB\u52A1\u5B57\u6BB5\u5305\u62EC\u9879\u76EE\u3001\u72B6\u6001\u3001\u4F18\u5148\u7EA7\u3001\u8BA1\u5212\u5F00\u59CB\u3001\u8BA1\u5212\u7ED3\u675F\u3001\u622A\u6B62\u65E5\u671F\u548C\u7236\u4EFB\u52A1\u3002</p>

  <h2>\u4E09\u3001\u4EFB\u52A1\u8FFD\u8E2A\u9762\u677F</h2>
  <p>\u4FA7\u8FB9\u680F\u9762\u677F\u7528\u4E8E\u5FEB\u901F\u6D4F\u89C8\u548C\u5904\u7406\u6D3B\u8DC3\u4EFB\u52A1\uFF1B\u4EFB\u52A1\u7BA1\u7406\u5668\u5219\u63D0\u4F9B\u8868\u683C\u3001\u6E05\u5355\u3001\u65F6\u95F4\u8F74\u3001\u770B\u677F\u3001\u65E5\u5386\u7B49\u5B8C\u6574\u9762\u677F\u3002\u4E24\u8005\u90FD\u56F4\u7ED5\u4E8B\u9879\u5E93\u6587\u6863\u6811\u5DE5\u4F5C\uFF0C\u4EFB\u52A1\u4E0E\u5B50\u4EFB\u52A1\u5BF9\u5E94\u771F\u5B9E\u7B14\u8BB0\u6587\u6863\uFF0C\u70B9\u51FB\u4EFB\u52A1\u6807\u9898\u4F1A\u76F4\u63A5\u6253\u5F00\u5BF9\u5E94\u7B14\u8BB0\u3002</p>

  <h2>\u56DB\u3001\u65E5\u5386\u89C6\u56FE</h2>
  <p>\u65E5\u5386\u6309\u8BA1\u5212\u5F00\u59CB\u65F6\u95F4\u5C55\u793A\u4EFB\u52A1\uFF1B\u6CA1\u6709\u8BA1\u5212\u5F00\u59CB\u65F6\u95F4\u7684\u4EFB\u52A1\u4F1A\u8FDB\u5165\u53F3\u4FA7\u201C\u672A\u767B\u8BB0\u8BA1\u5212\u65F6\u95F4\u201D\u3002\u6708\u4EFD\u6807\u9898\u4E24\u4FA7\u6309\u94AE\u53EF\u5207\u6362\u524D\u540E\u6708\u4EFD\uFF0C\u6708\u4EFD\u9009\u62E9\u6846\u53EF\u5FEB\u901F\u8DF3\u8F6C\u3002</p>

  <h2>\u4E94\u3001\u5220\u9664\u4EFB\u52A1</h2>
  <p>\u5220\u9664\u601D\u6E90\u4EFB\u52A1\u6587\u6863\u540E\uFF0C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u6E05\u7406\u5BF9\u5E94\u4EFB\u52A1\u8BB0\u5F55\uFF0C\u4E5F\u53EF\u4EE5\u70B9\u51FB\u63D2\u4EF6\u83DC\u5355\u6216\u9762\u677F\u4E2D\u7684\u5237\u65B0\u6309\u94AE\u624B\u52A8\u6E05\u7406\u3002\u4EFB\u52A1\u5361\u7247\u4E0A\u7684\u5220\u9664\u6309\u94AE\u53EA\u4F1A\u4ECE\u63D2\u4EF6\u8BB0\u5F55\u4E2D\u79FB\u9664\u4EFB\u52A1\uFF0C\u4E0D\u4F1A\u5220\u9664\u601D\u6E90\u6587\u6863\u3002</p>

  <h2>\u516D\u3001\u4EFB\u52A1\u6A21\u677F\u5360\u4F4D\u7B26</h2>
  <p>\u6A21\u677F\u652F\u6301\uFF1A<code>{{title}}</code>\u3001<code>{{source}}</code>\u3001<code>{{parent}}</code>\u3001<code>{{project}}</code>\u3001<code>{{status}}</code>\u3001<code>{{priority}}</code>\u3001<code>{{dueDate}}</code>\u3001<code>{{planStart}}</code>\u3001<code>{{planEnd}}</code>\u3001<code>{{childTasks}}</code>\u3001<code>{{childTaskList}}</code>\u3001<code>{{createdAt}}</code>\u3001<code>{{updatedAt}}</code>\u3002</p>
  <p>\u5EFA\u8BAE\u4FDD\u7559\u9ED8\u8BA4\u6A21\u677F\u4E2D\u7684\u5F15\u7528\u4FE1\u606F\u533A\uFF0C\u63D2\u4EF6\u4F1A\u540C\u6B65\u66F4\u65B0\u8FD9\u4E00\u533A\u57DF\u91CC\u7684\u72B6\u6001\u3001\u4F18\u5148\u7EA7\u3001\u65E5\u671F\u548C\u5B50\u4EFB\u52A1\u94FE\u63A5\u3002</p>

  <h2>\u4E03\u3001\u7248\u672C\u89C4\u5219</h2>
  <p>\u5927\u7248\u672C\u7528\u4E8E\u660E\u663E\u4E0D\u517C\u5BB9\u6216\u67B6\u6784\u53D8\u5316\uFF1B\u5C0F\u7248\u672C\u7528\u4E8E\u65B0\u589E\u529F\u80FD\uFF1B\u9519\u8BEF\u4FEE\u590D\u7528\u4E8E\u4E0D\u6539\u53D8\u529F\u80FD\u9762\u7684 bug \u4FEE\u590D\u3002\u6BCF\u6B21\u6784\u5EFA\u540E\u7684\u63D2\u4EF6\u538B\u7F29\u5305\u4F1A\u653E\u5165\u9879\u76EE\u7684 <code>release</code> \u6587\u4EF6\u5939\u3002</p>
</div>`,
    width: "760px",
    height: "620px"
  });
}

// src/taskStore.ts
var TaskStore = class {
  constructor(plugin) {
    this.plugin = plugin;
    __publicField(this, "tasks", []);
    __publicField(this, "settings", { ...DEFAULT_SETTINGS });
  }
  async load() {
    const [tasksData, settingsData] = await Promise.all([
      this.plugin.loadData(TASKS_DATA_FILE).catch(() => void 0),
      this.plugin.loadData(SETTINGS_DATA_FILE).catch(() => void 0)
    ]);
    if (Array.isArray(tasksData)) {
      this.tasks = tasksData;
    } else if (Array.isArray(tasksData?.tasks)) {
      this.tasks = tasksData.tasks;
    }
    if (settingsData && typeof settingsData === "object") {
      this.settings = { ...DEFAULT_SETTINGS, ...settingsData };
    }
  }
  all() {
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
  get(id) {
    return this.tasks.find((task) => task.id === id);
  }
  getSettings() {
    return { ...this.settings };
  }
  getProjects() {
    return Array.from(new Set(this.tasks.map((task) => task.project?.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }
  async setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    await this.plugin.saveData(SETTINGS_DATA_FILE, this.settings);
  }
  async upsert(task) {
    const index = this.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      this.tasks[index] = task;
    } else {
      this.tasks.push(task);
    }
    await this.saveTasks();
  }
  async update(id, patch) {
    const current = this.get(id);
    if (!current) {
      throw new Error(`Task not found: ${id}`);
    }
    const next = {
      ...current,
      ...patch,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.upsert(next);
    return next;
  }
  async removeMany(ids) {
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
  async saveTasks() {
    await this.plugin.saveData(TASKS_DATA_FILE, { tasks: this.tasks });
  }
};

// src/views/CalendarTab.ts
var import_siyuan4 = require("siyuan");
var CalendarTab = class {
  constructor(container, service, actions, data) {
    this.container = container;
    this.service = service;
    this.actions = actions;
    __publicField(this, "month", monthStart(/* @__PURE__ */ new Date()));
    __publicField(this, "unsubscribe");
    if (data?.month) {
      const date = /* @__PURE__ */ new Date(`${data.month}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
      }
    }
    this.unsubscribe = this.service.onChange(() => this.render());
  }
  destroy() {
    this.unsubscribe?.();
  }
  render() {
    const days = calendarDays(this.month);
    const tasksByDate = groupTasksByDate(this.service.activeTasks());
    const unplanned = this.service.activeTasks().filter((task) => !task.planStart);
    const monthValue = monthInputValue(this.month);
    this.container.innerHTML = `<div class="task-tracker task-tracker--calendar">
  <div class="task-tracker-calendar__toolbar">
    <div class="task-tracker-calendar__month">
      <button class="block__icon ariaLabel" data-action="prev" aria-label="\u4E0A\u4E2A\u6708" data-position="south"><svg><use xlink:href="#iconLeft"></use></svg></button>
      <div class="task-tracker-calendar__title">${monthTitle(this.month)}</div>
      <button class="block__icon ariaLabel" data-action="next" aria-label="\u4E0B\u4E2A\u6708" data-position="south"><svg><use xlink:href="#iconRight"></use></svg></button>
      <input class="b3-text-field task-tracker-calendar__month-input" data-field="month" type="month" value="${monthValue}" aria-label="\u9009\u62E9\u6708\u4EFD" />
      <button class="block__icon ariaLabel" data-action="today" aria-label="\u56DE\u5230\u4ECA\u5929" data-position="south"><svg><use xlink:href="#iconRefresh"></use></svg></button>
    </div>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--text" data-action="new">\u65B0\u5EFA\u4EFB\u52A1</button>
  </div>
  <div class="task-tracker-calendar__layout">
    <section class="task-tracker-calendar__main">
      <div class="task-tracker-calendar__weekdays">
        ${["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u65E5"].map((day) => `<div>${day}</div>`).join("")}
      </div>
      <div class="task-tracker-calendar__grid">
        ${days.map((day) => this.renderDay(day, tasksByDate[formatDateKey(day)] || [])).join("")}
      </div>
    </section>
    <aside class="task-tracker-calendar__aside">
      <div class="task-tracker-calendar__aside-title">\u672A\u767B\u8BB0\u8BA1\u5212\u65F6\u95F4</div>
      <div class="task-tracker-calendar__unplanned">
        ${unplanned.length ? unplanned.map((task) => renderPill(task, "aside")).join("") : `<div class="task-tracker-empty">\u6CA1\u6709\u672A\u5B89\u6392\u4EFB\u52A1\u3002</div>`}
      </div>
    </aside>
  </div>
</div>`;
    this.bind();
  }
  renderDay(day, tasks) {
    const dateKey = formatDateKey(day);
    const isToday = dateKey === formatDateKey(/* @__PURE__ */ new Date());
    const outside = !sameMonth(day, this.month);
    return `<div class="task-tracker-day ${outside ? "is-outside" : ""} ${isToday ? "is-today" : ""}" data-date="${dateKey}" role="button" tabindex="0">
  <span class="task-tracker-day__num">${day.getDate()}</span>
  <div class="task-tracker-day__tasks">
    ${tasks.slice(0, 4).map((task) => renderPill(task, "calendar")).join("")}
    ${tasks.length > 4 ? `<span class="task-tracker-day__more">+${tasks.length - 4}</span>` : ""}
  </div>
</div>`;
  }
  bind() {
    this.container.querySelector("[data-action='prev']")?.addEventListener("click", () => {
      this.month = addMonths(this.month, -1);
      this.render();
    });
    this.container.querySelector("[data-action='today']")?.addEventListener("click", () => {
      this.month = monthStart(/* @__PURE__ */ new Date());
      this.render();
    });
    this.container.querySelector("[data-action='next']")?.addEventListener("click", () => {
      this.month = addMonths(this.month, 1);
      this.render();
    });
    this.container.querySelector("[data-field='month']")?.addEventListener("change", (event) => {
      const value = event.target.value;
      const date = /* @__PURE__ */ new Date(`${value}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
        this.render();
      }
    });
    this.container.querySelector("[data-action='new']")?.addEventListener("click", () => this.actions.newTask());
    this.container.querySelectorAll(".task-tracker-day").forEach((day) => {
      day.addEventListener("click", (event) => {
        if (event.target.closest("[data-task-id]")) {
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
    this.container.querySelectorAll("[data-task-id]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (event.target.closest("[data-action='plan-today']")) {
          return;
        }
        event.stopPropagation();
        const task = this.service.store.get(element.dataset.taskId || "");
        if (task) {
          this.actions.openTask(task);
        }
      });
    });
    this.container.querySelectorAll("[data-action='plan-today']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await this.service.updateTask(button.dataset.taskId || "", {
            planStart: fromDateInput(formatDateKey(/* @__PURE__ */ new Date()))
          });
        } catch (error) {
          (0, import_siyuan4.showMessage)(error instanceof Error ? error.message : "\u66F4\u65B0\u4EFB\u52A1\u5931\u8D25", 5e3, "error");
        }
      });
    });
  }
};
function calendarDays(month) {
  const first = monthStart(month);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - startOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}
function groupTasksByDate(tasks) {
  const result = {};
  for (const task of tasks) {
    const key = toDateKey(task.planStart || task.dueDate);
    if (!key) {
      continue;
    }
    result[key] || (result[key] = []);
    result[key].push(task);
  }
  return result;
}
function monthInputValue(date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}
function renderPill(task, mode) {
  const title = escapeHtml(task.title);
  const status = TASK_STATUS_LABELS[task.status];
  if (mode === "aside") {
    return `<div class="task-tracker-pill task-tracker-pill--aside task-status-${task.status}" data-task-id="${task.id}">
  <span>${title}</span>
  <small>${escapeHtml(task.project || status)}</small>
  <button class="block__icon ariaLabel" data-action="plan-today" data-task-id="${task.id}" aria-label="\u5B89\u6392\u5230\u4ECA\u5929" data-position="north"><svg><use xlink:href="#iconCalendar"></use></svg></button>
</div>`;
  }
  return `<span class="task-tracker-pill task-status-${task.status}" data-task-id="${task.id}" title="${title}">${title}</span>`;
}

// src/views/TaskDock.ts
var import_siyuan5 = require("siyuan");
var TaskDock = class {
  constructor(container, service, actions) {
    this.container = container;
    this.service = service;
    this.actions = actions;
    __publicField(this, "filter", "focus");
    __publicField(this, "collapsedTaskIds", /* @__PURE__ */ new Set());
    __publicField(this, "unsubscribe");
    this.unsubscribe = this.service.onChange(() => this.render());
  }
  destroy() {
    this.unsubscribe?.();
  }
  render() {
    const settings = this.service.store.getSettings();
    const tree = this.filteredTaskTree();
    const counts = this.counts();
    this.container.innerHTML = `<div class="task-tracker task-tracker--dock">
  <div class="block__icons task-tracker-dock__header">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconTaskTracker"></use></svg>
      <span>\u4EFB\u52A1\u8FFD\u8E2A</span>
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <button class="block__icon ariaLabel" data-action="new" aria-label="\u65B0\u5EFA\u4EFB\u52A1" data-position="south"><svg><use xlink:href="#iconAdd"></use></svg></button>
    <button class="block__icon ariaLabel" data-action="calendar" aria-label="\u4EFB\u52A1\u65E5\u5386" data-position="south"><svg><use xlink:href="#iconCalendar"></use></svg></button>
    <button class="block__icon ariaLabel" data-action="sync-deleted" aria-label="\u6E05\u7406\u5DF2\u5220\u9664\u6587\u6863" data-position="south"><svg><use xlink:href="#iconRefresh"></use></svg></button>
  </div>
  <div class="task-tracker-dock__body">
    ${settings.taskRootDocId ? this.renderContent(tree, counts) : this.renderEmptyRoot()}
  </div>
</div>`;
    this.bind();
  }
  renderContent(tree, counts) {
    const settings = this.service.store.getSettings();
    return `<div class="task-tracker-dock__summary">
  <div class="task-tracker-dock__summary-title">\u4E8B\u9879\u5E93</div>
  <div class="task-tracker-dock__summary-name">${escapeHtml(settings.taskRootTitle || "\u672A\u7ED1\u5B9A\u4E8B\u9879\u5E93")}</div>
  <div class="task-tracker-dock__summary-hint">\u4EFB\u52A1\u4E0E\u5B50\u4EFB\u52A1\u90FD\u5BF9\u5E94\u771F\u5B9E\u7B14\u8BB0\u6587\u6863\u3002</div>
</div>
<div class="task-tracker-tabs">
  ${tabButton("all", "\u5168\u90E8", counts.all, this.filter)}
  ${tabButton("focus", "\u7126\u70B9", counts.focus, this.filter)}
  ${tabButton("unplanned", "\u672A\u5B89\u6392", counts.unplanned, this.filter)}
  ${tabButton("today", "\u4ECA\u65E5", counts.today, this.filter)}
  ${tabButton("overdue", "\u903E\u671F", counts.overdue, this.filter)}
  ${tabButton("done", "\u5B8C\u6210", counts.done, this.filter)}
</div>
<div class="task-tracker-list">
  ${tree.length ? tree.map((node) => this.renderTaskNode(node, 0)).join("") : `<div class="task-tracker-empty">\u8FD9\u91CC\u6682\u65F6\u6CA1\u6709\u4EFB\u52A1\u3002</div>`}
</div>`;
  }
  renderEmptyRoot() {
    return `<div class="task-tracker-empty task-tracker-empty--root">
  <div class="task-tracker-empty__title">\u8FD8\u6CA1\u6709\u4E8B\u9879\u5E93</div>
  <div class="task-tracker-empty__text">\u5148\u521B\u5EFA\u6216\u6253\u5F00\u4E00\u4E2A\u6587\u6863\uFF0C\u6BD4\u5982\u201C\u4E8B\u9879\u5E93\u201D\uFF0C\u518D\u628A\u5B83\u8BBE\u4E3A\u4EFB\u52A1\u6839\u6587\u6863\u3002</div>
  <button class="b3-button b3-button--text" data-action="set-root">\u5C06\u5F53\u524D\u6587\u6863\u8BBE\u4E3A\u4E8B\u9879\u5E93</button>
</div>`;
  }
  renderTaskNode(node, depth) {
    const task = node.task;
    const statusClass = `task-status-${task.status}`;
    const priorityClass = `task-priority-${task.priority}`;
    const planned = formatHumanDate(task.planStart);
    const due = formatHumanDate(task.dueDate);
    const parent = task.parentId ? this.service.store.get(task.parentId) : void 0;
    const childCount = node.children.length;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const depthClass = depth > 0 ? " task-tracker-task--child" : "";
    const contextClass = node.contextOnly ? " task-tracker-task--context" : "";
    return `<div class="task-tracker-task ${statusClass} ${priorityClass}${depthClass}${contextClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
  <div class="task-tracker-task__main">
    <div class="task-tracker-task__title-row">
      ${childCount ? `<button class="task-tracker-task__toggle" data-action="toggle-children" aria-label="${collapsed ? "\u5C55\u5F00\u5B50\u4EFB\u52A1" : "\u6298\u53E0\u5B50\u4EFB\u52A1"}" title="${collapsed ? "\u5C55\u5F00\u5B50\u4EFB\u52A1" : "\u6298\u53E0\u5B50\u4EFB\u52A1"}"><span>${collapsed ? "\u25B8" : "\u25BE"}</span></button>` : `<span class="task-tracker-task__toggle-placeholder"></span>`}
      <button class="task-tracker-task__title" data-action="open" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</button>
      ${childCount ? `<span class="task-tracker-task__child-count">${childCount}</span>` : ""}
    </div>
    <div class="task-tracker-task__meta">
      <span>${escapeHtml(task.project || "\u65E0\u9879\u76EE")}</span>
      <span>\u8BA1\u5212\uFF1A${planned}</span>
      <span>\u622A\u6B62\uFF1A${due}</span>
      ${parent ? `<span>\u7236\u4EFB\u52A1\uFF1A${escapeHtml(parent.title)}</span>` : ""}
      ${task.sourceText ? `<span>\u6765\u6E90\uFF1A${escapeHtml(task.sourceText)}</span>` : ""}
      ${task.path ? `<span>\u8DEF\u5F84\uFF1A${escapeHtml(task.path)}</span>` : ""}
    </div>
  </div>
  <div class="task-tracker-task__controls">
    <select class="b3-select" data-field="status" aria-label="\u4EFB\u52A1\u72B6\u6001">${statusOptions(task.status)}</select>
    <select class="b3-select" data-field="priority" aria-label="\u4EFB\u52A1\u4F18\u5148\u7EA7">${priorityOptions(task.priority)}</select>
    <input class="b3-text-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="\u8BA1\u5212\u65E5\u671F" />
    <input class="b3-text-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="\u622A\u6B62\u65E5\u671F" />
    <button class="block__icon ariaLabel" data-action="subtask" aria-label="\u521B\u5EFA\u5B50\u4EFB\u52A1" data-position="north"><svg><use xlink:href="#iconAdd"></use></svg></button>
    ${task.status === "completed" ? `<button class="block__icon ariaLabel" data-action="reopen" aria-label="\u91CD\u65B0\u6253\u5F00" data-position="north"><svg><use xlink:href="#iconRefresh"></use></svg></button>` : `<button class="block__icon ariaLabel" data-action="complete" aria-label="\u5B8C\u6210\u4EFB\u52A1" data-position="north"><svg><use xlink:href="#iconSelect"></use></svg></button>`}
    <button class="block__icon ariaLabel" data-action="remove-record" aria-label="\u4ECE\u4EFB\u52A1\u8FFD\u8E2A\u79FB\u9664" data-position="north"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
  </div>
  ${childCount && !collapsed ? `<div class="task-tracker-task__children">${node.children.map((child) => this.renderTaskNode(child, depth + 1)).join("")}</div>` : ""}
</div>`;
  }
  bind() {
    this.container.querySelector("[data-action='new']")?.addEventListener("click", () => this.actions.newTask());
    this.container.querySelector("[data-action='calendar']")?.addEventListener("click", () => this.actions.openCalendar());
    this.container.querySelector("[data-action='sync-deleted']")?.addEventListener("click", () => {
      this.runUpdate(async () => {
        const count = await this.service.syncDeletedDocs();
        (0, import_siyuan5.showMessage)(count > 0 ? `\u5DF2\u6E05\u7406 ${count} \u4E2A\u5DF2\u5220\u9664\u4EFB\u52A1\u8BB0\u5F55` : "\u6CA1\u6709\u9700\u8981\u6E05\u7406\u7684\u4EFB\u52A1\u8BB0\u5F55");
      });
    });
    this.container.querySelector("[data-action='set-root']")?.addEventListener("click", () => this.actions.setCurrentDocAsRoot());
    this.container.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        this.filter = button.dataset.filter;
        this.render();
      });
    });
    this.container.querySelectorAll("[data-task-id]").forEach((row) => {
      const taskId = row.dataset.taskId;
      const task = taskId ? this.service.store.get(taskId) : void 0;
      if (!task) {
        return;
      }
      row.querySelector("[data-action='open']")?.addEventListener("click", () => this.actions.openTask(task));
      row.querySelector("[data-action='toggle-children']")?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (this.collapsedTaskIds.has(task.id)) {
          this.collapsedTaskIds.delete(task.id);
        } else {
          this.collapsedTaskIds.add(task.id);
        }
        this.render();
      });
      row.querySelector("[data-action='subtask']")?.addEventListener("click", () => this.actions.createSubtask(task.id));
      row.querySelector("[data-action='complete']")?.addEventListener("click", () => this.runUpdate(() => this.service.completeTask(task.id)));
      row.querySelector("[data-action='reopen']")?.addEventListener("click", () => this.runUpdate(() => this.service.reopenTask(task.id)));
      row.querySelector("[data-action='remove-record']")?.addEventListener("click", () => {
        const message = `\u4EC5\u4ECE\u63D2\u4EF6\u4EFB\u52A1\u8FFD\u8E2A\u4E2D\u79FB\u9664\u201C${task.title}\u201D\u53CA\u5176\u5B50\u4EFB\u52A1\u8BB0\u5F55\uFF0C\u4E0D\u4F1A\u5220\u9664\u601D\u6E90\u6587\u6863\u3002\u786E\u5B9A\u7EE7\u7EED\uFF1F`;
        if (!window.confirm(message)) {
          return;
        }
        this.runUpdate(async () => {
          const count = await this.service.removeTaskRecord(task.id, { cascade: true });
          (0, import_siyuan5.showMessage)(count > 0 ? `\u5DF2\u79FB\u9664 ${count} \u4E2A\u4EFB\u52A1\u8BB0\u5F55` : "\u4EFB\u52A1\u8BB0\u5F55\u5DF2\u4E0D\u5B58\u5728");
        });
      });
      row.querySelector("[data-field='status']")?.addEventListener("change", (event) => {
        this.runUpdate(() => this.service.updateTask(task.id, { status: event.target.value }));
      });
      row.querySelector("[data-field='priority']")?.addEventListener("change", (event) => {
        this.runUpdate(() => this.service.updateTask(task.id, { priority: event.target.value }));
      });
      row.querySelector("[data-field='planDate']")?.addEventListener("change", (event) => {
        this.runUpdate(() => this.service.updateTask(task.id, { planStart: fromDateInput(event.target.value) }));
      });
      row.querySelector("[data-field='dueDate']")?.addEventListener("change", (event) => {
        this.runUpdate(() => this.service.updateTask(task.id, { dueDate: event.target.value || void 0 }));
      });
    });
  }
  async runUpdate(action) {
    try {
      await action();
    } catch (error) {
      (0, import_siyuan5.showMessage)(error instanceof Error ? error.message : "\u66F4\u65B0\u4EFB\u52A1\u5931\u8D25", 5e3, "error");
    }
  }
  filteredTaskTree() {
    const tasks = this.service.store.all();
    const matched = new Set(tasks.filter((task) => this.matchesFilter(task)).map((task) => task.id));
    const visible = includeAncestors(tasks, matched);
    return buildTaskTree(tasks, visible, matched);
  }
  matchesFilter(task) {
    const today = toDateKey((/* @__PURE__ */ new Date()).toISOString());
    switch (this.filter) {
      case "unplanned":
        return isActive(task) && !task.planStart;
      case "today":
        return isActive(task) && toDateKey(task.planStart || task.dueDate) === today;
      case "overdue":
        return isActive(task) && isActiveDateBeforeToday(task.planStart || task.dueDate);
      case "all":
        return isActive(task);
      case "done":
        return task.status === "completed";
      case "focus":
      default:
        return isActive(task) && (task.status === "doing" || toDateKey(task.planStart || task.dueDate) <= today);
    }
  }
  counts() {
    const tasks = this.service.store.all();
    const today = toDateKey((/* @__PURE__ */ new Date()).toISOString());
    return {
      focus: tasks.filter((task) => isActive(task) && (task.status === "doing" || toDateKey(task.planStart || task.dueDate) <= today)).length,
      unplanned: tasks.filter((task) => isActive(task) && !task.planStart).length,
      today: tasks.filter((task) => isActive(task) && toDateKey(task.planStart || task.dueDate) === today).length,
      overdue: tasks.filter((task) => isActive(task) && isActiveDateBeforeToday(task.planStart || task.dueDate)).length,
      all: tasks.filter(isActive).length,
      done: tasks.filter((task) => task.status === "completed").length
    };
  }
};
function tabButton(filter, label, count, current) {
  return `<button class="task-tracker-tab ${filter === current ? "is-active" : ""}" data-filter="${filter}">${label}<span>${count}</span></button>`;
}
function isActive(task) {
  return ACTIVE_TASK_STATUSES.includes(task.status);
}
function includeAncestors(tasks, matched) {
  const visible = new Set(matched);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const id of matched) {
    let current = byId.get(id);
    while (current?.parentId) {
      visible.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
  return visible;
}
function buildTaskTree(tasks, visible, matched) {
  const nodes = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    if (visible.has(task.id)) {
      nodes.set(task.id, {
        task,
        children: [],
        contextOnly: !matched.has(task.id)
      });
    }
  }
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.task.parentId ? nodes.get(node.task.parentId) : void 0;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// src/views/TaskManagerTab.ts
var import_siyuan6 = require("siyuan");
var VIEWS = [
  { value: "table", label: "\u8868\u683C" },
  { value: "list", label: "\u6E05\u5355" },
  { value: "timeline", label: "\u65F6\u95F4\u8F74" },
  { value: "kanban", label: "\u770B\u677F" },
  { value: "calendar", label: "\u65E5\u5386" }
];
var STATUSES = Object.keys(TASK_STATUS_LABELS);
var TaskManagerTab = class {
  constructor(container, service, actions, data) {
    this.container = container;
    this.service = service;
    this.actions = actions;
    __publicField(this, "view", "table");
    __publicField(this, "search", "");
    __publicField(this, "month", monthStart(/* @__PURE__ */ new Date()));
    __publicField(this, "collapsedTaskIds", /* @__PURE__ */ new Set());
    __publicField(this, "childCounts", /* @__PURE__ */ new Map());
    __publicField(this, "unsubscribe");
    if (data?.view && VIEWS.some((view) => view.value === data.view)) {
      this.view = data.view;
    }
    if (data?.search) {
      this.search = data.search;
    }
    if (data?.month) {
      const date = /* @__PURE__ */ new Date(`${data.month}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
      }
    }
    this.unsubscribe = this.service.onChange(() => this.render());
  }
  destroy() {
    this.unsubscribe?.();
    this.container.onclick = null;
    this.container.onchange = null;
    this.container.oninput = null;
    this.container.onkeydown = null;
  }
  render() {
    const allTasks = this.service.store.all();
    const tasks = this.filteredTasks();
    this.childCounts = countChildren(allTasks);
    this.container.innerHTML = `<div class="task-manager task-manager--${this.view}">
  ${this.renderDashboardHeader(allTasks, tasks)}
  <div class="task-manager__body">
    ${tasks.length ? this.renderCurrentView(tasks) : `<div class="task-manager-empty">\u8FD9\u91CC\u6682\u65F6\u6CA1\u6709\u5339\u914D\u4EFB\u52A1\u3002</div>`}
  </div>
</div>`;
    this.bind();
  }
  renderDashboardHeader(allTasks, tasks) {
    const settings = this.service.store.getSettings();
    const overview = this.buildOverview(allTasks);
    const rootTitle = settings.taskRootTitle || "\u672A\u7ED1\u5B9A\u4E8B\u9879\u5E93";
    const rootHint = settings.taskRootHPath || settings.taskRootPath || "\u4EFB\u52A1\u4EE5\u771F\u5B9E\u7B14\u8BB0\u548C\u5B50\u6587\u6863\u5F62\u5F0F\u7EC4\u7EC7";
    return `<section class="task-manager-dashboard">
  <div class="task-manager-hero">
    <div class="task-manager-hero__title">
      <div class="task-manager-toolbar__title">
        <svg class="task-manager-toolbar__icon"><use xlink:href="#iconTaskTracker"></use></svg>
        <span>\u4EFB\u52A1\u63A7\u5236\u9762\u677F</span>
        <small>${tasks.length}</small>
      </div>
      <div class="task-manager-hero__subtitle">\u56F4\u7ED5\u4E8B\u9879\u5E93\u6587\u6863\u6811\u7BA1\u7406\u4EFB\u52A1\uFF0C\u6253\u5F00\u4EFB\u52A1\u5373\u6253\u5F00\u5BF9\u5E94\u7B14\u8BB0\u3002</div>
    </div>
    <div class="task-manager-hero__actions">
      <button class="b3-button b3-button--text" data-action="new-task"><svg><use xlink:href="#iconAdd"></use></svg><span>\u65B0\u5EFA\u4EFB\u52A1</span></button>
      <button class="block__icon ariaLabel" data-action="sync" aria-label="\u540C\u6B65\u4EFB\u52A1\u6587\u6863" data-position="south"><svg><use xlink:href="#iconRefresh"></use></svg></button>
    </div>
  </div>
  <div class="task-manager-overview">
    ${this.renderOverviewCard("\u4E8B\u9879\u5E93", rootTitle, rootHint, "task-manager-overview-card--root")}
    ${this.renderOverviewCard("\u6D3B\u8DC3\u4EFB\u52A1", String(overview.active), "\u5F85\u5904\u7406 / \u8FDB\u884C\u4E2D / \u7B49\u5F85\u4E2D", overview.active ? "" : "is-muted")}
    ${this.renderOverviewCard("\u4ECA\u65E5\u4EFB\u52A1", String(overview.today), "\u8BA1\u5212\u6216\u622A\u6B62\u5728\u4ECA\u5929", overview.today ? "" : "is-muted")}
    ${this.renderOverviewCard("\u903E\u671F\u4EFB\u52A1", String(overview.overdue), "\u9700\u8981\u4F18\u5148\u5904\u7406", overview.overdue ? "task-manager-overview-card--danger" : "is-muted")}
    ${this.renderOverviewCard("\u672A\u5B89\u6392", String(overview.unplanned), "\u5C1A\u672A\u8BBE\u7F6E\u8BA1\u5212\u5F00\u59CB", overview.unplanned ? "" : "is-muted")}
    ${this.renderOverviewCard("\u5DF2\u5B8C\u6210", String(overview.completed), "\u5DF2\u7ECF\u5B8C\u6210\u7684\u4EFB\u52A1\u7B14\u8BB0", overview.completed ? "" : "is-muted")}
  </div>
  <div class="task-manager-toolbar">
    <div class="task-manager-toolbar__views" role="tablist" aria-label="\u4EFB\u52A1\u89C6\u56FE">
      ${VIEWS.map((view) => `<button class="task-manager-view-button ${this.view === view.value ? "is-active" : ""}" data-manager-view="${view.value}" aria-label="${view.label}" role="tab" aria-selected="${this.view === view.value}"><span>${view.label}</span></button>`).join("")}
    </div>
    <label class="task-manager-toolbar__search">
      <svg><use xlink:href="#iconSearch"></use></svg>
      <input class="b3-text-field" data-field="search" value="${escapeAttr2(this.search)}" placeholder="\u641C\u7D22\u4EFB\u52A1\u3001\u9879\u76EE\u3001\u72B6\u6001\u3001\u7236\u4EFB\u52A1\u3001\u6765\u6E90" />
    </label>
  </div>
</section>`;
  }
  renderOverviewCard(label, value, hint, extraClass = "") {
    return `<article class="task-manager-overview-card ${extraClass}">
  <div class="task-manager-overview-card__label">${label}</div>
  <div class="task-manager-overview-card__value">${escapeHtml(value)}</div>
  <div class="task-manager-overview-card__hint">${escapeHtml(hint)}</div>
</article>`;
  }
  buildOverview(tasks) {
    const today = toDateKey((/* @__PURE__ */ new Date()).toISOString());
    return {
      active: tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status)).length,
      today: tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status) && toDateKey(task.planStart || task.dueDate) === today).length,
      overdue: tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status) && isActiveDateBeforeToday(task.planStart || task.dueDate)).length,
      unplanned: tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status) && !task.planStart).length,
      completed: tasks.filter((task) => task.status === "completed").length
    };
  }
  renderCurrentView(tasks) {
    switch (this.view) {
      case "list":
        return this.renderListView(tasks);
      case "timeline":
        return this.renderTimelineView(tasks);
      case "kanban":
        return this.renderKanbanView(tasks);
      case "calendar":
        return this.renderCalendarView(tasks);
      case "table":
      default:
        return this.renderTableView(tasks);
    }
  }
  renderTableView(tasks) {
    const matched = new Set(tasks.map((task) => task.id));
    const visible = includeAncestors2(this.service.store.all(), matched);
    const tree = buildTaskTree2(this.service.store.all(), visible, matched);
    return `<div class="task-manager-table-wrap">
  <table class="task-manager-table">
    <thead>
      <tr>
        <th>\u4EFB\u52A1</th>
        <th>\u6587\u6863\u5173\u8054</th>
        <th>\u9879\u76EE</th>
        <th>\u72B6\u6001</th>
        <th>\u4F18\u5148\u7EA7</th>
        <th>\u8BA1\u5212</th>
        <th>\u622A\u6B62</th>
        <th>\u7236\u4EFB\u52A1</th>
        <th>\u5B50\u6587\u6863</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${tree.map((node) => this.renderTableNode(node, 0, this.childCounts)).join("")}
    </tbody>
  </table>
</div>`;
  }
  renderTableNode(node, depth, childCounts) {
    const task = node.task;
    const childCount = childCounts.get(task.id) || 0;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const row = this.renderTableRow(node, depth, childCount, collapsed);
    const children = node.children.length && !collapsed ? node.children.map((child) => this.renderTableNode(child, depth + 1, childCounts)).join("") : "";
    return `${row}${children}`;
  }
  renderTableRow(node, depth, childCount, collapsed) {
    const task = node.task;
    const parent = task.parentId ? this.service.store.get(task.parentId) : void 0;
    const contextClass = node.contextOnly ? " task-manager-table__row--context" : "";
    return `<tr class="task-manager-table__row task-manager-status-${task.status} task-manager-priority-${task.priority}${contextClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
  <td>
    <div class="task-manager-table__task-cell">
      ${childCount ? `<button class="task-manager-task__toggle task-manager-table__toggle" data-task-action="toggle-children" aria-label="${collapsed ? "\u5C55\u5F00\u5B50\u4EFB\u52A1" : "\u6298\u53E0\u5B50\u4EFB\u52A1"}" title="${collapsed ? "\u5C55\u5F00\u5B50\u4EFB\u52A1" : "\u6298\u53E0\u5B50\u4EFB\u52A1"}"><span>${collapsed ? "\u25B8" : "\u25BE"}</span></button>` : `<span class="task-manager-task__toggle-placeholder"></span>`}
      <div class="task-manager-table__task-main">
        <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr2(task.title)}">${escapeHtml(task.title)}</button>
        ${task.path ? `<div class="task-manager-table__path">${escapeHtml(task.path)}</div>` : ""}
      </div>
    </div>
  </td>
  <td>${this.renderDocLinkMeta(task, parent, childCount)}</td>
  <td>${escapeHtml(task.project || "\u65E0\u9879\u76EE")}</td>
  <td><select class="b3-select task-manager-field" data-field="status" aria-label="\u4EFB\u52A1\u72B6\u6001">${statusOptions(task.status)}</select></td>
  <td><select class="b3-select task-manager-field" data-field="priority" aria-label="\u4EFB\u52A1\u4F18\u5148\u7EA7">${priorityOptions(task.priority)}</select></td>
  <td><input class="b3-text-field task-manager-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="\u8BA1\u5212\u65E5\u671F" /></td>
  <td><input class="b3-text-field task-manager-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="\u622A\u6B62\u65E5\u671F" /></td>
  <td>${parent ? `<button class="task-manager-parent-link" data-task-id="${parent.id}" data-task-action="open">${escapeHtml(parent.title)}</button>` : "\u65E0"}</td>
  <td>${childCount}</td>
  <td>${this.renderRowActions(task)}</td>
</tr>`;
  }
  renderListView(tasks) {
    const matched = new Set(tasks.map((task) => task.id));
    const visible = includeAncestors2(this.service.store.all(), matched);
    const tree = buildTaskTree2(this.service.store.all(), visible, matched);
    return `<div class="task-manager-list">
  ${tree.length ? tree.map((node) => this.renderTaskNode(node, 0)).join("") : `<div class="task-manager-empty">\u8FD9\u91CC\u6682\u65F6\u6CA1\u6709\u4EFB\u52A1\u3002</div>`}
</div>`;
  }
  renderTaskNode(node, depth) {
    const task = node.task;
    const childCount = node.children.length;
    const collapsed = this.collapsedTaskIds.has(task.id);
    const parent = task.parentId ? this.service.store.get(task.parentId) : void 0;
    const contextClass = node.contextOnly ? " task-manager-task--context" : "";
    return `<div class="task-manager-task task-manager-status-${task.status} task-manager-priority-${task.priority}${contextClass}" data-task-id="${task.id}" style="--task-depth: ${depth}">
  <div class="task-manager-task__main">
    <div class="task-manager-task__title-row">
      ${childCount ? `<button class="task-manager-task__toggle" data-task-action="toggle-children" aria-label="${collapsed ? "\u5C55\u5F00\u5B50\u4EFB\u52A1" : "\u6298\u53E0\u5B50\u4EFB\u52A1"}" title="${collapsed ? "\u5C55\u5F00\u5B50\u4EFB\u52A1" : "\u6298\u53E0\u5B50\u4EFB\u52A1"}"><span>${collapsed ? "\u25B8" : "\u25BE"}</span></button>` : `<span class="task-manager-task__toggle-placeholder"></span>`}
      <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr2(task.title)}">${escapeHtml(task.title)}</button>
      ${childCount ? `<span class="task-manager-task__child-count">${childCount}</span>` : ""}
    </div>
    <div class="task-manager-task__meta">
      <span>${escapeHtml(task.project || "\u65E0\u9879\u76EE")}</span>
      <span>${TASK_STATUS_LABELS[task.status]}</span>
      <span>${TASK_PRIORITY_LABELS[task.priority]}</span>
      <span>\u8BA1\u5212\uFF1A${formatHumanDate(task.planStart)}</span>
      <span>\u622A\u6B62\uFF1A${formatHumanDate(task.dueDate)}</span>
      ${this.renderDocMetaLine(task, parent, childCount)}
    </div>
  </div>
  <div class="task-manager-task__controls">
    <select class="b3-select task-manager-field" data-field="status" aria-label="\u4EFB\u52A1\u72B6\u6001">${statusOptions(task.status)}</select>
    <select class="b3-select task-manager-field" data-field="priority" aria-label="\u4EFB\u52A1\u4F18\u5148\u7EA7">${priorityOptions(task.priority)}</select>
    <input class="b3-text-field task-manager-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="\u8BA1\u5212\u65E5\u671F" />
    <input class="b3-text-field task-manager-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="\u622A\u6B62\u65E5\u671F" />
    ${this.renderRowActions(task)}
  </div>
  ${childCount && !collapsed ? `<div class="task-manager-task__children">${node.children.map((child) => this.renderTaskNode(child, depth + 1)).join("")}</div>` : ""}
</div>`;
  }
  renderTimelineView(tasks) {
    const groups = groupByPlanDate(tasks);
    return `<div class="task-manager-timeline">
  ${groups.map((group) => `<section class="task-manager-timeline__group">
    <div class="task-manager-timeline__date">${group.label}<span>${group.tasks.length}</span></div>
    <div class="task-manager-timeline__items">
      ${group.tasks.map((task) => this.renderTaskCard(task, "timeline")).join("")}
    </div>
  </section>`).join("")}
</div>`;
  }
  renderKanbanView(tasks) {
    return `<div class="task-manager-kanban">
  ${STATUSES.map((status) => {
      const columnTasks = tasks.filter((task) => task.status === status);
      return `<section class="task-manager-kanban__column task-manager-status-${status}">
      <div class="task-manager-kanban__header">${TASK_STATUS_LABELS[status]}<span>${columnTasks.length}</span></div>
      <div class="task-manager-kanban__items">
        ${columnTasks.length ? columnTasks.map((task) => this.renderTaskCard(task, "kanban")).join("") : `<div class="task-manager-empty">\u6682\u65E0\u4EFB\u52A1</div>`}
      </div>
    </section>`;
    }).join("")}
</div>`;
  }
  renderCalendarView(tasks) {
    const days = calendarDays2(this.month);
    const tasksByDate = groupTasksByDate2(tasks);
    const unplanned = tasks.filter((task) => !task.planStart);
    const monthValue = monthInputValue2(this.month);
    return `<div class="task-manager-calendar">
  <div class="task-manager-calendar__toolbar">
    <button class="task-manager-calendar__nav" data-action="prev-month" aria-label="\u4E0A\u4E2A\u6708" title="\u4E0A\u4E2A\u6708">\u2039</button>
    <div class="task-manager-calendar__title">${monthTitle(this.month)}</div>
    <button class="task-manager-calendar__nav" data-action="next-month" aria-label="\u4E0B\u4E2A\u6708" title="\u4E0B\u4E2A\u6708">\u203A</button>
    <input class="b3-text-field task-manager-calendar__month-input" data-field="month" type="month" value="${monthValue}" aria-label="\u9009\u62E9\u6708\u4EFD" />
    <button class="task-manager-calendar__nav task-manager-calendar__nav--today" data-action="today-month" aria-label="\u56DE\u5230\u672C\u6708" title="\u56DE\u5230\u672C\u6708">\u4ECA</button>
  </div>
  <div class="task-manager-calendar__layout">
    <section class="task-manager-calendar__main">
      <div class="task-manager-calendar__weekdays">
        ${["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u65E5"].map((day) => `<div>${day}</div>`).join("")}
      </div>
      <div class="task-manager-calendar__grid">
        ${days.map((day) => this.renderCalendarDay(day, tasksByDate[formatDateKey(day)] || [])).join("")}
      </div>
    </section>
    <aside class="task-manager-calendar__aside">
      <div class="task-manager-calendar__aside-title">\u672A\u5B89\u6392</div>
      <div class="task-manager-calendar__unplanned">
        ${unplanned.length ? unplanned.map((task) => this.renderTaskCard(task, "calendar-aside")).join("") : `<div class="task-manager-empty">\u6CA1\u6709\u672A\u5B89\u6392\u4EFB\u52A1\u3002</div>`}
      </div>
    </aside>
  </div>
</div>`;
  }
  renderCalendarDay(day, tasks) {
    const dateKey = formatDateKey(day);
    const isToday = dateKey === formatDateKey(/* @__PURE__ */ new Date());
    const outside = !sameMonth(day, this.month);
    return `<div class="task-manager-calendar-day ${outside ? "is-outside" : ""} ${isToday ? "is-today" : ""}" data-date="${dateKey}" role="button" tabindex="0">
  <span class="task-manager-calendar-day__num">${day.getDate()}</span>
  <div class="task-manager-calendar-day__tasks">
    ${tasks.slice(0, 5).map((task) => `<button class="task-manager-calendar-pill task-manager-status-${task.status}" data-task-id="${task.id}" data-task-action="open" title="${escapeAttr2(task.title)}">${escapeHtml(task.title)}</button>`).join("")}
    ${tasks.length > 5 ? `<span class="task-manager-calendar-day__more">+${tasks.length - 5}</span>` : ""}
  </div>
</div>`;
  }
  renderTaskCard(task, mode) {
    const parent = task.parentId ? this.service.store.get(task.parentId) : void 0;
    const childCount = this.childCounts.get(task.id) || 0;
    return `<article class="task-manager-card task-manager-card--${mode} task-manager-status-${task.status} task-manager-priority-${task.priority}" data-task-id="${task.id}">
  <div class="task-manager-card__header">
    <button class="task-manager-task-title" data-task-action="open" title="${escapeAttr2(task.title)}">${escapeHtml(task.title)}</button>
    ${this.renderRowActions(task)}
  </div>
  <div class="task-manager-card__meta">
    <span>${escapeHtml(task.project || "\u65E0\u9879\u76EE")}</span>
    <span>${TASK_STATUS_LABELS[task.status]}</span>
    <span>${TASK_PRIORITY_LABELS[task.priority]}</span>
    <span>\u8BA1\u5212\uFF1A${formatHumanDate(task.planStart)}</span>
    <span>\u622A\u6B62\uFF1A${formatHumanDate(task.dueDate)}</span>
    ${this.renderDocMetaLine(task, parent, childCount)}
  </div>
  <div class="task-manager-card__controls">
    <select class="b3-select task-manager-field" data-field="status" aria-label="\u4EFB\u52A1\u72B6\u6001">${statusOptions(task.status)}</select>
    <select class="b3-select task-manager-field" data-field="priority" aria-label="\u4EFB\u52A1\u4F18\u5148\u7EA7">${priorityOptions(task.priority)}</select>
    <input class="b3-text-field task-manager-field" data-field="planDate" type="date" value="${toDateKey(task.planStart)}" aria-label="\u8BA1\u5212\u65E5\u671F" />
    <input class="b3-text-field task-manager-field" data-field="dueDate" type="date" value="${task.dueDate || ""}" aria-label="\u622A\u6B62\u65E5\u671F" />
  </div>
</article>`;
  }
  renderRowActions(task) {
    return `<span class="task-manager-actions">
  <button class="block__icon ariaLabel" data-task-action="subtask" aria-label="\u521B\u5EFA\u5B50\u4EFB\u52A1" data-position="north"><svg><use xlink:href="#iconAdd"></use></svg></button>
  ${task.status === "completed" ? `<button class="block__icon ariaLabel" data-task-action="reopen" aria-label="\u91CD\u65B0\u6253\u5F00" data-position="north"><svg><use xlink:href="#iconRefresh"></use></svg></button>` : `<button class="block__icon ariaLabel" data-task-action="complete" aria-label="\u5B8C\u6210\u4EFB\u52A1" data-position="north"><svg><use xlink:href="#iconSelect"></use></svg></button>`}
</span>`;
  }
  renderDocMetaLine(task, parent, childCount) {
    const segments = [
      parent ? `\u7236\u4EFB\u52A1\uFF1A${parent.title}` : "",
      task.sourceText ? `\u6765\u6E90\uFF1A${task.sourceText}` : task.sourceDocId ? `\u6765\u6E90\u6587\u6863\uFF1A${task.sourceDocId}` : "",
      childCount ? `\u5B50\u6587\u6863\uFF1A${childCount}` : "",
      task.path ? `\u8DEF\u5F84\uFF1A${task.path}` : ""
    ].filter(Boolean);
    return segments.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  }
  renderDocLinkMeta(task, parent, childCount) {
    return `<div class="task-manager-doc-meta">
  ${parent ? `<div class="task-manager-doc-meta__item">\u7236\u4EFB\u52A1\uFF1A${escapeHtml(parent.title)}</div>` : ""}
  ${task.sourceText ? `<div class="task-manager-doc-meta__item">\u6765\u6E90\uFF1A${escapeHtml(task.sourceText)}</div>` : task.sourceDocId ? `<div class="task-manager-doc-meta__item">\u6765\u6E90\u6587\u6863\uFF1A${escapeHtml(task.sourceDocId)}</div>` : `<div class="task-manager-doc-meta__item">\u6587\u6863 ID\uFF1A${escapeHtml(task.docId)}</div>`}
  <div class="task-manager-doc-meta__item">\u5B50\u6587\u6863\uFF1A${childCount}</div>
</div>`;
  }
  bind() {
    this.container.onclick = (event) => this.handleClick(event);
    this.container.onchange = (event) => this.handleChange(event);
    this.container.oninput = (event) => this.handleInput(event);
    this.container.onkeydown = (event) => this.handleKeydown(event);
  }
  handleClick(event) {
    const target = event.target;
    const viewButton = target.closest("[data-manager-view]");
    if (viewButton) {
      this.view = viewButton.dataset.managerView;
      this.render();
      return;
    }
    const actionButton = target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "new-task") {
        this.actions.newTask({});
        return;
      }
      if (action === "sync") {
        void this.runSync();
        return;
      }
      if (action === "prev-month") {
        this.month = addMonths(this.month, -1);
        this.render();
        return;
      }
      if (action === "next-month") {
        this.month = addMonths(this.month, 1);
        this.render();
        return;
      }
      if (action === "today-month") {
        this.month = monthStart(/* @__PURE__ */ new Date());
        this.render();
        return;
      }
    }
    const taskAction = target.closest("[data-task-action]");
    if (taskAction) {
      event.stopPropagation();
      const task = this.taskFromElement(taskAction);
      if (task) {
        this.handleTaskAction(taskAction.dataset.taskAction || "", task);
      }
      return;
    }
    const day = target.closest(".task-manager-calendar-day");
    if (day?.dataset.date) {
      this.actions.newTask({ presetPlanDate: day.dataset.date });
    }
  }
  handleChange(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.field === "month") {
      const date = /* @__PURE__ */ new Date(`${target.value}-01T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        this.month = monthStart(date);
        this.render();
      }
      return;
    }
    const field = target.closest("[data-field]");
    const task = field ? this.taskFromElement(field) : void 0;
    if (!field || !task) {
      return;
    }
    if (field.dataset.field === "status") {
      void this.runUpdate(() => this.service.updateTask(task.id, { status: field.value }));
    } else if (field.dataset.field === "priority") {
      void this.runUpdate(() => this.service.updateTask(task.id, { priority: field.value }));
    } else if (field.dataset.field === "planDate") {
      void this.runUpdate(() => this.service.updateTask(task.id, { planStart: fromDateInput(field.value) }));
    } else if (field.dataset.field === "dueDate") {
      void this.runUpdate(() => this.service.updateTask(task.id, { dueDate: field.value || void 0 }));
    }
  }
  handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.field !== "search") {
      return;
    }
    const cursor = target.selectionStart ?? target.value.length;
    this.search = target.value;
    this.render();
    const nextSearch = this.container.querySelector("[data-field='search']");
    nextSearch?.focus();
    nextSearch?.setSelectionRange(cursor, cursor);
  }
  handleKeydown(event) {
    const target = event.target;
    const day = target.closest(".task-manager-calendar-day");
    if (day?.dataset.date && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.actions.newTask({ presetPlanDate: day.dataset.date });
    }
  }
  handleTaskAction(action, task) {
    if (action === "open") {
      this.actions.openTask(task);
    } else if (action === "subtask") {
      this.actions.createSubtask(task.id);
    } else if (action === "complete") {
      void this.runUpdate(() => this.service.completeTask(task.id));
    } else if (action === "reopen") {
      void this.runUpdate(() => this.service.reopenTask(task.id));
    } else if (action === "toggle-children") {
      if (this.collapsedTaskIds.has(task.id)) {
        this.collapsedTaskIds.delete(task.id);
      } else {
        this.collapsedTaskIds.add(task.id);
      }
      this.render();
    }
  }
  async runSync() {
    try {
      if (this.actions.sync) {
        await this.actions.sync();
        (0, import_siyuan6.showMessage)("\u4EFB\u52A1\u9762\u677F\u5DF2\u540C\u6B65");
        return;
      }
      const removed = await this.service.syncDeletedDocs();
      const synced = await this.service.syncAllTaskDocuments();
      (0, import_siyuan6.showMessage)(removed > 0 ? `\u5DF2\u6E05\u7406 ${removed} \u4E2A\u5DF2\u5220\u9664\u4EFB\u52A1\u8BB0\u5F55\uFF0C\u540C\u6B65 ${synced} \u4E2A\u4EFB\u52A1\u6587\u6863` : `\u5DF2\u540C\u6B65 ${synced} \u4E2A\u4EFB\u52A1\u6587\u6863`);
    } catch (error) {
      (0, import_siyuan6.showMessage)(error instanceof Error ? error.message : "\u540C\u6B65\u4EFB\u52A1\u5931\u8D25", 5e3, "error");
    }
  }
  async runUpdate(action) {
    try {
      await action();
    } catch (error) {
      (0, import_siyuan6.showMessage)(error instanceof Error ? error.message : "\u66F4\u65B0\u4EFB\u52A1\u5931\u8D25", 5e3, "error");
      this.render();
    }
  }
  filteredTasks() {
    const query = normalizeSearch(this.search);
    const tasks = this.service.store.all();
    if (!query) {
      return tasks;
    }
    return tasks.filter((task) => {
      const parent = task.parentId ? this.service.store.get(task.parentId) : void 0;
      const haystack = [
        task.title,
        task.project,
        task.sourceText,
        TASK_STATUS_LABELS[task.status],
        TASK_PRIORITY_LABELS[task.priority],
        task.planStart,
        task.dueDate,
        parent?.title
      ].filter(Boolean).join(" ");
      return normalizeSearch(haystack).includes(query);
    });
  }
  taskFromElement(element) {
    const owner = element.closest("[data-task-id]");
    const taskId = owner?.dataset.taskId;
    return taskId ? this.service.store.get(taskId) : void 0;
  }
};
function countChildren(tasks) {
  const counts = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    if (task.parentId) {
      counts.set(task.parentId, (counts.get(task.parentId) || 0) + 1);
    }
  }
  return counts;
}
function includeAncestors2(tasks, matched) {
  const visible = new Set(matched);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const id of matched) {
    let current = byId.get(id);
    while (current?.parentId) {
      visible.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
  return visible;
}
function buildTaskTree2(tasks, visible, matched) {
  const nodes = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    if (visible.has(task.id)) {
      nodes.set(task.id, {
        task,
        children: [],
        contextOnly: !matched.has(task.id)
      });
    }
  }
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.task.parentId ? nodes.get(node.task.parentId) : void 0;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
function groupByPlanDate(tasks) {
  const groups = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    const key = toDateKey(task.planStart) || "unplanned";
    const group = groups.get(key) || [];
    group.push(task);
    groups.set(key, group);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === "unplanned") {
      return 1;
    }
    if (b === "unplanned") {
      return -1;
    }
    return a.localeCompare(b);
  }).map(([key, groupTasks]) => ({
    key,
    label: key === "unplanned" ? "\u672A\u5B89\u6392" : key,
    tasks: groupTasks
  }));
}
function calendarDays2(month) {
  const first = monthStart(month);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - startOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}
function groupTasksByDate2(tasks) {
  const result = {};
  for (const task of tasks) {
    const key = toDateKey(task.planStart);
    if (!key) {
      continue;
    }
    result[key] || (result[key] = []);
    result[key].push(task);
  }
  return result;
}
function monthInputValue2(date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}
function normalizeSearch(value) {
  return (value || "").trim().toLocaleLowerCase();
}
function escapeAttr2(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

// src/index.ts
var DOCK_TYPE = "task_tracker_dock";
var CALENDAR_TAB_TYPE = "task_tracker_calendar_tab";
var MANAGER_TAB_TYPE = "task_tracker_manager_tab";
var TaskTrackerPlugin = class extends import_siyuan7.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "store");
    __publicField(this, "service");
    __publicField(this, "ready");
    __publicField(this, "taskDock");
    __publicField(this, "calendarViews", /* @__PURE__ */ new Map());
    __publicField(this, "managerViews", /* @__PURE__ */ new Map());
    __publicField(this, "docMenuHandler", this.handleDocumentMenu.bind(this));
    __publicField(this, "blockMenuHandler", this.handleBlockMenu.bind(this));
    __publicField(this, "wsMainHandler", this.handleWsMain.bind(this));
  }
  onload() {
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
  onLayoutReady() {
    this.addTopBar({
      icon: "iconTaskTracker",
      title: "\u4EFB\u52A1\u8FFD\u8E2A",
      position: "right",
      callback: (event) => {
        const rect = event.target.getBoundingClientRect();
        this.openTopBarMenu(rect);
      }
    });
  }
  onunload() {
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
  registerDock() {
    this.addDock({
      type: DOCK_TYPE,
      config: {
        position: "LeftBottom",
        size: { width: 320, height: 0 },
        icon: "iconTaskTracker",
        title: "\u4EFB\u52A1\u8FFD\u8E2A",
        hotkey: "\u2325\u2318T"
      },
      data: {},
      init: (dock) => {
        dock.element.innerHTML = `<div class="task-tracker task-tracker-empty">\u4EFB\u52A1\u8FFD\u8E2A\u52A0\u8F7D\u4E2D...</div>`;
        void this.ready.then(() => {
          this.taskDock?.destroy();
          this.taskDock = new TaskDock(dock.element, this.service, this.viewActions());
          this.taskDock.render();
        }).catch((error) => {
          dock.element.innerHTML = `<div class="task-tracker task-tracker-empty">\u52A0\u8F7D\u5931\u8D25\uFF1A${error?.message || error}</div>`;
        });
      },
      update: () => {
        this.taskDock?.render();
      },
      destroy: () => {
        this.taskDock?.destroy();
        this.taskDock = void 0;
      }
    });
  }
  registerCalendarTab() {
    const plugin = this;
    this.addTab({
      type: CALENDAR_TAB_TYPE,
      init() {
        const tab = this;
        tab.element.innerHTML = `<div class="task-tracker task-tracker-empty">\u4EFB\u52A1\u65E5\u5386\u52A0\u8F7D\u4E2D...</div>`;
        void plugin.ready.then(() => {
          const view = new CalendarTab(tab.element, plugin.service, {
            newTask: (presetPlanDate) => void plugin.showTaskDialog({ presetPlanDate }),
            openTask: (task) => void plugin.openTask(task)
          }, tab.data || {});
          plugin.calendarViews.set(tab.element, view);
          view.render();
        }).catch((error) => {
          tab.element.innerHTML = `<div class="task-tracker task-tracker-empty">\u52A0\u8F7D\u5931\u8D25\uFF1A${error?.message || error}</div>`;
        });
      },
      destroy() {
        const tab = this;
        const view = plugin.calendarViews.get(tab.element);
        view?.destroy();
        plugin.calendarViews.delete(tab.element);
      }
    });
  }
  registerManagerTab() {
    const plugin = this;
    this.addTab({
      type: MANAGER_TAB_TYPE,
      init() {
        const tab = this;
        tab.element.innerHTML = `<div class="task-manager task-manager-empty">\u4EFB\u52A1\u7BA1\u7406\u5668\u52A0\u8F7D\u4E2D...</div>`;
        void plugin.ready.then(() => {
          const view = new TaskManagerTab(tab.element, plugin.service, {
            newTask: (options) => void plugin.showTaskDialog(options || {}),
            createSubtask: (parentId) => void plugin.showTaskDialog({ parentId }),
            openTask: (task) => void plugin.openTask(task),
            sync: () => plugin.syncDeletedTasks()
          }, tab.data || {});
          plugin.managerViews.set(tab.element, view);
          view.render();
        }).catch((error) => {
          tab.element.innerHTML = `<div class="task-manager task-manager-empty">\u52A0\u8F7D\u5931\u8D25\uFF1A${error?.message || error}</div>`;
        });
      },
      destroy() {
        const tab = this;
        const view = plugin.managerViews.get(tab.element);
        view?.destroy();
        plugin.managerViews.delete(tab.element);
      }
    });
  }
  registerCommands() {
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
      editorCallback: (protyle) => void this.setCurrentDocAsRoot(protyle),
      callback: () => void this.setCurrentDocAsRoot()
    });
  }
  registerContextMenus() {
    this.eventBus.on("click-editortitleicon", this.docMenuHandler);
    this.eventBus.on("click-blockicon", this.blockMenuHandler);
    this.eventBus.on("ws-main", this.wsMainHandler);
  }
  createSettingPanel() {
    return createTaskSettings(this.service, {
      setCurrentDocAsRoot: () => this.setCurrentDocAsRoot(),
      setRootDocId: (docId) => this.setRootDocId(docId),
      openRootDoc: () => this.openRootDoc(),
      refreshViews: () => this.refreshViews()
    }, plugin_default.version);
  }
  viewActions() {
    return {
      newTask: () => void this.showTaskDialog(),
      createSubtask: (parentId) => void this.showTaskDialog({ parentId }),
      openTask: (task) => void this.openTask(task),
      openCalendar: () => void this.openCalendar(),
      setCurrentDocAsRoot: () => void this.setCurrentDocAsRoot()
    };
  }
  openTopBarMenu(rect) {
    const menu = new import_siyuan7.Menu("taskTrackerTopBar");
    menu.addItem({
      icon: "iconAdd",
      label: "\u65B0\u5EFA\u4EFB\u52A1",
      click: () => void this.showTaskDialog()
    });
    menu.addItem({
      icon: "iconTaskTracker",
      label: "\u6253\u5F00\u4EFB\u52A1\u7BA1\u7406\u5668",
      click: () => void this.openTaskManager()
    });
    menu.addItem({
      icon: "iconCalendar",
      label: "\u6253\u5F00\u4EFB\u52A1\u65E5\u5386",
      click: () => void this.openCalendar()
    });
    menu.addItem({
      icon: "iconFolder",
      label: "\u6253\u5F00\u4E8B\u9879\u5E93",
      click: () => void this.openRootDoc()
    });
    menu.addSeparator();
    menu.addItem({
      icon: "iconDatabase",
      label: "\u8BBE\u7F6E\u4E8B\u9879\u5E93\u6587\u6863 ID",
      click: () => void this.showRootDocIdDialog()
    });
    menu.addItem({
      icon: "iconFile",
      label: "\u4ECE\u5F53\u524D\u6587\u6863\u521B\u5EFA\u4EFB\u52A1",
      click: () => void this.createTaskFromCurrentDocument()
    });
    menu.addItem({
      icon: "iconRefresh",
      label: "\u6E05\u7406\u5DF2\u5220\u9664\u4EFB\u52A1\u8BB0\u5F55",
      click: () => void this.syncDeletedTasks()
    });
    menu.addItem({
      icon: "iconSettings",
      label: "\u63D2\u4EF6\u8BBE\u7F6E",
      click: () => {
        (0, import_siyuan7.openSetting)(this.app);
      }
    });
    menu.open({
      x: rect.right,
      y: rect.bottom,
      isLeft: true
    });
  }
  handleDocumentMenu({ detail }) {
    const docId = detail?.protyle?.block?.rootID;
    if (!detail?.menu || !docId) {
      return;
    }
    detail.menu.addItem({
      icon: "iconAdd",
      label: "\u4ECE\u5F53\u524D\u6587\u6863\u521B\u5EFA\u4EFB\u52A1",
      click: () => void this.createTaskFromCurrentDocument(detail.protyle)
    });
    detail.menu.addItem({
      icon: "iconDatabase",
      label: "\u5C06\u5F53\u524D\u6587\u6863\u8BBE\u4E3A\u4E8B\u9879\u5E93",
      click: () => void this.setCurrentDocAsRoot(detail.protyle)
    });
  }
  handleBlockMenu({ detail }) {
    const blockElements = Array.isArray(detail?.blockElements) ? detail.blockElements : [];
    const firstBlockId = blockElements[0]?.getAttribute?.("data-node-id");
    if (!detail?.menu || !firstBlockId) {
      return;
    }
    detail.menu.addItem({
      icon: "iconAdd",
      label: blockElements.length > 1 ? "\u4ECE\u7B2C\u4E00\u4E2A\u9009\u4E2D\u5757\u521B\u5EFA\u4EFB\u52A1" : "\u4ECE\u5F53\u524D\u5757\u521B\u5EFA\u4EFB\u52A1",
      click: () => void this.createTaskFromBlock(firstBlockId)
    });
  }
  handleWsMain({ detail }) {
    if (detail?.cmd !== "removeDoc") {
      return;
    }
    void this.ready.then(() => this.service.syncDeletedDocs()).catch((error) => console.warn("Task Tracker: failed to sync deleted docs", error));
  }
  async showTaskDialog(options = {}) {
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
  async setCurrentDocAsRoot(protyle) {
    await this.ready;
    const currentProtyle = protyle || this.getCurrentProtyle();
    const docId = currentProtyle?.block?.rootID;
    if (!docId) {
      (0, import_siyuan7.showMessage)("\u672A\u8BC6\u522B\u5230\u5F53\u524D\u6587\u6863\uFF0C\u8BF7\u4F7F\u7528\u6587\u6863 ID \u8BBE\u7F6E\u4E8B\u9879\u5E93", 5e3, "info");
      return;
    }
    await this.setRootDocId(docId);
  }
  async setRootDocId(docId) {
    await this.ready;
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      (0, import_siyuan7.showMessage)("\u8BF7\u5148\u586B\u5199\u4E8B\u9879\u5E93\u6587\u6863 ID", 4e3, "info");
      return;
    }
    if (!/^\d{14}-[a-z0-9]{7}$/i.test(normalizedDocId)) {
      (0, import_siyuan7.showMessage)("\u6587\u6863 ID \u683C\u5F0F\u770B\u8D77\u6765\u4E0D\u6B63\u786E\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u4ECE\u601D\u6E90\u590D\u5236\u4E86\u6587\u6863 ID", 5e3, "error");
      return;
    }
    try {
      const settings = await this.service.setRootFromDoc(normalizedDocId);
      this.setting = this.createSettingPanel();
      this.refreshViews();
      (0, import_siyuan7.showMessage)(`\u5DF2\u5C06 ${settings.taskRootTitle || "\u5F53\u524D\u6587\u6863"} \u8BBE\u4E3A\u4E8B\u9879\u5E93`);
    } catch (error) {
      (0, import_siyuan7.showMessage)(error instanceof Error ? error.message : "\u8BBE\u7F6E\u4E8B\u9879\u5E93\u5931\u8D25", 5e3, "error");
    }
  }
  async showRootDocIdDialog() {
    await this.ready;
    const currentId = this.service.store.getSettings().taskRootDocId || "";
    const dialog = new import_siyuan7.Dialog({
      title: "\u8BBE\u7F6E\u4E8B\u9879\u5E93\u6587\u6863 ID",
      content: `<form class="task-tracker-dialog">
  <div class="b3-dialog__content task-tracker-dialog__content">
    <label class="task-tracker-field">
      <span>\u6587\u6863 ID</span>
      <input class="b3-text-field fn__block" name="docId" value="${escapeAttr3(currentId)}" placeholder="\u4F8B\u5982\uFF1A20260506092200-qynf33g" required />
    </label>
  </div>
  <div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">\u53D6\u6D88</button>
    <div class="fn__space"></div>
    <button type="submit" class="b3-button b3-button--text">\u7ED1\u5B9A\u4E8B\u9879\u5E93</button>
  </div>
</form>`,
      width: "520px"
    });
    const form = dialog.element.querySelector("form");
    const input = dialog.element.querySelector("input[name='docId']");
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
  async createTaskFromCurrentDocument(protyle) {
    await this.ready;
    const currentProtyle = protyle || this.getCurrentProtyle();
    const docId = currentProtyle?.block?.rootID;
    if (!docId) {
      (0, import_siyuan7.showMessage)("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u6587\u6863", 4e3, "info");
      return;
    }
    try {
      const source = await sourceFromBlock(docId);
      await this.showTaskDialog({
        source,
        presetTitle: source.text || "\u65B0\u4EFB\u52A1"
      });
    } catch (error) {
      (0, import_siyuan7.showMessage)(error instanceof Error ? error.message : "\u8BFB\u53D6\u5F53\u524D\u6587\u6863\u5931\u8D25", 5e3, "error");
    }
  }
  async createTaskFromBlock(blockId) {
    await this.ready;
    try {
      const source = await sourceFromBlock(blockId);
      await this.showTaskDialog({
        source,
        presetTitle: source.text || "\u65B0\u4EFB\u52A1"
      });
    } catch (error) {
      (0, import_siyuan7.showMessage)(error instanceof Error ? error.message : "\u8BFB\u53D6\u5F53\u524D\u5757\u5931\u8D25", 5e3, "error");
    }
  }
  async openCalendar() {
    await this.ready;
    (0, import_siyuan7.openTab)({
      app: this.app,
      custom: {
        icon: "iconCalendar",
        title: "\u4EFB\u52A1\u65E5\u5386",
        id: `${this.name}${CALENDAR_TAB_TYPE}`,
        data: {}
      }
    });
  }
  async openTaskManager() {
    await this.ready;
    (0, import_siyuan7.openTab)({
      app: this.app,
      custom: {
        icon: "iconTaskTracker",
        title: "\u4EFB\u52A1\u7BA1\u7406\u5668",
        id: `${this.name}${MANAGER_TAB_TYPE}`,
        data: {}
      }
    });
  }
  async openTask(task) {
    (0, import_siyuan7.openTab)({
      app: this.app,
      doc: {
        id: task.docId
      }
    });
  }
  async openRootDoc() {
    await this.ready;
    const rootDocId = this.service.store.getSettings().taskRootDocId;
    if (!rootDocId) {
      (0, import_siyuan7.showMessage)("\u8FD8\u6CA1\u6709\u8BBE\u7F6E\u4E8B\u9879\u5E93", 4e3, "info");
      return;
    }
    (0, import_siyuan7.openTab)({
      app: this.app,
      doc: {
        id: rootDocId
      }
    });
  }
  async syncDeletedTasks() {
    await this.ready;
    const count = await this.service.syncDeletedDocs();
    (0, import_siyuan7.showMessage)(count > 0 ? `\u5DF2\u6E05\u7406 ${count} \u4E2A\u5DF2\u5220\u9664\u4EFB\u52A1\u8BB0\u5F55` : "\u6CA1\u6709\u9700\u8981\u6E05\u7406\u7684\u4EFB\u52A1\u8BB0\u5F55");
  }
  refreshViews() {
    this.taskDock?.render();
    for (const view of this.calendarViews.values()) {
      view.render();
    }
    for (const view of this.managerViews.values()) {
      view.render();
    }
  }
  getCurrentProtyle() {
    return this.getEditor?.()?.protyle;
  }
};
function escapeAttr3(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

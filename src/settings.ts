import { Dialog, Setting, showMessage } from "siyuan";
import type { TaskService } from "./document";
import { DEFAULT_TASK_TEMPLATE } from "./types";

const MANAGED_DETAIL_SECTION_TITLE = "## 任务详情";
const REQUIRED_TEMPLATE_PLACEHOLDERS = ["{{source}}", "{{status}}", "{{priority}}", "{{description}}"];
const MANAGED_SUMMARY_HINT = "任务概要受控区正式支持 Markdown 表格，以及紧随表格后的父任务 / 子任务 / 任务描述标签行；插件会持续同步表格和这些标签行。";

export function createTaskSettings(
  service: TaskService,
  actions: {
    setCurrentDocAsRoot: () => Promise<void>;
    openTaskRootDoc: () => Promise<void>;
    setRootDocId: (docId: string) => Promise<void>;
    syncDeletedTasks: () => Promise<void>;
    rebuildTaskIndex: () => Promise<void>;
    reconcileAffectedTaskSummaries: () => Promise<void>;
    refreshViews: () => void;
  },
  version: string
): Setting {
  const settingsState = service.store.getSettings();
  const defaultProjectInput = document.createElement("input");
  defaultProjectInput.className = "b3-text-field fn__block task-settings-control task-settings-input";
  defaultProjectInput.placeholder = "例如：工作 / 产品 / 客户A";
  defaultProjectInput.value = settingsState.defaultProject || "";

  const rootDocIdInput = document.createElement("input");
  rootDocIdInput.className = "b3-text-field fn__block task-settings-control task-settings-input task-settings-doc-id";
  rootDocIdInput.placeholder = "粘贴文档 ID，例如：20260506092200-qynf33g";
  rootDocIdInput.value = settingsState.taskRootDocId || "";
  rootDocIdInput.title = rootDocIdInput.value || "";
  rootDocIdInput.addEventListener("input", () => {
    rootDocIdInput.title = rootDocIdInput.value || "";
  });

  const templateInput = document.createElement("textarea");
  templateInput.className = "b3-text-field fn__block task-settings-template-editor";
  templateInput.spellcheck = false;
  templateInput.value = settingsState.taskTemplate || DEFAULT_TASK_TEMPLATE;

  const setting = new Setting({
    confirmCallback: async () => {
      const normalizedTemplate = templateInput.value.trim();
      const validationError = validateTaskTemplate(normalizedTemplate || DEFAULT_TASK_TEMPLATE);
      if (validationError) {
        showMessage(validationError, 7000, "error");
        throw new Error(validationError);
      }
      await service.store.setSettings({
        defaultProject: defaultProjectInput.value.trim() || undefined,
        taskTemplate: normalizedTemplate || undefined,
        collaborationMode: collaborationModeSelect.value === "single-workspace" ? "single-workspace" : "strict"
      });
      actions.refreshViews();
      showMessage("任务追踪设置已保存");
    }
  });

  const collaborationModeSelect = document.createElement("select");
  collaborationModeSelect.className = "b3-select fn__block task-settings-control task-settings-select";
  collaborationModeSelect.innerHTML = `
    <option value="strict">严格协作</option>
    <option value="single-workspace">单工作区</option>
  `;
  collaborationModeSelect.value = settingsState.collaborationMode || "strict";

  const header = buildSettingsHeader(() => showHelpDialog());
  setting.addItem({
    title: "",
    description: "",
    direction: "column",
    actionElement: header
  });

  setting.addItem({
    title: "",
    description: "",
    direction: "column",
    actionElement: buildSettingsCard({
      icon: "iconEdit",
      title: "默认项目",
      description: "新建任务时自动填入，可在创建时修改。",
      actionElement: defaultProjectInput
    })
  });

  setting.addItem({
    title: "",
    description: "",
    direction: "column",
    actionElement: buildSettingsCard({
      icon: "iconSettings",
      title: "协作模式",
      description: "严格协作用于多副本同步（桌面/手机），单工作区用于同一后端多会话并发。",
      actionElement: collaborationModeSelect
    })
  });

  const rootRow = document.createElement("div");
  rootRow.className = "task-settings-root-row";

  const bindButton = document.createElement("button");
  bindButton.className = "b3-button b3-button--outline task-settings-btn task-settings-btn--outline";
  bindButton.textContent = "绑定 ID";
  bindButton.addEventListener("click", () => {
    void actions.setRootDocId(rootDocIdInput.value);
  });

  const openButton = document.createElement("button");
  openButton.className = "b3-button b3-button--outline task-settings-btn task-settings-btn--outline";
  openButton.textContent = "打开文档";
  openButton.title = "打开当前事项库文档";
  openButton.addEventListener("click", () => {
    void actions.openTaskRootDoc();
  });

  rootRow.append(rootDocIdInput, bindButton, openButton);

  setting.addItem({
    title: "",
    description: "",
    direction: "column",
    actionElement: buildSettingsCard({
      icon: "iconFolder",
      title: "事项库",
      description: "存储所有任务和项目的根目录。",
      actionElement: rootRow
    })
  });

  const maintenanceGrid = document.createElement("div");
  maintenanceGrid.className = "task-settings-maintenance-grid";

  const cleanupButton = buildMaintenanceAction(
    "warning",
    "iconTrashcan",
    "清理已删除任务记录",
    "清理文档已不存在的失效任务索引",
    () => {
      void actions.syncDeletedTasks();
    }
  );
  const rebuildButton = buildMaintenanceAction(
    "primary",
    "iconRefresh",
    "从事项库重建任务索引",
    "重新扫描事项库中的任务文档并重建索引",
    () => {
      void actions.rebuildTaskIndex();
    }
  );
  rebuildButton.title = "重新扫描事项库中的可识别任务文档，重建任务索引缓存";
  const reconcileButton = buildMaintenanceAction(
    "success",
    "iconList",
    "整理受影响任务摘要",
    "仅整理待整理任务的摘要展示",
    () => {
      void actions.reconcileAffectedTaskSummaries();
    }
  );
  reconcileButton.title = "仅整理被标记为待整理的任务摘要，不会全库重写";
  maintenanceGrid.append(cleanupButton, rebuildButton, reconcileButton);

  setting.addItem({
    title: "",
    description: "",
    direction: "column",
    actionElement: buildSettingsCard({
      icon: "iconTaskTracker",
      title: "任务维护",
      description: "清理失效索引、重建任务索引，或整理待处理的任务摘要。",
      actionElement: maintenanceGrid,
      className: "task-settings-card--stacked"
    })
  });

  const templateWrapper = document.createElement("div");
  templateWrapper.className = "task-settings-template-wrap";

  const templateTop = document.createElement("div");
  templateTop.className = "task-settings-template-top";

  const resetButton = document.createElement("button");
  resetButton.className = "b3-button b3-button--outline task-settings-btn task-settings-btn--outline";
  resetButton.textContent = "恢复默认模板";
  resetButton.addEventListener("click", () => {
    templateInput.value = DEFAULT_TASK_TEMPLATE;
  });
  templateTop.append(resetButton);

  const variableRow = document.createElement("div");
  variableRow.className = "task-settings-template-tags";
  const variableLabel = document.createElement("span");
  variableLabel.className = "task-settings-template-tags__label";
  variableLabel.textContent = "可用变量：";
  variableRow.append(variableLabel);
  [
    "{{project}}",
    "{{status}}",
    "{{source}}",
    "{{priority}}",
    "{{createdAt}}",
    "{{parent}}",
    "{{childTasks}}",
    "{{description}}"
  ].forEach((token) => {
    const tag = document.createElement("span");
    tag.className = "task-settings-template-tag";
    tag.textContent = token;
    variableRow.append(tag);
  });

  templateWrapper.append(templateTop, templateInput, variableRow);

  setting.addItem({
    title: "",
    description: "",
    direction: "column",
    actionElement: buildSettingsCard({
      icon: "iconFile",
      title: "任务模板",
      description: "新建任务文档时使用的模板，支持 Markdown 语法和变量占位符。",
      actionElement: templateWrapper,
      className: "task-settings-card--stacked"
    })
  });

  const helpButton = document.createElement("button");
  helpButton.className = "b3-button b3-button--outline task-settings-btn task-settings-btn--outline";
  helpButton.textContent = "打开使用帮助";
  helpButton.addEventListener("click", () => showHelpDialog());

  setting.addItem({
    title: "",
    description: "",
    direction: "column",
    actionElement: buildSettingsCard({
      icon: "iconHelp",
      title: "使用帮助",
      description: "查看插件使用说明、常见问题和操作指南。",
      actionElement: helpButton
    })
  });

  const pluginInfo = document.createElement("div");
  pluginInfo.className = "task-settings-plugin-info";

  const checkUpdate = document.createElement("button");
  checkUpdate.className = "task-settings-link-btn";
  checkUpdate.textContent = "检查更新";
  checkUpdate.addEventListener("click", () => {
    window.open("https://github.com/risoyo/siyuan-plugin-task-tracker/releases", "_blank", "noopener,noreferrer");
  });

  const versionValue = document.createElement("div");
  versionValue.className = "task-settings-version";
  versionValue.textContent = `v${version}`;
  pluginInfo.append(checkUpdate, versionValue);

  setting.addItem({
    title: "",
    description: "",
    direction: "column",
    actionElement: buildSettingsCard({
      icon: "iconInfo",
      title: "插件信息",
      description: `当前版本：v${version}`,
      actionElement: pluginInfo
    })
  });

  mountSettingDialogSkin();
  return setting;
}

function buildSettingsHeader(openHelp: () => void): HTMLElement {
  const shell = document.createElement("div");
  shell.className = "task-tracker-settings-shell";
  shell.innerHTML = `
    <div class="task-tracker-settings-shell__main">
      <h1 class="task-tracker-settings-shell__title">任务追踪设置</h1>
      <p class="task-tracker-settings-shell__subtitle">配置任务追踪插件的各项参数</p>
    </div>
    <div class="task-tracker-settings-shell__actions"></div>
  `;

  const actions = shell.querySelector<HTMLElement>(".task-tracker-settings-shell__actions");
  if (!actions) {
    return shell;
  }

  const helpButton = document.createElement("button");
  helpButton.className = "task-settings-header-link";
  helpButton.innerHTML = `<svg><use xlink:href="#iconHelp"></use></svg><span>使用帮助</span>`;
  helpButton.addEventListener("click", () => openHelp());

  const closeButton = document.createElement("button");
  closeButton.className = "task-settings-header-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "关闭");
  closeButton.textContent = "✕";
  closeButton.addEventListener("click", () => {
    const dialog = shell.closest(".b3-dialog");
    const close = dialog?.querySelector<HTMLElement>(".b3-dialog__close, [data-type='close']");
    close?.click();
  });

  actions.append(helpButton, closeButton);
  return shell;
}

function buildSettingsCard(options: {
  icon: string;
  title: string;
  description: string;
  actionElement: HTMLElement;
  className?: string;
}): HTMLElement {
  const card = document.createElement("section");
  card.className = `task-settings-card ${options.className || ""}`.trim();
  card.innerHTML = `
    <div class="task-settings-card__meta">
      <span class="task-settings-card__icon"><svg><use xlink:href="#${options.icon}"></use></svg></span>
      <div class="task-settings-card__text">
        <h3 class="task-settings-card__title"></h3>
        <p class="task-settings-card__desc"></p>
      </div>
    </div>
    <div class="task-settings-card__action"></div>
  `;
  const title = card.querySelector<HTMLElement>(".task-settings-card__title");
  const desc = card.querySelector<HTMLElement>(".task-settings-card__desc");
  const action = card.querySelector<HTMLElement>(".task-settings-card__action");
  if (title) {
    title.textContent = options.title;
  }
  if (desc) {
    desc.textContent = options.description;
  }
  if (action) {
    action.append(options.actionElement);
  }
  return card;
}

function buildMaintenanceAction(
  tone: "warning" | "primary" | "success",
  icon: string,
  title: string,
  desc: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `task-settings-maintenance-item task-settings-maintenance-item--${tone}`;
  button.type = "button";
  button.innerHTML = `
    <span class="task-settings-maintenance-item__icon"><svg><use xlink:href="#${icon}"></use></svg></span>
    <span class="task-settings-maintenance-item__body">
      <span class="task-settings-maintenance-item__title"></span>
      <span class="task-settings-maintenance-item__desc"></span>
    </span>
  `;
  const titleEl = button.querySelector<HTMLElement>(".task-settings-maintenance-item__title");
  const descEl = button.querySelector<HTMLElement>(".task-settings-maintenance-item__desc");
  if (titleEl) {
    titleEl.textContent = title;
  }
  if (descEl) {
    descEl.textContent = desc;
  }
  button.addEventListener("click", () => onClick());
  return button;
}

function mountSettingDialogSkin(): void {
  const apply = () => {
    const shell = document.querySelector<HTMLElement>(".task-tracker-settings-shell");
    if (!shell) {
      return false;
    }
    const dialog = shell.closest<HTMLElement>(".b3-dialog");
    if (!dialog) {
      return false;
    }
    dialog.classList.add("task-tracker-settings-dialog");
    const actionBar = dialog.querySelector<HTMLElement>(".b3-dialog__action");
    if (actionBar) {
      const buttons = Array.from(actionBar.querySelectorAll<HTMLButtonElement>("button"));
      for (const button of buttons) {
        const text = (button.textContent || "").trim();
        if (text === "确定" || text.toLowerCase() === "ok" || text === "保存") {
          button.textContent = "保存设置";
          button.classList.add("task-tracker-settings-dialog__confirm");
        } else if (text === "取消") {
          button.textContent = "取消";
          button.classList.add("task-tracker-settings-dialog__cancel");
        }
      }
    }
    return true;
  };

  if (apply()) {
    return;
  }
  for (let i = 1; i <= 12; i += 1) {
    window.setTimeout(() => {
      apply();
    }, i * 80);
  }
}

function validateTaskTemplate(template: string): string | undefined {
  const missingPlaceholders = REQUIRED_TEMPLATE_PLACEHOLDERS.filter((placeholder) => !template.includes(placeholder));
  if (missingPlaceholders.length) {
    return `任务模板缺少基础创建所需占位符：${missingPlaceholders.join("、")}。请补回后再保存。`;
  }
  return undefined;
}

function showHelpDialog(): void {
  new Dialog({
    title: "任务追踪使用帮助",
    content: `<div class="b3-dialog__content task-tracker-help">
  <h2>一、核心概念</h2>
  <p><strong>事项库</strong>是你指定的思源文档，用作任务文档的根目录。每个任务都是一个真实的思源子文档，子任务会成为父任务文档的子文档。</p>
  <p>插件会把快速索引保存在 <code>tasks.json</code>，设置保存在 <code>settings.json</code>，同时把任务元数据写入任务文档自定义属性，便于换设备或同步异常后重建索引。</p>

  <h2>二、首次配置事项库</h2>
  <ol>
    <li>新建或打开一个文档，例如“事项库”。</li>
    <li>在文档标题图标菜单中选择“将当前文档设为事项库”。</li>
    <li>如果自动识别失败，请复制该文档 ID，在插件设置的“事项库”中粘贴并点击“绑定 ID”。</li>
    <li>可选：设置默认项目，或按自己的笔记结构调整任务模板。</li>
  </ol>

  <h2>三、创建任务</h2>
  <p>可以从顶栏任务图标、任务追踪停靠栏、任务控制面板、当前文档标题菜单、当前块/选中块菜单创建任务，也可以在日历视图点击某一天创建带计划日期的任务。</p>
  <p>任务字段包括标题、项目、父任务、状态、优先级、创建时间、计划开始、计划结束、截止日期和来源。创建时间由系统记录为任务文档的真实创建时刻，来源可选择“手动创建”或“笔记”；从文档/块菜单创建时会自动带入来源引用。</p>

  <h2>四、任务追踪停靠栏</h2>
  <ul>
    <li><strong>全部</strong>：待处理、进行中、等待中的活跃任务。</li>
    <li><strong>焦点</strong>：进行中，或计划/截止日期为今天及以前的活跃任务。</li>
    <li><strong>今日</strong>：计划/截止日期为今天的活跃任务。</li>
  </ul>
  <p>停靠栏支持打开任务、修改状态、修改计划日期、修改截止日期、新建任务、打开任务控制面板，以及清理已删除文档对应的任务记录。</p>

  <h2>五、任务控制面板</h2>
  <p>面板提供六种视图：表格、清单、时间轴、看板、日历、已完成。搜索会匹配任务标题、项目、来源文本、来源类型、状态、优先级、日期和父任务标题。</p>
  <ul>
    <li><strong>表格</strong>：状态可直接修改，其余核心字段为只读展示，可拖拽调整列宽，并支持页面级字段/排序配置；创建时间与计划时间按本地可读时间显示。</li>
    <li><strong>清单</strong>：树形任务清单，适合逐项推进。</li>
    <li><strong>时间轴</strong>：未安排任务单独展示，其余任务按计划时间倒序分组和排序。</li>
    <li><strong>看板</strong>：按状态分列展示活跃任务。</li>
    <li><strong>日历</strong>：按计划开始日期展示任务，默认每格显示 3 条事项；超出时可点击 <code>more</code> 展开当前日期，该周整行会同步拉高，并通过日历区域内部滚动承载额外高度。</li>
    <li><strong>已完成</strong>：按任务完成时间所在自然周分组，标题显示为 <code>YYYY年WeekN(MM.DD~MM.DD)</code>，支持导出每周周报，可重新打开或删除任务。</li>
  </ul>

  <h2>六、完成、删除与归档</h2>
  <p>顶层任务标记为已完成后，会自动移动到 <code>事项库/已完成/&lt;周起始日&gt;</code>，按任务完成时间所在自然周归档，例如 <code>事项库/已完成/2026-05-11</code>。已完成页可把该周任务导出到 <code>事项库/周报</code>，重复导出只会重建“本周工作事项”每日引用列表，并保留用户已填写的总结与下周计划正文。子任务单独完成时会保持在父任务下；历史的月归档目录不会被批量迁移或删除。</p>

  <p class="task-tracker-help__warning">在任务控制面板中删除任务，会删除该任务文档及其所有子任务文档；“清理已删除任务记录”只会清理那些思源文档已经不存在的插件索引记录。</p>

  <h2>七、维护与恢复</h2>
  <ul>
    <li><strong>清理已删除任务记录</strong>：移除文档已经不存在的任务索引。</li>
    <li><strong>刷新索引</strong>：刷新并校正任务索引，不会自动整理任务文档摘要。</li>
    <li><strong>从事项库重建任务索引</strong>：重新扫描事项库中的可识别任务文档，重建 <code>tasks.json</code> 索引缓存；会跳过周报、已完成等容器性文档。</li>
    <li><strong>整理受影响任务摘要</strong>：仅整理被标记为待整理的任务摘要，不会全库重写。</li>
  </ul>
  <p>插件启动时会等待思源同步状态稳定，再尝试恢复和刷新索引。换设备、同步异常、任务列表不完整时，可以先“刷新索引”或“从事项库重建任务索引”；如果任务都在，但父子展示、任务概要或派生摘要过期，再执行“整理受影响任务摘要”。</p>

  <h2>八、任务模板占位符</h2>
  <p>模板支持：<code>{{title}}</code>、<code>{{source}}</code>、<code>{{parent}}</code>、<code>{{project}}</code>、<code>{{status}}</code>、<code>{{priority}}</code>、<code>{{description}}</code>、<code>{{dueDate}}</code>、<code>{{planStart}}</code>、<code>{{planEnd}}</code>、<code>{{childTasks}}</code>、<code>{{childTaskList}}</code>、<code>{{createdAt}}</code>、<code>{{updatedAt}}</code>。</p>
  <p><code>{{description}}</code> 对应“任务描述”元信息字段；<code>${MANAGED_DETAIL_SECTION_TITLE}</code> 对应“任务详情”正文受控分区，不通过模板占位符填写，而是在创建后由插件自动补入并在编辑时持续写回。</p>
  <p>${MANAGED_SUMMARY_HINT}</p>

  <h2>九、使用建议</h2>
  <ul>
    <li>如果希望重建索引能找回任务，请把任务文档保留在事项库范围内。</li>
    <li>手动移动或重命名任务文档后，如果面板显示异常，可以执行一次重建索引。</li>
    <li>批量删除任务树前，建议确认思源数据已经同步或备份。</li>
  </ul>
</div>`,
    width: "760px",
    height: "620px"
  });
}

import { Dialog, Setting, showMessage } from "siyuan";
import type { TaskService } from "./document";
import { DEFAULT_TASK_TEMPLATE } from "./types";

const MANAGED_DETAIL_SECTION_TITLE = "## 任务详情";
const MANAGED_PROGRESS_SECTION_TITLE = "## 推进记录";
const REQUIRED_TEMPLATE_PLACEHOLDERS = ["{{source}}", "{{status}}", "{{priority}}", "{{description}}"];
const MANAGED_SUMMARY_HINT = "任务概要受控区正式支持 Markdown 表格，以及紧随表格后的父任务 / 子任务 / 任务近况标签行；插件会持续同步表格和这些标签行。";
const TEMPLATE_PLACEHOLDER_CHIPS = [
  "{{project}}",
  "{{status}}",
  "{{source}}",
  "{{priority}}",
  "{{createdAt}}",
  "{{parent}}",
  "{{childTasks}}",
  "{{description}}"
];

export function createTaskSettings(
  service: TaskService,
  actions: {
    setCurrentDocAsRoot: () => Promise<void>;
    setRootDocId: (docId: string) => Promise<void>;
    syncDeletedTasks: () => Promise<void>;
    rebuildTaskIndex: () => Promise<void>;
    refreshViews: () => void;
  },
  version: string
): Setting {
  const settings = service.store.getSettings();
  const defaultProjectInput = document.createElement("input");
  defaultProjectInput.className = "b3-text-field fn__block task-tracker-settings__input";
  defaultProjectInput.placeholder = "例如：工作 / 产品 / 客户A";
  defaultProjectInput.value = settings.defaultProject || "";

  const rootDocIdInput = document.createElement("input");
  rootDocIdInput.className = "b3-text-field fn__block task-tracker-settings__input task-tracker-settings__input--doc-id";
  rootDocIdInput.placeholder = "粘贴文档 ID，例如：20260506092200-qynf33g";
  rootDocIdInput.value = settings.taskRootDocId || "";

  const templateInput = document.createElement("textarea");
  templateInput.className = "b3-text-field fn__block task-tracker-settings__template";
  templateInput.spellcheck = false;
  templateInput.value = settings.taskTemplate || DEFAULT_TASK_TEMPLATE;

  const templateLineNumbers = document.createElement("div");
  templateLineNumbers.className = "task-tracker-settings__template-lines";
  const syncTemplateLineNumbers = (): void => {
    const lineCount = Math.max(templateInput.value.split(/\r?\n/u).length, 1);
    templateLineNumbers.innerHTML = Array.from({ length: lineCount }, (_, index) => `<div>${index + 1}</div>`).join("");
  };
  templateInput.addEventListener("input", syncTemplateLineNumbers);
  templateInput.addEventListener("scroll", () => {
    templateLineNumbers.scrollTop = templateInput.scrollTop;
  });
  syncTemplateLineNumbers();

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
        taskTemplate: normalizedTemplate || undefined
      });
      actions.refreshViews();
      showMessage("任务追踪设置已保存");
    }
  });

  const defaultProjectCard = createSettingsCard("project", "默认项目", "新建任务时自动填入，可在创建时修改。");
  defaultProjectCard.controlsBody.append(defaultProjectInput);
  addSettingsCard(setting, defaultProjectCard.card);

  const rootCard = createSettingsCard("library", "事项库", "尚未设置。请在文档菜单中复制 ID，粘贴到右侧后绑定。");
  const refreshRootSummary = (): void => {
    const currentSettings = service.store.getSettings();
    rootCard.description.textContent = currentSettings.taskRootTitle
      ? `当前：${currentSettings.taskRootTitle}`
      : "尚未设置。请在文档菜单中复制 ID，粘贴到右侧后绑定。";
    if (currentSettings.taskRootDocId) {
      rootDocIdInput.value = currentSettings.taskRootDocId;
    }
  };
  refreshRootSummary();

  const rootAside = document.createElement("div");
  rootAside.className = "task-tracker-settings__inline-group";
  const rootButtonRow = document.createElement("div");
  rootButtonRow.className = "task-tracker-settings__button-row task-tracker-settings__button-row--compact";

  const bindButton = createSettingsButton("绑定 ID");
  bindButton.addEventListener("click", async () => {
    await actions.setRootDocId(rootDocIdInput.value);
    refreshRootSummary();
  });

  const currentButton = createSettingsButton("当前文档");
  currentButton.title = "快捷设置，若识别失败请使用文档 ID";
  currentButton.addEventListener("click", async () => {
    await actions.setCurrentDocAsRoot();
    refreshRootSummary();
  });

  rootButtonRow.append(bindButton, currentButton);
  rootAside.append(rootDocIdInput, rootButtonRow);
  rootCard.controlsBody.append(rootAside);
  addSettingsCard(setting, rootCard.card);

  const maintenanceCard = createSettingsCard("shield", "任务维护", "清理失效索引，或在换设备/同步异常后从事项库文档重建任务索引。");
  const maintenanceButtons = document.createElement("div");
  maintenanceButtons.className = "task-tracker-settings__button-row";

  const cleanupButton = createSettingsButton("清理已删除任务记录");
  cleanupButton.addEventListener("click", () => {
    void actions.syncDeletedTasks();
  });

  const rebuildButton = createSettingsButton("从事项库重建任务索引");
  rebuildButton.title = "扫描事项库下的任务文档并重建 tasks.json";
  rebuildButton.addEventListener("click", () => {
    void actions.rebuildTaskIndex();
  });

  maintenanceButtons.append(cleanupButton, rebuildButton);
  maintenanceCard.controlsBody.append(maintenanceButtons);
  addSettingsCard(setting, maintenanceCard.card);

  const templateCard = createSettingsCard("template", "任务模板", "新建任务文档时使用。模板中的任务概要、推进记录与任务详情分区会由插件持续管理。");
  const resetButton = createSettingsButton("恢复默认模板", "ghost");
  resetButton.addEventListener("click", () => {
    templateInput.value = DEFAULT_TASK_TEMPLATE;
    syncTemplateLineNumbers();
  });
  templateCard.controlsHeader.append(resetButton);

  const templateEditorPanel = document.createElement("div");
  templateEditorPanel.className = "task-tracker-settings__template-panel";

  const templateEditor = document.createElement("div");
  templateEditor.className = "task-tracker-settings__template-editor";
  templateEditor.append(templateLineNumbers, templateInput);

  const templateChips = document.createElement("div");
  templateChips.className = "task-tracker-settings__placeholder-list";
  TEMPLATE_PLACEHOLDER_CHIPS.forEach((placeholder) => {
    const chip = document.createElement("span");
    chip.className = "task-tracker-settings__placeholder-chip";
    chip.textContent = placeholder;
    templateChips.append(chip);
  });

  const placeholderLabel = document.createElement("div");
  placeholderLabel.className = "task-tracker-settings__placeholder-label";
  placeholderLabel.textContent = "可用变量：";

  const placeholderRow = document.createElement("div");
  placeholderRow.className = "task-tracker-settings__placeholder-row";
  placeholderRow.append(placeholderLabel, templateChips);

  templateEditorPanel.append(templateEditor, placeholderRow);

  const templateManagedHint = document.createElement("div");
  templateManagedHint.className = "task-tracker-settings__callout";
  templateManagedHint.innerHTML = `
    <div class="task-tracker-settings__callout-icon">${renderInlineIcon("info")}</div>
    <div class="task-tracker-settings__callout-content">
      <div class="task-tracker-settings__callout-title">插件管理的正文交互字段</div>
      <ul>
        <li>${MANAGED_SUMMARY_HINT}</li>
        <li><code>{{description}}</code>：对应任务近况，属于任务元信息字段。</li>
        <li><code>${MANAGED_PROGRESS_SECTION_TITLE}</code>：对应推进记录受控分区；保存任务时会把结构化推进记录实体化写回该区块。</li>
        <li><code>${MANAGED_DETAIL_SECTION_TITLE}</code>：对应任务详情正文受控分区；创建时自动追加，编辑时近实时写回。</li>
      </ul>
      <div>保存模板时会校验是否仍保留插件管理所需字段；推进记录区块建议保留，但不会阻止旧模板继续保存。</div>
    </div>
  `;

  templateCard.controlsBody.append(templateEditorPanel);
  templateCard.body.append(templateManagedHint);
  addSettingsCard(setting, templateCard.card);

  const helpCard = createSettingsCard("help", "使用帮助", "查看事项库设置、任务创建、任务控制面板、任务维护、模板占位符和版本规则。");
  const helpButton = createSettingsButton("打开使用帮助", "outline", true);
  helpButton.addEventListener("click", () => showHelpDialog());
  helpCard.controlsBody.append(helpButton);
  addSettingsCard(setting, helpCard.card);

  const versionCard = createSettingsCard("version", "插件版本", `当前版本：v${version}`);
  const value = document.createElement("div");
  value.className = "task-tracker-settings__version";
  value.textContent = `v${version}`;
  versionCard.controlsBody.append(value);
  addSettingsCard(setting, versionCard.card);

  return setting;
}

function addSettingsCard(setting: Setting, card: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = "task-tracker-settings-item";
  wrapper.append(card);
  decorateSettingsRow(wrapper);
  setting.addItem({
    title: "",
    description: "",
    direction: "row",
    actionElement: wrapper
  });
}

function createSettingsButton(label: string, variant: "outline" | "ghost" = "outline", external = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `b3-button ${variant === "ghost" ? "b3-button--cancel" : "b3-button--outline"} task-tracker-settings__button`;
  button.innerHTML = external
    ? `<span>${label}</span><span class="task-tracker-settings__button-icon">${renderInlineIcon("external")}</span>`
    : `<span>${label}</span>`;
  return button;
}

function createSettingsCard(
  icon: SettingsIconName,
  title: string,
  description: string
): {
  card: HTMLDivElement;
  description: HTMLDivElement;
  body: HTMLDivElement;
  controlsHeader: HTMLDivElement;
  controlsBody: HTMLDivElement;
} {
  const card = document.createElement("div");
  card.className = "task-tracker-settings-card";

  const main = document.createElement("div");
  main.className = "task-tracker-settings-card__main";

  const meta = document.createElement("div");
  meta.className = "task-tracker-settings-card__meta";

  const iconWrap = document.createElement("div");
  iconWrap.className = "task-tracker-settings-card__icon";
  iconWrap.innerHTML = renderInlineIcon(icon);

  const copy = document.createElement("div");
  copy.className = "task-tracker-settings-card__copy";

  const titleEl = document.createElement("div");
  titleEl.className = "task-tracker-settings-card__title";
  titleEl.textContent = title;

  const descriptionEl = document.createElement("div");
  descriptionEl.className = "task-tracker-settings-card__description";
  descriptionEl.textContent = description;

  copy.append(titleEl, descriptionEl);
  meta.append(iconWrap, copy);

  const controls = document.createElement("div");
  controls.className = "task-tracker-settings-card__controls";

  const controlsHeader = document.createElement("div");
  controlsHeader.className = "task-tracker-settings-card__controls-header";

  const controlsBody = document.createElement("div");
  controlsBody.className = "task-tracker-settings-card__controls-body";

  controls.append(controlsHeader, controlsBody);

  const body = document.createElement("div");
  body.className = "task-tracker-settings-card__body";

  main.append(meta, controls);
  card.append(main, body);

  return { card, description: descriptionEl, body, controlsHeader, controlsBody };
}

function decorateSettingsRow(wrapper: HTMLElement): void {
  queueMicrotask(() => {
    const row = wrapper.closest(".b3-label");
    row?.classList.add("task-tracker-settings-row");
    const content = wrapper.parentElement;
    content?.classList.add("task-tracker-settings-row__content");
    const divider = content?.querySelector<HTMLElement>(".fn__hr");
    if (divider) {
      divider.style.display = "none";
    }
  });
}

type SettingsIconName = "project" | "library" | "shield" | "template" | "help" | "version" | "info" | "external";

function renderInlineIcon(name: SettingsIconName): string {
  switch (name) {
    case "project":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18.5V20h1.5L17 8.5 15.5 7 4 18.5Zm14.7-11.8a1 1 0 0 0 0-1.4l-1-1a1 1 0 0 0-1.4 0l-.9.9 2.4 2.4.9-.9ZM7 5h4M7 9H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "library":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="6.5" ry="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 6v4c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8V6M5.5 10v4c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-4M5.5 14v4c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "shield":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 5.5 6v5.3c0 4.2 2.7 7.9 6.5 9.2 3.8-1.3 6.5-5 6.5-9.2V6L12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9.3 12.2 1.8 1.8 3.7-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "template":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.8h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3.8V8h4M9 12h6M9 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "help":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h11a1.5 1.5 0 0 1 1.5 1.5v12A2.5 2.5 0 0 0 17 15H7a2.5 2.5 0 0 0-2.5 2.5v-11Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 4v13.5M9.5 8H16M9.5 11.5H16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "version":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10.2v5.3M12 7.8h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "info":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v5M12 8h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "external":
      return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5H13.5V6.5M13 3 8.5 7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 3.5H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
  <p>插件会把快速索引保存在 <code>tasks.json</code>，设置保存在 <code>settings.json</code>；同时把任务元数据写入任务文档自定义属性，并把事项库绑定镜像到事项库根文档属性。手动在设置里切换事项库后，本端会持续以这次手动绑定为准，并主动回写事项库根文档标记、清理冲突标记；未手动绑定的其他端仍可根据 marker 自动收敛到同一个事项库并重建索引。</p>

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
  <p>顶层任务标记为已完成后，会自动移动到 <code>事项库/已完成/&lt;周起始日&gt;</code>，按任务完成时间所在自然周归档，例如 <code>事项库/已完成/2026-05-11</code>。已完成页可把该周任务导出到 <code>事项库/周报</code>，重复导出会重建“本周完成事项”和“本周推进事项”分区，并保留用户已填写的总结与下周计划正文。子任务单独完成时会保持在父任务下；历史的月归档目录不会被批量迁移或删除。</p>

  <p class="task-tracker-help__warning">在任务控制面板中删除任务，会删除该任务文档及其所有子任务文档；“清理已删除任务记录”只会清理那些思源文档已经不存在的插件索引记录。</p>

  <h2>七、维护与恢复</h2>
  <ul>
    <li><strong>清理已删除任务记录</strong>：移除文档已经不存在的任务索引。</li>
    <li><strong>从事项库重建任务索引</strong>：扫描事项库下带有任务属性的文档，并重建 <code>tasks.json</code>。</li>
  </ul>
  <p>插件启动时会等待思源同步状态稳定，再尝试恢复和同步索引。换设备、同步异常或面板显示不完整时，可以手动执行重建。</p>

  <h2>八、任务模板占位符</h2>
  <p>模板支持：<code>{{title}}</code>、<code>{{source}}</code>、<code>{{parent}}</code>、<code>{{project}}</code>、<code>{{status}}</code>、<code>{{priority}}</code>、<code>{{description}}</code>、<code>{{dueDate}}</code>、<code>{{planStart}}</code>、<code>{{planEnd}}</code>、<code>{{childTasks}}</code>、<code>{{childTaskList}}</code>、<code>{{createdAt}}</code>、<code>{{updatedAt}}</code>。</p>
  <p><code>{{description}}</code> 对应“任务近况”元信息字段；<code>${MANAGED_PROGRESS_SECTION_TITLE}</code> 对应“推进记录”受控分区；<code>${MANAGED_DETAIL_SECTION_TITLE}</code> 对应“任务详情”正文受控分区。后两者不通过模板占位符填写，而是在创建后由插件自动补入并在编辑时持续写回。</p>
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

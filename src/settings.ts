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
    setRootDocId: (docId: string) => Promise<void>;
    syncDeletedTasks: () => Promise<void>;
    rebuildTaskIndex: () => Promise<void>;
    reconcileAffectedTaskSummaries: () => Promise<void>;
    refreshViews: () => void;
  },
  version: string
): Setting {
  const defaultProjectInput = document.createElement("input");
  defaultProjectInput.className = "b3-text-field fn__block";
  defaultProjectInput.placeholder = "例如：工作 / 产品 / 客户A";
  defaultProjectInput.value = service.store.getSettings().defaultProject || "";

  const rootDocIdInput = document.createElement("input");
  rootDocIdInput.className = "b3-text-field fn__block task-tracker-setting__doc-id";
  rootDocIdInput.placeholder = "粘贴文档 ID，例如：20260506092200-qynf33g";
  rootDocIdInput.value = service.store.getSettings().taskRootDocId || "";

  const templateInput = document.createElement("textarea");
  templateInput.className = "b3-text-field fn__block task-tracker-setting__template";
  templateInput.spellcheck = false;
  templateInput.value = service.store.getSettings().taskTemplate || DEFAULT_TASK_TEMPLATE;

  const templateManagedHint = document.createElement("div");
  templateManagedHint.className = "task-tracker-setting__template-managed";
  templateManagedHint.innerHTML = `
    <div><strong>插件管理的正文交互字段</strong></div>
    <ul>
      <li>${MANAGED_SUMMARY_HINT}</li>
      <li><code>{{description}}</code>：对应任务描述，属于任务元信息字段。</li>
      <li><code>${MANAGED_DETAIL_SECTION_TITLE}</code>：对应任务详情正文受控分区；创建时自动追加，编辑时近实时写回。</li>
    </ul>
    <div>保存模板时会校验是否仍保留插件管理所需字段；如果缺少必要字段，将拒绝保存并提示补回。</div>
  `;

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
  collaborationModeSelect.className = "b3-select fn__block";
  collaborationModeSelect.innerHTML = `
    <option value="strict">严格协作</option>
    <option value="single-workspace">单工作区</option>
  `;
  collaborationModeSelect.value = service.store.getSettings().collaborationMode || "strict";

  setting.addItem({
    title: "默认项目",
    description: "新建任务时自动填入，可在创建时修改。",
    createActionElement: () => defaultProjectInput
  });

  setting.addItem({
    title: "协作模式",
    description: "严格协作用于多副本同步（桌面/手机），单工作区用于同一后端多会话并发（Docker/浏览器同工作区）。",
    createActionElement: () => collaborationModeSelect
  });

  setting.addItem({
    title: "事项库",
    description: service.store.getSettings().taskRootTitle
      ? `当前：${service.store.getSettings().taskRootTitle}`
      : "尚未设置。请在文档菜单中复制 ID，粘贴到右侧后绑定。",
    createActionElement: () => {
      const wrapper = document.createElement("div");
      wrapper.className = "fn__flex task-tracker-setting__root";

      const bindButton = document.createElement("button");
      bindButton.className = "b3-button b3-button--outline fn__size160";
      bindButton.textContent = "绑定 ID";
      bindButton.addEventListener("click", () => {
        void actions.setRootDocId(rootDocIdInput.value);
      });

      const currentButton = document.createElement("button");
      currentButton.className = "b3-button b3-button--outline fn__size160";
      currentButton.textContent = "当前文档";
      currentButton.title = "快捷设置，若识别失败请使用文档 ID";
      currentButton.addEventListener("click", () => {
        void actions.setCurrentDocAsRoot();
      });

      wrapper.append(rootDocIdInput, bindButton, currentButton);
      return wrapper;
    }
  });

  setting.addItem({
    title: "任务维护",
    description: "清理失效索引、刷新/重建任务索引，或显式整理受影响任务摘要（仅处理待整理集合）。",
    createActionElement: () => {
      const wrapper = document.createElement("div");
      wrapper.className = "fn__flex task-tracker-setting__root";

      const cleanupButton = document.createElement("button");
      cleanupButton.className = "b3-button b3-button--outline fn__size200";
      cleanupButton.textContent = "清理已删除任务记录";
      cleanupButton.addEventListener("click", () => {
        void actions.syncDeletedTasks();
      });

      const rebuildButton = document.createElement("button");
      rebuildButton.className = "b3-button b3-button--outline fn__size200";
      rebuildButton.textContent = "从事项库重建任务索引";
      rebuildButton.title = "扫描事项库下的任务文档并重建 tasks.json";
      rebuildButton.addEventListener("click", () => {
        void actions.rebuildTaskIndex();
      });

      const reconcileButton = document.createElement("button");
      reconcileButton.className = "b3-button b3-button--outline fn__size200";
      reconcileButton.textContent = "整理受影响任务摘要";
      reconcileButton.title = "仅整理 needsReconcile 的任务，不会全库重写";
      reconcileButton.addEventListener("click", () => {
        void actions.reconcileAffectedTaskSummaries();
      });

      wrapper.append(cleanupButton, rebuildButton, reconcileButton);
      return wrapper;
    }
  });

  setting.addItem({
    title: "任务模板",
    description: "新建任务文档时使用。模板中的任务概要受控区与任务详情正文分区会由插件持续管理。",
    createActionElement: () => {
      const wrapper = document.createElement("div");
      wrapper.className = "task-tracker-setting__template-wrap";

      const actionsRow = document.createElement("div");
      actionsRow.className = "fn__flex task-tracker-setting__template-actions";

      const resetButton = document.createElement("button");
      resetButton.className = "b3-button b3-button--outline";
      resetButton.textContent = "恢复默认模板";
      resetButton.addEventListener("click", () => {
        templateInput.value = DEFAULT_TASK_TEMPLATE;
      });

      actionsRow.append(resetButton);
      wrapper.append(templateInput, templateManagedHint, actionsRow);
      return wrapper;
    }
  });

  setting.addItem({
    title: "使用帮助",
    description: "查看事项库设置、任务创建、任务控制面板、任务维护、模板占位符和版本规则。",
    createActionElement: () => {
      const button = document.createElement("button");
      button.className = "b3-button b3-button--outline fn__size200";
      button.textContent = "打开使用帮助";
      button.addEventListener("click", () => showHelpDialog());
      return button;
    }
  });

  setting.addItem({
    title: "插件版本",
    description: `当前版本：v${version}`,
    createActionElement: () => {
      const value = document.createElement("div");
      value.className = "task-tracker-setting__version";
      value.textContent = `v${version}`;
      return value;
    }
  });

  return setting;
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
    <li><strong>从事项库重建任务索引</strong>：扫描事项库下带有任务属性的文档，并重建 <code>tasks.json</code> 索引缓存。</li>
    <li><strong>整理受影响任务摘要</strong>：仅整理被标记为待整理的任务摘要，不会全库重写。</li>
  </ul>
  <p>插件启动时会等待思源同步状态稳定，再尝试恢复和刷新索引。换设备、同步异常或面板显示不完整时，可以手动刷新或重建索引；如果是父子展示或摘要过期，再执行“整理受影响任务摘要”。</p>

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

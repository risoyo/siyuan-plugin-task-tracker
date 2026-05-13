import { Dialog, Setting, showMessage } from "siyuan";
import type { TaskService } from "./document";
import { DEFAULT_TASK_TEMPLATE } from "./types";

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

  const setting = new Setting({
    confirmCallback: async () => {
      await service.store.setSettings({
        defaultProject: defaultProjectInput.value.trim() || undefined,
        taskTemplate: templateInput.value.trim() || undefined
      });
      actions.refreshViews();
      showMessage("任务追踪设置已保存");
    }
  });

  setting.addItem({
    title: "默认项目",
    description: "新建任务时自动填入，可在创建时修改。",
    createActionElement: () => defaultProjectInput
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
    description: "清理失效索引，或在换设备/同步异常后从事项库文档重建任务索引。",
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

      wrapper.append(cleanupButton, rebuildButton);
      return wrapper;
    }
  });

  setting.addItem({
    title: "任务模板",
    description: "新建任务文档时使用。保留元信息占位符后，任务追踪面板中的状态和日期会同步回笔记。",
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
      wrapper.append(templateInput, actionsRow);
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
  <p>任务字段包括标题、项目、父任务、状态、优先级、创建时间、计划开始、计划结束、截止日期和来源。来源可选择“手动创建”或“笔记”；从文档/块菜单创建时会自动带入来源引用。</p>

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
    <li><strong>表格</strong>：状态可直接修改，其余核心字段为只读展示，可拖拽调整列宽，并支持页面级字段/排序配置。</li>
    <li><strong>清单</strong>：树形任务清单，适合逐项推进。</li>
    <li><strong>时间轴</strong>：未安排任务单独展示，其余任务按计划时间倒序分组和排序。</li>
    <li><strong>看板</strong>：按状态分列展示活跃任务。</li>
    <li><strong>日历</strong>：按计划开始日期展示任务，可展开未安排任务浮层。</li>
    <li><strong>已完成</strong>：按任务完成时间所在自然周分组，可重新打开或删除任务。</li>
  </ul>

  <h2>六、完成、删除与归档</h2>
  <p>顶层任务标记为已完成后，会自动移动到 <code>事项库/已完成/&lt;周起始日&gt;</code>，按任务完成时间所在自然周归档，例如 <code>事项库/已完成/2026-05-11</code>。子任务单独完成时会保持在父任务下；历史的月归档目录不会被批量迁移或删除。</p>

  <p class="task-tracker-help__warning">在任务控制面板中删除任务，会删除该任务文档及其所有子任务文档；“清理已删除任务记录”只会清理那些思源文档已经不存在的插件索引记录。</p>

  <h2>七、维护与恢复</h2>
  <ul>
    <li><strong>清理已删除任务记录</strong>：移除文档已经不存在的任务索引。</li>
    <li><strong>从事项库重建任务索引</strong>：扫描事项库下带有任务属性的文档，并重建 <code>tasks.json</code>。</li>
  </ul>
  <p>插件启动时会等待思源同步状态稳定，再尝试恢复和同步索引。换设备、同步异常或面板显示不完整时，可以手动执行重建。</p>

  <h2>八、任务模板占位符</h2>
  <p>模板支持：<code>{{title}}</code>、<code>{{source}}</code>、<code>{{parent}}</code>、<code>{{project}}</code>、<code>{{status}}</code>、<code>{{priority}}</code>、<code>{{dueDate}}</code>、<code>{{planStart}}</code>、<code>{{planEnd}}</code>、<code>{{childTasks}}</code>、<code>{{childTaskList}}</code>、<code>{{createdAt}}</code>、<code>{{updatedAt}}</code>。</p>
  <p>建议保留默认模板中的元信息引用块，或至少保留一个包含 <code>来源：</code> 的引用块。插件会同步更新这个块中的状态、优先级、日期和子任务链接。</p>

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

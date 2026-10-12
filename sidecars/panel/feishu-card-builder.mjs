import { createHmac } from 'node:crypto';

/**
 * 飞书交互式卡片构建器 (Feishu Interactive Card Builder)
 * 支持链式调用构建符合飞书规范的交互式卡片 JSON，并提供安全加签与常用模板支持。
 */
export class FeishuCardBuilder {
  constructor() {
    this.header = null;
    this.config = {
      wide_screen_mode: true,
      enable_forward_card: true,
      update_multi: true
    };
    this.elements = [];
  }

  /**
   * 静态快速入口
   */
  static create() {
    return new FeishuCardBuilder();
  }

  /**
   * 配置卡片标题与主色调
   * @param {string} title 标题文本
   * @param {string} [template='blue'] 主题色: blue|green|red|orange|indigo|turquoise|violet|carmine|yellow|grey
   * @param {string} [subtitle=''] 副标题
   */
  setHeader(title, template = 'blue', subtitle = '') {
    this.header = {
      title: {
        tag: 'plain_text',
        content: String(title || '通知')
      },
      template: template || 'blue'
    };
    if (subtitle) {
      this.header.subtitle = {
        tag: 'plain_text',
        content: String(subtitle)
      };
    }
    return this;
  }

  /**
   * 配置卡片全局属性
   */
  setConfig(configObj = {}) {
    this.config = { ...this.config, ...configObj };
    return this;
  }

  /**
   * 添加富文本 Markdown 块 (lark_md)
   * @param {string} content Markdown 文本内容
   */
  addMarkdown(content) {
    if (!content) return this;
    this.elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: String(content)
      }
    });
    return this;
  }

  /**
   * 添加纯文本块 (plain_text)
   * @param {string} content 纯文本内容
   */
  addPlainText(content) {
    if (!content) return this;
    this.elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: String(content)
      }
    });
    return this;
  }

  /**
   * 添加分割线
   */
  addHr() {
    this.elements.push({ tag: 'hr' });
    return this;
  }

  /**
   * 添加一组字段 (栅格排版展示)
   * @param {Array<{title: string, value: string, short?: boolean}>} fields 字段列表
   */
  addFields(fields = []) {
    if (!Array.isArray(fields) || fields.length === 0) return this;
    const formattedFields = fields.map((f) => ({
      is_short: f.short !== false,
      text: {
        tag: 'lark_md',
        content: `**${f.title}**\n${f.value}`
      }
    }));
    this.elements.push({
      tag: 'div',
      fields: formattedFields
    });
    return this;
  }

  /**
   * 快捷添加单条字段
   * @param {string} title 字段标题
   * @param {string} value 字段值
   * @param {boolean} [short=true] 是否两列排版
   */
  addField(title, value, short = true) {
    return this.addFields([{ title, value, short }]);
  }

  /**
   * 添加备注/脚注文本 (灰底小字说明)
   * @param {string|Array<string>} notes 备注说明
   */
  addNote(notes) {
    const list = Array.isArray(notes) ? notes : [notes];
    const elements = list.filter(Boolean).map((n) => ({
      tag: 'plain_text',
      content: String(n)
    }));
    if (elements.length > 0) {
      this.elements.push({
        tag: 'note',
        elements
      });
    }
    return this;
  }

  /**
   * 添加按钮操作组
   * @param {Array<{text: string, type?: string, url?: string, value?: object}>} buttons
   */
  addActions(buttons = []) {
    if (!Array.isArray(buttons) || buttons.length === 0) return this;
    const actionElements = buttons.map((b) => {
      const btn = {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: String(b.text || '操作')
        },
        type: b.type || 'default' // 'default' | 'primary' | 'danger'
      };
      if (b.url) {
        btn.url = b.url;
        btn.multi_url = {
          url: b.url,
          android_url: b.url,
          ios_url: b.url,
          pc_url: b.url
        };
      }
      if (b.value) {
        btn.value = typeof b.value === 'object' ? b.value : { action: String(b.value) };
      }
      return btn;
    });

    this.elements.push({
      tag: 'action',
      actions: actionElements
    });
    return this;
  }

  /**
   * 快捷添加单个按钮
   */
  addButton(text, options = {}) {
    return this.addActions([{ text, ...options }]);
  }

  /**
   * 编译为标准飞书 card 对象
   */
  buildCard() {
    const card = {
      config: { ...this.config },
      elements: [...this.elements]
    };
    if (this.header) {
      card.header = { ...this.header };
    }
    return card;
  }

  /**
   * 编译为机器人 Webhook 请求体
   * @param {object} [options={}]
   * @param {string} [options.secret] 飞书安全校验密钥 (可选)
   * @param {number} [options.timestamp] 时间戳 (可选，默认当前时间)
   */
  buildWebhookPayload(options = {}) {
    const card = this.buildCard();
    const payload = {
      msg_type: 'interactive',
      card
    };

    if (options.secret) {
      const ts = options.timestamp || Math.floor(Date.now() / 1000);
      payload.timestamp = String(ts);
      payload.sign = FeishuCardBuilder.generateSignature(ts, options.secret);
    }

    return payload;
  }

  /**
   * 飞书签名算法
   * @param {number|string} timestamp
   * @param {string} secret
   */
  static generateSignature(timestamp, secret) {
    if (!secret) return '';
    const str = `${timestamp}\n${secret}`;
    return createHmac('sha256', str).update('').digest('base64');
  }

  // -------------------------------------------------------------------------
  // 常用场景预设模板 (Presets)
  // -------------------------------------------------------------------------

  /**
   * 预设 1：任务派发与执行状态卡片
   */
  static createTaskNotification({
    title = '🚀 研发任务派发通知',
    status = '执行中 (In Progress)',
    projectName = '默认工程',
    conversationName = '当前会话',
    sender = '微信用户',
    detail = '',
    templateColor = 'blue',
    dashboardUrl = ''
  }) {
    const builder = new FeishuCardBuilder()
      .setHeader(title, templateColor)
      .addFields([
        { title: '📁 所属工程', value: projectName },
        { title: '💬 目标会话', value: conversationName },
        { title: '👤 触发人员', value: sender },
        { title: '📊 当前状态', value: status }
      ]);

    if (detail) {
      builder.addHr().addMarkdown(`**任务需求明细**:\n${detail}`);
    }

    const actions = [
      { text: '📊 查询进度', type: 'primary', value: { action: 'status' } },
      { text: '📑 会话列表', type: 'default', value: { action: 'sessions' } }
    ];
    if (dashboardUrl) {
      actions.push({ text: '🖥️ 打开看板', type: 'default', url: dashboardUrl });
    }

    builder.addActions(actions);
    builder.addNote([`⚡ Antigravity 自动化研发网关 · ${new Date().toLocaleTimeString()}`]);
    return builder;
  }

  /**
   * 预设 2：任务执行完成结构化报告卡片
   */
  static createCompletionReport({
    title = '✅ 任务执行完成报告',
    projectName = '默认工程',
    conversationName = '当前会话',
    elapsedSec = 0,
    stepsAdded = 0,
    summary = '',
    touchedFiles = [],
    templateColor = 'green',
    dashboardUrl = ''
  }) {
    const builder = new FeishuCardBuilder()
      .setHeader(title, templateColor)
      .addFields([
        { title: '📁 所属工程', value: projectName },
        { title: '💬 目标会话', value: conversationName },
        { title: '⏱️ 执行耗时', value: `${elapsedSec}s` },
        { title: '📈 步骤递增', value: `+${stepsAdded} 步` }
      ]);

    if (touchedFiles && touchedFiles.length > 0) {
      builder.addMarkdown(`📁 **涉及改动文件**:\n${touchedFiles.map((f) => `• \`${f}\``).join('\n')}`);
    }

    if (summary) {
      builder.addHr().addMarkdown(`📝 **执行成果总结**:\n${summary}`);
    }

    const actions = [
      { text: '📋 查看完整报告', type: 'primary', value: { action: 'report' } }
    ];
    if (dashboardUrl) {
      actions.push({ text: '🖥️ 访问 Web 看板', type: 'default', url: dashboardUrl });
    }

    builder.addActions(actions);
    builder.addNote([`✅ 执行验证完毕 · ${new Date().toLocaleTimeString()}`]);
    return builder;
  }

  /**
   * 预设 3：异常与告警卡片
   */
  static createAlert({
    title = '⚠️ 研发任务异常告警',
    errorMessage = '执行过程中遇到未知错误',
    projectName = '默认工程',
    conversationName = '当前会话',
    templateColor = 'red'
  }) {
    return new FeishuCardBuilder()
      .setHeader(title, templateColor)
      .addFields([
        { title: '📁 所属工程', value: projectName },
        { title: '💬 会话位置', value: conversationName }
      ])
      .addHr()
      .addMarkdown(`❌ **错误详情**:\n\`\`\`\n${errorMessage}\n\`\`\``)
      .addActions([
        { text: '🔄 重试任务', type: 'danger', value: { action: 'retry' } },
        { text: '🔍 查验日志', type: 'default', value: { action: 'status' } }
      ])
      .addNote([`⚠️ 警报触发时间: ${new Date().toLocaleTimeString()}`]);
  }
}

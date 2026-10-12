import test from 'node:test';
import assert from 'node:assert/strict';
import { FeishuCardBuilder } from './feishu-card-builder.mjs';

test('FeishuCardBuilder - 基本卡片构建与链式调用', () => {
  const card = new FeishuCardBuilder()
    .setHeader('测试卡片标题', 'blue', '副标题说明')
    .addMarkdown('这是一段 **Markdown** 内容')
    .addHr()
    .addField('工程名称', 'wechat-dispatcher')
    .buildCard();

  assert.equal(card.header.title.content, '测试卡片标题');
  assert.equal(card.header.template, 'blue');
  assert.equal(card.header.subtitle.content, '副标题说明');
  assert.equal(card.config.wide_screen_mode, true);

  assert.equal(card.elements.length, 3);
  assert.equal(card.elements[0].tag, 'div');
  assert.equal(card.elements[0].text.tag, 'lark_md');
  assert.equal(card.elements[0].text.content, '这是一段 **Markdown** 内容');

  assert.equal(card.elements[1].tag, 'hr');

  assert.equal(card.elements[2].tag, 'div');
  assert.equal(card.elements[2].fields.length, 1);
  assert.equal(card.elements[2].fields[0].text.content, '**工程名称**\nwechat-dispatcher');
});

test('FeishuCardBuilder - 字段栅格与脚注组件 (Fields & Note)', () => {
  const card = FeishuCardBuilder.create()
    .addFields([
      { title: '状态', value: '已完成', short: true },
      { title: '耗时', value: '12s', short: true }
    ])
    .addNote(['备注 1', '备注 2'])
    .buildCard();

  assert.equal(card.elements.length, 2);
  const fieldsDiv = card.elements[0];
  assert.equal(fieldsDiv.fields.length, 2);
  assert.equal(fieldsDiv.fields[0].is_short, true);
  assert.equal(fieldsDiv.fields[0].text.content, '**状态**\n已完成');

  const noteElement = card.elements[1];
  assert.equal(noteElement.tag, 'note');
  assert.equal(noteElement.elements.length, 2);
  assert.equal(noteElement.elements[0].content, '备注 1');
  assert.equal(noteElement.elements[1].content, '备注 2');
});

test('FeishuCardBuilder - 交互按钮与操作组 (Actions)', () => {
  const card = FeishuCardBuilder.create()
    .addActions([
      { text: '主要操作', type: 'primary', value: { action: 'submit' } },
      { text: '跳转页面', type: 'default', url: 'https://open.feishu.cn' }
    ])
    .addButton('快捷按钮', { type: 'danger', value: { action: 'delete' } })
    .buildCard();

  assert.equal(card.elements.length, 2);
  const action1 = card.elements[0];
  assert.equal(action1.tag, 'action');
  assert.equal(action1.actions.length, 2);
  assert.equal(action1.actions[0].type, 'primary');
  assert.deepEqual(action1.actions[0].value, { action: 'submit' });
  assert.equal(action1.actions[1].url, 'https://open.feishu.cn');

  const action2 = card.elements[1];
  assert.equal(action2.actions.length, 1);
  assert.equal(action2.actions[0].type, 'danger');
  assert.deepEqual(action2.actions[0].value, { action: 'delete' });
});

test('FeishuCardBuilder - Webhook 请求体构建与签名安全加签', () => {
  const secret = 'test-secret-key-12345';
  const timestamp = 1700000000;

  const payload = FeishuCardBuilder.create()
    .setHeader('加签通知', 'green')
    .addPlainText('纯文本测试')
    .buildWebhookPayload({ secret, timestamp });

  assert.equal(payload.msg_type, 'interactive');
  assert.equal(payload.timestamp, '1700000000');
  assert.ok(payload.sign);

  // 验证签名一致性
  const expectedSign = FeishuCardBuilder.generateSignature(timestamp, secret);
  assert.equal(payload.sign, expectedSign);
});

test('FeishuCardBuilder - 预设模板 1: 任务派发通知卡片 (createTaskNotification)', () => {
  const builder = FeishuCardBuilder.createTaskNotification({
    title: '🚀 测试任务下发',
    status: '进行中',
    projectName: 'combat-concept',
    conversationName: '会话-001',
    sender: '张三',
    detail: '请修改配置'
  });

  const card = builder.buildCard();
  assert.equal(card.header.title.content, '🚀 测试任务下发');
  assert.equal(card.header.template, 'blue');

  const fieldDiv = card.elements.find((e) => e.fields);
  assert.ok(fieldDiv);
  assert.equal(fieldDiv.fields.length, 4);

  const detailDiv = card.elements.find((e) => e.text && e.text.content.includes('请修改配置'));
  assert.ok(detailDiv);

  const actionDiv = card.elements.find((e) => e.tag === 'action');
  assert.ok(actionDiv);
  assert.ok(actionDiv.actions.length >= 2);
});

test('FeishuCardBuilder - 预设模板 2: 任务完成报告卡片 (createCompletionReport)', () => {
  const builder = FeishuCardBuilder.createCompletionReport({
    title: '✅ 构建完成',
    projectName: 'wechat-dispatcher',
    conversationName: '主会话',
    elapsedSec: 42,
    stepsAdded: 8,
    summary: '已通过全部单元测试',
    touchedFiles: ['main.mjs', 'app.js']
  });

  const card = builder.buildCard();
  assert.equal(card.header.template, 'green');

  const filesDiv = card.elements.find((e) => e.text && e.text.content.includes('main.mjs'));
  assert.ok(filesDiv);

  const summaryDiv = card.elements.find((e) => e.text && e.text.content.includes('已通过全部单元测试'));
  assert.ok(summaryDiv);
});

test('FeishuCardBuilder - 预设模板 3: 异常告警卡片 (createAlert)', () => {
  const builder = FeishuCardBuilder.createAlert({
    title: '⚠️ 编译报错',
    errorMessage: 'SyntaxError: Unexpected token',
    projectName: 'wechat-dispatcher',
    conversationName: '调试会话'
  });

  const card = builder.buildCard();
  assert.equal(card.header.template, 'red');

  const errDiv = card.elements.find((e) => e.text && e.text.content.includes('SyntaxError'));
  assert.ok(errDiv);
});

test('FeishuCardBuilder - 容错处理 (空值/无参)', () => {
  const card = FeishuCardBuilder.create()
    .addMarkdown('')
    .addPlainText(null)
    .addFields([])
    .addActions([])
    .addNote([])
    .buildCard();

  assert.equal(card.elements.length, 0);
  assert.equal(card.header, undefined);
  assert.equal(card.config.wide_screen_mode, true);
});

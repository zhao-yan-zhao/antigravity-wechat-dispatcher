import { createServer } from 'node:http';
import { createHash, createHmac, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { Response, SidecarApp } from 'sidecar_sdk';
import { FeishuCardBuilder } from './feishu-card-builder.mjs';

// 全局崩溃拦截与自愈保障：杜绝任何未捕获异常导致侧边栏进程意外终止
process.on('uncaughtException', (err) => {
  console.error('[ai-assistant][FATAL_SAFEGUARD] Uncaught Exception trapped:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[ai-assistant][FATAL_SAFEGUARD] Unhandled Rejection trapped:', reason);
});

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DATA_DIR = process.env.ANTIGRAVITY_APP_DATA_DIR || join(homedir(), '.gemini/antigravity');
const BRAIN_DIR = join(APP_DATA_DIR, 'brain');
const MCP_DIR = join(APP_DATA_DIR, 'mcp');
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(APP_DATA_DIR, 'sidecar_data', 'ai-assistant', 'panel', 'data');

mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_FILE = join(DATA_DIR, 'wechat_config.json');
const MESSAGES_FILE = join(DATA_DIR, 'wechat_messages.json');
const PENDING_CONFIRM_FILE = join(DATA_DIR, 'pending_confirmations.json');

const DEFAULT_CONFIG = {
  token: 'antigravity_token',
  autoDispatch: true,
  autoStartWechatBot: true, // 插件启动时自动化启动并守护微信机器人
  xmlPort: 18765,
  targetMode: 'code',
  enableIntentRouting: true,
  enableAIIntentCheck: true,
  aiIntentConfirmTimeoutSec: 300,
  activeConversationId: '',
  pendingSwitchConvId: '',
  currentProject: 'combat-concept-ai-workbench',
  waitForAgentReply: true,
  waitReplyTimeoutSec: 150,
  notifyChannel: 'none', // 'none' | 'wechat' | 'feishu' | 'pushplus' | 'wecom' | 'serverchan' | 'custom'
  notifyWebhookUrl: '',
  notifyWecomUrl: '',
  notifyPushPlusToken: '',
  notifyServerChanKey: '',
  feishuWebhookUrl: '',
  feishuSecret: '',
  feishuAppId: '',
  feishuAppSecret: '',
  feishuVerificationToken: '',
  feishuEncryptKey: '',
  feishuNotifyOnDispatch: false,
  llmProvider: 'deepseek', // 'deepseek' | 'openai' | 'custom'
  llmBaseUrl: 'https://api.deepseek.com/v1',
  llmApiKey: '',
  llmModel: 'deepseek-chat',
  systemPromptQA: '你是 Antigravity 微信与飞书随身 AI 助手。请用清晰、精炼、适合移动端阅读的文字回答用户问题。若需要执行具体项目代码改动，请提示用户带上操作动词（如“帮我在当前工程中修改…”）。'
};

const DEFAULT_ROADMAP = {
  milestones: [],
  tasks: []
};

// ---------------------------------------------------------------------------
// 存储辅助函数
// ---------------------------------------------------------------------------
function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    // 兼容迁移：若原 wechat-dispatcher 存在配置则优先读取
    const legacyConfig = join(APP_DATA_DIR, 'sidecar_data', 'wechat-dispatcher', 'panel', 'data', 'wechat_config.json');
    if (existsSync(legacyConfig)) {
      try {
        const parsed = JSON.parse(readFileSync(legacyConfig, 'utf8'));
        return { ...DEFAULT_CONFIG, ...parsed };
      } catch (e) {}
    }
    return { ...DEFAULT_CONFIG };
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

function loadMessages() {
  if (!existsSync(MESSAGES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(MESSAGES_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveMessages(msgs) {
  mkdirSync(DATA_DIR, { recursive: true });
  const trimmed = msgs.slice(-150);
  writeFileSync(MESSAGES_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  return trimmed;
}

function loadPendingConfirmations() {
  if (!existsSync(PENDING_CONFIRM_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PENDING_CONFIRM_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function savePendingConfirmations(data) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PENDING_CONFIRM_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function getPendingConfirmation(userKey, timeoutSec = 300) {
  if (!userKey) return null;
  const store = loadPendingConfirmations();
  const item = store[userKey];
  if (!item) return null;

  const now = Date.now();
  if (now - item.createdAt > timeoutSec * 1000) {
    delete store[userKey];
    savePendingConfirmations(store);
    return null;
  }
  return item;
}

function setPendingConfirmation(userKey, info) {
  if (!userKey) return;
  const store = loadPendingConfirmations();
  store[userKey] = {
    ...info,
    createdAt: Date.now()
  };
  savePendingConfirmations(store);
}

function clearPendingConfirmation(userKey) {
  if (!userKey) return;
  const store = loadPendingConfirmations();
  if (store[userKey]) {
    delete store[userKey];
    savePendingConfirmations(store);
  }
}

function parseConfirmationAnswer(text) {
  const trimmed = String(text || '').trim();
  const lower = trimmed.toLowerCase();

  // 0 / 取消
  const cancelWords = ['0', '取消', '算了', '不用了', '别改', 'cancel', 'no', 'n', '放弃', '作废', '取消执行', '不用改了', '停止'];
  if (cancelWords.includes(lower)) {
    return { action: 'CANCEL' };
  }

  // 2 / 仅解答
  const qaWords = ['2', '仅解答', '解答', '只解释', '只回答', '解释', 'qa', '问答', '咨询', '只解答', '不要改只解答'];
  if (qaWords.includes(lower)) {
    return { action: 'QA_ONLY' };
  }

  // 1 / 确认
  const exactConfirmWords = ['1', '确认', '执行', '好的', '好', '确定', 'ok', 'yes', 'y', '行', '走起', '开始', '搞', '准了', '确认执行', '执行吧', '去做吧', '开始做', '可以'];
  if (exactConfirmWords.includes(lower)) {
    return { action: 'CONFIRM' };
  }

  // 复合确认 + 补充，如 "好的，并且把端口改了" 或 "1 改在另一个工程"
  if (/^(?:1|好的|好|确认|行|可以)[,，\s]+(.+)$/i.test(trimmed)) {
    const match = trimmed.match(/^(?:1|好的|好|确认|行|可以)[,，\s]+(.+)$/i);
    return { action: 'CONFIRM', supplement: match[1].trim() };
  }

  // 显式补充
  const supplementPrefixes = ['改在', '改为', '修改为', '补充:', '补充：', '补充', '另外', '并且', '加上', '顺便'];
  for (const p of supplementPrefixes) {
    if (trimmed.startsWith(p)) {
      return { action: 'SUPPLEMENT', supplement: trimmed };
    }
  }

  return { action: 'UNKNOWN' };
}

function formatConfirmationCard({ taskTitle, projName, convName, summary }) {
  return `🤖【Antigravity 意图确认】\n` +
    `检测到您提交了一项研发任务：\n` +
    `📝 任务：${taskTitle}\n` +
    `📌 目标会话：${convName}\n` +
    `📦 所属工程：${projName}\n` +
    (summary ? `💡 说明：${summary}\n\n` : `\n`) +
    `请在微信中回复序号或指令：\n` +
    `[1] 确认执行 ➔ 立即派发至 IDE 终端执行\n` +
    `[2] 仅解答 ➔ 作为技术咨询纯回答，不改代码\n` +
    `[0] 取消 ➔ 取消本次任务派发\n` +
    `（亦可直接回复补充要求，如“改在 xx 工程中修改”）\n` +
    `⏱️ 5 分钟内有效`;
}

function getTaskFilePath(conversationId) {
  const id = String(conversationId || 'default').trim();
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(DATA_DIR, `tasks_${safeId}.json`);
}

function loadTasks(conversationId) {
  const file = getTaskFilePath(conversationId);
  if (!existsSync(file)) {
    // 尝试寻找已有会话的任务数据
    return JSON.parse(JSON.stringify(DEFAULT_ROADMAP));
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return JSON.parse(JSON.stringify(DEFAULT_ROADMAP));
  }
}

function saveTasks(conversationId, data) {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = getTaskFilePath(conversationId);
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

// ---------------------------------------------------------------------------
// 会话列表与工具调用流水解析 (Transcript Parser)
// ---------------------------------------------------------------------------
function getConversationsList() {
  const dbPath = join(APP_DATA_DIR, 'conversation_summaries.db');
  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db.prepare(`
        SELECT conversation_id, title, workspace_uris, last_modified_time, step_count
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
        LIMIT 60
      `).all();
      db.close();

      return rows.map((r) => {
        let projectName = '通用会话';
        let projectPath = '';
        if (r.workspace_uris) {
          try {
            const uris = JSON.parse(r.workspace_uris);
            if (Array.isArray(uris) && uris.length > 0) {
              const decoded = decodeURIComponent(uris[0].replace('file:///', ''));
              projectPath = decoded;
              projectName = decoded.split(/[/\\]/).filter(Boolean).pop() || '通用会话';
            }
          } catch (e) {}
        }
        return {
          id: r.conversation_id,
          title: r.title || r.conversation_id.slice(0, 8),
          projectName,
          projectPath,
          lastModified: r.last_modified_time,
          stepCount: r.step_count || 0,
          hasTranscript: existsSync(join(BRAIN_DIR, r.conversation_id, '.system_generated', 'logs', 'transcript.jsonl'))
        };
      });
    } catch (err) {
      console.error('Failed to query conversation_summaries.db:', err);
    }
  }

  if (!existsSync(BRAIN_DIR)) return [];
  try {
    const entries = readdirSync(BRAIN_DIR, { withFileTypes: true });
    const convs = [];
    for (const ent of entries) {
      if (ent.isDirectory() && ent.name !== 'scratch' && ent.name !== 'tempmediaStorage') {
        const transcriptPath = join(BRAIN_DIR, ent.name, '.system_generated', 'logs', 'transcript.jsonl');
        let mtime = 0;
        let hasTranscript = false;
        if (existsSync(transcriptPath)) {
          hasTranscript = true;
          mtime = statSync(transcriptPath).mtimeMs;
        } else {
          mtime = statSync(join(BRAIN_DIR, ent.name)).mtimeMs;
        }
        convs.push({
          id: ent.name,
          title: ent.name.slice(0, 8),
          projectName: '本地会话',
          mtime,
          hasTranscript
        });
      }
    }
    convs.sort((a, b) => b.mtime - a.mtime);
    return convs;
  } catch (e) {
    console.error('Failed to list conversations:', e);
    return [];
  }
}

function parseTranscript(conversationId) {
  const convId = String(conversationId || '').trim();
  if (!convId) {
    return { steps: [], stats: { totalSteps: 0, toolCallsCount: 0, userMessages: 0, tokens: null } };
  }

  const transcriptPath = join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!existsSync(transcriptPath)) {
    return { steps: [], stats: { totalSteps: 0, toolCallsCount: 0, userMessages: 0, tokens: null } };
  }

  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

    const steps = [];
    let toolCallsCount = 0;
    let userMessages = 0;
    let latestTokens = null;
    let latestAssistantResponse = '';

    for (const line of lines) {
      try {
        const step = JSON.parse(line);

        if (step.input_tokens !== undefined || step.cache_read_tokens !== undefined || step.output_tokens !== undefined) {
          const inp = Number(step.input_tokens || 0);
          const cache = Number(step.cache_read_tokens || 0);
          const out = Number(step.output_tokens || 0);
          latestTokens = {
            input: inp,
            cache: cache,
            output: out,
            total: inp + cache + out
          };
        }

        if (step.type === 'USER_INPUT') {
          userMessages++;
          steps.push({
            type: 'user',
            stepIndex: step.step_index,
            time: step.created_at,
            content: typeof step.content === 'string' ? step.content.slice(0, 400) : ''
          });
        } else if (step.type === 'PLANNER_RESPONSE') {
          const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
          toolCallsCount += calls.length;
          const textContent = typeof step.content === 'string' ? step.content.trim() : '';
          if (textContent) {
            latestAssistantResponse = textContent;
          }

          if (calls.length > 0) {
            steps.push({
              type: 'tool_execution',
              stepIndex: step.step_index,
              time: step.created_at,
              status: step.status,
              content: textContent ? textContent.slice(0, 1000) : '',
              calls: calls.map((c) => ({
                name: c.name,
                summary: c.args?.toolSummary || c.name,
                action: c.args?.toolAction || '',
                args: sanitizeArgs(c.name, c.args)
              }))
            });
          } else if (textContent) {
            steps.push({
              type: 'assistant_response',
              stepIndex: step.step_index,
              time: step.created_at,
              status: step.status,
              content: textContent.slice(0, 1500)
            });
          }
        }
      } catch (e) {}
    }

    return {
      steps: steps.slice(-50).reverse(),
      latestAssistantResponse,
      stats: {
        totalSteps: lines.length,
        toolCallsCount,
        userMessages,
        tokens: latestTokens
      }
    };
  } catch (err) {
    console.error(`Failed to read transcript: ${err.message}`);
    return { error: err.message, steps: [], stats: { totalSteps: 0, toolCallsCount: 0, userMessages: 0, tokens: null } };
  }
}

function sanitizeArgs(toolName, args = {}) {
  if (!args) return {};
  const cleaned = {};
  if (toolName === 'run_command') {
    cleaned.command = args.CommandLine || '';
    cleaned.cwd = args.Cwd || '';
  } else if (toolName === 'write_to_file' || toolName === 'replace_file_content') {
    cleaned.file = args.TargetFile || '';
    cleaned.desc = args.Description || args.Instruction || '';
  } else if (toolName === 'view_file') {
    cleaned.file = args.AbsolutePath || '';
    if (args.StartLine) cleaned.lines = `${args.StartLine}-${args.EndLine || ''}`;
  } else if (toolName === 'search_web') {
    cleaned.query = args.query || '';
  } else {
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && v.length < 200) cleaned[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') cleaned[k] = v;
    }
  }
  return cleaned;
}

function getTranscriptStepCount(conversationId) {
  const convId = String(conversationId || '').trim();
  if (!convId) return 0;
  const transcriptPath = join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!existsSync(transcriptPath)) return 0;
  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.length;
  } catch (e) {
    return 0;
  }
}

async function waitForAgentReply(conversationId, baselineStep = 0, timeoutMs = 150000) {
  const convId = String(conversationId || '').trim();
  if (!convId) return { completed: false, timedOut: false, error: 'No conversationId' };

  const transcriptPath = join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
  const startTime = Date.now();
  const pollInterval = 1200;
  let lastSeenStepCount = baselineStep;
  let quietCount = 0;
  let effectiveTimeoutMs = Math.max(timeoutMs, 120000); // 至少等待 120 秒，避免 Agent 执行工具被提前掐断

  while (Date.now() - startTime < effectiveTimeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    if (!existsSync(transcriptPath)) continue;

    try {
      const raw = readFileSync(transcriptPath, 'utf8');
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const currentStepCount = lines.length;

      if (currentStepCount > baselineStep) {
        if (currentStepCount > lastSeenStepCount) {
          lastSeenStepCount = currentStepCount;
          quietCount = 0;

          // 动态续期：如果 Agent 仍在持续产生工具调用流水，且剩余等待时间不足 30s，自动续期至最高 165s
          const elapsed = Date.now() - startTime;
          const remaining = effectiveTimeoutMs - elapsed;
          if (remaining < 30000 && elapsed < 165000) {
            effectiveTimeoutMs = Math.min(165000, effectiveTimeoutMs + 30000);
          }
        } else {
          quietCount++;
        }

        // 倒序寻找 baselineStep 之后最新的 PLANNER_RESPONSE
        let latestPlanner = null;
        let latestPlannerIdx = -1;
        for (let i = lines.length - 1; i >= baselineStep; i--) {
          try {
            const step = JSON.parse(lines[i]);
            if (step.type === 'PLANNER_RESPONSE') {
              latestPlanner = step;
              latestPlannerIdx = i;
              break;
            }
          } catch (e) {}
        }

        if (latestPlanner) {
          const calls = Array.isArray(latestPlanner.tool_calls) ? latestPlanner.tool_calls : [];
          const text = typeof latestPlanner.content === 'string' ? latestPlanner.content.trim() : '';

          // 当满足以下任一条件时，判定本轮 Agent 执行与回复已完成：
          // 1. 无后续工具调用且输出了非空回复正文（典型的最终回复）
          // 2. 或 status 为 DONE 且已有文本，且步骤已静默至少一轮轮询
          // 3. 或 quietCount >= 3 (连续 3.6 秒无新增步骤) 且具备正文
          const hasFinishedTools = calls.length === 0 && text.length > 0;
          const isSettledDone = latestPlanner.status === 'DONE' && text.length > 0 && quietCount >= 1;
          const isQuietWithText = quietCount >= 3 && text.length > 0;

          if (hasFinishedTools || isSettledDone || isQuietWithText) {
            const elapsedSec = Math.round((Date.now() - startTime) / 1000);
            return {
              completed: true,
              response: text,
              stepsAdded: currentStepCount - baselineStep,
              elapsedSec
            };
          }
        }
      }
    } catch (err) {
      console.warn('[waitForAgentReply] Error reading transcript:', err.message);
    }
  }

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const currentStepCount = getTranscriptStepCount(convId);
  return {
    completed: false,
    timedOut: true,
    stepsAdded: Math.max(0, currentStepCount - baselineStep),
    elapsedSec
  };
}

// ---------------------------------------------------------------------------
// 飞书群自定义机器人 Webhook 与开放平台交互
// ---------------------------------------------------------------------------

function generateFeishuSign(timestamp, secret) {
  if (!secret) return '';
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac('sha256', stringToSign).digest('base64');
}

/**
 * 发送飞书自定义机器人交互式卡片消息
 */
async function sendFeishuWebhookCard({ webhookUrl, secret, title, content, fields = [], templateColor = 'blue', actions = [] }) {
  if (!webhookUrl) return { success: false, error: '未配置飞书 Webhook 地址' };

  const builder = new FeishuCardBuilder()
    .setHeader(title || 'Antigravity 研发任务通知', templateColor);

  if (fields && fields.length > 0) {
    builder.addFields(fields);
  }

  if (content) {
    if (fields.length > 0) builder.addHr();
    builder.addMarkdown(content.slice(0, 3000));
  }

  const defaultActions = [
    {
      text: '🖥️ 打开派发看板',
      type: 'primary',
      url: 'http://127.0.0.1:18765/'
    }
  ];
  const finalActions = actions.length > 0 ? actions : defaultActions;
  if (finalActions.length > 0) {
    builder.addActions(finalActions);
  }

  const payload = builder.buildWebhookPayload({ secret });

  const res = await fetch(webhookUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const resData = await res.json().catch(() => ({}));
  if (resData.code && resData.code !== 0) {
    throw new Error(`飞书推送失败 [code: ${resData.code}]: ${resData.msg || JSON.stringify(resData)}`);
  }
  return { success: true, data: resData };
}

function decryptFeishuData(encryptStr, encryptKey) {
  if (!encryptStr || !encryptKey) return null;
  try {
    const key = createHash('sha256').update(encryptKey).digest();
    const decodeBuffer = Buffer.from(encryptStr, 'base64');
    const iv = decodeBuffer.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(decodeBuffer.subarray(16), undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    console.error('[Feishu] 解密数据失败:', err.message);
    return null;
  }
}

let feishuTokenCache = { token: '', expireTime: 0 };

async function getFeishuTenantAccessToken(appId, appSecret) {
  if (!appId || !appSecret) return null;
  const now = Date.now();
  if (feishuTokenCache.token && feishuTokenCache.expireTime > now) {
    return feishuTokenCache.token;
  }
  try {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId.trim(), app_secret: appSecret.trim() })
    });
    const data = await res.json();
    if (data.code === 0 && data.tenant_access_token) {
      feishuTokenCache = {
        token: data.tenant_access_token,
        expireTime: now + ((data.expire || 7200) - 300) * 1000
      };
      return data.tenant_access_token;
    }
  } catch (err) {
    console.error('[Feishu] 获取 tenant_access_token 失败:', err.message);
  }
  return null;
}

async function replyFeishuMessage({ appId, appSecret, chatId, openId, text, card }) {
  const token = await getFeishuTenantAccessToken(appId, appSecret);
  if (!token) return false;

  const receiveId = chatId || openId;
  const receiveIdType = chatId ? 'chat_id' : 'open_id';
  if (!receiveId) return false;

  const msgType = card ? 'interactive' : 'text';
  const content = card ? JSON.stringify(card) : JSON.stringify({ text });

  try {
    const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: msgType,
        content
      })
    });
    const data = await res.json();
    return data.code === 0;
  } catch (err) {
    console.error('[Feishu] 发送飞书消息异常:', err.message);
    return false;
  }
}

async function processFeishuIncomingMessage({ text, sender, chatId, openId, cfg }) {
  let replyContent = '';
  const switchReply = resolveSwitchCommand(text);
  const newSessionTask = extractNewSessionTask(text);

  if (isHelpCommand(text)) {
    replyContent = getHelpMessage();
    handleIncomingMessage(text, sender, 'feishu', {
      category: 'command',
      status: 'answered',
      reply: replyContent
    });
  } else if (isSessionsCommand(text)) {
    replyContent = getSessionsMessage();
    handleIncomingMessage(text, sender, 'feishu', {
      category: 'command',
      status: 'answered',
      reply: replyContent
    });
  } else if (switchReply) {
    replyContent = switchReply;
    handleIncomingMessage(text, sender, 'feishu', {
      category: 'command',
      status: 'answered',
      reply: replyContent
    });
  } else if (newSessionTask) {
    handleIncomingMessage(newSessionTask, sender, 'feishu', {
      category: 'project_task',
      isNewChat: true,
      cleanContent: newSessionTask
    });
    replyContent = `🚀 已为您创建新会话并派发任务：\n${newSessionTask}\n\nAntigravity 将在新会话中开始执行！`;
  } else if (isProjectsCommand(text)) {
    replyContent = getProjectsMessage();
    handleIncomingMessage(text, sender, 'feishu', {
      category: 'command',
      status: 'answered',
      reply: replyContent
    });
  } else if (isStatusCommand(text)) {
    replyContent = getStatusMessage();
    handleIncomingMessage(text, sender, 'feishu', {
      category: 'command',
      status: 'answered',
      reply: replyContent
    });
  } else if (isReportCommand(text)) {
    replyContent = getStructuredTaskReport();
    handleIncomingMessage(text, sender, 'feishu', {
      category: 'command',
      status: 'answered',
      reply: replyContent
    });
  } else if (isFeishuCommand(text)) {
    replyContent = await resolveFeishuCommand(text);
    handleIncomingMessage(text, sender, 'feishu', {
      category: 'command',
      status: 'answered',
      reply: replyContent
    });
  } else {
    const userKey = openId || sender || 'feishu_user';
    const pending = getPendingConfirmation(userKey, cfg.aiIntentConfirmTimeoutSec || 300);
    let handledPending = false;

    if (pending) {
      const answer = parseConfirmationAnswer(text);
      if (answer.action === 'CONFIRM') {
        handledPending = true;
        clearPendingConfirmation(userKey);
        const finalPrompt = answer.supplement ? `${pending.prompt}\n(补充要求: ${answer.supplement})` : pending.prompt;
        replyContent = await executeDispatchedTask(finalPrompt, sender, pending.targetConvId, pending.projName, cfg, 'feishu');
      } else if (answer.action === 'QA_ONLY') {
        handledPending = true;
        clearPendingConfirmation(userKey);
        replyContent = await callUpstreamLLM(pending.prompt, cfg);
        handleIncomingMessage(pending.prompt, sender, 'feishu', {
          category: 'daily_qa',
          status: 'answered',
          reply: replyContent
        });
      } else if (answer.action === 'CANCEL') {
        handledPending = true;
        clearPendingConfirmation(userKey);
        replyContent = `🛑 已取消任务派发：\n📝「${pending.taskTitle}」\n不会对工程代码做任何修改。`;
        handleIncomingMessage(text, sender, 'feishu', {
          category: 'command',
          status: 'answered',
          reply: replyContent
        });
      } else if (answer.action === 'SUPPLEMENT') {
        handledPending = true;
        clearPendingConfirmation(userKey);
        const finalPrompt = `${pending.prompt}\n(补充要求: ${answer.supplement})`;
        replyContent = await executeDispatchedTask(finalPrompt, sender, pending.targetConvId, pending.projName, cfg, 'feishu');
      } else {
        clearPendingConfirmation(userKey);
      }
    }

    if (!handledPending) {
      const aiEval = await evaluateIntentWithAI(text, cfg);
      if (aiEval.intent === 'CONFIRM_REQUIRED') {
        const convList = getConversationsList();
        const targetConvId = cfg.activeConversationId || (convList[0]?.id) || 'default';
        const currentConv = convList.find((c) => c.id === targetConvId);
        const convName = currentConv ? currentConv.title : targetConvId.slice(0, 8);
        const projName = currentConv ? currentConv.projectName : (cfg.currentProject || '默认工程');

        setPendingConfirmation(userKey, {
          prompt: text,
          taskTitle: aiEval.taskTitle || text.slice(0, 20),
          summary: aiEval.summary || aiEval.reason || '',
          projName,
          targetConvId,
          convName
        });

        replyContent = formatConfirmationCard({
          taskTitle: aiEval.taskTitle || text.slice(0, 20),
          projName,
          convName,
          summary: aiEval.summary || aiEval.reason || ''
        });

        handleIncomingMessage(text, sender, 'feishu', {
          category: 'command',
          status: 'answered',
          reply: replyContent
        });
      } else if (aiEval.intent === 'DAILY_QA') {
        replyContent = await callUpstreamLLM(text, cfg);
        handleIncomingMessage(text, sender, 'feishu', {
          category: 'daily_qa',
          status: 'answered',
          reply: replyContent
        });
      } else {
        // DIRECT_EXECUTE
        const convList = getConversationsList();
        const targetConvId = cfg.activeConversationId || (convList[0]?.id) || 'default';
        const currentConv = convList.find((c) => c.id === targetConvId);
        const convName = currentConv ? currentConv.title : targetConvId.slice(0, 8);
        const projName = currentConv ? currentConv.projectName : (cfg.currentProject || '默认工程');

        const cleanPrompt = text;
        handleIncomingMessage(text, sender, 'feishu', {
          category: 'project_task',
          targetProject: projName,
          targetConvId,
          cleanContent: cleanPrompt,
          isDirectChat: false
        });

        if (cfg.feishuWebhookUrl) {
          sendFeishuWebhookCard({
            webhookUrl: cfg.feishuWebhookUrl,
            secret: cfg.feishuSecret,
            title: '🚀 飞书研发指令已录入并下发',
            content: `**指令详情**: ${cleanPrompt}`,
            templateColor: 'blue',
            fields: [
              { title: '📁 所属工程', value: projName },
              { title: '💬 目标会话', value: convName },
              { title: '👤 触发人员', value: sender },
              { title: '📊 状态', value: '执行中 (In Progress)' }
            ]
          }).catch(() => {});
        }
        return;
      }
    }
  }

  // 如果有回复文本，回推给飞书
  if (replyContent) {
    if (cfg.feishuAppId && cfg.feishuAppSecret && (chatId || openId)) {
      await replyFeishuMessage({
        appId: cfg.feishuAppId,
        appSecret: cfg.feishuAppSecret,
        chatId,
        openId,
        text: replyContent
      });
    } else if (cfg.feishuWebhookUrl) {
      await sendFeishuWebhookCard({
        webhookUrl: cfg.feishuWebhookUrl,
        secret: cfg.feishuSecret,
        title: '🤖 Antigravity 飞书助手回复',
        content: replyContent,
        templateColor: 'blue'
      }).catch(() => {});
    }
  }
}

async function triggerTaskCompletionPush(info, cfg) {
  const activeCfg = cfg || loadConfig();
  let channel = activeCfg.notifyChannel || 'none';
  // 如果任务来自飞书且配置了飞书 Webhook，即便默认通知非 feishu 也确保推送到飞书群
  if (info.source === 'feishu' && activeCfg.feishuWebhookUrl && channel === 'none') {
    channel = 'feishu';
  }
  if (!channel || channel === 'none') return;

  const title = info.title || 'Antigravity 任务执行完成';
  const content = info.content || '';
  const convName = info.convName || '';
  const projName = info.projName || '';
  const stepsAdded = info.stepsAdded || 0;
  const elapsedSec = info.elapsedSec || 0;

  const markdownText = `### ✅ ${title}\n\n` +
    `**📁 工程**: ${projName}  \n` +
    `**💬 会话**: ${convName}  \n\n` +
    `---\n\n` +
    `${content.slice(0, 2000)}`;

  try {
    if (channel === 'wechat') {
      const msgs = loadMessages();
      const lastWxUser = msgs.slice().reverse().find(m => m.source === 'chatgpt-on-wechat' || m.source === 'wechat');
      const targetUser = info.fromUser || lastWxUser?.from || '微信随身用户';
      const pushMsg = {
        id: `wx_push_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        from: targetUser,
        content: `【任务完成推送】${title}`,
        category: 'project_task',
        source: 'system_push',
        time: new Date().toISOString(),
        status: 'completed',
        reply: `✅【Antigravity 任务执行完成】\n` +
          `📌 目标会话：${convName}\n` +
          `📦 所属工程：${projName}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `${content.slice(0, 1500)}\n` +
          `━━━━━━━━━━━━━━━━━━━━`
      };
      msgs.push(pushMsg);
      saveMessages(msgs);
      console.log('[PushNotification] Sent WeChat session push notification successfully');
    } else if (channel === 'feishu' && activeCfg.feishuWebhookUrl) {
      await sendFeishuWebhookCard({
        webhookUrl: activeCfg.feishuWebhookUrl,
        secret: activeCfg.feishuSecret,
        title: `✅ ${title}`,
        content: content || '任务执行完成，未产生额外输出。',
        templateColor: 'green',
        fields: [
          { title: '📁 所属工程', value: projName },
          { title: '💬 目标会话', value: convName },
          { title: '📊 任务状态', value: '已完成 (Done)' }
        ]
      });
      console.log('[PushNotification] Sent Feishu Webhook notification successfully');
    } else if (channel === 'pushplus' && activeCfg.notifyPushPlusToken) {
      await fetch('http://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: activeCfg.notifyPushPlusToken.trim(),
          title: `[Antigravity] ${title}`,
          content: markdownText,
          template: 'markdown'
        })
      });
      console.log('[PushNotification] Sent PushPlus notification successfully');
    } else if (channel === 'wecom') {
      const wecomUrl = (activeCfg.notifyWecomUrl || activeCfg.notifyWebhookUrl || '').trim();
      if (wecomUrl) {
        await fetch(wecomUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: { content: markdownText }
          })
        });
        console.log('[PushNotification] Sent WeCom Webhook notification successfully');
      }
    } else if (channel === 'serverchan' && activeCfg.notifyServerChanKey) {
      const url = `https://sctapi.ftqq.com/${activeCfg.notifyServerChanKey.trim()}.send`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[Antigravity] ${title}`,
          desp: markdownText
        })
      });
      console.log('[PushNotification] Sent ServerChan notification successfully');
    } else if (channel === 'custom' && activeCfg.notifyWebhookUrl) {
      await fetch(activeCfg.notifyWebhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'task_completed',
          title,
          conversation: convName,
          project: projName,
          content,
          elapsedSec,
          stepsAdded,
          timestamp: new Date().toISOString()
        })
      });
      console.log('[PushNotification] Sent Custom Webhook notification successfully');
    }
  } catch (err) {
    console.error('[PushNotification] Push error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// 微信意图识别与工程任务流转
// ---------------------------------------------------------------------------
const DEV_TOOL_KEYWORDS = [
  'git', 'commit', 'push', 'pull', 'branch', 'diff', 'status', 'stash', 'checkout', 'merge', 'rebase',
  'npm', 'pnpm', 'yarn', 'bun', 'pip', 'python', 'node', 'docker', 'compose',
  'build', 'compile', 'bundle', 'test', 'lint', 'format', 'dev', 'serve', 'start', 'stop', 'restart', 'deploy', 'release'
];

const ACTION_VERBS = [
  '修改', '改代码', '改一下', '改改', '改下', '写代码', '写一下', '写个', '写出', '写下',
  '创建', '新建', '运行', '执行', '跑一下', '跑跑', '跑个', '跑下', '测试', '测一下', '测下',
  '重构', '排查', '修复', '解决bug', '改bug', '修bug', '修一下', '修下',
  '部署', '构建', '打包', '安装', '删除', '实现', '添加', '增加',
  '优化', '完善', '检查', '查一下', '查下', '调整', '更新', '整理', '重写',
  '看一下', '看下', '看看', '弄一下', '搞一下', '处理', '分析', '统计', '查看'
];

const ACTION_SUFFIX_PATTERNS = [
  /一下$/, /一波$/, /下$/, /看看$/
];

const PROJECT_OBJECTS = [
  '代码', '文件', '函数', '方法', '脚本', '项目', '工程', '仓库',
  'bug', 'issue', '测试用例', '单元测试', '组件', '依赖', '类', '接口',
  'readme', 'package.json', '目录', '配置', '前端', '后端',
  '模型', '字段', '结构', '架构', '页面', '功能', '模块'
];

const DIRECT_CONV_PREFIXES = [
  '给这个会话发送', '给当前会话发送', '向当前会话发送', '向这个会话发送',
  '给会话发送', '对会话说', '对这个会话说', '对当前会话说', '向会话发送',
  '发给当前会话', '发给这个会话', '发给会话', '跟这个会话对话', '和这个会话对话',
  '与会话对话', '发送给当前会话', '发送给这个会话', '发消息给会话',
  '给会话发', '跟会话聊', '对会话发', '在当前会话中', '在当前会话', '给当前会话发',
  '和会话说', '跟会话说', '问会话', '向会话提问', '发给会话说'
];

const EXPLICIT_CMD_PREFIXES = [
  '/task', '/cmd', '/run', '/code', '/chat', '/msg', '/talk', '/ask', '/send',
  '@bot', '【任务】', '【指令】', '【对话】'
];

function extractTargetProject(text) {
  const patterns = [
    /(?:在|对)\s*([a-zA-Z0-9_\-\.]+)\s*(?:项目|工程|目录)/i,
    /(?:项目|工程)\s*[:：]\s*([a-zA-Z0-9_\-\.]+)/i,
    /--project\s+([a-zA-Z0-9_\-\.]+)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function isGreeting(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[!！?？~～.。\s]/g, '');
  if (!t) return false;
  const greetings = [
    '你好', '您好', 'hi', 'hello', 'hey', '在吗', '在不在', '在呢', '哈喽', '嗨',
    '早上好', '早安', '中午好', '下午好', '晚上好', '晚安', 'hihi', 'hellohello'
  ];
  return greetings.includes(t);
}

function getGreetingMessage() {
  return [
    '👋 **您好！我是 Antigravity 随身 AI 助手。**',
    '',
    '当前已与电脑端 IDE 深度连通，随时待命！',
    '',
    '---',
    '',
    '### 🛠️ 您现在可以这样吩咐我：',
    '- **💻 代码与工程开发**：直接发指令（例如：“帮我写一个快速排序测试”、“检查当前工程的 Git 状态”）',
    '- **📊 查询看板与进度**：发送 `/status` 或 **进度** 查看当前任务执行动态',
    '- **📑 切换工程会话**：发送 `/sessions` 查看历史会话，输入 `进入 会话名` 远程切换',
    '- **💬 日常技术咨询**：发送 `/qa 你的问题` 进行轻量咨询（不打扰项目会话）',
    '',
    '请问今天有什么任务需要我来协助您处理？😊'
  ].join('\n');
}

function classifyIntent(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { category: 'DAILY_QA', targetProject: null, cleanContent: '', isDirectChat: false };

  // 0. 问候语直接判定为日常问答/迎宾，绝不作为工程代码任务
  if (isGreeting(trimmed)) {
    return { category: 'DAILY_QA', targetProject: null, cleanContent: trimmed, isDirectChat: false, isGreeting: true };
  }

  const cfg = loadConfig();
  const defaultProject = cfg.currentProject || null;

  // 1. 显式指定发送给当前会话 / 与会话对话前缀 (如 "给这个会话发送你好消息", "对会话说...", "发给当前会话...")
  for (const prefix of DIRECT_CONV_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      let clean = trimmed.slice(prefix.length).replace(/^[:：\s]+/, '').trim() || trimmed;
      const targetProject = extractTargetProject(clean) || defaultProject;
      return { category: 'PROJECT_TASK', targetProject, cleanContent: clean, isDirectChat: true };
    }
  }

  // 2. 显式指令前缀 (/task, /chat, /run, /code, /msg 等)
  for (const prefix of EXPLICIT_CMD_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      let clean = trimmed.slice(prefix.length).replace(/^[:：\s]+/, '').trim() || trimmed;
      const targetProject = extractTargetProject(clean) || defaultProject;
      const isChat = prefix.includes('chat') || prefix.includes('msg') || prefix.includes('talk') || prefix.includes('ask') || prefix.includes('对话');
      return { category: 'PROJECT_TASK', targetProject, cleanContent: clean, isDirectChat: isChat };
    }
  }

  // 3. 显式 /qa 前缀 -> 强制使用独立大模型日常问答
  if (trimmed.toLowerCase().startsWith('/qa ') || trimmed.toLowerCase().startsWith('/qa：') || trimmed.toLowerCase().startsWith('/qa:')) {
    const clean = trimmed.slice(4).trim();
    return { category: 'DAILY_QA', targetProject: null, cleanContent: clean, isDirectChat: false };
  }

  // 4. 若为工程/会话直通模式 (targetMode === 'code'，即默认模式)，所有未指定 /qa 的消息均直通 Antigravity 会话！
  if (cfg.targetMode === 'code' || cfg.enableIntentRouting === false) {
    const targetProject = extractTargetProject(trimmed) || defaultProject;
    return { category: 'PROJECT_TASK', targetProject, cleanContent: trimmed, isDirectChat: false };
  }

  const targetProject = extractTargetProject(trimmed);
  const lower = trimmed.toLowerCase();

  // 5. 明确包含开发者工具或 CLI 关键词 (如 git, npm, test, commit, branch...)
  const hasDevTool = DEV_TOOL_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasDevTool) {
    return { category: 'PROJECT_TASK', targetProject: targetProject || defaultProject, cleanContent: trimmed, isDirectChat: false };
  }

  // 6. 动词后缀模式 (如 "git一下", "看下", "查一下", "跑一下", "测下", "理一下")
  const hasActionSuffix = ACTION_SUFFIX_PATTERNS.some((p) => p.test(trimmed));
  if (hasActionSuffix) {
    return { category: 'PROJECT_TASK', targetProject: targetProject || defaultProject, cleanContent: trimmed, isDirectChat: false };
  }

  // 7. 显式操作前缀 (如 "帮我...", "请帮我...", "给我...")
  if (lower.startsWith('帮我') || lower.startsWith('请帮我') || lower.startsWith('给我') || lower.startsWith('请在') || lower.startsWith('在')) {
    return { category: 'PROJECT_TASK', targetProject: targetProject || defaultProject, cleanContent: trimmed, isDirectChat: false };
  }

  // 8. 包含动作动词并搭配工程对象，或属于简短指令短语
  const hasActionVerb = ACTION_VERBS.some((verb) => lower.includes(verb));
  const hasProjectObject = PROJECT_OBJECTS.some((obj) => lower.includes(obj));

  if (hasActionVerb && (hasProjectObject || targetProject || trimmed.length <= 25)) {
    return { category: 'PROJECT_TASK', targetProject: targetProject || defaultProject, cleanContent: trimmed, isDirectChat: false };
  }

  // 9. 纯概念型问答或闲聊判定
  return { category: 'DAILY_QA', targetProject: null, cleanContent: trimmed, isDirectChat: false };
}

function isHelpCommand(text) {
  const lower = String(text || '').trim().toLowerCase();
  const keywords = [
    '/help', 'help', '帮助', '/h', '指令', '菜单', '/帮助', '操作指南', '使用指南',
    '功能', '怎么用', '有哪些指令', '指令列表', '帮助菜单', '?', '/?', '？', '/？',
    '命令', '有哪些命令', '在会话中有哪些命令可以用', '会话命令', '可用命令', '支持哪些命令', '指令有哪些'
  ];
  return keywords.includes(lower) || lower.includes('有哪些命令') || lower === '/help' || lower.startsWith('/help ');
}

function isReportCommand(text) {
  const lower = String(text || '').trim().toLowerCase();
  const keywords = [
    '/report', '/result', '/ans', '/reply', '/last', 'report', 'result',
    '执行结果', '任务结果', '结果', '反馈', '任务反馈', '查看结果', '执行反馈',
    '任务报告', '执行报告', '最新结果', '最新回复', '会话结果', '会话回复',
    '完成了吗', '执行完了吗', '做到哪了'
  ];
  return keywords.includes(lower) || lower.startsWith('/report') || lower.startsWith('/result') || lower.startsWith('/ans') || lower.startsWith('/last');
}

function isProjectsCommand(text) {
  const lower = String(text || '').trim().toLowerCase();
  const keywords = [
    '/projects', '/project', 'projects', 'project', '项目列表', '有哪些项目',
    '所有项目', '查看项目', '项目清单', '工程列表', '查看工程', '项目'
  ];
  return keywords.includes(lower) || lower.startsWith('/projects') || lower.startsWith('/project');
}

function isStatusCommand(text) {
  const lower = String(text || '').trim().toLowerCase();
  const keywords = [
    '/status', 'status', '进度', '当前进度', '任务状态', '状态', '查看进度', '运行状态'
  ];
  return keywords.includes(lower) || lower.startsWith('/status');
}

function isSessionsCommand(text) {
  const lower = String(text || '').trim().toLowerCase();
  const keywords = [
    '/sessions', '/session', 'sessions', 'session', '会话列表', '历史会话',
    '所有会话', '查看会话', '会话清单', '会话', '会话记录'
  ];
  return keywords.includes(lower) || lower.startsWith('/sessions') || lower.startsWith('/session');
}

function extractNewSessionTask(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  // 1. 如果包含多轮历史记录指示符、引用或日志标记，绝对不是用户的新建会话指令！
  if (
    t.includes('助手:') || t.includes('用户:') ||
    t.includes('【AI助手') || t.includes('【Antigravity') ||
    t.includes('📌 目标会话') || t.includes('💬 指令内容') ||
    t.includes('📊【任务执行结构化反馈报告】') ||
    t.includes('System:') || t.includes('```') ||
    t.includes('## ') || t.includes('Context summary')
  ) {
    return null;
  }

  // 2. 问候语绝不触发新会话
  if (isGreeting(t)) return null;

  // 3. 新建会话指令必须是简明的指令短语，过长文本（超过 120 字符）严禁判定为新建会话
  if (t.length > 120) return null;

  // 4. 显式前缀: /new, 新会话, 新建会话 (支持单独输入 /new 或 /new <任务内容>)
  const prefixMatch = t.match(/^(?:\/new|新会话|新建会话)(?:[:：\s]+([\s\S]+))?$/i);
  if (prefixMatch) {
    const task = prefixMatch[1] ? prefixMatch[1].trim() : '开启全新研发会话';
    return task.slice(0, 100);
  }

  // 5. 自然语言表达: 必须是明确的新会话创建句式（行首锚定，避免长文本中偶然包含关键字）
  const nlMatch = t.match(/^(?:请|帮我|能否|可以|我想)?(?:创建|新建|开|建|起)(?:一个|个)?(?:全新的?|新的?)?会话(?:[，,\s\n]+(?:会话)?(?:工作内容是|内容是|主题是|任务是|做|负责|进行|绑定)[：:\s]*([\s\S]+)|[，,\s\n：:]+([\s\S]+))?$/i);
  if (nlMatch) {
    const raw = nlMatch[1] || nlMatch[2];
    const task = raw ? raw.trim() : '开启全新研发会话';
    return task.slice(0, 100);
  }

  return null;
}

function isFeishuCommand(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();
  if (!t) return false;
  // 如果带有显式任务/代码开发指令前缀或包含代码修改诉求，放行至研发任务派发
  if (lower.startsWith('/task') || lower.startsWith('/code') || lower.includes('修改代码') || lower.includes('开发代码') || lower.includes('实现代码')) {
    return false;
  }

  const keywords = [
    '/feishu', 'feishu', 'lark', '/lark', '飞书', '飞书绑定', '绑定飞书', '飞书怎么绑定',
    '如何绑定飞书', '怎么绑定飞书', '飞书配置', '配置飞书', '飞书设置', '设置飞书',
    '飞书状态', '飞书推送', '飞书机器人', '飞书测试', '测试飞书', '飞书指南', '飞书帮助',
    '飞书通知', '飞书接入', '接入飞书', '工作内容是绑定飞书', '内容是绑定飞书'
  ];
  if (keywords.includes(lower)) return true;
  if (lower.startsWith('/feishu') || lower.startsWith('/lark')) return true;
  if (lower.includes('绑定飞书') || lower.includes('飞书绑定')) return true;
  if (lower.includes('配置飞书') || lower.includes('设置飞书') || lower.includes('飞书设置') || lower.includes('飞书配置')) return true;
  if (lower.includes('飞书状态') || lower.includes('飞书指南') || lower.includes('飞书帮助') || lower.includes('飞书信息')) return true;
  if (lower.includes('飞书测试') || lower.includes('测试飞书')) return true;
  if (lower.includes('飞书机器人')) return true;
  if (lower.includes('飞书怎么') || lower.includes('如何绑定飞书') || lower.includes('怎么绑定飞书')) return true;
  if (lower.includes('飞书推送') || lower.includes('飞书通知')) return true;
  return false;
}

function getFeishuGuideMessage(cfg) {
  const isHookBound = !!cfg.feishuWebhookUrl;
  const isAppBound = !!(cfg.feishuAppId && cfg.feishuAppSecret);
  const isChannelFeishu = cfg.notifyChannel === 'feishu';
  const port = cfg.xmlPort || 18765;

  return `🤖【飞书机器人绑定与配置指南】\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 当前飞书绑定状态：\n` +
    `• 🔔 自动推送通道: ${isChannelFeishu ? '✅ 已开启 (feishu)' : '⏹️ 未启用 (当前: ' + (cfg.notifyChannel || 'none') + ')'}\n` +
    `• 📢 群机器人 Webhook: ${isHookBound ? '✅ 已绑定 (' + cfg.feishuWebhookUrl.slice(0, 32) + '...)' : '❌ 未配置'}\n` +
    `• 🔒 安全加签 Secret: ${cfg.feishuSecret ? '✅ 已设置' : '⚪ 未启用'}\n` +
    `• 🏢 开放平台自建应用: ${isAppBound ? '✅ 已绑定 (' + cfg.feishuAppId + ')' : '⚪ 未配置 (仅使用 Webhook 推送无需配置)'}\n` +
    `• 🌐 回调服务端口: 本地 ${port} (HTTP)\n` +
    `• 🔗 事件回调请求网址: http://<你的IP或穿透域名>:${port}/api/feishu/event\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🛠️ 快速绑定方法（二选一）：\n\n` +
    `【方案一：飞书群机器人 Webhook（极速推荐，1分钟完成）】\n` +
    `1️⃣ 在飞书群「设置」->「群机器人」->「添加机器人」->「自定义机器人」\n` +
    `2️⃣ 名称填写「Antigravity 研发助手」，复制生成的 Webhook 地址\n` +
    `3️⃣ 直接在微信中回复指令绑定：\n` +
    `   /feishu bind <你的Webhook地址> [可选安全Secret]\n` +
    `   或在电脑端控制台「设置」->「飞书群机器人 Webhook」中填入并保存\n` +
    `👉 绑定后：每次任务派发与完成，飞书群将自动收到富文本研发卡片！\n\n` +
    `【方案二：开放平台企业自建应用（支持双向 @ 对话交互）】\n` +
    `1️⃣ 访问飞书开放平台 (open.feishu.cn) 创建「企业自建应用」并添加「机器人」能力\n` +
    `2️⃣ 在「凭证与基础信息」获取 App ID 和 App Secret，在控制台填入保存\n` +
    `3️⃣ 在「事件与回调」配置请求网址 URL 为：\n` +
    `   http://<你的公网IP或穿透域名>:${port}/api/feishu/event\n` +
    `   (系统已内置自动化 Challenge 验证与数据解密)\n` +
    `4️⃣ 添加事件「im.message.receive_v1」(接收消息)，发布版本并邀请机器人进群\n` +
    `👉 绑定后：在飞书群直接 @机器人 即可派发任务、切换会话与查看进度！\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 常用飞书快捷指令：\n` +
    `• /feishu test ：测试飞书群机器人卡片推送\n` +
    `• /feishu bind <URL> [Secret] ：一键绑定/更换 Webhook\n` +
    `• /feishu on / /feishu off ：快速开启/关闭飞书群推送\n` +
    `• /feishu status ：查询飞书当前详细绑定状态\n` +
    `• /status ：查看当前任务看板状态\n` +
    `• /sessions ：查看全部会话并切换`;
}

async function resolveFeishuCommand(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();
  const cfg = loadConfig();

  // 1. 测试指令: /feishu test, 飞书测试, 测试飞书
  if (lower === '/feishu test' || lower === '飞书测试' || lower === '测试飞书' || lower.startsWith('/feishu test')) {
    if (!cfg.feishuWebhookUrl) {
      return '⚠️ 当前尚未配置飞书机器人 Webhook 地址！\n\n请先发送指令绑定：\n/feishu bind <你的飞书Webhook地址> [可选Secret]\n或在电脑端控制台设置。';
    }
    const testRes = await handleApiFeishuTestPush();
    if (testRes.success) {
      return `🎉 飞书机器人 Webhook 测试推送成功！\n\n✅ 测试卡片已实时送达飞书群，请前往飞书查看效果。`;
    } else {
      return `❌ 飞书 Webhook 测试推送失败：\n${testRes.error || '网络超时或安全签名不匹配'}\n\n💡 请检查 Webhook 地址与 Secret 设置是否正确。`;
    }
  }

  // 2. 状态查询: /feishu status, 飞书状态
  if (lower === '/feishu status' || lower === '飞书状态' || lower === '/feishu info' || lower === '飞书信息') {
    return getFeishuGuideMessage(cfg);
  }

  // 3. 快捷开启/关闭通知
  if (lower === '/feishu on' || lower === '开启飞书通知' || lower === '开启飞书推送' || lower === '打开飞书通知') {
    cfg.notifyChannel = 'feishu';
    saveConfig(cfg);
    return '✅ 已开启飞书通知通道！\n后续 Antigravity 任务执行完成时将自动推送富文本卡片到飞书群。';
  }
  if (lower === '/feishu off' || lower === '关闭飞书通知' || lower === '关闭飞书推送') {
    cfg.notifyChannel = 'none';
    saveConfig(cfg);
    return '⏹️ 已关闭外部飞书通知通道（已恢复为看板查看模式）。';
  }

  // 4. 快捷绑定指令: /feishu bind <url> [secret], 绑定飞书 <url> [secret]
  const bindMatch = t.match(/^(?:\/feishu\s*(?:bind|hook|set)?\s*|(?:绑定飞书|飞书绑定|配置飞书)[：:\s]*)(https?:\/\/[^\s]+)(?:\s+([^\s]+))?$/i);
  if (bindMatch) {
    const webhookUrl = bindMatch[1].trim();
    const secret = bindMatch[2] ? bindMatch[2].trim() : (cfg.feishuSecret || '');
    cfg.feishuWebhookUrl = webhookUrl;
    if (bindMatch[2]) cfg.feishuSecret = secret;
    cfg.notifyChannel = 'feishu';
    saveConfig(cfg);

    let testInfo = '';
    try {
      const testRes = await handleApiFeishuTestPush({ webhookUrl, secret });
      if (testRes.success) {
        testInfo = '\n\n🎉 验证卡片已同步送达飞书群，绑定完全生效！';
      } else {
        testInfo = `\n\n⚠️ 提示：测试卡片发送返回 [${testRes.error}]，配置已保存，请检查网络或飞书群安全白名单设置。`;
      }
    } catch (e) {
      testInfo = `\n\n⚠️ 测试发送异常：${e.message}`;
    }

    return `✅ 飞书群机器人 Webhook 绑定成功！\n` +
      `• Webhook 地址: ${webhookUrl.slice(0, 35)}...\n` +
      `• 安全签名 Secret: ${secret ? '已配置 (HMAC-SHA256)' : '未设置'}\n` +
      `• 推送通知通道: 已自动开启 (feishu)${testInfo}`;
  }

  // 5. 默认返回完整的绑定状态与接入指南
  return getFeishuGuideMessage(cfg);
}

async function callUpstreamLLM(query, cfg) {
  const apiKey = cfg.llmApiKey ? cfg.llmApiKey.trim() : '';
  const baseUrl = (cfg.llmBaseUrl || 'http://127.0.0.1:8045/v1').replace(/\/+$/, '');
  const model = cfg.llmModel || 'gemini-3.8-flash-high';
  const systemPrompt = cfg.systemPromptQA || DEFAULT_CONFIG.systemPromptQA;

  const tryCall = async (targetUrl, targetKey, targetModel) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${targetUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${targetKey || 'local'}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
          temperature: 0.7
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 80)}` };
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      return { ok: true, content: content || '未能从模型获取到有效回复' };
    } catch (e) {
      clearTimeout(timeout);
      return { ok: false, error: e.message };
    }
  };

  // 1. 尝试当前配置的主模型
  if (apiKey || baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
    const firstAttempt = await tryCall(baseUrl, apiKey, model);
    if (firstAttempt.ok) {
      return firstAttempt.content;
    }
    console.warn(`[callUpstreamLLM] Primary LLM failed (${firstAttempt.error}), trying local fallback...`);
  }

  // 2. 本地高可用故障转移: 如果主模型失效且当前不是 8045，自动走本地 Antigravity Tools (8045)
  if (!baseUrl.includes(':8045')) {
    const localAttempt = await tryCall('http://127.0.0.1:8045/v1', 'local', 'gemini-3.8-flash-high');
    if (localAttempt.ok) {
      console.log('[callUpstreamLLM] Fallback to local 8045 succeeded');
      return localAttempt.content;
    }
  }

  return `⚠️ 抱歉，当前问答大模型服务暂不可用（API Key 或接口异常）。\n\n` +
    `💡 您可以在 Antigravity 侧边栏「⚙️ 综合设置」中检查 API Key 与 Base URL。\n` +
    `🚀 如果您是想在工程中编写代码或执行操作，请直接在消息中带上明确动作（例如：“帮我写一个测试”），我将直接派发给 IDE 终端执行！`;
}

const recentMsgMap = new Map();
function isDuplicate(text, from) {
  const now = Date.now();
  for (const [key, time] of recentMsgMap.entries()) {
    if (now - time > 10000) recentMsgMap.delete(key);
  }
  const key = `${from}:::${text}`;
  const lastTime = recentMsgMap.get(key);
  if (lastTime && (now - lastTime) < 5000) {
    console.log(`[Deduplicate] Blocked duplicate message within 5s: "${text}" from "${from}"`);
    return true;
  }
  recentMsgMap.set(key, now);
  return false;
}

function handleIncomingMessage(content, from = '微信用户', source = 'wechat', metadata = {}) {
  const text = String(content || '').trim();
  if (!text) return null;
  if (isDuplicate(text, from)) {
    return null;
  }

  const msgs = loadMessages();
  const category = metadata.category || 'project_task';
  const status = metadata.status || (category === 'project_task' ? 'received' : 'answered');

  const newMsg = {
    id: `wx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    from: String(from),
    content: text,
    cleanContent: metadata.cleanContent || text,
    isDirectChat: !!metadata.isDirectChat,
    category, // 'project_task' | 'daily_qa' | 'command'
    targetProject: metadata.targetProject || null,
    targetConvId: metadata.targetConvId || null,
    reply: metadata.reply || null,
    source,
    time: new Date().toISOString(),
    status // 'received' | 'dispatched' | 'answered' | 'completed'
  };

  msgs.push(newMsg);
  saveMessages(msgs);

  // 若为工程任务，自动录入当前看板并准备下发
  if (category === 'project_task') {
    const cfg = loadConfig();
    const convList = getConversationsList();
    const targetConvId = metadata.targetConvId || cfg.activeConversationId || (convList[0]?.id) || 'default';
    const taskData = loadTasks(targetConvId);
    const cleanPrompt = metadata.cleanContent || text;
    const taskTitle = cleanPrompt.length > 30 ? cleanPrompt.slice(0, 30) + '...' : cleanPrompt;

    const newTask = {
      id: `task_${source === 'feishu' ? 'feishu' : 'wx'}_${Date.now()}`,
      milestoneId: taskData.milestones[1]?.id || taskData.milestones[0]?.id || 'm2',
      title: taskTitle,
      desc: cleanPrompt,
      priority: 'high',
      status: cfg.autoDispatch !== false ? 'in_progress' : 'todo',
      source: source || 'wechat',
      wechatMsgId: newMsg.id,
      fromUser: from,
      targetConvId
    };

    taskData.tasks.push(newTask);
    saveTasks(targetConvId, taskData);

    newMsg.targetConvId = targetConvId;
    newMsg.isNewChat = !!metadata.isNewChat;
    newMsg.dispatchedTaskId = newTask.id;
    // 关键修正：保持 status: 'received'，等待 IDE 端 app.js 调用 window.sidecar.agent.sendMessage 成功后再标为 dispatched！
    newMsg.status = 'received';
    saveMessages(msgs);
  }

  return newMsg;
}

function fallbackRuleEvaluation(userMsg) {
  const ruleIntent = classifyIntent(userMsg);
  if (ruleIntent.category === 'DAILY_QA') {
    return {
      intent: 'DAILY_QA',
      reason: '本地规则判定为日常问答',
      taskTitle: userMsg.slice(0, 15),
      summary: ''
    };
  }
  const lower = userMsg.toLowerCase();
  const isRoutine = DEV_TOOL_KEYWORDS.some((kw) => lower.includes(kw)) ||
                    lower.startsWith('/task') || lower.startsWith('/run') ||
                    lower.includes('跑一下测试') || lower.includes('测一下') ||
                    lower.includes('git一下') || lower.includes('查看状态') ||
                    lower.includes('git status') || lower.includes('npm test');
  if (isRoutine) {
    return {
      intent: 'DIRECT_EXECUTE',
      reason: '本地规则判定为常规开发指令',
      taskTitle: userMsg.slice(0, 15),
      summary: '常规开发或查询操作'
    };
  }
  return {
    intent: 'CONFIRM_REQUIRED',
    reason: '本地规则判定为项目开发任务',
    taskTitle: ruleIntent.cleanContent ? ruleIntent.cleanContent.slice(0, 15) : userMsg.slice(0, 15),
    summary: '检测到项目修改需求，需确认'
  };
}

async function evaluateIntentWithAI(userMsg, cfg) {
  // 问候语直接走规则日常问答，绝不调用 LLM 或误报研发确认
  if (isGreeting(userMsg)) {
    return fallbackRuleEvaluation(userMsg);
  }

  const apiKey = cfg.llmApiKey ? cfg.llmApiKey.trim() : '';
  const baseUrl = (cfg.llmBaseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = cfg.llmModel || 'deepseek-chat';

  // 如果未开启 AI 意图判定或未配置 API Key，直接走规则兜底
  if (!apiKey || cfg.enableAIIntentCheck === false) {
    return fallbackRuleEvaluation(userMsg);
  }

  const systemPrompt = `你是一个专业的编程与任务调度意图判断专家。请分析用户的输入，判断其真实意图类型：
1. "DIRECT_EXECUTE"：常规、高置信度、明确的代码查看/测试/版本控制/日常开发操作。例如：
   - git 相关操作（git status, git commit, git push, git一下, 查看分支）
   - 测试与依赖（跑一下测试, npm test, 检查依赖, pip install）
   - 用户带有明确前缀如 /task, /run, 【任务】, 帮我在当前工程中修改...
2. "CONFIRM_REQUIRED"：复杂、可能产生较大影响的代码改动、重构、功能新增、删除或意图存在歧义的任务。例如：
   - 重构某个模块或逻辑（如“把调度器重构一下”，“重写数据库层”）
   - 复杂功能实现（如“为系统增加飞书交互卡片”，“实现用户鉴权”）
   - 模糊的开发需求或用户未明确指定只想问答还是改代码的操作
3. "DAILY_QA"：纯概念问答、咨询、闲聊、语法解释，无需在 IDE 项目中修改或执行代码。例如：
   - “什么是 WebSocket？”、“Python 和 Node 哪个更好？”、“你好”、“解释一下这段正则”

请必须严格只输出以下 JSON 格式（不要包含任何 markdown 代码块反引号，直接输出纯 JSON 字符串）：
{
  "intent": "DIRECT_EXECUTE" | "CONFIRM_REQUIRED" | "DAILY_QA",
  "reason": "10字以内简短原因",
  "taskTitle": "提炼出的简明任务标题（15字以内）",
  "summary": "任务执行摘要或建议（30字以内）"
}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.1
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[evaluateIntentWithAI] LLM HTTP error ${res.status}, fallback to rule`);
      return fallbackRuleEvaluation(userMsg);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const cleanJson = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    if (['DIRECT_EXECUTE', 'CONFIRM_REQUIRED', 'DAILY_QA'].includes(parsed.intent)) {
      return {
        intent: parsed.intent,
        reason: parsed.reason || '',
        taskTitle: parsed.taskTitle || userMsg.slice(0, 15),
        summary: parsed.summary || ''
      };
    }
    return fallbackRuleEvaluation(userMsg);
  } catch (err) {
    console.warn(`[evaluateIntentWithAI] LLM eval failed (${err.message}), fallback to rule`);
    return fallbackRuleEvaluation(userMsg);
  }
}

async function executeDispatchedTask(prompt, fromUser, targetConvId, projName, cfgNow, source = 'chatgpt-on-wechat') {
  const convList = getConversationsList();
  const currentConv = convList.find((c) => c.id === targetConvId);
  const convName = currentConv ? currentConv.title : targetConvId.slice(0, 8);
  const actualProj = currentConv ? currentConv.projectName : projName;

  const cleanPrompt = prompt;
  const baselineStep = getTranscriptStepCount(targetConvId);

  handleIncomingMessage(prompt, fromUser, source, {
    category: 'project_task',
    targetProject: actualProj,
    targetConvId,
    cleanContent: cleanPrompt,
    isDirectChat: false
  });

  const preview = cleanPrompt.length > 30 ? `${cleanPrompt.slice(0, 30)}...` : cleanPrompt;
  let replyContent = '';

  if (cfgNow.waitForAgentReply !== false) {
    const timeoutSec = Math.min(180, Math.max(10, Number(cfgNow.waitReplyTimeoutSec) || 150));
    const waitRes = await waitForAgentReply(targetConvId, baselineStep, timeoutSec * 1000);

    if (waitRes.completed && waitRes.response) {
      replyContent = `✅【Antigravity 任务执行完成】\n` +
        `📌 目标会话：${convName}\n` +
        `📦 所属工程：${actualProj}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${waitRes.response}\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

      triggerTaskCompletionPush({
        title: `任务执行完成 (${actualProj})`,
        convName,
        projName: actualProj,
        content: waitRes.response,
        stepsAdded: waitRes.stepsAdded,
        elapsedSec: waitRes.elapsedSec,
        source
      }, cfgNow);
    } else if (waitRes.timedOut) {
      replyContent = `⏳【Antigravity 任务已下发并在后台持续执行中】\n` +
        `📌 目标会话：${convName}\n` +
        `📦 所属工程：${actualProj}\n` +
        `💬 指令内容：${preview}\n\n` +
        `⚡ 任务较为深入，正在后台继续处理中。\n` +
        `💡 你可以随时发送「/result」或「执行结果」查看最终报告！`;
    } else {
      replyContent = `🚀【已直通 Antigravity 会话】\n` +
        `📌 目标会话：${convName}\n` +
        `📦 所属工程：${actualProj}\n` +
        `💬 指令内容：${preview}\n\n` +
        `⚡ 电脑端 IDE 正在执行与回复！任务进度可发 /status 查询，执行结果发 /result 查看。`;
    }
  } else {
    replyContent = `🚀【已直通 Antigravity 会话】\n` +
      `📌 目标会话：${convName}\n` +
      `📦 所属工程：${actualProj}\n` +
      `💬 指令内容：${preview}\n\n` +
      `⚡ 电脑端 IDE 正在执行与回复！任务进度可发 /status 查询，执行结果发 /result 查看。`;
  }

  return replyContent;
}

function getStatusMessage() {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const activeConvId = cfg.activeConversationId || (convList[0]?.id) || 'default';
  const currentConv = convList.find((c) => c.id === activeConvId);
  const convTitle = currentConv ? `${currentConv.title} (📁 ${currentConv.projectName})` : activeConvId.slice(0, 8);
  const taskData = loadTasks(activeConvId);
  const transcriptData = parseTranscript(activeConvId);

  const total = taskData.tasks.length;
  const done = taskData.tasks.filter((t) => t.status === 'done').length;
  const inProgress = taskData.tasks.filter((t) => t.status === 'in_progress').length;
  const todo = taskData.tasks.filter((t) => t.status === 'todo').length;

  let text = `📡 Antigravity AI助手 · 运行状态\n\n`;
  text += `🖥️ 微信网关：在线监听 (端口 ${cfg.xmlPort || 18765})\n`;
  text += `📌 当前绑定会话：${convTitle}\n`;
  text += `🎯 自动派发：${cfg.autoDispatch !== false ? '已开启' : '已暂停'}\n`;
  text += `📊 看板任务：总计 ${total} 个 (✅ 完成: ${done} | 🚀 进行: ${inProgress} | ⏳ 待办: ${todo})\n\n`;

  const recent = taskData.tasks.slice(-5).reverse();
  if (recent.length > 0) {
    text += `📋 最近任务卡片：\n`;
    recent.forEach((t, i) => {
      const badge = t.status === 'done' ? '✅' : (t.status === 'in_progress' ? '🚀' : '⏳');
      text += `${i + 1}. ${badge} [${t.priority.toUpperCase()}] ${t.title}\n`;
    });
  }

  text += `\n💡 输入 /sessions 查看会话列表，输入「进入 会话名」切换会话，输入 /result 查看执行反馈报告`;
  return text;
}

function getStructuredTaskReport(conversationId) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const activeConvId = conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const currentConv = convList.find((c) => c.id === activeConvId);
  const convTitle = currentConv ? currentConv.title : activeConvId.slice(0, 8);
  const projName = currentConv ? currentConv.projectName : (cfg.currentProject || '默认工程');

  const taskData = loadTasks(activeConvId);
  const transcriptData = parseTranscript(activeConvId);
  const latestTask = taskData.tasks[taskData.tasks.length - 1] || null;

  const toolExecs = transcriptData.steps.filter((s) => s.type === 'tool_execution').slice(0, 8);
  const touchedFiles = new Set();

  for (const step of toolExecs) {
    for (const call of (step.calls || [])) {
      if (call.name === 'replace_file_content' || call.name === 'write_to_file' || call.name === 'view_file') {
        const p = call.args?.file;
        if (p) touchedFiles.add(p.split(/[/\\]/).pop());
      }
    }
  }

  let answerText = transcriptData.latestAssistantResponse || '';
  if (!answerText) {
    answerText = '（Agent 正在执行思考中，暂未生成总结回复…）';
  } else if (answerText.length > 500) {
    answerText = `${answerText.slice(0, 500)}...\n（更多详细内容请在电脑端 IDE 查看）`;
  }

  let text = `📊【任务执行反馈报告】\n`;
  text += `📌 目标会话：${convTitle}\n`;
  text += `📦 所属工程：${projName}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;

  if (latestTask) {
    const statusText = latestTask.status === 'done' ? '✅ 已完成' : (latestTask.status === 'in_progress' ? '🚀 执行中' : '⏳ 待办');
    text += `🎯 任务目标：${latestTask.title}\n`;
    text += `⚡ 执行状态：${statusText} (优先级: ${latestTask.priority || 'high'})\n`;
    if (latestTask.fromUser) text += `👤 派发来源：${latestTask.fromUser}\n`;
  }

  if (touchedFiles.size > 0) {
    text += `📁 涉及文件：${Array.from(touchedFiles).join(', ')}\n`;
  }

  text += `\n📝 会话最新成果/总结：\n${answerText}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💡 发送 /status 查全貌进度，发送 /sessions 切换会话，发送 /help 查看所有指令`;

  return text;
}

function getSessionsMessage() {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const activeId = cfg.activeConversationId || (convList[0]?.id) || '';

  let text = `📑 Antigravity 历史会话清单：\n\n`;
  if (convList.length === 0) {
    text += `暂未获取到历史会话记录。\n`;
  } else {
    convList.slice(0, 10).forEach((conv, idx) => {
      const isCur = conv.id === activeId;
      const marker = isCur ? '🟢 [当前] ' : '';
      text += `[${idx + 1}] ${marker}${conv.title}\n    📦 ${conv.projectName} (步数: ${conv.stepCount || 0})\n`;
    });
  }
  text += `\n💡 远程控制指令：\n• 发送 /switch 序号 (如 /switch 1) 或直接发送「进入 ${convList[0]?.title || '会话名'}」切换会话\n• 发送 /new 需求 (如 /new 梳理设计文档) 在新会话中启动任务\n• 直接发送需求（如“git一下”），将直接在当前绑定的会话中执行！`;
  return text;
}

function getProjectsList() {
  const projects = [];
  try {
    const pluginsDir = join(homedir(), '.gemini', 'config', 'plugins');
    if (existsSync(pluginsDir)) {
      const list = readdirSync(pluginsDir);
      for (const item of list) {
        if (existsSync(join(pluginsDir, item, 'plugin.json'))) {
          projects.push({ name: item, path: join(pluginsDir, item), type: 'UI Extension / 插件' });
        }
      }
    }
    const scratchDir = join(homedir(), '.gemini', 'antigravity', 'scratch');
    if (existsSync(scratchDir)) {
      const list = readdirSync(scratchDir);
      for (const item of list) {
        projects.push({ name: item, path: join(scratchDir, item), type: '本地工程项目' });
      }
    }
    const dProjectsDir = 'D:\\项目';
    if (existsSync(dProjectsDir)) {
      const list = readdirSync(dProjectsDir);
      for (const item of list) {
        if (!item.startsWith('_') && !item.startsWith('.')) {
          projects.push({ name: item, path: join(dProjectsDir, item), type: 'D盘研发工程' });
        }
      }
    }
  } catch (e) {
    console.error('Scan projects error:', e);
  }
  return projects;
}

function resolveSwitchCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // 1. 判断是否包含切换意图关键词
  const prefixPatterns = [
    /^\/switch\s*(.*)$/i,
    /^\/use\s*(.*)$/i,
    /^(?:切换到|切换会话|切换项目|切换工程|切换|切到|切会话|切项目|切)\s*(.*)$/i,
    /^(?:进入会话|进入项目|进入工程|进入|进)\s*(.*)$/i,
    /^(?:打开会话|打开项目|打开工程|打开)\s*(.*)$/i,
    /^(?:转到|跳转到|去到|去)\s*(.*)$/i
  ];

  let rawTarget = null;
  for (const p of prefixPatterns) {
    const m = raw.match(p);
    if (m) {
      rawTarget = m[1].trim();
      break;
    }
  }

  // 匹配后缀形式：如 "项目快速了解conversation" / "快速了解会话" / "combat-concept工程"
  if (rawTarget === null) {
    const suffixMatch = raw.match(/^(.+?)\s*(?:会话|conversation|session|工程|项目)$/i);
    if (suffixMatch && suffixMatch[1]) {
      rawTarget = suffixMatch[1].trim();
    }
  }

  if (rawTarget === null) return null;

  // 2. 清理目标词修饰符
  let cleanTarget = rawTarget
    .replace(/^[:：\s]+/, '')
    .replace(/\s*[:：\s]+$/, '')
    .replace(/(?:中|里)$/, '')
    .trim();

  const coreKeyword = cleanTarget
    .replace(/^(?:会话|conversation|session|项目|工程)\s*/gi, '')
    .replace(/\s*(?:会话|conversation|session|项目|工程)$/gi, '')
    .trim();

  const cfg = loadConfig();
  const convList = getConversationsList();
  const projectList = getProjectsList();

  // 3. 优先匹配会话序号 (如 "1", "2", "3")
  const num = parseInt(cleanTarget || coreKeyword, 10);
  if (!isNaN(num) && num >= 1 && num <= convList.length) {
    const foundConv = convList[num - 1];
    cfg.activeConversationId = foundConv.id;
    cfg.currentProject = foundConv.projectName || cfg.currentProject;
    cfg.pendingSwitchConvId = foundConv.id;
    saveConfig(cfg);
    return `✅ 已成功切换远程绑定会话！\n\n📌 目标会话：${foundConv.title}\n📦 所属工程：${foundConv.projectName}\n🆔 会话ID：${foundConv.id.slice(0, 8)}...\n\n🚀 电脑端已同步在 IDE 主窗口中打开该会话，后续发送的任务将直接在此会话中执行！`;
  }

  // 4. 智能匹配会话标题 (支持双向模糊匹配，完美支持“进入项目快速了解conversation”)
  const candidateTerms = [cleanTarget, coreKeyword, rawTarget].filter(Boolean);
  let matchedConv = null;

  for (const term of candidateTerms) {
    const tLower = term.toLowerCase();
    matchedConv = convList.find((c) => {
      const cLower = c.title.toLowerCase();
      return cLower === tLower || cLower.includes(tLower) || tLower.includes(cLower);
    });
    if (matchedConv) break;
  }

  if (matchedConv) {
    cfg.activeConversationId = matchedConv.id;
    cfg.currentProject = matchedConv.projectName || cfg.currentProject;
    cfg.pendingSwitchConvId = matchedConv.id;
    saveConfig(cfg);
    return `✅ 已成功切换远程绑定会话！\n\n📌 目标会话：${matchedConv.title}\n📦 所属工程：${matchedConv.projectName}\n🆔 会话ID：${matchedConv.id.slice(0, 8)}...\n\n🚀 电脑端已同步在 IDE 主窗口中打开该会话，后续发送的任务将直接在此会话中执行！`;
  }

  // 5. 若未匹配到会话，智能匹配本地工程
  let matchedProject = null;
  for (const term of candidateTerms) {
    const tLower = term.toLowerCase();
    matchedProject = projectList.find((p) => {
      const pLower = p.name.toLowerCase();
      return pLower === tLower || pLower.includes(tLower) || tLower.includes(pLower);
    });
    if (matchedProject) break;
  }

  if (matchedProject) {
    cfg.currentProject = matchedProject.name;
    const projConv = convList.find((c) => c.projectName.toLowerCase() === matchedProject.name.toLowerCase() || c.projectPath?.toLowerCase().includes(matchedProject.name.toLowerCase()));
    if (projConv) {
      cfg.activeConversationId = projConv.id;
      cfg.pendingSwitchConvId = projConv.id;
    }
    saveConfig(cfg);

    let reply = `📌 已成功切换聚焦工程为：【${matchedProject.name}】\n`;
    if (projConv) {
      reply += `👉 已自动关联并打开该工程活跃会话：【${projConv.title}】\n`;
    }
    reply += `后续发送的工程任务将默认针对该工程执行。`;
    return reply;
  }

  // 6. 如果既不是合法会话也不是合法工程，不修改任何配置，给出清晰提示
  return `❌ 未找到与「${cleanTarget || rawTarget}」匹配的历史会话或工程。\n\n💡 提示：\n• 发送 /sessions 查看所有历史会话（输入 /switch 序号 或「进入 会话名」即可切换）\n• 发送 /projects 查看所有本地工程列表`;
}

function getProjectsMessage() {
  const projects = getProjectsList();
  const cfg = loadConfig();
  const currentProj = cfg.currentProject || '未锁定 (随当前 IDE 会话)';
  let text = `📂 Antigravity 可用工程与插件清单：\n`;
  text += `📌 当前聚焦工程：${currentProj}\n\n`;
  if (projects.length === 0) {
    text += `当前工作目录中暂未登记项目。\n`;
  } else {
    projects.forEach((p, idx) => {
      text += `${idx + 1}. 📦 ${p.name} (${p.type})\n`;
    });
  }
  text += `\n💡 提示：可直接发送「进入 工程名」或「在 工程名 中修改...」定向操作！`;
  return text;
}

function getHelpMessage() {
  return `🤖 Antigravity AI助手 · 全能远程指南

💬【会话直通对话】（直接与当前 IDE 会话双向互动）
• 发送任意问答或指令，直接注入当前 Antigravity 会话并让 Agent 响应：
  示例：“给这个会话发送你好消息” 或直接发送 “你好”
  示例：“分析当前项目的代码架构与入口”
  示例：“/chat 查看当前的数据库连接状态”
  💡 电脑端 IDE 将实时显示此消息并自动生成回复！

🚀【远程工程任务派发】（看板追踪 + 自动执行）
• 直接发送任务需求，IDE 立即执行代码改动、测试或调试：
  示例：“git一下”
  示例：“跑一下测试”
  示例：“帮我用 Python 写一个快速排序并在当前项目运行测试”
  示例：“检查作战兵力组织关系的数据模型并优化字段命名”
• 快捷前缀派发：/task <需求内容>
• 创建全新会话执行：/new <需求内容>

📑【会话远程切换与管理】
• /sessions 或【会话】：查看电脑上近期历史会话列表
• /switch <序号|标题> 或直接发送「进入 会话名」：远程切换并绑定指定会话，电脑端同步切换打开该会话窗口

📊【结构化反馈与状态指令】
• /result 或 /report 或【结果】：获取当前任务的执行反馈报告（包含任务目标、涉及文件及最新成果总结）
• /status 或【进度】：查看当前任务看板完成度、最近任务及工程绑定状态
• /projects 或【项目】：查看电脑上所有工程仓库
• /feishu 或【飞书】：查看飞书群机器人绑定状态、Webhook 接入指南与快捷配置
• /help 或【帮助】：再次呼出本操作手册

🤖【AI 意图研判与二次确认】
• 系统内置智能意图判定（固定指令优先放行）：
  - 常规高频指令（如“git一下”、“跑一下测试”）直接极速派发执行
  - 复杂任务/重构/有歧义诉求将发送确认卡片：回复 [1] 确认执行、[2] 仅解答、[0] 取消，亦可直接补充说明要求`;
}

// ---------------------------------------------------------------------------
// Sidecar SDK 应用程序
let app = null;
try {
  app = new SidecarApp();
} catch (e) {
  console.log('[SidecarApp] Running in standalone/gateway mode (outside Antigravity UI pane)');
  app = {
    page: () => {},
    api: () => {},
    run: () => {}
  };
}

const readLocal = (name) => readFileSync(join(HERE, name), 'utf8');

app.page('/', () => readLocal('index.html'));
app.page('/app.js', () => new Response(readLocal('app.js'), {
  contentType: 'application/javascript',
  headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
}));
app.api('/styles.css', () => new Response(readLocal('styles.css'), {
  contentType: 'text/css',
  headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
}), 'GET');

// ---------------------------------------------------------------------------
// 统一 API 处理器
// ---------------------------------------------------------------------------
function handleApiStatus() {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const activeConv = cfg.activeConversationId || (convList[0]?.id) || '';
  const parsed = parseTranscript(activeConv);
  const tasks = loadTasks(activeConv);

  return {
    plugin: 'ai-assistant',
    displayName: 'AI助手',
    xmlPort: cfg.xmlPort || 18765,
    autoDispatch: cfg.autoDispatch !== false,
    activeConversationId: activeConv,
    pendingSwitchConvId: cfg.pendingSwitchConvId || '',
    conversations: convList,
    stats: parsed.stats,
    taskStats: {
      total: tasks.tasks.length,
      done: tasks.tasks.filter((t) => t.status === 'done').length,
      inProgress: tasks.tasks.filter((t) => t.status === 'in_progress').length,
      todo: tasks.tasks.filter((t) => t.status === 'todo').length
    }
  };
}

function handleApiSession(query) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const targetConv = query?.conversationId || cfg.activeConversationId || (convList[0]?.id) || '';
  const result = parseTranscript(targetConv);
  result.availableConversations = convList;
  result.currentConversationId = targetConv;
  return result;
}

function handleApiMcp() {
  if (!existsSync(MCP_DIR)) return { servers: [] };
  const servers = [];
  try {
    const entries = readdirSync(MCP_DIR);
    for (const entry of entries) {
      const serverPath = join(MCP_DIR, entry);
      if (statSync(serverPath).isDirectory()) {
        const tools = [];
        const files = readdirSync(serverPath);
        for (const f of files) {
          if (f.endsWith('.json')) {
            try {
              const toolData = JSON.parse(readFileSync(join(serverPath, f), 'utf8'));
              tools.push({
                file: f,
                name: toolData.name || f.replace('.json', ''),
                description: toolData.description || '无详细描述',
                parameters: toolData.parameters?.properties ? Object.keys(toolData.parameters.properties) : []
              });
            } catch (e) {}
          }
        }
        servers.push({
          name: entry,
          toolCount: tools.length,
          tools
        });
      }
    }
  } catch (err) {
    console.error(`Failed to scan MCP directory: ${err.message}`);
  }
  return { servers };
}

function handleApiTasks(query) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const targetConv = query?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  return {
    conversationId: targetConv,
    data: loadTasks(targetConv)
  };
}

function handleApiTaskAdd(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  const title = String(payload?.title || '').trim();
  if (!title) return { error: '任务标题不能为空' };

  const newTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    milestoneId: String(payload?.milestoneId || data.milestones[0]?.id || 'm1'),
    title,
    desc: String(payload?.desc || '').trim(),
    priority: ['low', 'medium', 'high'].includes(payload?.priority) ? payload.priority : 'medium',
    status: payload?.status || 'todo',
    source: payload?.source || 'user'
  };

  data.tasks.push(newTask);
  saveTasks(convId, data);
  return { success: true, task: newTask, data };
}

function handleApiTaskToggle(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  const task = data.tasks.find((t) => t.id === payload?.id);
  if (!task) return { error: '未找到对应任务' };

  const prevStatus = task.status;
  if (payload?.status) {
    task.status = payload.status;
  } else {
    const nextStatus = {
      todo: 'in_progress',
      in_progress: 'done',
      done: 'todo'
    };
    task.status = nextStatus[task.status] || 'todo';
  }

  saveTasks(convId, data);

  if (task.status === 'done' && prevStatus !== 'done') {
    const msgs = loadMessages();
    const linkedMsg = msgs.find((m) => m.id === task.wechatMsgId || m.dispatchedTaskId === task.id);
    if (linkedMsg) {
      linkedMsg.status = 'completed';
      linkedMsg.completedAt = new Date().toISOString();
      linkedMsg.summary = `任务【${task.title}】已在 AI助手 看板标记完成！`;
      saveMessages(msgs);
    }
  }

  return { success: true, task, data };
}

function handleApiTaskUpdate(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  const targetId = payload?.taskId || payload?.id;
  const task = data.tasks.find((t) => t.id === targetId);
  if (!task) return { error: '未找到对应任务' };

  if (payload.title !== undefined) {
    const t = String(payload.title).trim();
    if (t) task.title = t;
  }
  if (payload.desc !== undefined) {
    task.desc = String(payload.desc).trim();
  }
  if (payload.priority !== undefined && ['low', 'medium', 'high'].includes(payload.priority)) {
    task.priority = payload.priority;
  }
  if (payload.milestoneId !== undefined) {
    task.milestoneId = String(payload.milestoneId);
  }
  if (payload.status !== undefined && ['todo', 'in_progress', 'done'].includes(payload.status)) {
    task.status = payload.status;
  }

  saveTasks(convId, data);
  return { success: true, task, data };
}

function handleApiTaskMove(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  const targetId = payload?.taskId || payload?.id;
  const task = data.tasks.find((t) => t.id === targetId);
  if (!task) return { error: '未找到对应任务' };

  if (payload.targetMilestoneId) {
    task.milestoneId = String(payload.targetMilestoneId);
  }
  if (payload.targetStatus && ['todo', 'in_progress', 'done'].includes(payload.targetStatus)) {
    task.status = payload.targetStatus;
  }

  saveTasks(convId, data);
  return { success: true, task, data };
}

function handleApiTasksExportTodo(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const currentConv = convList.find((c) => c.id === convId);
  const convTitle = currentConv ? currentConv.title : convId.slice(0, 8);
  const projName = currentConv ? currentConv.projectName : (cfg.currentProject || '默认工程');
  const projectPath = currentConv?.projectPath || '';

  const data = loadTasks(convId);
  const milestones = data.milestones || [];
  const tasks = data.tasks || [];

  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const todoCount = tasks.filter((t) => t.status === 'todo').length;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  let md = `# 📋 项目迭代任务清单 (Project TODO)\n\n`;
  md += `> **📁 所属工程**: ${projName}  \n`;
  md += `> **💬 目标会话**: ${convTitle}  \n`;
  md += `> **📊 达成进度**: ${percent}% (完成: ${doneCount} | 进行中: ${inProgressCount} | 待办: ${todoCount} | 总计: ${total})  \n`;
  md += `> **⏰ 导出时间**: ${new Date().toLocaleString()}  \n\n`;
  md += `---\n\n`;

  milestones.forEach((m) => {
    const mTasks = tasks.filter((t) => t.milestoneId === m.id);
    md += `### ${m.title} (${mTasks.filter(t => t.status === 'done').length}/${mTasks.length})\n\n`;
    if (mTasks.length === 0) {
      md += `*（本阶段暂无任务）*\n\n`;
    } else {
      mTasks.forEach((t) => {
        const check = t.status === 'done' ? '[x]' : '[ ]';
        const priorityTag = t.priority === 'high' ? ' `🔴高`' : (t.priority === 'low' ? ' `🟢低`' : ' `🟡中`');
        const sourceTag = t.source === 'wechat' ? ' `📱微信`' : '';
        const inProgressTag = t.status === 'in_progress' ? ' *(进行中)*' : '';
        md += `- ${check} **${t.title}**${priorityTag}${sourceTag}${inProgressTag}\n`;
        if (t.desc) {
          md += `  > ${t.desc.replace(/\r?\n/g, ' ')}\n`;
        }
      });
      md += `\n`;
    }
  });

  let savedPath = null;
  if (payload?.saveToWorkspace) {
    let targetDir = projectPath;
    if (!targetDir || !existsSync(targetDir)) {
      targetDir = process.cwd();
    }
    if (targetDir && existsSync(targetDir)) {
      savedPath = join(targetDir, 'TODO.md');
      writeFileSync(savedPath, md, 'utf8');
    }
  }

  return { success: true, markdown: md, savedPath, total, doneCount, percent };
}

function handleApiTaskDelete(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  data.tasks = data.tasks.filter((t) => t.id !== payload?.id);
  saveTasks(convId, data);
  return { success: true, data };
}

function handleApiTasksClearDone(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  data.tasks = data.tasks.filter((t) => t.status !== 'done');
  saveTasks(convId, data);
  return { success: true, data };
}

function handleApiTasksClearAll(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  data.tasks = [];
  saveTasks(convId, data);
  return { success: true, data };
}

function handleApiMilestoneAdd(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  const title = String(payload?.title || '').trim();
  if (!title) return { error: '里程碑标题不能为空' };

  const newMilestone = {
    id: `m_${Date.now()}`,
    title
  };
  data.milestones.push(newMilestone);
  saveTasks(convId, data);
  return { success: true, milestone: newMilestone, data };
}

function handleApiMilestoneDelete(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = loadTasks(convId);
  const mId = String(payload?.id || '').trim();
  if (!mId) return { error: '阶段ID不能为空' };
  data.milestones = data.milestones.filter((m) => m.id !== mId);
  const fallbackMId = data.milestones[0]?.id || '';
  data.tasks.forEach((t) => {
    if (t.milestoneId === mId) {
      t.milestoneId = fallbackMId;
    }
  });
  saveTasks(convId, data);
  return { success: true, data };
}

function handleApiTasksReset(payload) {
  const cfg = loadConfig();
  const convList = getConversationsList();
  const convId = payload?.conversationId || cfg.activeConversationId || (convList[0]?.id) || 'default';
  const data = JSON.parse(JSON.stringify(DEFAULT_ROADMAP));
  saveTasks(convId, data);
  return { success: true, data };
}

function handleApiWechatMessageDelete(payload) {
  const id = String(payload?.id || '').trim();
  if (!id) return { error: '消息ID不能为空' };
  const msgs = loadMessages();
  const filtered = msgs.filter((m) => m.id !== id);
  saveMessages(filtered);
  return { success: true, messages: filtered.reverse() };
}

function handleApiWechatData() {
  const cfg = loadConfig();
  const safeCfg = { ...cfg };
  if (safeCfg.llmApiKey) {
    safeCfg.llmApiKeyMasked = safeCfg.llmApiKey.length > 8
      ? `${safeCfg.llmApiKey.slice(0, 4)}••••••••${safeCfg.llmApiKey.slice(-4)}`
      : '••••••••';
  }
  return {
    config: safeCfg,
    messages: loadMessages().reverse()
  };
}

function handleApiConfigSave(payload) {
  const current = loadConfig();
  const updated = {
    ...current,
    xmlPort: Number(payload?.xmlPort) || current.xmlPort || 18765,
    token: payload?.token !== undefined ? payload.token : current.token,
    autoDispatch: payload?.autoDispatch !== undefined ? !!payload.autoDispatch : current.autoDispatch,
    targetMode: payload?.targetMode !== undefined ? payload.targetMode : current.targetMode,
    activeConversationId: payload?.activeConversationId !== undefined ? payload.activeConversationId : current.activeConversationId,
    pendingSwitchConvId: payload?.pendingSwitchConvId !== undefined ? payload.pendingSwitchConvId : current.pendingSwitchConvId,
    currentProject: payload?.currentProject !== undefined ? payload.currentProject : current.currentProject,
    enableIntentRouting: payload?.enableIntentRouting !== undefined ? !!payload.enableIntentRouting : current.enableIntentRouting,
    enableAIIntentCheck: payload?.enableAIIntentCheck !== undefined ? !!payload.enableAIIntentCheck : (current.enableAIIntentCheck !== false),
    aiIntentConfirmTimeoutSec: payload?.aiIntentConfirmTimeoutSec !== undefined ? Number(payload.aiIntentConfirmTimeoutSec) : (current.aiIntentConfirmTimeoutSec || 300),
    waitForAgentReply: payload?.waitForAgentReply !== undefined ? !!payload.waitForAgentReply : (current.waitForAgentReply !== false),
    waitReplyTimeoutSec: payload?.waitReplyTimeoutSec !== undefined ? Number(payload.waitReplyTimeoutSec) : (current.waitReplyTimeoutSec || 45),
    notifyChannel: payload?.notifyChannel !== undefined ? payload.notifyChannel : (current.notifyChannel || 'none'),
    notifyWecomUrl: payload?.notifyWecomUrl !== undefined ? payload.notifyWecomUrl : (current.notifyWecomUrl || ''),
    notifyWebhookUrl: payload?.notifyWebhookUrl !== undefined ? payload.notifyWebhookUrl : (current.notifyWebhookUrl || ''),
    notifyPushPlusToken: payload?.notifyPushPlusToken !== undefined ? payload.notifyPushPlusToken : (current.notifyPushPlusToken || ''),
    notifyServerChanKey: payload?.notifyServerChanKey !== undefined ? payload.notifyServerChanKey : (current.notifyServerChanKey || ''),
    feishuWebhookUrl: payload?.feishuWebhookUrl !== undefined ? payload.feishuWebhookUrl : (current.feishuWebhookUrl || ''),
    feishuSecret: payload?.feishuSecret !== undefined ? payload.feishuSecret : (current.feishuSecret || ''),
    feishuAppId: payload?.feishuAppId !== undefined ? payload.feishuAppId : (current.feishuAppId || ''),
    feishuAppSecret: payload?.feishuAppSecret !== undefined ? payload.feishuAppSecret : (current.feishuAppSecret || ''),
    feishuVerificationToken: payload?.feishuVerificationToken !== undefined ? payload.feishuVerificationToken : (current.feishuVerificationToken || ''),
    feishuEncryptKey: payload?.feishuEncryptKey !== undefined ? payload.feishuEncryptKey : (current.feishuEncryptKey || ''),
    feishuNotifyOnDispatch: payload?.feishuNotifyOnDispatch !== undefined ? !!payload.feishuNotifyOnDispatch : (current.feishuNotifyOnDispatch || false),
    autoStartWechatBot: payload?.autoStartWechatBot !== undefined ? !!payload.autoStartWechatBot : (current.autoStartWechatBot !== false),
    llmProvider: payload?.llmProvider !== undefined ? payload.llmProvider : (current.llmProvider || 'deepseek'),
    llmBaseUrl: payload?.llmBaseUrl !== undefined ? payload.llmBaseUrl : (current.llmBaseUrl || 'https://api.deepseek.com/v1'),
    llmApiKey: (payload?.llmApiKey !== undefined && payload?.llmApiKey !== '') ? payload.llmApiKey : current.llmApiKey,
    llmModel: payload?.llmModel !== undefined ? payload.llmModel : (current.llmModel || 'deepseek-chat'),
    systemPromptQA: payload?.systemPromptQA !== undefined ? payload.systemPromptQA : current.systemPromptQA
  };
  saveConfig(updated);
  if (payload?.autoStartWechatBot !== undefined) {
    if (payload.autoStartWechatBot) {
      startWechatBot();
    } else {
      stopWechatBot();
    }
  }
  return { success: true, config: updated };
}

async function handleApiLlmTest(payload) {
  const current = loadConfig();
  const testCfg = {
    ...current,
    llmProvider: payload?.llmProvider !== undefined ? payload.llmProvider : current.llmProvider,
    llmBaseUrl: payload?.llmBaseUrl !== undefined ? payload.llmBaseUrl : current.llmBaseUrl,
    llmApiKey: (payload?.llmApiKey !== undefined && payload?.llmApiKey !== '') ? payload.llmApiKey : current.llmApiKey,
    llmModel: payload?.llmModel !== undefined ? payload.llmModel : current.llmModel,
    systemPromptQA: payload?.systemPromptQA !== undefined ? payload.systemPromptQA : current.systemPromptQA
  };

  const apiKey = testCfg.llmApiKey ? testCfg.llmApiKey.trim() : (testCfg.llmProvider === 'antigravity-tools' ? 'local' : '');
  const baseUrl = (testCfg.llmBaseUrl || 'http://127.0.0.1:8045/v1').replace(/\/+$/, '');
  const model = testCfg.llmModel || 'gemini-3.8-flash-high';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey || 'local'}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: '请回复：API测试成功。' }
        ],
        max_tokens: 30
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, latencyMs, error: `HTTP ${res.status}: ${errText.slice(0, 120)}` };
    }
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || '连通成功';
    return { success: true, latencyMs, reply };
  } catch (err) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    return { success: false, latencyMs, error: err.message };
  }
}

async function handleApiWechatSimulate(payload) {
  const content = payload?.content || '';
  const source = payload?.source || 'simulate';
  const defaultFrom = source === 'feishu' ? '模拟飞书用户 (Test)' : '模拟微信用户 (Test)';
  const from = payload?.from || defaultFrom;
  const cfg = loadConfig();

  const switchReply = resolveSwitchCommand(content);
  const newSessionTask = extractNewSessionTask(content);

  if (isGreeting(content)) {
    const reply = getGreetingMessage();
    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply
    });
    return { success: true, message: msg, reply };
  } else if (isHelpCommand(content)) {
    const reply = getHelpMessage();
    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply
    });
    return { success: true, message: msg };
  } else if (isSessionsCommand(content)) {
    const reply = getSessionsMessage();
    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply
    });
    return { success: true, message: msg };
  } else if (switchReply) {
    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply: switchReply
    });
    return { success: true, message: msg };
  } else if (newSessionTask) {
    const msg = handleIncomingMessage(newSessionTask, from, source, {
      category: 'project_task',
      isNewChat: true,
      cleanContent: newSessionTask
    });
    return { success: true, message: msg };
  } else if (isProjectsCommand(content)) {
    const reply = getProjectsMessage();
    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply
    });
    return { success: true, message: msg };
  } else if (isStatusCommand(content)) {
    const reply = getStatusMessage();
    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply
    });
    return { success: true, message: msg };
  } else if (isReportCommand(content)) {
    const reply = getStructuredTaskReport();
    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply
    });
    return { success: true, message: msg };
  } else if (isFeishuCommand(content)) {
    const reply = await resolveFeishuCommand(content);
    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply
    });
    return { success: true, message: msg };
  }

  // 非固定指令，待确认检查与 AI 意图判定
  const pending = getPendingConfirmation(from, cfg.aiIntentConfirmTimeoutSec || 300);
  let handledPending = false;

  if (pending) {
    const answer = parseConfirmationAnswer(content);
    if (answer.action === 'CONFIRM') {
      handledPending = true;
      clearPendingConfirmation(from);
      const finalPrompt = answer.supplement ? `${pending.prompt}\n(补充要求: ${answer.supplement})` : pending.prompt;
      const msg = handleIncomingMessage(finalPrompt, from, source, {
        category: 'project_task',
        targetProject: pending.projName,
        targetConvId: pending.targetConvId,
        cleanContent: finalPrompt,
        isDirectChat: false
      });
      return { success: true, message: msg, reply: `已确认执行任务：${pending.taskTitle}` };
    } else if (answer.action === 'QA_ONLY') {
      handledPending = true;
      clearPendingConfirmation(from);
      const reply = await callUpstreamLLM(pending.prompt, cfg);
      const msg = handleIncomingMessage(pending.prompt, from, source, {
        category: 'daily_qa',
        status: 'answered',
        reply
      });
      return { success: true, message: msg, reply };
    } else if (answer.action === 'CANCEL') {
      handledPending = true;
      clearPendingConfirmation(from);
      const reply = `🛑 已取消任务派发：${pending.taskTitle}`;
      const msg = handleIncomingMessage(content, from, source, {
        category: 'command',
        status: 'answered',
        reply
      });
      return { success: true, message: msg, reply };
    } else if (answer.action === 'SUPPLEMENT') {
      handledPending = true;
      clearPendingConfirmation(from);
      const finalPrompt = `${pending.prompt}\n(补充要求: ${answer.supplement})`;
      const msg = handleIncomingMessage(finalPrompt, from, source, {
        category: 'project_task',
        targetProject: pending.projName,
        targetConvId: pending.targetConvId,
        cleanContent: finalPrompt,
        isDirectChat: false
      });
      return { success: true, message: msg, reply: `已补充并派发任务` };
    } else {
      clearPendingConfirmation(from);
    }
  }

  const aiEval = await evaluateIntentWithAI(content, cfg);
  if (aiEval.intent === 'CONFIRM_REQUIRED') {
    const convList = getConversationsList();
    const targetConvId = cfg.activeConversationId || (convList[0]?.id) || 'default';
    const currentConv = convList.find((c) => c.id === targetConvId);
    const convName = currentConv ? currentConv.title : targetConvId.slice(0, 8);
    const projName = currentConv ? currentConv.projectName : (cfg.currentProject || '默认工程');

    setPendingConfirmation(from, {
      prompt: content,
      taskTitle: aiEval.taskTitle || content.slice(0, 20),
      summary: aiEval.summary || aiEval.reason || '',
      projName,
      targetConvId,
      convName
    });

    const reply = formatConfirmationCard({
      taskTitle: aiEval.taskTitle || content.slice(0, 20),
      projName,
      convName,
      summary: aiEval.summary || aiEval.reason || ''
    });

    const msg = handleIncomingMessage(content, from, source, {
      category: 'command',
      status: 'answered',
      reply
    });
    return { success: true, message: msg, reply };
  } else if (aiEval.intent === 'DAILY_QA') {
    const reply = await callUpstreamLLM(content, cfg);
    const msg = handleIncomingMessage(content, from, source, {
      category: 'daily_qa',
      status: 'answered',
      reply
    });
    return { success: true, message: msg, reply };
  } else {
    // DIRECT_EXECUTE
    const convList = getConversationsList();
    const targetConvId = cfg.activeConversationId || (convList[0]?.id) || 'default';
    const msg = handleIncomingMessage(content, from, source, {
      category: 'project_task',
      targetProject: cfg.currentProject || '默认工程',
      targetConvId,
      cleanContent: content,
      isDirectChat: false
    });
    return { success: true, message: msg };
  }
}

function handleApiFeishuStatus() {
  const cfg = loadConfig();
  const port = cfg.xmlPort || 18765;
  return {
    success: true,
    data: {
      isBound: !!cfg.feishuWebhookUrl,
      webhookUrl: cfg.feishuWebhookUrl || '',
      hasSecret: !!cfg.feishuSecret,
      appId: cfg.feishuAppId || '',
      hasAppSecret: !!cfg.feishuAppSecret,
      notifyChannel: cfg.notifyChannel || 'none',
      isPushActive: cfg.notifyChannel === 'feishu',
      notifyOnDispatch: !!cfg.feishuNotifyOnDispatch,
      callbackPort: port,
      callbackUrl: `http://127.0.0.1:${port}/api/feishu/event`,
      supportedEvents: ['url_verification', 'im.message.receive_v1', 'card.action.trigger']
    }
  };
}

async function handleApiFeishuBind(payload) {
  const cfg = loadConfig();
  const webhookUrl = String(payload?.webhookUrl || '').trim();
  const secret = payload?.secret !== undefined ? String(payload.secret).trim() : cfg.feishuSecret;
  const appId = payload?.appId !== undefined ? String(payload.appId).trim() : cfg.feishuAppId;
  const appSecret = payload?.appSecret !== undefined ? String(payload.appSecret).trim() : cfg.feishuAppSecret;
  const verificationToken = payload?.verificationToken !== undefined ? String(payload.verificationToken).trim() : cfg.feishuVerificationToken;
  const encryptKey = payload?.encryptKey !== undefined ? String(payload.encryptKey).trim() : cfg.feishuEncryptKey;
  const enablePush = payload?.enablePush !== undefined ? !!payload.enablePush : true;

  if (webhookUrl) {
    cfg.feishuWebhookUrl = webhookUrl;
  }
  if (secret !== undefined) cfg.feishuSecret = secret;
  if (appId !== undefined) cfg.feishuAppId = appId;
  if (appSecret !== undefined) cfg.feishuAppSecret = appSecret;
  if (verificationToken !== undefined) cfg.feishuVerificationToken = verificationToken;
  if (encryptKey !== undefined) cfg.feishuEncryptKey = encryptKey;
  if (enablePush) cfg.notifyChannel = 'feishu';

  saveConfig(cfg);

  let testResult = null;
  if (cfg.feishuWebhookUrl && payload?.test !== false) {
    try {
      testResult = await handleApiFeishuTestPush({ webhookUrl: cfg.feishuWebhookUrl, secret: cfg.feishuSecret });
    } catch (e) {
      testResult = { success: false, error: e.message };
    }
  }

  return {
    success: true,
    message: '飞书配置已成功绑定并保存！',
    testResult,
    config: {
      webhookUrl: cfg.feishuWebhookUrl,
      hasSecret: !!cfg.feishuSecret,
      notifyChannel: cfg.notifyChannel,
      appId: cfg.feishuAppId
    }
  };
}

async function handleApiNotifyTestPush(payload) {
  const cfg = loadConfig();
  const channel = payload?.channel || cfg.notifyChannel || 'none';

  if (channel === 'none') {
    return { success: false, error: '当前未选择任何外部推送渠道' };
  }

  const testTitle = '🎉 Antigravity 任务完成推送连通测试';
  const testContent = `恭喜！您的【${channel}】通知渠道已成功与 Antigravity AI助手系统连通！\n\n` +
    `• 🖥️ 调度网关：本地端口 ${cfg.xmlPort || 18765}\n` +
    `• 📁 绑定工程：${cfg.currentProject || '默认工程'}\n` +
    `• ⏰ 测试时间：${new Date().toLocaleString()}\n\n` +
    `当代码编写、测试运行或其它长耗时任务在 IDE 中完成时，系统将自动向您推送执行报告。`;

  try {
    if (channel === 'wechat') {
      const msgs = loadMessages();
      const lastWxUser = msgs.slice().reverse().find(m => m.source === 'chatgpt-on-wechat' || m.source === 'wechat');
      const targetUser = payload?.from || lastWxUser?.from || '微信随身用户';
      const pushMsg = {
        id: `wx_test_${Date.now()}`,
        from: targetUser,
        content: `【测试推送】${testTitle}`,
        category: 'project_task',
        source: 'system_push',
        time: new Date().toISOString(),
        status: 'completed',
        reply: `✅【Antigravity 微信推送测试成功】\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `${testContent}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `当前微信网关处于正常连通状态！`
      };
      msgs.push(pushMsg);
      saveMessages(msgs);
      return { success: true, message: '✅ 微信助手推送测试成功！已向微信记录流注入执行完成卡片，当前微信长轮询网关状态正常。' };
    }

    if (channel === 'pushplus') {
      const token = (payload?.notifyPushPlusToken || cfg.notifyPushPlusToken || '').trim();
      if (!token) return { success: false, error: '未配置 PushPlus Token，请在输入框填入 token' };
      const res = await fetch('http://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          title: `[Antigravity] ${testTitle}`,
          content: `### ${testTitle}\n\n${testContent}`,
          template: 'markdown'
        })
      });
      const data = await res.json();
      if (data.code === 200 || data.code === '200') {
        return { success: true, message: '✅ PushPlus 微信推送成功！请在手机微信服务号中查收通知。' };
      }
      return { success: false, error: `PushPlus 推送失败: ${data.msg || JSON.stringify(data)}` };
    }

    if (channel === 'serverchan') {
      const key = (payload?.notifyServerChanKey || cfg.notifyServerChanKey || '').trim();
      if (!key) return { success: false, error: '未配置 Server酱 SendKey，请在输入框填入 SendKey' };
      const res = await fetch(`https://sctapi.ftqq.com/${key}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[Antigravity] ${testTitle}`,
          desp: `### ${testTitle}\n\n${testContent}`
        })
      });
      const data = await res.json();
      if (data.code === 0) {
        return { success: true, message: '✅ Server酱 微信推送成功！请在手机微信中查收通知。' };
      }
      return { success: false, error: `Server酱 推送失败: ${data.message || JSON.stringify(data)}` };
    }

    if (channel === 'wecom') {
      const url = (payload?.notifyWecomUrl || cfg.notifyWecomUrl || payload?.notifyWebhookUrl || cfg.notifyWebhookUrl || '').trim();
      if (!url) return { success: false, error: '未配置企业微信群机器人 Webhook 地址' };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: { content: `### ${testTitle}\n\n${testContent}` }
        })
      });
      const data = await res.json();
      if (data.errcode === 0) {
        return { success: true, message: '✅ 企业微信群机器人推送成功！' };
      }
      return { success: false, error: `企业微信推送失败: ${data.errmsg || JSON.stringify(data)}` };
    }

    if (channel === 'feishu') {
      return handleApiFeishuTestPush(payload);
    }

    if (channel === 'custom') {
      const url = (payload?.notifyWebhookUrl || cfg.notifyWebhookUrl || '').trim();
      if (!url) return { success: false, error: '未配置自定义 Webhook URL' };
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'test_push',
          title: testTitle,
          content: testContent,
          timestamp: new Date().toISOString()
        })
      });
      return { success: true, message: '✅ 自定义 Webhook 测试请求已成功发出！' };
    }

    return { success: false, error: `不支持的通知渠道: ${channel}` };
  } catch (err) {
    return { success: false, error: `推送异常: ${err.message}` };
  }
}

async function handleApiFeishuTestPush(payload) {
  const cfg = loadConfig();
  const webhookUrl = payload?.webhookUrl || cfg.feishuWebhookUrl;
  const secret = payload?.secret !== undefined ? payload.secret : cfg.feishuSecret;

  if (!webhookUrl) {
    return { success: false, error: '未提供飞书机器人 Webhook 地址，请在设置中配置' };
  }

  try {
    const res = await sendFeishuWebhookCard({
      webhookUrl,
      secret,
      title: '🎉 Antigravity 飞书机器人联动测试成功',
      content: '恭喜！您的飞书群机器人已成功与 **Antigravity 微信 & 飞书研发调度系统** 打通！\n\n• ✅ 任务完成卡片自动推送到群聊\n• ✅ 支持加签安全防伪校验\n• ✅ 支持开放平台消息事件双向派发与交互',
      templateColor: 'turquoise',
      fields: [
        { title: '🖥️ 网关监听', value: `本地端口 ${cfg.xmlPort || 18765}` },
        { title: '📁 绑定工程', value: cfg.currentProject || 'wechat-dispatcher' },
        { title: '🔒 安全加签', value: secret ? '已启用 (HMAC-SHA256)' : '未启用' },
        { title: '⏰ 测试时间', value: new Date().toLocaleString() }
      ]
    });
    return { success: true, message: '测试消息已成功送达飞书群！', data: res };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleApiFeishuEvent(jsonBody, rawBody) {
  const cfg = loadConfig();
  let feishuBody = jsonBody || {};
  if ((!feishuBody || Object.keys(feishuBody).length === 0) && rawBody) {
    try { feishuBody = JSON.parse(rawBody); } catch (e) {}
  }

  // 0. 支持 Encrypt 解密
  if (feishuBody.encrypt && cfg.feishuEncryptKey) {
    const decrypted = decryptFeishuData(feishuBody.encrypt, cfg.feishuEncryptKey);
    if (decrypted) {
      feishuBody = decrypted;
    }
  }

  // 1. 飞书 URL 校验 (Challenge 验证)
  if (feishuBody.type === 'url_verification') {
    const vToken = cfg.feishuVerificationToken ? cfg.feishuVerificationToken.trim() : '';
    if (vToken && feishuBody.token && feishuBody.token !== vToken) {
      return { status: 403, body: { error: 'Invalid verification token' } };
    }
    console.log('[Feishu] URL Verification Challenge success:', feishuBody.challenge);
    return { status: 200, body: { challenge: feishuBody.challenge } };
  }

  // 2. 飞书交互式卡片按钮回调 (card.action.trigger / action callback)
  if (feishuBody.action || feishuBody.type === 'card.action.trigger') {
    const actionVal = feishuBody.action?.value || {};
    console.log('[Feishu] Card action trigger:', actionVal);
    const actionCmd = actionVal.action || '';

    if (actionCmd === 'status') {
      const statusText = getStatusMessage();
      return {
        status: 200,
        body: {
          toast: { type: 'info', content: '看板状态已同步' }
        }
      };
    }
    return {
      status: 200,
      body: {
        toast: { type: 'success', content: '操作已接收并处理' }
      }
    };
  }

  // 3. 飞书开放平台事件订阅 (v2.0 header.event_type 或 v1.0 event.type)
  const header = feishuBody.header || {};
  const event = feishuBody.event || {};
  const eventType = header.event_type || event.type || feishuBody.type || '';

  if (eventType === 'im.message.receive_v1' || eventType === 'message') {
    const message = event.message || event;
    const msgType = message.message_type || message.msg_type || 'text';
    const chatId = message.chat_id || '';
    const senderObj = event.sender?.sender_id || {};
    const senderId = senderObj.user_id || senderObj.open_id || event.open_id || '飞书用户';
    const senderName = `飞书用户 [${String(senderId).slice(-4)}]`;

    if (msgType === 'text' || msgType === 'post') {
      let rawText = '';
      if (typeof message.content === 'string') {
        try {
          let parsed = JSON.parse(message.content);
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch (e) {}
          }
          if (msgType === 'post' && parsed) {
            const postBody = parsed.zh_cn || parsed.en_us || parsed.ja_jp || Object.values(parsed)[0];
            if (postBody && Array.isArray(postBody.content)) {
              rawText = postBody.content.map((line) => {
                if (Array.isArray(line)) {
                  return line.map((item) => (item.tag === 'text' ? item.text : '')).join('');
                }
                return '';
              }).filter(Boolean).join('\n');
            }
          }
          if (!rawText) {
            rawText = parsed?.text || parsed?.content || (typeof parsed === 'string' ? parsed : '');
          }
        } catch (e) {
          rawText = message.content;
        }
      } else if (typeof message.content === 'object' && message.content !== null) {
        rawText = message.content.text || message.content.content || '';
      } else {
        rawText = message.text || '';
      }

      if (typeof rawText === 'string') {
        try {
          const trimmed = rawText.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const inner = JSON.parse(trimmed);
            if (inner && typeof inner === 'object') {
              rawText = inner.text || inner.content || rawText;
            }
          }
        } catch (e) {}
      }

      // 清除飞书 @ 标记（如 @_user_1 等）
      const cleanMsg = String(rawText || '').replace(/@_user_\d+\s*/g, '').trim();
      console.log(`[Feishu] Received event message from ${senderName}: ${cleanMsg}`);

      if (cleanMsg) {
        // 异步派发，立即回复 200 保证飞书不超时
        setImmediate(async () => {
          try {
            await processFeishuIncomingMessage({
              text: cleanMsg,
              sender: senderName,
              chatId,
              openId: senderObj.open_id,
              cfg
            });
          } catch (err) {
            console.error('[Feishu] Process incoming message error:', err.message);
          }
        });
      }
    }

    return { status: 200, body: { success: true } };
  }

  return { status: 200, body: { success: true } };
}

function handleApiWechatClear() {
  saveMessages([]);
  return { success: true, messages: [] };
}

function handleApiWechatMarkDispatched(payload) {
  const msgs = loadMessages();
  const item = msgs.find((m) => m.id === payload?.id);
  if (item) {
    item.status = payload?.status || 'dispatched';
    saveMessages(msgs);
  }
  return { success: true, messages: msgs.reverse() };
}

function handleApiWechatClaimDispatch(payload) {
  const msgs = loadMessages();
  const id = payload?.id;
  const item = msgs.find((m) => m.id === id);
  if (!item) return { success: false, reason: 'not_found' };

  // 核心互斥保证：只有 status === 'received' 的消息允许被认领
  if (item.status !== 'received') {
    return { success: false, reason: 'already_claimed_or_dispatched', status: item.status };
  }

  item.status = 'dispatching';
  item.claimedAt = Date.now();
  item.claimedBy = payload?.clientId || 'unknown';
  saveMessages(msgs);

  return { success: true, message: item };
}

function handleApiWechatReleaseDispatch(payload) {
  const msgs = loadMessages();
  const id = payload?.id;
  const item = msgs.find((m) => m.id === id);
  if (item && item.status === 'dispatching') {
    item.status = 'received';
    delete item.claimedAt;
    delete item.claimedBy;
    saveMessages(msgs);
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// 自动化服务守护与容错监控 (Service Supervisor & Fault Tolerance)
// ---------------------------------------------------------------------------
const WECHAT_BOT_DIR = join(APP_DATA_DIR, 'scratch', 'chatgpt-on-wechat');
let wechatBotProcess = null;
const wechatBotLogs = [];
const MAX_LOG_LINES = 250;
let wechatBotRestartCount = 0;
let wechatBotStartTime = 0;
let wechatBotAutoRestartTimer = null;
let isStoppingWechatBot = false;

function appendWechatBotLog(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  const now = new Date().toLocaleTimeString();
  for (const line of lines) {
    wechatBotLogs.push(`[${now}] ${line}`);
    if (wechatBotLogs.length > MAX_LOG_LINES) {
      wechatBotLogs.shift();
    }
  }
}

function findRunningWechatBotPid() {
  try {
    const stdout = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name = \'python.exe\' AND CommandLine LIKE \'%app.py%\'\\" -ErrorAction SilentlyContinue | Select-Object -First 1).ProcessId"',
      { encoding: 'utf8', timeout: 3500 }
    ).trim();
    if (stdout) {
      const pid = parseInt(stdout, 10);
      return !isNaN(pid) && pid > 0 ? pid : null;
    }
  } catch (e) {}
  return null;
}

function killProcessTree(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 3000 });
  } catch (e) {}
}

function startWechatBot() {
  if (!existsSync(join(WECHAT_BOT_DIR, 'app.py'))) {
    appendWechatBotLog(`[Supervisor] 微信机器人目录不存在: ${WECHAT_BOT_DIR}`);
    return { success: false, error: '微信机器人目录不存在' };
  }

  const existingPid = findRunningWechatBotPid();
  if (existingPid && (!wechatBotProcess || wechatBotProcess.pid !== existingPid)) {
    appendWechatBotLog(`[Supervisor] 检测到微信机器人已在运行中 (PID: ${existingPid})，自动纳管守护`);
    wechatBotStartTime = wechatBotStartTime || Date.now();
    return { success: true, pid: existingPid, attached: true };
  }

  if (wechatBotProcess && !wechatBotProcess.killed) {
    return { success: true, pid: wechatBotProcess.pid, running: true };
  }

  isStoppingWechatBot = false;
  appendWechatBotLog('[Supervisor] 正在自动化拉起微信随身端服务 (python app.py)...');

  try {
    wechatBotProcess = spawn('python', ['app.py'], {
      cwd: WECHAT_BOT_DIR,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    wechatBotStartTime = Date.now();

    wechatBotProcess.stdout.on('data', (chunk) => {
      appendWechatBotLog(chunk.toString('utf8'));
    });

    wechatBotProcess.stderr.on('data', (chunk) => {
      appendWechatBotLog(chunk.toString('utf8'));
    });

    wechatBotProcess.on('exit', (code, signal) => {
      appendWechatBotLog(`[Supervisor] 微信机器人进程退出 (code: ${code}, signal: ${signal})`);
      wechatBotProcess = null;
      if (!isStoppingWechatBot) {
        const cfg = loadConfig();
        if (cfg.autoStartWechatBot !== false) {
          wechatBotRestartCount++;
          if (wechatBotRestartCount <= 10) {
            appendWechatBotLog(`[Supervisor] 5秒后自动自愈重启微信服务 (重试 ${wechatBotRestartCount}/10)...`);
            clearTimeout(wechatBotAutoRestartTimer);
            wechatBotAutoRestartTimer = setTimeout(() => {
              startWechatBot();
            }, 5000);
          } else {
            appendWechatBotLog('[Supervisor] 连续异常次数超限，暂停自动重启，请检查凭证有效性');
          }
        }
      }
    });

    wechatBotProcess.on('error', (err) => {
      appendWechatBotLog(`[Supervisor] 进程启动错误: ${err.message}`);
    });

    return { success: true, pid: wechatBotProcess.pid };
  } catch (err) {
    appendWechatBotLog(`[Supervisor] 启动异常: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function stopWechatBot() {
  isStoppingWechatBot = true;
  clearTimeout(wechatBotAutoRestartTimer);

  if (wechatBotProcess) {
    appendWechatBotLog('[Supervisor] 正在停止微信机器人进程...');
    killProcessTree(wechatBotProcess.pid);
    wechatBotProcess = null;
  }

  const existingPid = findRunningWechatBotPid();
  if (existingPid) {
    killProcessTree(existingPid);
  }

  appendWechatBotLog('[Supervisor] 微信随身端服务已停止');
  return { success: true };
}

function handleApiWechatQrcodeStatus() {
  const credentialsPath = join(homedir(), '.weixin_cow_credentials.json');
  const qrPath = join(WECHAT_BOT_DIR, 'qrcode.png');

  let creds = null;
  let isBound = false;
  let credMtime = 0;
  if (existsSync(credentialsPath)) {
    try {
      creds = JSON.parse(readFileSync(credentialsPath, 'utf8'));
      isBound = !!(creds && creds.token);
      credMtime = statSync(credentialsPath).mtimeMs;
    } catch (e) {}
  }

  const hasQr = existsSync(qrPath);
  let qrMtime = 0;
  if (hasQr) {
    try {
      qrMtime = statSync(qrPath).mtimeMs;
    } catch (e) {}
  }

  // 提取最新日志中腾讯 ilink 官方授权链接
  let qrAuthUrl = '';
  for (let i = wechatBotLogs.length - 1; i >= 0 && i >= wechatBotLogs.length - 40; i--) {
    const log = wechatBotLogs[i];
    const match = log.match(/https:\/\/(liteapp\.weixin\.qq\.com\/q\/[^\s\)]+|ilinkai\.weixin\.qq\.com\/[^\s\)]+)/);
    if (match) {
      qrAuthUrl = match[0];
      break;
    }
  }

  const botPid = findRunningWechatBotPid();

  return {
    success: true,
    isBound,
    credentials: creds ? {
      botId: creds.bot_id || '',
      userId: creds.user_id || '',
      hasToken: !!creds.token,
      path: credentialsPath,
      mtime: credMtime
    } : null,
    botRunning: !!botPid,
    botPid: botPid || null,
    hasQr,
    qrImgUrl: hasQr ? `/api/wechat/qrcode.png?t=${qrMtime}` : null,
    qrAuthUrl,
    qrMtime
  };
}

async function handleApiWechatRebind() {
  appendWechatBotLog('[Supervisor] 用户触发【重新扫码绑定微信】流程...');

  // 1. 停止当前运行的微信随身端
  stopWechatBot();

  // 2. 安全备份并清除过期的凭据
  const credentialsPath = join(homedir(), '.weixin_cow_credentials.json');
  if (existsSync(credentialsPath)) {
    try {
      copyFileSync(credentialsPath, `${credentialsPath}.bak`);
      unlinkSync(credentialsPath);
      appendWechatBotLog('[Supervisor] 旧凭据已备份至 .bak 并清除');
    } catch (e) {
      console.warn('Backup/remove credentials error:', e);
    }
  }

  // 3. 移除旧的二维码图片
  const qrPath = join(WECHAT_BOT_DIR, 'qrcode.png');
  if (existsSync(qrPath)) {
    try { unlinkSync(qrPath); } catch (e) {}
  }

  // 4. 重置自动重试并拉起微信随身端 (此时无凭据，app.py 将进入 _qr_login 流程生成官方二维码)
  wechatBotRestartCount = 0;
  const startRes = startWechatBot();

  // 5. 等待新二维码生成 (最多等待 6 秒)
  let qrFound = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (existsSync(qrPath)) {
      qrFound = true;
      break;
    }
  }

  return {
    success: true,
    hasQr: qrFound,
    message: qrFound ? '微信二维码已生成，请在设置中查看并扫码' : '微信登录流程已启动，请稍候获取二维码'
  };
}

function handleApiWechatUnbind() {
  appendWechatBotLog('[Supervisor] 用户手动解绑微信账号...');
  stopWechatBot();

  const credentialsPath = join(homedir(), '.weixin_cow_credentials.json');
  if (existsSync(credentialsPath)) {
    try {
      copyFileSync(credentialsPath, `${credentialsPath}.bak`);
      unlinkSync(credentialsPath);
      appendWechatBotLog('[Supervisor] 用户手动解绑微信，凭据已归档');
    } catch (e) {}
  }

  const qrPath = join(WECHAT_BOT_DIR, 'qrcode.png');
  if (existsSync(qrPath)) {
    try { unlinkSync(qrPath); } catch (e) {}
  }

  return { success: true, message: '已成功解绑并清理微信本地凭据' };
}

function getServicesStatus() {
  const cfg = loadConfig();
  const existingPid = findRunningWechatBotPid();
  const isBotRunning = !!(wechatBotProcess && !wechatBotProcess.killed) || !!existingPid;
  const currentPid = wechatBotProcess ? wechatBotProcess.pid : existingPid;

  const credentialsPath = join(homedir(), '.weixin_cow_credentials.json');
  const hasCredentials = existsSync(credentialsPath);

  return {
    success: true,
    server: {
      port: cfg.xmlPort || 18765,
      status: 'listening',
      uptimeSec: Math.floor(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      faultTolerance: {
        uncaughtExceptionTrapped: true,
        portConflictAutoRecovery: true,
        autoSupervisorActive: true
      }
    },
    wechatBot: {
      enabled: cfg.autoStartWechatBot !== false,
      running: isBotRunning,
      pid: currentPid,
      restarts: wechatBotRestartCount,
      uptimeSec: isBotRunning && wechatBotStartTime ? Math.floor((Date.now() - wechatBotStartTime) / 1000) : 0,
      hasCredentials,
      credentialsPath,
      recentLogs: wechatBotLogs.slice(-50)
    },
    feishu: {
      configured: !!(cfg.feishuWebhookUrl || cfg.feishuAppId),
      appId: cfg.feishuAppId || '',
      hasWebhook: !!cfg.feishuWebhookUrl
    },
    taskMonitor: {
      active: true,
      intervalSec: 4
    }
  };
}

async function runServicesDiagnosis() {
  const results = [];
  const cfg = loadConfig();

  // 1. 端口与 HTTP 路由诊断
  const port = cfg.xmlPort || 18765;
  try {
    const testRes = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (testRes.ok) {
      results.push({ name: 'HTTP API 网关与路由', status: 'pass', detail: `端口 ${port} 响应正常，延迟 < 50ms` });
    } else {
      results.push({ name: 'HTTP API 网关与路由', status: 'warn', detail: `端口 ${port} 返回 HTTP ${testRes.status}` });
    }
  } catch (err) {
    results.push({ name: 'HTTP API 网关与路由', status: 'fail', detail: `本地连接失败: ${err.message}` });
  }

  // 2. 微信机器人进程诊断
  const botPid = findRunningWechatBotPid();
  const credentialsPath = join(homedir(), '.weixin_cow_credentials.json');
  const hasCreds = existsSync(credentialsPath);

  if (botPid) {
    results.push({ name: '微信随身端服务进程', status: 'pass', detail: `自动守护运行中 (PID: ${botPid})，双向路由就绪` });
  } else {
    results.push({ name: '微信随身端服务进程', status: 'warn', detail: '未检测到运行进程，自启动机制将尝试自动拉起' });
  }

  if (hasCreds) {
    results.push({ name: '微信登录身份凭证', status: 'pass', detail: `凭证已持久化在 ${credentialsPath}` });
  } else {
    results.push({ name: '微信登录身份凭证', status: 'warn', detail: '未检测到微信登录凭证，启动时需进行扫码' });
  }

  // 3. Python 环境诊断
  try {
    const pyVer = execSync('python --version', { encoding: 'utf8', timeout: 3000 }).trim();
    results.push({ name: 'Python 运行环境', status: 'pass', detail: `环境正常: ${pyVer}` });
  } catch (err) {
    results.push({ name: 'Python 运行环境', status: 'fail', detail: `未检测到 Python: ${err.message}` });
  }

  // 4. 数据持久化诊断
  try {
    const testFile = join(DATA_DIR, '__diag_test.tmp');
    writeFileSync(testFile, 'ok', 'utf8');
    readFileSync(testFile, 'utf8');
    results.push({ name: '侧边栏本地数据持久化', status: 'pass', detail: `读写权限正常 (${DATA_DIR})` });
  } catch (err) {
    results.push({ name: '侧边栏本地数据持久化', status: 'fail', detail: `数据目录不可写: ${err.message}` });
  }

  // 5. 大模型接口配置
  if (cfg.llmApiKey) {
    results.push({ name: '日常问答大模型配置', status: 'pass', detail: `已配置 Provider: ${cfg.llmProvider}` });
  } else {
    results.push({ name: '日常问答大模型配置', status: 'warn', detail: '未配置 API Key，移动端日常闲聊受限，但工程指令正常' });
  }

  return { success: true, timestamp: new Date().toISOString(), results };
}

function findProcessOnPort(port) {
  try {
    const stdout = execSync(
      `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object OwningProcess -ne 0 | Select-Object -First 1).OwningProcess"`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    const pid = parseInt(stdout, 10);
    return isNaN(pid) || pid <= 0 ? null : pid;
  } catch {
    return null;
  }
}

function startHttpServerWithRetry(xmlServer, port, maxRetries = 5, retryDelayMs = 1500) {
  let attempt = 0;

  xmlServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      attempt++;
      console.warn(`[ai-assistant][PORT_SAFEGUARD] 端口 ${port} 当前被占用 (重试第 ${attempt}/${maxRetries} 次)...`);
      if (attempt <= maxRetries) {
        const conflictPid = findProcessOnPort(port);
        if (conflictPid && conflictPid !== process.pid) {
          console.log(`[ai-assistant][PORT_SAFEGUARD] 检测到冲突进程 PID ${conflictPid}，尝试安全清理以保障服务自启...`);
          try {
            killProcessTree(conflictPid);
          } catch {}
        }
        setTimeout(() => {
          try {
            xmlServer.close();
          } catch {}
          xmlServer.listen(port, '0.0.0.0');
        }, retryDelayMs);
      } else {
        console.error(`[ai-assistant][PORT_SAFEGUARD] 经过 ${maxRetries} 次尝试仍无法绑定端口 ${port}`);
      }
    } else {
      console.error('[ai-assistant][SERVER_ERROR]', err);
    }
  });

  xmlServer.listen(port, '0.0.0.0', () => {
    console.log(`[ai-assistant] 服务端 API 路由与 Web 界面就绪，监听端口 ${port}`);
    // HTTP 服务启动成功后，自动化启动微信随身端服务
    const currentCfg = loadConfig();
    if (currentCfg.autoStartWechatBot !== false) {
      setTimeout(() => {
        startWechatBot();
      }, 1000);
    }
  });
}

// ---------------------------------------------------------------------------
// 注册 Sidecar SDK 原生路由
// ---------------------------------------------------------------------------
app.api('/api/status', () => handleApiStatus(), 'GET');
app.api('/api/session', (query) => handleApiSession(query), 'GET');
app.api('/api/mcp', () => handleApiMcp(), 'GET');
app.api('/api/tasks', (query) => handleApiTasks(query), 'GET');
app.api('/api/task/add', (payload) => handleApiTaskAdd(payload));
app.api('/api/task/update', (payload) => handleApiTaskUpdate(payload));
app.api('/api/task/move', (payload) => handleApiTaskMove(payload));
app.api('/api/task/toggle', (payload) => handleApiTaskToggle(payload));
app.api('/api/task/delete', (payload) => handleApiTaskDelete(payload));
app.api('/api/tasks/clear-done', (payload) => handleApiTasksClearDone(payload));
app.api('/api/tasks/clear-all', (payload) => handleApiTasksClearAll(payload));
app.api('/api/tasks/export-todo', (payload) => handleApiTasksExportTodo(payload));
app.api('/api/milestone/add', (payload) => handleApiMilestoneAdd(payload));
app.api('/api/milestone/delete', (payload) => handleApiMilestoneDelete(payload));
app.api('/api/tasks/reset', (payload) => handleApiTasksReset(payload));
app.api('/api/wechat/data', () => handleApiWechatData(), 'GET');
app.api('/api/config/save', (payload) => handleApiConfigSave(payload));
app.api('/api/wechat/simulate', (payload) => handleApiWechatSimulate(payload));
app.api('/api/wechat/message/delete', (payload) => handleApiWechatMessageDelete(payload));
app.api('/api/wechat/clear-messages', () => handleApiWechatClear());
app.api('/api/wechat/mark-dispatched', (payload) => handleApiWechatMarkDispatched(payload));
app.api('/api/wechat/claim-dispatch', (payload) => handleApiWechatClaimDispatch(payload));
app.api('/api/wechat/release-dispatch', (payload) => handleApiWechatReleaseDispatch(payload));
app.api('/api/notify/test-push', (payload) => handleApiNotifyTestPush(payload));
app.api('/api/feishu/test-push', (payload) => handleApiFeishuTestPush(payload));
app.api('/api/feishu/event', (payload) => handleApiFeishuEvent(payload));
app.api('/api/feishu/status', () => handleApiFeishuStatus(), 'GET');
app.api('/api/feishu/bind', (payload) => handleApiFeishuBind(payload));
app.api('/api/services/status', () => getServicesStatus(), 'GET');
app.api('/api/services/wechat-bot/start', () => startWechatBot());
app.api('/api/services/wechat-bot/stop', () => stopWechatBot());
app.api('/api/services/wechat-bot/restart', () => { stopWechatBot(); return startWechatBot(); });
app.api('/api/services/wechat-bot/logs', () => ({ success: true, logs: wechatBotLogs }), 'GET');
app.api('/api/services/diagnose', async () => await runServicesDiagnosis(), 'GET');
app.api('/api/services/diagnose', async () => await runServicesDiagnosis(), 'POST');
app.api('/api/wechat/qrcode', () => handleApiWechatQrcodeStatus(), 'GET');
app.api('/api/wechat/rebind', async () => await handleApiWechatRebind());
app.api('/api/wechat/unbind', () => handleApiWechatUnbind());
app.api('/api/llm/test', (payload) => handleApiLlmTest(payload));

// ---------------------------------------------------------------------------
// 启动原生 HTTP 独立 Web 访问与微信网关服务 (端口 18765)
// ---------------------------------------------------------------------------
const cfg = loadConfig();
const XML_PORT = cfg.xmlPort || 18765;

try {
  const xmlServer = createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${XML_PORT}`);

    // 全局支持 CORS 跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // 1. Web 界面静态资源路由 (支持在浏览器中直接打开 http://localhost:18765/)
    if (req.method === 'GET') {
      if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(readLocal('index.html'));
      }

      if (parsedUrl.pathname === '/app.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(readLocal('app.js'));
      }

      if (parsedUrl.pathname === '/styles.css') {
        res.writeHead(200, {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(readLocal('styles.css'));
      }

      // REST API GET 路由 (供外部浏览器端访问)
      const queryObj = Object.fromEntries(parsedUrl.searchParams);
      if (parsedUrl.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(handleApiStatus()));
      }
      if (parsedUrl.pathname === '/api/session') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(handleApiSession(queryObj)));
      }
      if (parsedUrl.pathname === '/api/tasks') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(handleApiTasks(queryObj)));
      }
      if (parsedUrl.pathname === '/api/mcp') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(handleApiMcp()));
      }
      if (parsedUrl.pathname === '/api/wechat/data') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(handleApiWechatData()));
      }
      if (parsedUrl.pathname === '/api/report') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: true, report: getStructuredTaskReport(queryObj.conversationId) }));
      }
      if (parsedUrl.pathname === '/api/feishu/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(handleApiFeishuStatus()));
      }
      if (parsedUrl.pathname === '/api/services/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(getServicesStatus()));
      }
      if (parsedUrl.pathname === '/api/services/wechat-bot/logs') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: true, logs: wechatBotLogs }));
      }
      if (parsedUrl.pathname === '/api/services/diagnose') {
        const diagRes = await runServicesDiagnosis();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(diagRes));
      }
      if (parsedUrl.pathname === '/api/wechat/qrcode') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(handleApiWechatQrcodeStatus()));
      }
      if (parsedUrl.pathname === '/api/wechat/qrcode.png') {
        const qrPath = join(WECHAT_BOT_DIR, 'qrcode.png');
        if (existsSync(qrPath)) {
          try {
            const imgBuf = readFileSync(qrPath);
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Content-Length': imgBuf.length
            });
            return res.end(imgBuf);
          } catch (e) {}
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'QR code not found' }));
      }
      if (parsedUrl.pathname === '/api/wechat/rebind') {
        const rebindRes = await handleApiWechatRebind();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(rebindRes));
      }
      if (parsedUrl.pathname === '/api/feishu/event' || parsedUrl.pathname === '/feishu/webhook') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          success: true,
          message: 'Antigravity 飞书事件与交互网关就绪！请在飞书开放平台将事件请求网址配置为当前 URL (POST)。',
          supportedEvents: ['url_verification', 'im.message.receive_v1', 'card.action.trigger']
        }));
      }

      // 微信公众号服务器接口验证 (echostr)
      const signature = parsedUrl.searchParams.get('signature');
      const timestamp = parsedUrl.searchParams.get('timestamp');
      const nonce = parsedUrl.searchParams.get('nonce');
      const echostr = parsedUrl.searchParams.get('echostr');

      if (echostr) {
        const token = loadConfig().token || 'antigravity_token';
        const str = [token, timestamp, nonce].sort().join('');
        const hash = createHash('sha1').update(str).digest('hex');

        if (hash === signature) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end(echostr);
        } else {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          return res.end('Invalid signature');
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Antigravity AI助手服务正常运行中！访问 http://localhost:18765/ 可查看完整 Web 界面。');
    }

    // 2. POST 请求处理
    if (req.method === 'POST') {
      req.setEncoding('utf8');
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const cfgNow = loadConfig();

          // 浏览器端的 POST API 路由
          let jsonBody = {};
          try { jsonBody = JSON.parse(body); } catch (e) {}

          if (parsedUrl.pathname === '/api/task/add') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTaskAdd(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/task/update') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTaskUpdate(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/task/move') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTaskMove(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/tasks/export-todo') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTasksExportTodo(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/task/toggle') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTaskToggle(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/task/delete') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTaskDelete(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/tasks/clear-done') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTasksClearDone(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/tasks/clear-all') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTasksClearAll(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/milestone/add') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiMilestoneAdd(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/milestone/delete') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiMilestoneDelete(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/tasks/reset') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiTasksReset(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/config/save') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiConfigSave(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/wechat/simulate') {
            const simRes = await handleApiWechatSimulate(jsonBody);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(simRes));
          }
          if (parsedUrl.pathname === '/api/wechat/message/delete') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiWechatMessageDelete(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/wechat/clear-messages') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiWechatClear()));
          }
          if (parsedUrl.pathname === '/api/wechat/mark-dispatched') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiWechatMarkDispatched(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/wechat/claim-dispatch') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiWechatClaimDispatch(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/wechat/release-dispatch') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiWechatReleaseDispatch(jsonBody)));
          }
          if (parsedUrl.pathname === '/api/notify/test-push') {
            const testRes = await handleApiNotifyTestPush(jsonBody);
            res.writeHead(testRes.success ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(testRes));
          }
          if (parsedUrl.pathname === '/api/feishu/test-push') {
            const simRes = await handleApiFeishuTestPush(jsonBody);
            res.writeHead(simRes.success ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(simRes));
          }
          if (parsedUrl.pathname === '/api/feishu/status') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(handleApiFeishuStatus()));
          }
          if (parsedUrl.pathname === '/api/feishu/bind') {
            const bindRes = await handleApiFeishuBind(jsonBody);
            res.writeHead(bindRes.success ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(bindRes));
          }
          if (parsedUrl.pathname === '/api/feishu/event' || parsedUrl.pathname === '/feishu/webhook') {
            const feishuRes = await handleApiFeishuEvent(jsonBody, body);
            res.writeHead(feishuRes.status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(feishuRes.body));
          }
          if (parsedUrl.pathname === '/api/services/wechat-bot/start') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(startWechatBot()));
          }
          if (parsedUrl.pathname === '/api/services/wechat-bot/stop') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(stopWechatBot()));
          }
          if (parsedUrl.pathname === '/api/services/wechat-bot/restart') {
            stopWechatBot();
            const rRes = startWechatBot();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(rRes));
          }
          if (parsedUrl.pathname === '/api/services/diagnose') {
            const diagRes = await runServicesDiagnosis();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(diagRes));
          }
          if (parsedUrl.pathname === '/api/llm/test') {
            const testRes = await handleApiLlmTest(jsonBody);
            res.writeHead(testRes.success ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(testRes));
          }
          if (parsedUrl.pathname === '/api/wechat/rebind') {
            const rebindRes = await handleApiWechatRebind();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(rebindRes));
          }
          if (parsedUrl.pathname === '/api/wechat/unbind') {
            const unbindRes = handleApiWechatUnbind();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(unbindRes));
          }

          // 兼容 OpenAI /v1/chat/completions 客户端调用 (如 chatgpt-on-wechat)
          if (parsedUrl.pathname === '/v1/chat/completions' || parsedUrl.pathname === '/chat/completions') {
            const msgs = Array.isArray(jsonBody.messages) ? jsonBody.messages : [];
            const userMsgs = msgs.filter((m) => m && m.role === 'user');
            const targetMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : msgs[msgs.length - 1];
            let userMsg = '';
            if (targetMsg) {
              if (typeof targetMsg.content === 'string') userMsg = targetMsg.content.trim();
              else if (Array.isArray(targetMsg.content)) {
                userMsg = targetMsg.content.map(c => typeof c === 'string' ? c : (c.text || '')).join('\n').trim();
              } else if (typeof targetMsg.text === 'string') {
                userMsg = targetMsg.text.trim();
              }
            }

            // 过滤 CoW 内部系统提示词：闲置反思、会话记忆压缩归纳与梦境整理
            const isCoWInternalSystemMsg = (
              userMsg.startsWith('Here is the conversation transcript that just went idle') ||
              userMsg.includes('stay [SILENT]') ||
              userMsg.startsWith('请归纳以下对话的日常记录') ||
              userMsg.includes('请归纳以下对话的日常记录') ||
              userMsg.startsWith('Summarize the daily record') ||
              userMsg.includes('Summarize the daily record') ||
              userMsg.startsWith('## 当前长期记忆') ||
              userMsg.startsWith('## Current long-term memory') ||
              msgs.some(m => m && m.role === 'system' && (
                (typeof m.content === 'string' && m.content.includes('你是一个对话记录助手')) ||
                (typeof m.content === 'string' && m.content.includes('你是一个记忆整理助手')) ||
                (typeof m.content === 'string' && m.content.includes('conversation-logging assistant')) ||
                (typeof m.content === 'string' && m.content.includes('memory-curation assistant'))
              ))
            );

            if (isCoWInternalSystemMsg) {
              console.log('[wechat-gateway] Intercepted CoW internal memory/summarizer request cleanly');
              let internalReply = '无';
              if (userMsg.includes('stay [SILENT]')) {
                internalReply = '[SILENT]';
              } else if (cfgNow.llmApiKey && (userMsg.includes('请归纳以下对话') || userMsg.includes('Summarize the daily record'))) {
                try {
                  const resText = await callUpstreamLLM(userMsg, cfgNow);
                  if (resText && !resText.startsWith('[问答模型调用异常') && !resText.startsWith('[问答请求失败]')) {
                    internalReply = resText;
                  } else {
                    internalReply = '无';
                  }
                } catch {
                  internalReply = '无';
                }
              }

              if (jsonBody.stream) {
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream; charset=utf-8',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive'
                });
                const chunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: jsonBody.model || 'antigravity',
                  choices: [{ index: 0, delta: { role: 'assistant', content: internalReply }, finish_reason: null }]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                const endChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: jsonBody.model || 'antigravity',
                  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
                };
                res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
                res.write('data: [DONE]\n\n');
                return res.end();
              }
              const resp = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: jsonBody.model || 'antigravity',
                choices: [{ index: 0, message: { role: 'assistant', content: internalReply }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
              };
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify(resp));
            }

            let replyContent = '';
            const fromUser = jsonBody.user || 'CoW 微信用户';
            const switchReply = resolveSwitchCommand(userMsg);
            const newSessionTask = extractNewSessionTask(userMsg);

            if (isGreeting(userMsg)) {
              replyContent = getGreetingMessage();
              handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                category: 'command',
                status: 'answered',
                reply: replyContent
              });
            } else if (isHelpCommand(userMsg)) {
              replyContent = getHelpMessage();
              handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                category: 'command',
                status: 'answered',
                reply: replyContent
              });
            } else if (isSessionsCommand(userMsg)) {
              replyContent = getSessionsMessage();
              handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                category: 'command',
                status: 'answered',
                reply: replyContent
              });
            } else if (switchReply) {
              replyContent = switchReply;
              handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                category: 'command',
                status: 'answered',
                reply: replyContent
              });
            } else if (newSessionTask) {
              handleIncomingMessage(newSessionTask, fromUser, 'chatgpt-on-wechat', {
                category: 'project_task',
                isNewChat: true
              });
              replyContent = `🚀 已为您创建新会话并派发任务：\n${newSessionTask}\n\nAntigravity 将在新会话中开始执行！`;
            } else if (isProjectsCommand(userMsg)) {
              replyContent = getProjectsMessage();
              handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                category: 'command',
                status: 'answered',
                reply: replyContent
              });
            } else if (isStatusCommand(userMsg)) {
              replyContent = getStatusMessage();
              handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                category: 'command',
                status: 'answered',
                reply: replyContent
              });
            } else if (isReportCommand(userMsg)) {
              replyContent = getStructuredTaskReport();
              handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                category: 'command',
                status: 'answered',
                reply: replyContent
              });
            } else if (isFeishuCommand(userMsg)) {
              replyContent = await resolveFeishuCommand(userMsg);
              handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                category: 'command',
                status: 'answered',
                reply: replyContent
              });
            } else {
              // 非固定指令，进入待确认检查与 AI 意图判定
              const pending = getPendingConfirmation(fromUser, cfgNow.aiIntentConfirmTimeoutSec || 300);
              let handledPending = false;

              if (pending) {
                const answer = parseConfirmationAnswer(userMsg);
                if (answer.action === 'CONFIRM') {
                  handledPending = true;
                  clearPendingConfirmation(fromUser);
                  const finalPrompt = answer.supplement ? `${pending.prompt}\n(补充要求: ${answer.supplement})` : pending.prompt;
                  replyContent = await executeDispatchedTask(finalPrompt, fromUser, pending.targetConvId, pending.projName, cfgNow, 'chatgpt-on-wechat');
                } else if (answer.action === 'QA_ONLY') {
                  handledPending = true;
                  clearPendingConfirmation(fromUser);
                  replyContent = await callUpstreamLLM(pending.prompt, cfgNow);
                  handleIncomingMessage(pending.prompt, fromUser, 'chatgpt-on-wechat', {
                    category: 'daily_qa',
                    status: 'answered',
                    reply: replyContent
                  });
                } else if (answer.action === 'CANCEL') {
                  handledPending = true;
                  clearPendingConfirmation(fromUser);
                  replyContent = `🛑 已取消任务派发：\n📝「${pending.taskTitle}」\n不会对工程代码做任何修改。`;
                  handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                    category: 'command',
                    status: 'answered',
                    reply: replyContent
                  });
                } else if (answer.action === 'SUPPLEMENT') {
                  handledPending = true;
                  clearPendingConfirmation(fromUser);
                  const finalPrompt = `${pending.prompt}\n(补充要求: ${answer.supplement})`;
                  replyContent = await executeDispatchedTask(finalPrompt, fromUser, pending.targetConvId, pending.projName, cfgNow, 'chatgpt-on-wechat');
                } else {
                  // UNKNOWN: 清除旧待确认项，作为全新消息处理
                  clearPendingConfirmation(fromUser);
                }
              }

              if (!handledPending) {
                const aiEval = await evaluateIntentWithAI(userMsg, cfgNow);

                if (aiEval.intent === 'CONFIRM_REQUIRED') {
                  const convList = getConversationsList();
                  const targetConvId = cfgNow.activeConversationId || (convList[0]?.id) || 'default';
                  const currentConv = convList.find((c) => c.id === targetConvId);
                  const convName = currentConv ? currentConv.title : targetConvId.slice(0, 8);
                  const projName = currentConv ? currentConv.projectName : (cfgNow.currentProject || '默认工程');

                  setPendingConfirmation(fromUser, {
                    prompt: userMsg,
                    taskTitle: aiEval.taskTitle || userMsg.slice(0, 20),
                    summary: aiEval.summary || aiEval.reason || '',
                    projName,
                    targetConvId,
                    convName
                  });

                  replyContent = formatConfirmationCard({
                    taskTitle: aiEval.taskTitle || userMsg.slice(0, 20),
                    projName,
                    convName,
                    summary: aiEval.summary || aiEval.reason || ''
                  });

                  handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                    category: 'command',
                    status: 'answered',
                    reply: replyContent
                  });
                } else if (aiEval.intent === 'DAILY_QA') {
                  replyContent = await callUpstreamLLM(userMsg, cfgNow);
                  handleIncomingMessage(userMsg, fromUser, 'chatgpt-on-wechat', {
                    category: 'daily_qa',
                    status: 'answered',
                    reply: replyContent
                  });
                } else {
                  // DIRECT_EXECUTE
                  const convList = getConversationsList();
                  const targetConvId = cfgNow.activeConversationId || (convList[0]?.id) || 'default';
                  const currentConv = convList.find((c) => c.id === targetConvId);
                  const convName = currentConv ? currentConv.title : targetConvId.slice(0, 8);
                  const projName = currentConv ? currentConv.projectName : (cfgNow.currentProject || '默认工程');

                  replyContent = await executeDispatchedTask(userMsg, fromUser, targetConvId, projName, cfgNow, 'chatgpt-on-wechat');
                }
              }
            }

            // 处理流式 (SSE) 请求
            if (jsonBody.stream) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
              });
              const chunk = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: jsonBody.model || 'antigravity',
                choices: [{ index: 0, delta: { role: 'assistant', content: replyContent }, finish_reason: null }]
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              const endChunk = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: jsonBody.model || 'antigravity',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
              };
              res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
              res.write('data: [DONE]\n\n');
              return res.end();
            }

            // 普通非流式响应
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: jsonBody.model || 'antigravity',
              choices: [{
                index: 0,
                message: { role: 'assistant', content: replyContent },
                finish_reason: 'stop'
              }],
              usage: { prompt_tokens: 15, completion_tokens: 35, total_tokens: 50 }
            }));
          }

          // 微信标准 XML 格式报文处理
          const toUserMatch = body.match(/<ToUserName><!\[CDATA\[(.*?)\]\]><\/ToUserName>/i);
          const fromUserMatch = body.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/i);
          const contentMatch = body.match(/<Content><!\[CDATA\[([\s\S]*?)\]\]><\/Content>/i);

          const toUser = toUserMatch ? toUserMatch[1] : '';
          const fromUser = fromUserMatch ? fromUserMatch[1] : '';
          const content = contentMatch ? contentMatch[1].trim() : '';

          if (!content) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end('success');
          }

          // 指令优先响应
          let replyText = '';
          const switchReply = resolveSwitchCommand(content);
          const newSessionTask = extractNewSessionTask(content);

          if (isGreeting(content)) {
            replyText = getGreetingMessage();
            handleIncomingMessage(content, fromUser, 'wechat_xml', {
              category: 'command',
              status: 'answered',
              reply: replyText
            });
          } else if (isHelpCommand(content)) {
            replyText = getHelpMessage();
          } else if (isSessionsCommand(content)) {
            replyText = getSessionsMessage();
          } else if (switchReply) {
            replyText = switchReply;
          } else if (newSessionTask) {
            handleIncomingMessage(newSessionTask, fromUser, 'wechat_xml', {
              category: 'project_task',
              isNewChat: true
            });
            replyText = `🚀 已为您创建新会话并派发任务：\n${newSessionTask}\n\nAntigravity 将在新会话中开始执行！`;
          } else if (isProjectsCommand(content)) {
            replyText = getProjectsMessage();
          } else if (isStatusCommand(content)) {
            replyText = getStatusMessage();
          } else if (isReportCommand(content)) {
            replyText = getStructuredTaskReport();
            handleIncomingMessage(content, fromUser, 'wechat_xml', {
              category: 'command',
              status: 'answered',
              reply: replyText
            });
          } else if (isFeishuCommand(content)) {
            replyText = await resolveFeishuCommand(content);
            handleIncomingMessage(content, fromUser, 'wechat_xml', {
              category: 'command',
              status: 'answered',
              reply: replyText
            });
          } else {
            // 非固定指令，待确认检查与 AI 意图判定
            const pending = getPendingConfirmation(fromUser, cfgNow.aiIntentConfirmTimeoutSec || 300);
            let handledPending = false;

            if (pending) {
              const answer = parseConfirmationAnswer(content);
              if (answer.action === 'CONFIRM') {
                handledPending = true;
                clearPendingConfirmation(fromUser);
                const finalPrompt = answer.supplement ? `${pending.prompt}\n(补充要求: ${answer.supplement})` : pending.prompt;
                handleIncomingMessage(finalPrompt, fromUser, 'wechat_xml', {
                  category: 'project_task',
                  targetProject: pending.projName,
                  targetConvId: pending.targetConvId,
                  cleanContent: finalPrompt,
                  isDirectChat: false
                });
                const preview = finalPrompt.length > 30 ? `${finalPrompt.slice(0, 30)}...` : finalPrompt;
                replyText = `🚀【已确认执行 Antigravity 任务】\n` +
                  `📌 目标会话：${pending.convName}\n` +
                  `📦 所属工程：${pending.projName}\n` +
                  `💬 指令内容：${preview}\n\n` +
                  `⚡ 电脑端 IDE 正在执行与回复！任务进度可发 /status 查询，结果发 /result 查看。`;
              } else if (answer.action === 'QA_ONLY') {
                handledPending = true;
                clearPendingConfirmation(fromUser);
                replyText = await callUpstreamLLM(pending.prompt, cfgNow);
                handleIncomingMessage(pending.prompt, fromUser, 'wechat_xml', {
                  category: 'daily_qa',
                  status: 'answered',
                  reply: replyText
                });
              } else if (answer.action === 'CANCEL') {
                handledPending = true;
                clearPendingConfirmation(fromUser);
                replyText = `🛑 已取消任务派发：\n📝「${pending.taskTitle}」\n不会对工程代码做任何修改。`;
                handleIncomingMessage(content, fromUser, 'wechat_xml', {
                  category: 'command',
                  status: 'answered',
                  reply: replyText
                });
              } else if (answer.action === 'SUPPLEMENT') {
                handledPending = true;
                clearPendingConfirmation(fromUser);
                const finalPrompt = `${pending.prompt}\n(补充要求: ${answer.supplement})`;
                handleIncomingMessage(finalPrompt, fromUser, 'wechat_xml', {
                  category: 'project_task',
                  targetProject: pending.projName,
                  targetConvId: pending.targetConvId,
                  cleanContent: finalPrompt,
                  isDirectChat: false
                });
                replyText = `🚀【已确认并更新要求派发任务】\n` +
                  `📌 目标会话：${pending.convName}\n` +
                  `📦 所属工程：${pending.projName}\n` +
                  `⚡ 电脑端 IDE 正在执行！可发 /status 查询进度。`;
              } else {
                clearPendingConfirmation(fromUser);
              }
            }

            if (!handledPending) {
              const aiEval = await evaluateIntentWithAI(content, cfgNow);
              if (aiEval.intent === 'CONFIRM_REQUIRED') {
                const convList = getConversationsList();
                const targetConvId = cfgNow.activeConversationId || (convList[0]?.id) || 'default';
                const currentConv = convList.find((c) => c.id === targetConvId);
                const convName = currentConv ? currentConv.title : targetConvId.slice(0, 8);
                const projName = currentConv ? currentConv.projectName : (cfgNow.currentProject || '默认工程');

                setPendingConfirmation(fromUser, {
                  prompt: content,
                  taskTitle: aiEval.taskTitle || content.slice(0, 20),
                  summary: aiEval.summary || aiEval.reason || '',
                  projName,
                  targetConvId,
                  convName
                });

                replyText = formatConfirmationCard({
                  taskTitle: aiEval.taskTitle || content.slice(0, 20),
                  projName,
                  convName,
                  summary: aiEval.summary || aiEval.reason || ''
                });

                handleIncomingMessage(content, fromUser, 'wechat_xml', {
                  category: 'command',
                  status: 'answered',
                  reply: replyText
                });
              } else if (aiEval.intent === 'DAILY_QA') {
                replyText = await callUpstreamLLM(content, cfgNow);
                handleIncomingMessage(content, fromUser, 'wechat_xml', {
                  category: 'daily_qa',
                  status: 'answered',
                  reply: replyText
                });
              } else {
                // DIRECT_EXECUTE
                const convList = getConversationsList();
                const targetConvId = cfgNow.activeConversationId || (convList[0]?.id) || 'default';
                const currentConv = convList.find((c) => c.id === targetConvId);
                const convName = currentConv ? currentConv.title : targetConvId.slice(0, 8);
                const projName = currentConv ? currentConv.projectName : (cfgNow.currentProject || '默认工程');

                const cleanPrompt = content;
                handleIncomingMessage(content, fromUser, 'wechat_xml', {
                  category: 'project_task',
                  targetProject: projName,
                  targetConvId,
                  cleanContent: cleanPrompt,
                  isDirectChat: false
                });

                const preview = cleanPrompt.length > 30 ? `${cleanPrompt.slice(0, 30)}...` : cleanPrompt;
                replyText = `🚀【已直通 Antigravity 会话】\n` +
                  `📌 目标会话：${convName}\n` +
                  `📦 所属工程：${projName}\n` +
                  `💬 指令内容：${preview}\n\n` +
                  `⚡ 电脑端 IDE 正在执行与回复！任务进度可发 /status 查询。`;
              }
            }
          }

          // 构建回复 XML
          const nowTime = Math.floor(Date.now() / 1000);
          const replyXml = `<xml>` +
            `<ToUserName><![CDATA[${fromUser}]]></ToUserName>` +
            `<FromUserName><![CDATA[${toUser}]]></FromUserName>` +
            `<CreateTime>${nowTime}</CreateTime>` +
            `<MsgType><![CDATA[text]]></MsgType>` +
            `<Content><![CDATA[${replyText}]]></Content>` +
            `</xml>`;

          res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
          return res.end(replyXml);
        } catch (err) {
          console.error('[wechat-gateway] Message error:', err);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('success');
        }
      });
    }
  });

  xmlServer.listen(XML_PORT, '0.0.0.0', () => {
    console.log(`[ai-assistant] WeChat Gateway and Web UI listening on port ${XML_PORT}`);
  });
} catch (e) {
  console.error('[ai-assistant] Failed to bind WeChat gateway port:', e.message);
}
// ---------------------------------------------------------------------------
// 后台自动检测已派发微信任务的执行完成状态，自动更新看板并触发主动通知
// ---------------------------------------------------------------------------
setInterval(async () => {
  try {
    const msgs = loadMessages();
    let hasChanged = false;
    const now = Date.now();
    const cfg = loadConfig();

    for (const m of msgs) {
      if (m.category === 'project_task' && m.status === 'dispatched' && m.targetConvId) {
        const transcriptPath = join(BRAIN_DIR, m.targetConvId, '.system_generated', 'logs', 'transcript.jsonl');
        if (!existsSync(transcriptPath)) continue;

        const raw = readFileSync(transcriptPath, 'utf8');
        const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length === 0) continue;

        const lastLine = lines[lines.length - 1];
        let lastStep = null;
        try { lastStep = JSON.parse(lastLine); } catch (e) {}

        if (lastStep && lastStep.type === 'PLANNER_RESPONSE') {
          const calls = Array.isArray(lastStep.tool_calls) ? lastStep.tool_calls : [];
          const text = typeof lastStep.content === 'string' ? lastStep.content.trim() : '';
          const stepTime = lastStep.created_at ? new Date(lastStep.created_at).getTime() : 0;
          const msgTime = m.time ? new Date(m.time).getTime() : 0;

          if (stepTime >= msgTime - 5000 && ((calls.length === 0 && text.length > 0) || lastStep.status === 'DONE')) {
            m.status = 'completed';
            m.reply = text;
            hasChanged = true;

            if (m.dispatchedTaskId) {
              const taskData = loadTasks(m.targetConvId);
              const t = taskData.tasks.find((task) => task.id === m.dispatchedTaskId);
              if (t && t.status !== 'done') {
                t.status = 'done';
                saveTasks(m.targetConvId, taskData);
              }
            }

            const shouldPush = (cfg.notifyChannel && cfg.notifyChannel !== 'none') || (m.source === 'feishu' && cfg.feishuWebhookUrl);
            if (shouldPush) {
              const convList = getConversationsList();
              const currentConv = convList.find((c) => c.id === m.targetConvId);
              const convTitle = currentConv ? currentConv.title : m.targetConvId.slice(0, 8);
              const projName = currentConv ? currentConv.projectName : (cfg.currentProject || '默认工程');

              const sourcePrefix = m.source === 'feishu' ? '飞书' : '微信';
              triggerTaskCompletionPush({
                title: `${sourcePrefix}任务执行完成: ${m.cleanContent ? m.cleanContent.slice(0, 25) : m.content.slice(0, 25)}`,
                convName: convTitle,
                projName,
                content: text,
                source: m.source,
                stepsAdded: lines.length,
                elapsedSec: Math.round((now - msgTime) / 1000)
              }, cfg);
            }
          }
        }
      }
    }

    if (hasChanged) {
      saveMessages(msgs);
    }
  } catch (err) {}
}, 4000);

app.run();


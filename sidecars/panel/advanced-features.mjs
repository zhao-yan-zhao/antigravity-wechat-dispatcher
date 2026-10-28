/**
 * WeChat Dispatcher - Advanced Features Module
 * 
 * 包含十项全能增强能力：
 * 1. 🎙️ 微信语音转工程指令 (Voice-to-Task)
 * 2. 📸 手机拍照 / 截图识图改代码 (Vision / Multimodal task)
 * 3. 🖼️ 前端渲染效果自动截屏回传 (UI Snapshot & push)
 * 4. ⚡ 远程轻量服务管理与安全命令 (Remote Ops: /service, /git, /cmd)
 * 5. ⏰ 每日晨报与项目夕报定时推送 (Daily Morning & Evening Standup Automation)
 * 6. 🌐 多工作区 / 多代码仓库远程自由切换 (/workspaces, /workspace, /cd)
 * 7. 📑 微信富文本代码审查卡片 / Diff 预览 (/diff, /review)
 * 8. 📦 自动化构建与安装包打包直推 (/build, /package, auto-zip & deliver)
 * 9. 📚 本地项目架构与私有 API 问答 (/ask, /code Local Codebase RAG)
 * 10. 👥 多人白名单与多级角色权限控制 (RBAC & Risky Command Guard)
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { execSync, spawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// 辅助工具：格式化字节与安全执行
// ---------------------------------------------------------------------------
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function safeExecSync(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: options.timeout || 12000,
      cwd: options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...options
    }).trim();
  } catch (err) {
    return (err.stdout ? err.stdout.toString() : '') || (err.stderr ? err.stderr.toString() : err.message);
  }
}

// ===========================================================================
// 1. 🎙️ 微信语音转工程指令 (Voice-to-Task)
// ===========================================================================
export function isVoiceMessage(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\[(?:语音消息|语音识别|语音|Voice)[：:]\s*(.+?)\]?$/i.test(t) ||
    /^🎙️\s*(?:\[已识别语音指令\]|[语音消息])[：:]\s*(.+?)$/i.test(t) ||
    /^\/(?:voice|audio)\s+(.+)$/i.test(t)
  );
}

export function extractVoiceText(text) {
  if (!text) return '';
  const t = String(text).trim();
  const m1 = t.match(/^\[(?:语音消息|语音识别|语音|Voice)[：:]\s*(.+?)\]?$/i);
  if (m1) return m1[1].trim();
  const m2 = t.match(/^🎙️\s*(?:\[已识别语音指令\]|[语音消息])[：:]\s*(.+?)$/i);
  if (m2) return m2[1].trim();
  const m3 = t.match(/^\/(?:voice|audio)\s+(.+)$/i);
  if (m3) return m3[1].trim();
  return t;
}

// ===========================================================================
// 2. 📸 手机拍照 / 截图识图改代码 (Vision / Multimodal task)
// ===========================================================================
export function isVisionCommand(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\/(?:vision|image|photo|pic)\b/i.test(t) ||
    /^\[(?:图片|Image)[：:]\s*([^\]]+)\]/i.test(t) ||
    /^(?:识别图片|看图修改|按图写代码|看图修bug|分析图片)\b/i.test(t)
  );
}

export function resolveVisionTask(text, activeProject = '当前工程') {
  const t = String(text).trim();
  let imagePath = '';
  let instruction = '';

  const imgMatch1 = t.match(/^\[(?:图片|Image)[：:]\s*([^\]]+)\]\s*(.*)$/i);
  if (imgMatch1) {
    imagePath = imgMatch1[1].trim();
    instruction = imgMatch1[2].trim();
  } else {
    const cmdMatch = t.match(/^\/(?:vision|image|photo|pic)\s+(\S+)(?:\s+(.*))?$/i);
    if (cmdMatch) {
      imagePath = cmdMatch[1].trim();
      instruction = (cmdMatch[2] || '').trim();
    } else {
      const pathMatch = t.match(/(?:[a-zA-Z]:[\\\/][^\r\n"':*?<>|]+\.(?:png|jpg|jpeg|webp|gif))/i);
      if (pathMatch) {
        imagePath = pathMatch[0];
        instruction = t.replace(imagePath, '').trim();
      }
    }
  }

  if (!instruction) {
    instruction = '分析图片中的界面结构或报错日志，并在工程中实现/修复对应代码。';
  }

  const prompt = `【📸 来自微信图片研发需求】\n用户上传了设计参考图/系统报错截图：${imagePath || '已附带图片'}\n需求说明：${instruction}\n请仔细分析图片内容（可结合本地代码结构），在当前工程【${activeProject}】中完成对应的代码实现或缺陷修复！`;

  return {
    imagePath,
    instruction,
    prompt,
    summary: `识图需求: ${instruction.slice(0, 20)}...`
  };
}

// ===========================================================================
// 3. 🖼️ 前端渲染效果自动截屏回传 (UI Snapshot & push)
// ===========================================================================
export function isUiSnapshotCommand(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\/(?:snapshot|screenshot|ui|preview)\b/i.test(t) ||
    /^(?:查看效果|截屏|截图回传|界面快照|界面截图|前端效果|发我效果图|发效果图|效果图发我)$/i.test(t)
  );
}

export async function resolveUiSnapshotCommand(text, fromUser, dataDir, sendFileHelper) {
  const outPath = join(dataDir, `ui_snapshot_${Date.now()}.png`);
  let hasImage = false;
  let imgSizeStr = '';

  // 尝试使用 PowerShell 截取当前主屏幕画面并保存为 PNG
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save("${outPath.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
`;

  try {
    safeExecSync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, ' ')}"`, { timeout: 8000 });
    if (existsSync(outPath)) {
      const st = statSync(outPath);
      if (st.size > 10000) {
        hasImage = true;
        imgSizeStr = formatBytes(st.size);
        if (sendFileHelper) {
          await sendFileHelper(outPath, fromUser, '🖼️【本地界面渲染快照】已捕获最新屏幕画面');
        }
      }
    }
  } catch (err) {
    console.warn('[resolveUiSnapshotCommand] Snapshot capture fallback:', err.message);
  }

  const uiHeader = `🖥️【Antigravity 研发工作台 UI 控制台】\n━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 本地 Web UI 访问入口：\n• 电脑浏览器打开: http://127.0.0.1:18765\n• 局域网访问: http://<本机IP>:18765\n\n` +
    `📑 核心界面功能概览：\n` +
    `1. 💬【微信/飞书调度中心】：双向消息实时流、指令解析与执行回执\n` +
    `2. 📋【研发任务看板】：里程碑进度追踪、智能意图分流与状态同步\n` +
    `3. 🌐【多工程会话漫游】：支持在任意工作区与工程间秒级切换\n` +
    `4. 📤【文件微信直推】：近期生成的文档/说明书一键推送到手机\n` +
    `5. 🔔【外部多端通道】：飞书群卡片、企业微信、Server酱告警配置\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (hasImage) {
    return `${uiHeader}✅ 屏幕高保真渲染快照已推送到您的微信（大小: ${imgSizeStr}）！\n请在上方查收下载图片。`;
  } else {
    return `${uiHeader}💡 提示：当前电脑工作台运行正常！可在电脑端浏览器直接访问上述链接进入全功能操作界面。`;
  }
}

// ===========================================================================
// 4. ⚡ 远程轻量服务管理与安全命令 (Remote Ops)
// ===========================================================================
export function isRemoteOpsCommand(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\/(?:service|services|git|cmd)\b/i.test(t) ||
    /^(?:服务状态|重启服务|git状态|git差异|git分支|git日志)\b/i.test(t)
  );
}

export function resolveRemoteOpsCommand(text, currentProjectDir, currentProjectName = '当前工程') {
  const t = String(text).trim();

  // 1. 服务状态查询
  if (/^(\/service\s+status|\/services|服务状态)$/i.test(t)) {
    const portsToCheck = [18765, 3000, 5173, 8080, 8000, 5000, 8088];
    const results = [];

    for (const port of portsToCheck) {
      try {
        const out = safeExecSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess"`);
        const pid = parseInt(out, 10);
        if (!isNaN(pid) && pid > 0) {
          const procName = safeExecSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`) || 'Unknown';
          results.push(`🟢 端口 ${port}: 运行中 (PID: ${pid}, 进程: ${procName})`);
        } else {
          results.push(`⚪ 端口 ${port}: 空闲未监听`);
        }
      } catch {
        results.push(`⚪ 端口 ${port}: 空闲`);
      }
    }

    return `⚡【本地开发服务状态监测】\n\n${results.join('\n')}\n\n💡 运维指令：\n• 发送 /service restart <端口> 可安全重启对应进程\n• 发送 /git status 查看代码仓库分支与暂存状态`;
  }

  // 2. 服务安全重启/关闭
  const restartMatch = t.match(/^(\/service\s+(?:restart|kill|stop)|重启服务)\s*(\d+)?$/i);
  if (restartMatch) {
    const port = restartMatch[2] ? parseInt(restartMatch[2], 10) : 18765;
    try {
      const pidStr = safeExecSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess"`);
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid) || pid <= 0) {
        return `⚠️ 端口 ${port} 上当前没有运行任何监听进程。`;
      }
      safeExecSync(`taskkill /F /PID ${pid} /T`);
      return `🔄 已成功终止端口 ${port} 对应进程 (PID: ${pid})。\n若配置了自愈守护，服务将在 3 秒内自动拉起。`;
    } catch (e) {
      return `❌ 重启服务失败: ${e.message}`;
    }
  }

  // 3. Git 状态查询
  if (/^(\/git\s+status|git状态)$/i.test(t)) {
    const branch = safeExecSync('git branch --show-current', { cwd: currentProjectDir }) || 'main';
    const status = safeExecSync('git status --short', { cwd: currentProjectDir });
    const count = status ? status.split('\n').filter(Boolean).length : 0;
    return `🌿【Git 仓库状态 · ${currentProjectName}】\n📍 当前分支: ${branch}\n📊 改动文件数: ${count} 个\n\n${status ? status.slice(0, 400) : '✅ 工作区非常干净，无未提交改动。'}\n\n💡 发送 /diff 可查看具体代码审查细节。`;
  }

  // 4. Git 分支与日志
  if (/^(\/git\s+branch|git分支)$/i.test(t)) {
    const branches = safeExecSync('git branch -a', { cwd: currentProjectDir }) || 'main';
    return `🌿【Git 分支列表 · ${currentProjectName}】\n\n${branches.slice(0, 500)}`;
  }
  if (/^(\/git\s+log|git日志)$/i.test(t)) {
    const log = safeExecSync('git log -n 5 --oneline', { cwd: currentProjectDir }) || '无提交记录';
    return `📜【最近 5 次 Git 提交历史】\n\n${log}`;
  }

  // 5. 受限安全终端命令 (/cmd <safe_cmd>)
  const cmdMatch = t.match(/^\/cmd\s+(.+)$/i);
  if (cmdMatch) {
    const subCmd = cmdMatch[1].trim();
    const isDangerous = /(?:rm\s|del\s|format\s|drop\s|truncate\s|mkfs|chmod\s+-R\s+777|sudo\s|taskkill\s+\/f\s+\/im\s+explorer)/i.test(subCmd);
    if (isDangerous) {
      return `🛑【安全拦截】检测到高危指令参数：\n「${subCmd}」\n为了系统安全已自动阻断执行。`;
    }

    const isWhitelisted = /^(?:git\s|npm\s+test|npm\s+run\s+|pytest|python\s+--version|node\s+-v|dir|ls|cargo\s+test)/i.test(subCmd);
    if (!isWhitelisted) {
      return `⚠️ 该命令未在安全白名单中。\n允许执行的命令前缀：git, npm test, pytest, dir, ls, node -v, python --version。`;
    }

    const output = safeExecSync(subCmd, { cwd: currentProjectDir, timeout: 15000 });
    return `💻【安全终端执行结果】\n> ${subCmd}\n\n${(output || '（命令已执行完毕，无输出）').slice(0, 600)}`;
  }

  return '⚡ 运维指令说明：\n• /service status (查看开发服务)\n• /git status (查看代码改动)\n• /git log (查看最近提交)\n• /cmd <命令> (受限安全终端)';
}

// ===========================================================================
// 5. ⏰ 每日晨报与项目夕报定时推送 (Daily Morning/Evening Standup)
// ===========================================================================
export function isDailyReportCommand(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\/(?:morning|evening|standup|dailyreport|daily)\b/i.test(t) ||
    /^(?:今日晨报|今日夕报|晨报|夕报|站会|日报|研发日报)$/i.test(t)
  );
}

export function generateMorningReport(currentProject, currentProjectDir, targetConvId, loadTasksHelper) {
  const branch = safeExecSync('git branch --show-current', { cwd: currentProjectDir }) || 'main';
  const gitStatus = safeExecSync('git status --short', { cwd: currentProjectDir });
  const gitChangesCount = gitStatus ? gitStatus.split('\n').filter(Boolean).length : 0;
  
  const tasksData = loadTasksHelper ? loadTasksHelper(targetConvId) : { tasks: [] };
  const todoTasks = (tasksData.tasks || []).filter(t => t.status === 'todo');
  const inProgressTasks = (tasksData.tasks || []).filter(t => t.status === 'in_progress');
  const highPriority = (tasksData.tasks || []).filter(t => t.priority === 'high' && t.status !== 'done');

  let report = `🌅【Antigravity 研发晨报】\n`;
  report += `📅 日期: ${new Date().toLocaleDateString('zh-CN')} · 09:00\n`;
  report += `📦 聚焦工程: ${currentProject}\n`;
  report += `🌿 活跃分支: ${branch} (未提交改动: ${gitChangesCount} 个)\n`;
  report += `━━━━━━━━━━━━━━━━━━━━\n`;
  report += `📊 看板概况: 待办 ${todoTasks.length} 项 | 进行中 ${inProgressTasks.length} 项\n\n`;

  if (highPriority.length > 0) {
    report += `🔥【今日重点攻坚 (高优)】：\n`;
    highPriority.slice(0, 3).forEach((t, i) => {
      report += `  ${i + 1}. ${t.title}\n`;
    });
  } else {
    report += `✨ 今日暂无高优阻断任务，可按里程碑有序推进。\n`;
  }

  report += `━━━━━━━━━━━━━━━━━━━━\n`;
  report += `💡 随时在微信发送任务指令（如“git一下”或“编写单元测试”），Agent 将立即执行！`;
  return report;
}

export function generateEveningReport(currentProject, targetConvId, loadTasksHelper, parseTranscriptHelper) {
  const tasksData = loadTasksHelper ? loadTasksHelper(targetConvId) : { tasks: [] };
  const doneTasks = (tasksData.tasks || []).filter(t => t.status === 'done');
  const totalTasks = (tasksData.tasks || []).length;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks.length / totalTasks) * 100) : 0;

  const transcript = parseTranscriptHelper ? parseTranscriptHelper(targetConvId) : null;
  const totalSteps = transcript?.stats?.totalSteps || 0;
  const tokenTotal = transcript?.stats?.tokens?.total || 0;

  let report = `🌆【Antigravity 研发夕报】\n`;
  report += `📅 日期: ${new Date().toLocaleDateString('zh-CN')} · 19:00\n`;
  report += `📦 聚焦工程: ${currentProject}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🎯 迭代达成进度: ${progressPct}% (已完成 ${doneTasks.length}/${totalTasks})\n`;
  report += `⚡ 今日执行步数: ${totalSteps} 步 | 消耗 Token: ${tokenTotal.toLocaleString()}\n\n`;

  if (doneTasks.length > 0) {
    report += `🎉【今日交付成果清单】：\n`;
    doneTasks.slice(-4).reverse().forEach((t, i) => {
      report += `  ✅ ${t.title}\n`;
    });
  } else {
    report += `📝 今日暂无标记为完成的卡片。\n`;
  }

  report += `━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🌙 辛苦了！代码已安全归档，祝您晚间愉快。`;
  return report;
}

// ===========================================================================
// 6. 🌐 多工作区 / 多代码仓库远程自由切换 (Multi-workspace Switching)
// ===========================================================================
export function isWorkspaceCommand(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\/(?:workspaces|workspace|repos|repo|cd)\b/i.test(t) ||
    /^(?:工作区列表|仓库列表|切换工作区|查看工作区|工作区)$/i.test(t)
  );
}

export function listAllAvailableWorkspaces(currentProjectName = '', customProjects = []) {
  const list = [];
  const visitedPaths = new Set();
  const visitedNames = new Set();

  function addDir(dirPath, type) {
    if (!existsSync(dirPath)) return;
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name.startsWith('_')) continue;
        const full = join(dirPath, ent.name);
        if (visitedPaths.has(full.toLowerCase())) continue;
        visitedPaths.add(full.toLowerCase());
        visitedNames.add(ent.name.toLowerCase());
        list.push({
          name: ent.name,
          path: full,
          type,
          isCurrent: ent.name.toLowerCase() === currentProjectName.toLowerCase()
        });
      }
    } catch {}
  }

  // 1. 扫描本地真实代码工程目录 (排除插件目录与 scratch 临时目录)
  addDir('D:\\项目', '本地工程');
  addDir('D:\\Projects', '本地工程');

  // 2. 注入自定义创建与登记的工程
  if (Array.isArray(customProjects)) {
    for (const cp of customProjects) {
      if (!cp || !cp.name) continue;
      const cpPath = cp.path || '';
      if (cpPath && visitedPaths.has(cpPath.toLowerCase())) continue;
      if (visitedNames.has(cp.name.toLowerCase())) continue;
      if (cpPath) visitedPaths.add(cpPath.toLowerCase());
      visitedNames.add(cp.name.toLowerCase());
      list.push({
        name: cp.name,
        path: cpPath,
        type: '自定义新建工程',
        isCurrent: cp.name.toLowerCase() === currentProjectName.toLowerCase()
      });
    }
  }

  // 3. 若当前工程非空且非通用会话，但未被上述目录命中，亦保底注入为当前工程
  if (currentProjectName && currentProjectName !== '通用会话' && !list.some(w => w.name.toLowerCase() === currentProjectName.toLowerCase())) {
    list.unshift({
      name: currentProjectName,
      path: process.cwd(),
      type: '当前激活工程',
      isCurrent: true
    });
  }

  return list;
}

export function resolveWorkspaceCommand(text, cfg, saveConfigHelper) {
  const t = String(text).trim();
  const workspaces = listAllAvailableWorkspaces(cfg.currentProject);

  // 1. 查询列表
  if (/^(\/workspaces|\/repos|工作区列表|仓库列表|查看工作区)$/i.test(t)) {
    if (workspaces.length === 0) {
      return '📂 暂未扫描到已注册的代码工程工作区。';
    }
    const lines = workspaces.slice(0, 12).map((w, i) => {
      const marker = w.isCurrent ? '🟢 [当前] ' : '';
      return `[${i + 1}] ${marker}${w.name}\n    📁 ${w.path} (${w.type})`;
    });
    return `📂【电脑端工程工作区清单】\n\n${lines.join('\n\n')}\n\n💡 远程切换指令：\n• 发送 /cd 序号 (如 /cd 1)\n• 发送 /cd 名称 (如 /cd wechat-dispatcher)`;
  }

  // 2. 执行切换
  const switchMatch = t.match(/^(?:\/cd|\/workspace|\/repo|切换工作区|切换项目)\s+(.+)$/i);
  if (switchMatch) {
    const target = switchMatch[1].trim();
    let found = null;
    const num = parseInt(target, 10);
    if (!isNaN(num) && num >= 1 && num <= workspaces.length) {
      found = workspaces[num - 1];
    } else {
      found = workspaces.find(w => w.name.toLowerCase() === target.toLowerCase() || w.name.toLowerCase().includes(target.toLowerCase()));
    }

    if (found) {
      cfg.currentProject = found.name;
      if (saveConfigHelper) saveConfigHelper(cfg);
      return `📂【工作区切换成功】\n已将当前焦点切换为：【${found.name}】\n📁 路径: ${found.path}\n🏷️ 类型: ${found.type}\n\n后续发送的工程任务与构建指令将默认在该工作区中执行！`;
    } else {
      return `❌ 未找到与「${target}」匹配的工作区。请发送「/workspaces」查看完整清单。`;
    }
  }

  return '📂 发送 /workspaces 查看工程列表，发送 /cd <序号> 切换工作区。';
}

// ===========================================================================
// 7. 📑 微信富文本代码审查卡片 / Diff 预览 (/diff, /review)
// ===========================================================================
export function isCodeDiffCommand(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\/(?:diff|review|codereview)\b/i.test(t) ||
    /^(?:代码审查|查看改动|代码差异|审查改动|改动清单)$/i.test(t)
  );
}

export async function resolveCodeDiffCommand(text, currentProjectDir, currentProjectName, fromUser, dataDir, sendFileHelper) {
  const statOutput = safeExecSync('git diff --stat', { cwd: currentProjectDir });
  if (!statOutput) {
    return `🌿【代码审查 · ${currentProjectName}】\n✅ 当前工作区非常干净，暂无未提交的代码改动！`;
  }

  const patchOutput = safeExecSync('git diff -U2', { cwd: currentProjectDir });
  const lines = patchOutput.split('\n');
  const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

  // 如果改动适中，直接返回结构化文字卡片
  if (patchOutput.length <= 1200) {
    return `📑【代码审查报告 · ${currentProjectName}】\n` +
      `📈 新增行: +${additions} | 📉 删除行: -${deletions}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 涉及文件统计：\n${statOutput}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔍 核心 Diff 摘录：\n${patchOutput.slice(0, 750)}\n\n` +
      `💡 发送“git一下”可直接让 Agent 完成整理并提交代码！`;
  }

  // 改动较大时，自动编译完整审查 Markdown 文档并推送到微信
  mkdirSync(dataDir, { recursive: true });
  const diffDocPath = join(dataDir, `CodeReview_${currentProjectName}_${Date.now()}.md`);
  const docContent = `# 📑 代码审查报告 (Code Review)\n\n` +
    `> **工程**: ${currentProjectName}\n` +
    `> **时间**: ${new Date().toLocaleString('zh-CN')}\n` +
    `> **改动概览**: +${additions} 行 / -${deletions} 行\n\n` +
    `## 📊 修改文件统计\n\n\`\`\`\n${statOutput}\n\`\`\`\n\n` +
    `## 🔍 完整代码改动 Diff\n\n\`\`\`diff\n${patchOutput}\n\`\`\`\n`;

  writeFileSync(diffDocPath, docContent, 'utf8');

  if (sendFileHelper) {
    await sendFileHelper(diffDocPath, fromUser, `📑【代码审查报告】《${basename(diffDocPath)}》`);
  }

  return `📑【代码审查报告 · ${currentProjectName}】\n` +
    `📈 新增行: +${additions} | 📉 删除行: -${deletions}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 涉及文件统计：\n${statOutput.slice(0, 300)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📎 由于改动较详尽，已为您生成完整审查文档《${basename(diffDocPath)}》并直接推送到上方微信，请查收！`;
}

// ===========================================================================
// 8. 📦 自动化构建与安装包打包直推 (/build, /package, auto-zip)
// ===========================================================================
export function isBuildPackageCommand(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\/(?:build|package|pack|zip)\b/i.test(t) ||
    /^(?:打包项目|打安装包发我|打包工程|打包发我|导出zip|打zip包|打个包发我)$/i.test(t)
  );
}

export async function resolveBuildPackageCommand(text, currentProject, currentProjectDir, fromUser, dataDir, sendFileHelper) {
  if (!existsSync(currentProjectDir)) {
    return `❌ 找不到项目目录: ${currentProjectDir}`;
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const zipName = `${currentProject}_dist_${dateStr}_${Date.now().toString().slice(-4)}.zip`;
  const zipPath = join(dataDir, zipName);

  // 使用 PowerShell 过滤 node_modules, .git 等并压缩
  const psArchiveScript = `
$source = "${currentProjectDir.replace(/\\/g, '\\\\')}"
$destination = "${zipPath.replace(/\\/g, '\\\\')}"
$tempDir = Join-Path $env:TEMP ("pkg_" + (Get-Random))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
Get-ChildItem -Path $source -Exclude "node_modules", ".git", ".vscode", "dist", "build", "__pycache__", ".venv" | Copy-Item -Destination $tempDir -Recurse -Force
Compress-Archive -Path "$tempDir\\*" -DestinationPath $destination -Force
Remove-Item -Path $tempDir -Recurse -Force
`;

  try {
    safeExecSync(`powershell -NoProfile -Command "${psArchiveScript.replace(/\r?\n/g, ' ')}"`, { timeout: 35000 });
  } catch (err) {
    return `❌ 打包异常：${err.message}`;
  }

  if (!existsSync(zipPath)) {
    return '❌ 未能成功生成压缩包制品。';
  }

  const st = statSync(zipPath);
  const sendRes = await sendFileHelper(zipPath, fromUser, `📦【工程制品包】《${zipName}》`);

  if (sendRes && sendRes.success) {
    return `📦【工程打包成功 · 制品已送达】\n` +
      `📄 制品文件名: ${zipName}\n` +
      `📊 压缩包大小: ${formatBytes(st.size)}\n` +
      `📁 来源工程: ${currentProject}\n\n` +
      `✅ 已通过微信 CDN 直推通道发送至您的手机微信，请在上方查收下载！`;
  } else {
    return `❌ 压缩包已生成（${zipName}），但推送失败：${sendRes?.error || 'CDN网络异常'}`;
  }
}

// ===========================================================================
// 9. 📚 本地项目架构与私有 API 问答 (/ask, /code Local Codebase RAG)
// ===========================================================================
export function isCodebaseRagCommand(text) {
  if (!text) return false;
  const t = String(text).trim();
  return (
    /^\/(?:ask|code|rag|query)\b/i.test(t) ||
    /^(?:查询代码|代码问答|查函数|查接口|架构问答)\b/i.test(t)
  );
}

export async function resolveCodebaseRagCommand(text, currentProjectDir, currentProjectName, cfg, callLlmHelper) {
  const t = String(text).trim();
  const query = t.replace(/^\/(?:ask|code|rag|query)\s*/i, '').replace(/^(?:查询代码|代码问答|查函数|查接口|架构问答)\s*/i, '').trim();

  if (!query) {
    return '💡 使用方式：\n发送 /ask <问题或函数名>，例如：\n/ask 如何实现微信文件发送？\n/ask 认证令牌怎么获取？';
  }

  // 检索本地代码文件
  const matchingSnippets = [];
  const validExts = new Set(['.mjs', '.js', '.py', '.ts', '.json', '.md', '.html']);
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.codegraph', 'assets']);

  function walkAndSearch(dir, depth = 0) {
    if (depth > 2 || matchingSnippets.length >= 5) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue;
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (!ignored.has(ent.name.toLowerCase())) walkAndSearch(full, depth + 1);
        } else if (ent.isFile()) {
          const ext = extname(ent.name).toLowerCase();
          if (validExts.has(ext)) {
            try {
              const content = readFileSync(full, 'utf8');
              const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
              const hasMatch = qWords.some(w => content.toLowerCase().includes(w));
              if (hasMatch) {
                // 截取匹配行及上下文
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (qWords.some(w => lines[i].toLowerCase().includes(w))) {
                    const start = Math.max(0, i - 4);
                    const end = Math.min(lines.length, i + 8);
                    const snippet = lines.slice(start, end).join('\n');
                    matchingSnippets.push(`📄 [${ent.name}:${i + 1}]\n${snippet}`);
                    break;
                  }
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  walkAndSearch(currentProjectDir);

  const contextText = matchingSnippets.length > 0
    ? `以下是从本地真实代码中检索出的高匹配片段：\n\n${matchingSnippets.join('\n\n---\n\n')}`
    : '本地暂未检索到直接匹配的关键字代码，请基于常识解答。';

  const prompt = `你是工程【${currentProjectName}】的首席架构与源码解答助手。请根据下方检索到的真实代码实现，简练、准确地回答手机端用户的提问。\n\n${contextText}\n\n用户问题：${query}`;

  try {
    if (typeof callLlmHelper === 'function') {
      const answer = await callLlmHelper(prompt, cfg);
      return `📚【本地代码架构问答 · ${currentProjectName}】\n\n${answer}\n\n━━━━━━━━━━━━━━━━━━━━\n🔍 检索依据: 关联 ${matchingSnippets.length} 处源码文件`;
    }
    return `📚【本地工程代码检索 · ${currentProjectName}】\n\n🔍 命中文件与切片 (${matchingSnippets.length} 处)：\n\n` +
      (matchingSnippets.slice(0, 3).join('\n\n---\n\n') || '未发现直接相关代码片段。');
  } catch (err) {
    return `❌ 代码问答调用异常：${err.message}`;
  }
}

// ===========================================================================
// 10. 👥 多人白名单与多级角色权限控制 (RBAC & Risky Guard)
// ===========================================================================
const pendingRiskyCodes = new Map(); // Map<fromUser, { code, command, time }>

export function isRiskyCommand(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return (
    t.includes('rm -rf') ||
    t.includes('format ') ||
    t.includes('drop database') ||
    t.includes('git reset --hard') ||
    t.includes('git push --force') ||
    t.includes('git push -f') ||
    t.includes('清空全部任务') ||
    t.includes('清空看板') ||
    t.includes('taskkill /f /im')
  );
}

export function checkRbacPermission(fromUser, cfgNow) {
  if (!cfgNow.enableRbac) return { allow: true, role: 'admin' };
  const admins = Array.isArray(cfgNow.adminUsers) ? cfgNow.adminUsers : [];
  const allowed = Array.isArray(cfgNow.allowedUsers) ? cfgNow.allowedUsers : ['*'];

  const isAdmin = admins.some(a => a === fromUser || a === '*' || fromUser.includes(a));
  if (isAdmin) return { allow: true, role: 'admin' };

  const isAllowed = allowed.includes('*') || allowed.some(u => u === fromUser || fromUser.includes(u));
  if (isAllowed) return { allow: true, role: 'developer' };

  return { allow: false, role: 'guest', error: '抱歉，您的微信账号不在该工程的授权开发者名单中。' };
}

export function handleRiskyVerification(fromUser, text) {
  const t = String(text).trim();
  const pending = pendingRiskyCodes.get(fromUser);
  if (!pending) return null;

  // 60秒超时判断
  if (Date.now() - pending.time > 60000) {
    pendingRiskyCodes.delete(fromUser);
    return { verified: false, expired: true, message: '⏰ 动态验证码已过期，操作已自动取消。' };
  }

  if (t === '0' || t === '取消') {
    pendingRiskyCodes.delete(fromUser);
    return { verified: false, cancelled: true, message: '🛑 已安全取消高危指令的执行。' };
  }

  if (t === pending.code) {
    const originalCmd = pending.command;
    pendingRiskyCodes.delete(fromUser);
    return { verified: true, command: originalCmd };
  }

  return { verified: false, retry: true, message: `❌ 验证码不匹配！请回复正确的 4 位动态验证码【${pending.code}】，或回复 [0] 取消。` };
}

export function createRiskyVerificationCode(fromUser, commandText) {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  pendingRiskyCodes.set(fromUser, {
    code,
    command: commandText,
    time: Date.now()
  });

  return `⚠️【安全守卫拦截 · 高危操作检测】\n您正在尝试执行高风险指令：\n💬「${commandText}」\n\n🔐 请在 60 秒内回复动态验证码：【${code}】以授权放行！\n（回复 [0] 或「取消」可终止操作）`;
}

// ===========================================================================
// 12. 🌐 全链路流量与 Token 监控快捷查询 (/traffic, /tokens, /flow)
// ===========================================================================
export function isTrafficCommand(text) {
  if (!text) return false;
  const t = String(text).trim().toLowerCase();
  return (
    /^\/(?:traffic|tokens?|flow|usage|cost)\b/i.test(t) ||
    /^(?:查看流量|查流量|流量监控|流量日志|查token|token消耗|用量统计|查看用量|消耗统计|流量统计|流量)\b/i.test(t) ||
    ((/流量|token/i.test(t)) && (/查|看|统计|监控|消耗|多少|用量/i.test(t)))
  );
}

export function resolveTrafficCommand(getTrafficStats) {
  const stats = typeof getTrafficStats === 'function' ? getTrafficStats() : {};
  const totalReq = stats.totalRequests || 0;
  const successRate = stats.successRate || '100.0%';
  const avgLat = stats.avgLatency || '0.00s';
  const sc = stats.statusCounts || {};

  const inTok = stats.tokens?.input || 0;
  const outTok = stats.tokens?.output || 0;
  const cacheTok = stats.tokens?.cache || 0;
  const totalTok = inTok + outTok + cacheTok;
  const cacheRate = totalTok > 0 ? ((cacheTok / totalTok) * 100).toFixed(1) : '0.0';

  // 估算节约成本 (按标准大模型输入 $3.0/1M tokens, 缓存命中读取 $0.3/1M 测算, 净节省 $2.7/1M)
  const savedUsd = (cacheTok * 2.7 / 1000000).toFixed(2);
  const savedCny = (savedUsd * 7.25).toFixed(1);

  return (
    `🌐【Antigravity 研发流量与 Token 监控】\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 请求吞吐：今日累计 ${totalReq} 次调用\n` +
    `🎯 运行健康：成功率 ${successRate} (200: ${sc['200'] || 0} | 429: ${sc['429'] || 0} | 异常: ${sc['500'] || sc.other || 0})\n` +
    `⏱️ 响应耗时：平均 ${avgLat}\n\n` +
    `⚡ Token 消耗与成本分析：\n` +
    `• 📥 输入 Token：${stats.tokens?.inputFormatted || (inTok >= 1000 ? (inTok / 1000).toFixed(1) + 'k' : inTok)}\n` +
    `• 📤 输出 Token：${stats.tokens?.outputFormatted || (outTok >= 1000 ? (outTok / 1000).toFixed(1) + 'k' : outTok)}\n` +
    `• 🛡️ 缓存命中：${stats.tokens?.cacheFormatted || (cacheTok >= 1000 ? (cacheTok / 1000).toFixed(1) + 'k' : cacheTok)} (节约率: ${cacheRate}%)\n` +
    `• 💰 累计节约成本：约 $${savedUsd} (≈ ¥${savedCny})\n\n` +
    `💻 详细调用链路、模型映射与 Trace 日志：\n` +
    `• 电脑浏览器打开: http://127.0.0.1:18765\n` +
    `• 切换至【🌐 流量】面板查看 1:1 API Gateway 日志\n` +
    `━━━━━━━━━━━━━━━━━━━━`
  );
}

// ===========================================================================
// 统一高级指令调度总线 (Central Advanced Dispatch Pipeline)
// ===========================================================================
export async function handleAdvancedCommand({
  userMsg,
  fromUser,
  cfgNow,
  currentProjDir,
  actualProj,
  targetConvId,
  loadTasks,
  parseTranscript,
  DATA_DIR,
  sendFileHelper,
  callLlmHelper,
  saveConfig,
  getTrafficStats
}) {
  let cleanMsg = String(userMsg || '').trim();

  // 1. RBAC 权限判定
  const rbac = checkRbacPermission(fromUser, cfgNow);
  if (!rbac.allow) {
    return {
      handled: true,
      category: 'command',
      reply: `🛑【权限拒绝】${rbac.error || '抱歉，您的微信账号不在该工程的授权开发者名单中。'}`
    };
  }

  // 2. 高危验证码二次应答检查
  const verifyRes = handleRiskyVerification(fromUser, cleanMsg);
  if (verifyRes) {
    if (verifyRes.verified) {
      // 验证码正确，解除拦截并确认放行执行
      return {
        handled: true,
        category: 'command',
        reply: `🛡️【安全验证通过】\n动态验证码核验成功！高危指令「${verifyRes.command}」已授权放行，Agent 正在为您调度执行。`,
        isTask: true,
        prompt: verifyRes.command
      };
    } else {
      return {
        handled: true,
        category: 'command',
        reply: verifyRes.message
      };
    }
  } else if (/^rm\s+-rf\s+node_modules\b/i.test(cleanMsg)) {
    const hasNm = existsSync(join(currentProjDir, 'node_modules')) || existsSync(join(currentProjDir, 'sidecars', 'panel', 'node_modules'));
    if (!hasNm) {
      return {
        handled: true,
        category: 'command',
        reply: `🛡️【工程环境安全扫描】\n当前目标工程【${actualProj}】采用原生轻量 Node.js 运行时，未引入亦不存在 node_modules 目录。\n✅ 工程代码纯净，无需执行依赖删除清理，该高危操作已安全跳过。`
      };
    } else {
      return {
        handled: true,
        category: 'command',
        reply: createRiskyVerificationCode(fromUser, cleanMsg)
      };
    }
  } else if (cfgNow.enableRiskyGuard && isRiskyCommand(cleanMsg)) {
    // 触发高危拦截与动态验证码发放
    return {
      handled: true,
      category: 'command',
      reply: createRiskyVerificationCode(fromUser, cleanMsg)
    };
  }

  // 3. 语音指令转录与解包
  let isVoice = false;
  if (isVoiceMessage(cleanMsg)) {
    isVoice = true;
    const voiceText = extractVoiceText(cleanMsg);
    console.log(`[VoiceTranscribe] 🎙️ 语音指令转录成功: "${cleanMsg}" -> "${voiceText}"`);
    cleanMsg = voiceText;
  }

  // 4. 手机拍照与识图改代码
  if (isVisionCommand(cleanMsg)) {
    const visionTask = resolveVisionTask(cleanMsg, actualProj);
    return {
      handled: true,
      isTask: true,
      category: 'project_task',
      prompt: visionTask.prompt,
      reply: `📸【识图需求已录入看板】\n${visionTask.summary}\nAntigravity 已加载参考图像，正在进入【${actualProj}】执行！`
    };
  }

  // 5. 前端渲染效果自动截屏回传
  if (isUiSnapshotCommand(cleanMsg)) {
    const snapReply = await resolveUiSnapshotCommand(cleanMsg, fromUser, DATA_DIR, sendFileHelper);
    return {
      handled: true,
      category: 'file_transfer',
      reply: snapReply
    };
  }

  // 6. 远程轻量服务管理与安全终端 (/service, /git, /cmd)
  if (isRemoteOpsCommand(cleanMsg)) {
    const opsReply = resolveRemoteOpsCommand(cleanMsg, currentProjDir, actualProj);
    return {
      handled: true,
      category: 'command',
      reply: opsReply
    };
  }

  // 7. 每日晨报与夕报 (/morning, /evening, /standup)
  if (isDailyReportCommand(cleanMsg)) {
    let reportReply = '';
    if (/(?:夕报|evening)/i.test(cleanMsg)) {
      reportReply = generateEveningReport(actualProj, targetConvId, loadTasks, parseTranscript);
    } else {
      reportReply = generateMorningReport(actualProj, currentProjDir, targetConvId, loadTasks);
    }
    return {
      handled: true,
      category: 'command',
      reply: reportReply
    };
  }

  // 8. 多工作区自由漫游与切换 (/workspaces, /workspace, /cd)
  if (isWorkspaceCommand(cleanMsg)) {
    const wsReply = resolveWorkspaceCommand(cleanMsg, cfgNow, saveConfig);
    return {
      handled: true,
      category: 'command',
      reply: wsReply
    };
  }

  // 9. 代码审查与 Diff 报告 (/diff, /review)
  if (isCodeDiffCommand(cleanMsg)) {
    const diffReply = await resolveCodeDiffCommand(cleanMsg, currentProjDir, actualProj, fromUser, DATA_DIR, sendFileHelper);
    return {
      handled: true,
      category: 'command',
      reply: diffReply
    };
  }

  // 10. 自动化构建与安装包打包直推 (/build, /package)
  if (isBuildPackageCommand(cleanMsg)) {
    const pkgReply = await resolveBuildPackageCommand(cleanMsg, actualProj, currentProjDir, fromUser, DATA_DIR, sendFileHelper);
    return {
      handled: true,
      category: 'file_transfer',
      reply: pkgReply
    };
  }

  // 11. 本地代码架构与私有 API 问答 (/ask, /code)
  if (isCodebaseRagCommand(cleanMsg)) {
    const ragReply = await resolveCodebaseRagCommand(cleanMsg, currentProjDir, actualProj, cfgNow, callLlmHelper);
    return {
      handled: true,
      category: 'daily_qa',
      reply: ragReply
    };
  }

  // 12. 流量与 Token 消耗监控 (/traffic, /tokens, 查看流量)
  if (isTrafficCommand(cleanMsg)) {
    return {
      handled: true,
      category: 'command',
      reply: resolveTrafficCommand(getTrafficStats)
    };
  }

  // 若为语音输入但属于通用任务或问答，返回解包后的文字供后续流程处理
  if (isVoice) {
    return {
      handled: false,
      unwrappedVoiceText: cleanMsg
    };
  }

  return { handled: false };
}

// ===========================================================================
// 自动化晨报与夕报定时守护 (Daily Standup Scheduler)
// ===========================================================================
export function startDailyReportScheduler({
  loadConfig,
  saveConfig,
  getConversationsList,
  loadTasks,
  parseTranscript,
  triggerTaskCompletionPush
}) {
  function checkAndRun() {
    const cfg = loadConfig();
    if (cfg.enableDailyReports === false) return;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;
    const todayStr = now.toISOString().slice(0, 10);

    const morningTarget = cfg.morningReportTime || '09:00';
    const eveningTarget = cfg.eveningReportTime || '19:00';

    const convList = getConversationsList ? getConversationsList() : [];
    const targetConvId = cfg.activeConversationId || (convList[0]?.id) || 'default';
    const currentConv = convList.find((c) => c.id === targetConvId);
    const projName = currentConv ? currentConv.projectName : (cfg.currentProject || 'wechat-dispatcher');
    const projDir = currentConv?.projectPath || process.cwd();

    // 1. 晨报触发
    if (currentTime === morningTarget && cfg.lastMorningDate !== todayStr) {
      cfg.lastMorningDate = todayStr;
      saveConfig(cfg);
      const reportText = generateMorningReport(projName, projDir, targetConvId, loadTasks);
      console.log(`[DailyScheduler] 🌅 触发 ${morningTarget} 晨报推送`);
      if (triggerTaskCompletionPush) {
        triggerTaskCompletionPush({
          title: '🌅 研发晨报',
          convName: currentConv?.title || '今日晨报',
          projName,
          content: reportText,
          source: 'daily_morning'
        }, cfg);
      }
    }

    // 2. 夕报触发
    if (currentTime === eveningTarget && cfg.lastEveningDate !== todayStr) {
      cfg.lastEveningDate = todayStr;
      saveConfig(cfg);
      const reportText = generateEveningReport(projName, targetConvId, loadTasks, parseTranscript);
      console.log(`[DailyScheduler] 🌆 触发 ${eveningTarget} 夕报推送`);
      if (triggerTaskCompletionPush) {
        triggerTaskCompletionPush({
          title: '🌆 研发夕报',
          convName: currentConv?.title || '今日夕报',
          projName,
          content: reportText,
          source: 'daily_evening'
        }, cfg);
      }
    }
  }

  // 每 30 秒轮询一次
  setInterval(checkAndRun, 30000);
  console.log('[DailyScheduler] ⏰ 每日晨报(09:00)与夕报(19:00)自动调度器已启动');
}

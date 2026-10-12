// AI助手 - 侧边栏前端交互逻辑
(function () {
  let activeTab = localStorage.getItem('ai-assistant-active-tab') || 'tab-timeline';
  let currentConversationId = '';
  let autoRefreshTimer = null;
  let cachedConfig = null;
  let activeWechatFilter = 'all';
  let activeTimelineFilter = 'all';

  // DOM 元素引用
  const sessionSelect = document.getElementById('sessionSelect');
  const gatewayBadge = document.getElementById('gatewayBadge');
  const dispatchBadge = document.getElementById('dispatchBadge');
  const btnRefreshAll = document.getElementById('btnRefreshAll');
  const taskCountBadge = document.getElementById('taskCountBadge');
  const wechatCountBadge = document.getElementById('wechatCountBadge');

  const autoDispatchedIds = new Set();
  const CLIENT_INSTANCE_ID = 'client_' + Math.random().toString(36).slice(2, 8);
  let lastDispatchedPrompt = '';
  let lastDispatchedTime = 0;
  let toastTimer = null;

  function showToast(msg, isError = false) {
    const toast = document.getElementById('toastNotification');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.toggle('error', isError);
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3500);
  }

  // 统一接口请求器：自动在宿主面板注入 X-Sidecar-Token，独立 Web 浏览器无缝降级
  async function apiFetch(url, options = {}) {
    const opts = { ...options };
    const headers = new Headers(opts.headers || {});
    if (opts.body && typeof opts.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    opts.headers = headers;

    if (window.sidecar && typeof window.sidecar.fetch === 'function') {
      return window.sidecar.fetch(url, opts);
    }
    return fetch(url, opts);
  }

  // 通用自定义确认对话框：避免沙箱 iframe 中 window.confirm 被静默屏蔽
  function requestConfirm({ title = '⚠️ 操作确认', message = '确定要执行此操作吗？', confirmText = '确认执行', onConfirm }) {
    const modal = document.getElementById('modalConfirm');
    if (!modal) {
      if (confirm(message)) {
        if (typeof onConfirm === 'function') onConfirm();
      }
      return;
    }
    const titleEl = document.getElementById('confirmDialogTitle');
    const msgEl = document.getElementById('confirmDialogMessage');
    const btnOk = document.getElementById('btnExecuteConfirmAction');
    const btnClose = document.getElementById('btnCancelConfirm');
    const btnCancel = document.getElementById('btnCancelConfirmAction');

    titleEl.textContent = title;
    msgEl.textContent = message;
    btnOk.textContent = confirmText;

    const handleOk = async () => {
      modal.classList.add('hidden');
      cleanup();
      if (typeof onConfirm === 'function') {
        try {
          await onConfirm();
        } catch (err) {
          console.error('Confirm action error:', err);
          showToast(`操作失败: ${err.message}`, true);
        }
      }
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      cleanup();
    };

    function cleanup() {
      btnOk.removeEventListener('click', handleOk);
      if (btnClose) btnClose.removeEventListener('click', handleCancel);
      if (btnCancel) btnCancel.removeEventListener('click', handleCancel);
    }

    btnOk.addEventListener('click', handleOk);
    if (btnClose) btnClose.addEventListener('click', handleCancel);
    if (btnCancel) btnCancel.addEventListener('click', handleCancel);

    modal.classList.remove('hidden');
  }

  async function dispatchToAgent(taskOrMsg, isNewChat = false) {
    const sidecar = window.sidecar;
    const rawContent = taskOrMsg.cleanContent || taskOrMsg.title || taskOrMsg.content || '';
    const desc = taskOrMsg.desc && taskOrMsg.desc !== rawContent ? `\n详细说明：${taskOrMsg.desc}` : '';
    const source = taskOrMsg.source || 'wechat';
    const sourceLabel = source === 'feishu' ? '飞书' : (source === 'simulate' ? '模拟' : '微信');
    const defaultSender = source === 'feishu' ? '飞书用户' : '微信用户';
    const from = taskOrMsg.fromUser || taskOrMsg.from || defaultSender;
    const targetProject = taskOrMsg.targetProject ? `\n🎯 目标工程：${taskOrMsg.targetProject}` : '';
    const isDirectChat = !!taskOrMsg.isDirectChat;

    let prompt = '';
    if (isDirectChat || (!desc && rawContent.length < 50)) {
      prompt = [
        `【${sourceLabel}远程指令】来自 [${from}]：`,
        rawContent,
        targetProject ? `（对应工程：${taskOrMsg.targetProject}）` : ''
      ].filter(Boolean).join('\n');
    } else {
      prompt = [
        `【AI助手 任务派发】来自 [${from} (${sourceLabel})]：`,
        `📌 任务需求：${rawContent}${desc}${targetProject}`,
        `\n请分析需求并在当前项目中直接执行操作或代码修改。完成后请简要总结成果。`
      ].filter(Boolean).join('\n');
    }

    const now = Date.now();
    if (prompt === lastDispatchedPrompt && (now - lastDispatchedTime) < 4000) {
      console.warn('[Dispatch] 4秒内相同 Prompt 重复派发已拦截:', prompt);
      return false;
    }
    lastDispatchedPrompt = prompt;
    lastDispatchedTime = now;

    if (!sidecar || !sidecar.agent) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(prompt);
      }
      showToast('未检测到 Antigravity 宿主环境，已复制 Prompt 到剪贴板', true);
      return false;
    }

    try {
      if (isNewChat || taskOrMsg.isNewChat) {
        await sidecar.agent.startConversation(prompt);
        showToast(`🚀 已在新会话中启动任务执行 (${sourceLabel})`);
      } else {
        const targetConvId = taskOrMsg.targetConvId || cachedConfig?.activeConversationId || currentConversationId || sidecar.conversationId;
        if (targetConvId && sidecar.ui?.toggleConversation) {
          sidecar.ui.toggleConversation(targetConvId);
        }
        await sidecar.agent.sendMessage(prompt, targetConvId);
        showToast(`🚀 ${sourceLabel}消息已成功直达目标会话执行！`);
      }
      return true;
    } catch (err) {
      showToast(`派发失败: ${err.message}`, true);
      return false;
    }
  }

  // 初始化
  function init() {
    bindTabs();
    bindTimelineControls();
    bindKanbanEvents();
    bindWechatEvents();
    bindMcpEvents();
    bindSettingsEvents();

    // 切换到上次记忆的 Tab
    switchTab(activeTab);

    // 初始加载
    refreshAll();

    // 开启自动轮询 (3秒)
    startTimelinePolling();

    // 开启后台独立微信任务与会话直通派发监听器 (1.5秒)
    startAutoDispatchWorker();
    checkWechatAutoDispatch();
  }

  // ---------------------------------------------------------------------------
  // 选项卡切换
  // ---------------------------------------------------------------------------
  function bindTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        switchTab(target);
      });
    });
  }

  function switchTab(tabId) {
    activeTab = tabId;
    localStorage.setItem('ai-assistant-active-tab', tabId);

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.view-panel').forEach((panel) => {
      if (panel.id === tabId) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    if (tabId === 'tab-timeline') loadTimeline();
    else if (tabId === 'tab-tasks') loadTasks();
    else if (tabId === 'tab-wechat') loadWechatData();
    else if (tabId === 'tab-mcp') loadMcpServices();
    else if (tabId === 'tab-settings') {
      loadSettings();
      initSettingsCollapsible();
    }

    if (tabId !== 'tab-settings' && typeof stopWechatQrPolling === 'function') {
      stopWechatQrPolling();
    }
  }

  // ---------------------------------------------------------------------------
  // 全局刷新与会话切换
  // ---------------------------------------------------------------------------
  async function refreshAll() {
    try {
      const res = await apiFetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();

      // 响应微信远程会话切换指令，自动在宿主窗口打开该会话
      if (data.pendingSwitchConvId && window.sidecar?.ui?.toggleConversation) {
        window.sidecar.ui.toggleConversation(data.pendingSwitchConvId);
        currentConversationId = data.pendingSwitchConvId;
        apiFetch('/api/config/save', {
          method: 'POST',
          body: JSON.stringify({ pendingSwitchConvId: '' })
        });
        showToast('已响应微信远程指令，切换至指定会话！');
      } else if (data.activeConversationId && !currentConversationId) {
        currentConversationId = data.activeConversationId;
      }

      // 更新会话下拉列表（按工程分组，展示真实中文标题）
      if (Array.isArray(data.conversations) && data.conversations.length > 0) {
        const hostConvId = window.sidecar?.conversationId;
        const cur = currentConversationId || hostConvId || sessionSelect.value || data.activeConversationId;
        sessionSelect.innerHTML = '';

        const groups = {};
        data.conversations.forEach((conv) => {
          const pName = conv.projectName || '默认工程';
          if (!groups[pName]) groups[pName] = [];
          groups[pName].push(conv);
        });

        for (const [pName, convs] of Object.entries(groups)) {
          const optGroup = document.createElement('optgroup');
          optGroup.label = `📦 ${pName}`;
          convs.forEach((conv) => {
            const opt = document.createElement('option');
            opt.value = conv.id;
            const isCurrent = conv.id === hostConvId;
            const prefix = isCurrent ? '🟢 [当前] ' : '';
            opt.textContent = `${prefix}${conv.title || conv.id.slice(0, 8)}`;
            if (conv.id === cur) opt.selected = true;
            optGroup.appendChild(opt);
          });
          sessionSelect.appendChild(optGroup);
        }
        currentConversationId = sessionSelect.value;
      }

      // 更新顶部精致状态指示胶囊
      if (data.xmlPort) {
        gatewayBadge.innerHTML = `<span class="pulse-dot"></span><span class="pill-text">${data.xmlPort}</span>`;
        gatewayBadge.className = 'status-pill status-online';
      }

      if (data.autoDispatch) {
        dispatchBadge.innerHTML = `<span class="pill-icon">⚡</span><span class="pill-text">派发</span>`;
        dispatchBadge.className = 'status-pill status-dispatch';
      } else {
        dispatchBadge.innerHTML = `<span class="pill-text">暂停</span>`;
        dispatchBadge.className = 'status-pill status-offline';
      }

      // 更新计数标签
      if (data.taskStats) {
        taskCountBadge.textContent = data.taskStats.total || '0';
      }

      // 刷新当前活动视图
      if (activeTab === 'tab-timeline') loadTimeline();
      else if (activeTab === 'tab-tasks') loadTasks();
      else if (activeTab === 'tab-wechat') loadWechatData();
    } catch (e) {
      console.error('Refresh status error:', e);
    }
  }

  btnRefreshAll.addEventListener('click', () => {
    refreshAll();
  });

  function openCurrentConversationInHost() {
    const convId = currentConversationId || sessionSelect.value;
    if (!convId) return;
    if (window.sidecar?.ui?.toggleConversation) {
      window.sidecar.ui.toggleConversation(convId);
      const title = sessionSelect.selectedOptions[0]?.textContent || '';
      showToast(`已在 Antigravity 主窗口打开会话：${title}`);
    } else {
      showToast(`当前环境不支持在宿主窗口中切换会话`, true);
    }
  }

  const btnOpenHostConv = document.getElementById('btnOpenHostConv');
  if (btnOpenHostConv) {
    btnOpenHostConv.addEventListener('click', openCurrentConversationInHost);
  }

  sessionSelect.addEventListener('change', () => {
    currentConversationId = sessionSelect.value;
    openCurrentConversationInHost();
    loadTimeline();
    loadTasks();
  });

  // ---------------------------------------------------------------------------
  // 1. 执行流水 (Timeline)
  // ---------------------------------------------------------------------------
  function bindTimelineControls() {
    const chkAuto = document.getElementById('autoRefreshTimeline');
    if (chkAuto) {
      chkAuto.addEventListener('change', () => {
        if (chkAuto.checked) {
          startTimelinePolling();
        } else {
          stopTimelinePolling();
        }
      });
    }

    document.querySelectorAll('.stream-filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.stream-filter-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        activeTimelineFilter = chip.getAttribute('data-filter') || 'all';
        loadTimeline();
      });
    });
  }

  let isCheckingAutoDispatch = false;
  async function checkWechatAutoDispatch(messages = null) {
    if (isCheckingAutoDispatch) return;
    isCheckingAutoDispatch = true;
    try {
      let msgs = messages;
      if (!msgs) {
        const res = await apiFetch('/api/wechat/data');
        if (!res.ok) return;
        const data = await res.json();
        cachedConfig = data.config;
        msgs = data.messages || [];
      }

      if (cachedConfig?.autoDispatch !== false && window.sidecar?.agent) {
        for (const m of msgs) {
          const msgTime = m.time ? new Date(m.time).getTime() : 0;
          const ageMs = msgTime > 0 ? (Date.now() - msgTime) : 0;

          // 1. 超过 2 分钟的历史消息，严禁自动调用 agent 派发或创建会话，自动置为过期状态
          if (msgTime > 0 && ageMs > 120000) {
            if (!autoDispatchedIds.has(m.id)) {
              autoDispatchedIds.add(m.id);
              if (m.status === 'received' || !m.status) {
                m.status = 'expired';
                apiFetch('/api/wechat/mark-dispatched', {
                  method: 'POST',
                  body: JSON.stringify({ id: m.id, status: 'expired' })
                }).catch(() => {});
              }
            }
            continue;
          }

          const isEligible = (m.category === 'project_task' || m.category === 'session_chat' || !m.category) &&
            m.category !== 'daily_qa' && m.category !== 'command' &&
            (m.status === 'received' || !m.status) &&
            !autoDispatchedIds.has(m.id);

          if (isEligible) {
            autoDispatchedIds.add(m.id);

            // 2. 对于新建会话，只允许 60 秒内的最新消息触发，防止历史或重放风暴
            if (m.isNewChat && ageMs > 60000) {
              console.warn(`[AutoDispatch] Skipped stale isNewChat message (${ageMs}ms old):`, m.id);
              m.status = 'expired';
              apiFetch('/api/wechat/mark-dispatched', {
                method: 'POST',
                body: JSON.stringify({ id: m.id, status: 'expired' })
              }).catch(() => {});
              continue;
            }

            // 核心互斥锁：先向服务端原子申请独占认领，防止多 Webview 实例同时派发导致消息重复
            try {
              const claimRes = await apiFetch('/api/wechat/claim-dispatch', {
                method: 'POST',
                body: JSON.stringify({ id: m.id, clientId: CLIENT_INSTANCE_ID })
              });
              if (claimRes.ok) {
                const claimData = await claimRes.json();
                if (!claimData.success) {
                  console.log(`[AutoDispatch] 消息 ${m.id} 已被其他 Webview 实例认领，跳过当前派发`);
                  continue;
                }
              }
            } catch (claimErr) {
              console.warn('[AutoDispatch] Claim dispatch error:', claimErr);
              continue;
            }

            const ok = await dispatchToAgent(m, m.isNewChat);
            if (ok) {
              m.status = 'dispatched';
              await apiFetch('/api/wechat/mark-dispatched', {
                method: 'POST',
                body: JSON.stringify({ id: m.id, status: 'dispatched' })
              });
              if (activeTab === 'tab-tasks') loadTasks();
              if (activeTab === 'tab-wechat') loadWechatData();
            } else {
              autoDispatchedIds.delete(m.id);
              await apiFetch('/api/wechat/release-dispatch', {
                method: 'POST',
                body: JSON.stringify({ id: m.id })
              }).catch(() => {});
            }
          }
        }
      }
    } catch (e) {
      console.warn('[AutoDispatch] Check error:', e);
    } finally {
      isCheckingAutoDispatch = false;
    }
  }

  let autoDispatchWorkerTimer = null;
  function startAutoDispatchWorker() {
    if (autoDispatchWorkerTimer) clearInterval(autoDispatchWorkerTimer);
    autoDispatchWorkerTimer = setInterval(() => {
      checkWechatAutoDispatch();
    }, 1500);
  }

  function startTimelinePolling() {
    stopTimelinePolling();
    autoRefreshTimer = setInterval(() => {
      refreshAll();
    }, 3000);
  }

  function stopTimelinePolling() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  // 紧凑路径格式化辅助函数
  function shortenPath(p) {
    if (!p) return '';
    const clean = p.replace(/\\/g, '/');
    const parts = clean.split('/');
    if (parts.length > 3) {
      return `.../${parts.slice(-2).join('/')}`;
    }
    return clean;
  }

  async function loadTimeline() {
    const convId = currentConversationId || sessionSelect.value;
    const container = document.getElementById('timelineContainer');
    const statsInfo = document.getElementById('timelineStatsInfo');

    try {
      const res = await apiFetch(`/api/session?conversationId=${encodeURIComponent(convId)}`);
      if (!res.ok) throw new Error('网络请求异常');
      const data = await res.json();

      // 更新 Token 指标
      const tokens = data.stats?.tokens;
      document.getElementById('statTokenTotal').textContent = tokens ? tokens.total.toLocaleString() : '-';
      document.getElementById('statTokenInput').textContent = tokens ? tokens.input.toLocaleString() : '-';
      document.getElementById('statTokenCache').textContent = tokens ? tokens.cache.toLocaleString() : '-';
      document.getElementById('statTokenOutput').textContent = tokens ? tokens.output.toLocaleString() : '-';

      const totalSteps = data.stats?.totalSteps || 0;
      const toolCalls = data.stats?.toolCallsCount || 0;
      statsInfo.textContent = `${totalSteps} 步 · ${toolCalls} 次调用`;

      const rawSteps = data.steps || [];
      const steps = rawSteps.filter((s) => {
        if (activeTimelineFilter === 'all') return true;
        if (activeTimelineFilter === 'user') return s.type === 'user';
        if (activeTimelineFilter === 'tool') return s.type === 'tool_execution';
        if (activeTimelineFilter === 'assistant') return s.type === 'assistant_response';
        return true;
      });

      if (steps.length === 0) {
        container.innerHTML = '<div class="empty-placeholder">当前会话暂无匹配的流水记录</div>';
        return;
      }

      let html = '';
      steps.forEach((s) => {
        const timeStr = s.time ? new Date(s.time).toLocaleTimeString() : '';
        if (s.type === 'user') {
          html += `
            <div class="step-card step-card-user">
              <div class="step-header">
                <span class="step-tag step-tag-user">👤 用户需求 #${s.stepIndex}</span>
                <span class="step-time">${timeStr}</span>
              </div>
              <div class="user-content-text">${escapeHtml(s.content)}</div>
            </div>
          `;
        } else if (s.type === 'tool_execution') {
          html += `
            <div class="step-card step-card-tool">
              <div class="step-header">
                <span class="step-tag step-tag-tool">⚡ 工具执行 #${s.stepIndex}</span>
                <span class="step-time">${timeStr}</span>
              </div>
              <div class="step-tools-list">
                ${s.calls.map((c, callIdx) => renderToolItem(c, s.stepIndex, callIdx)).join('')}
              </div>
              ${s.content ? `<div class="tool-summary-text" style="margin-top:6px;padding:6px;font-size:11px;background:rgba(255,255,255,0.03);border-radius:4px;color:var(--text-secondary);">${escapeHtml(s.content)}</div>` : ''}
            </div>
          `;
        } else if (s.type === 'assistant_response') {
          html += `
            <div class="step-card step-card-assistant" style="border-left: 3px solid #10b981; background: rgba(16, 185, 129, 0.05); padding: 10px; border-radius: 6px; margin-bottom: 8px;">
              <div class="step-header" style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span class="step-tag" style="font-size:11px;font-weight:600;color:#10b981;">🤖 AI 执行总结 #${s.stepIndex}</span>
                <span class="step-time" style="font-size:10px;color:var(--text-muted);">${timeStr}</span>
              </div>
              <div class="assistant-content-text" style="font-size:12px;line-height:1.5;white-space:pre-wrap;color:var(--text-primary);">${escapeHtml(s.content)}</div>
            </div>
          `;
        }
      });

      container.innerHTML = html;
      bindToolDetailsToggle();
    } catch (e) {
      container.innerHTML = `<div class="empty-placeholder text-danger">加载流水失败: ${e.message}</div>`;
    }
  }

  function renderToolItem(c, stepIndex, callIdx) {
    const rawArgsId = `raw_args_${stepIndex}_${callIdx}`;
    const args = c.args || {};
    const capsules = [];

    if (args.file) {
      capsules.push(`<span class="arg-capsule" title="${escapeHtml(args.file)}"><span class="capsule-key">📄</span> ${escapeHtml(shortenPath(args.file))}</span>`);
    }
    if (args.lines) {
      capsules.push(`<span class="arg-capsule"><span class="capsule-key">🔢</span> 行: ${escapeHtml(args.lines)}</span>`);
    }
    if (args.command) {
      const shortCmd = args.command.length > 35 ? args.command.slice(0, 35) + '...' : args.command;
      capsules.push(`<span class="arg-capsule" title="${escapeHtml(args.command)}"><span class="capsule-key">💻</span> ${escapeHtml(shortCmd)}</span>`);
    }
    if (args.query) {
      capsules.push(`<span class="arg-capsule"><span class="capsule-key">🔍</span> ${escapeHtml(args.query)}</span>`);
    }

    const actionText = c.action || c.summary || '';

    return `
      <div class="tool-call-item">
        <div class="tool-name-line">
          <span class="tool-badge">${escapeHtml(c.name)}</span>
          ${actionText ? `<span class="tool-action-brief" title="${escapeHtml(actionText)}">${escapeHtml(actionText)}</span>` : ''}
        </div>
        ${capsules.length > 0 ? `<div class="capsules-row">${capsules.join('')}</div>` : ''}
        <button class="btn-toggle-args" data-target="${rawArgsId}">
          <span>展开完整参数 ▾</span>
        </button>
        <pre id="${rawArgsId}" class="raw-json-pre" style="display:none;">${escapeHtml(JSON.stringify(args, null, 2))}</pre>
      </div>
    `;
  }

  function bindToolDetailsToggle() {
    document.querySelectorAll('.btn-toggle-args').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const pre = document.getElementById(targetId);
        if (!pre) return;
        if (pre.style.display === 'none') {
          pre.style.display = 'block';
          btn.innerHTML = '<span>收起参数 ▴</span>';
        } else {
          pre.style.display = 'none';
          btn.innerHTML = '<span>展开完整参数 ▾</span>';
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 2. 任务看板 (Kanban) - 全功能升级版
  // ---------------------------------------------------------------------------
  let kanbanViewMode = localStorage.getItem('ai-assistant-kanban-view') || 'milestones';
  let kanbanFilter = 'all';
  let kanbanSearchQuery = '';
  let cachedMilestones = [];
  let cachedTasks = [];

  function bindKanbanEvents() {
    const modalTask = document.getElementById('modalTask');
    const modalMilestone = document.getElementById('modalMilestone');
    const modalEditTask = document.getElementById('modalEditTask');
    const modalExportTodo = document.getElementById('modalExportTodo');

    // 新建任务弹窗
    document.getElementById('btnAddTaskModal')?.addEventListener('click', () => {
      populateMilestoneSelect();
      modalTask?.classList.remove('hidden');
    });
    document.getElementById('btnCloseTaskModal')?.addEventListener('click', () => modalTask?.classList.add('hidden'));

    // 新建阶段弹窗
    document.getElementById('btnAddMilestoneModal')?.addEventListener('click', () => {
      const input = document.getElementById('modalMilestoneTitle');
      if (input) input.value = '';
      modalMilestone?.classList.remove('hidden');
    });
    document.getElementById('btnCloseMilestoneModal')?.addEventListener('click', () => modalMilestone?.classList.add('hidden'));

    // 提交创建任务
    document.getElementById('btnSubmitTask')?.addEventListener('click', async () => {
      const title = document.getElementById('modalTaskTitle')?.value.trim();
      const desc = document.getElementById('modalTaskDesc')?.value.trim();
      const milestoneId = document.getElementById('modalTaskMilestone')?.value;
      const priority = document.getElementById('modalTaskPriority')?.value;

      if (!title) return showToast('请输入任务标题', true);

      const convId = currentConversationId || sessionSelect.value;
      const res = await apiFetch('/api/task/add', {
        method: 'POST',
        body: JSON.stringify({ conversationId: convId, title, desc, milestoneId, priority })
      });

      if (res.ok) {
        showToast('✅ 任务卡片已添加');
      } else {
        showToast('创建任务失败', true);
      }

      modalTask?.classList.add('hidden');
      const titleInput = document.getElementById('modalTaskTitle');
      const descInput = document.getElementById('modalTaskDesc');
      if (titleInput) titleInput.value = '';
      if (descInput) descInput.value = '';
      loadTasks();
    });

    // 提交创建阶段
    document.getElementById('btnSubmitMilestone')?.addEventListener('click', async () => {
      const title = document.getElementById('modalMilestoneTitle')?.value.trim();
      if (!title) return showToast('请输入阶段标题', true);

      const convId = currentConversationId || sessionSelect.value;
      const res = await apiFetch('/api/milestone/add', {
        method: 'POST',
        body: JSON.stringify({ conversationId: convId, title })
      });

      if (res.ok) {
        showToast('✅ 阶段已添加');
      } else {
        showToast('创建阶段失败', true);
      }

      modalMilestone?.classList.add('hidden');
      loadTasks();
    });

    // 编辑任务弹窗事件
    document.getElementById('btnCloseEditTaskModal')?.addEventListener('click', () => {
      modalEditTask?.classList.add('hidden');
    });

    document.getElementById('btnSubmitEditTask')?.addEventListener('click', async () => {
      const taskId = document.getElementById('editTaskId')?.value;
      const milestoneId = document.getElementById('modalEditTaskMilestone')?.value;
      const title = document.getElementById('modalEditTaskTitle')?.value.trim();
      const desc = document.getElementById('modalEditTaskDesc')?.value.trim();
      const priority = document.getElementById('modalEditTaskPriority')?.value;
      const status = document.getElementById('modalEditTaskStatus')?.value;

      if (!title) return showToast('请输入任务标题', true);

      const convId = currentConversationId || sessionSelect.value;
      const res = await apiFetch('/api/task/update', {
        method: 'POST',
        body: JSON.stringify({ conversationId: convId, taskId, title, desc, milestoneId, priority, status })
      });

      if (res.ok) {
        showToast('✅ 任务卡片修改已保存');
        modalEditTask?.classList.add('hidden');
        loadTasks();
      } else {
        showToast('保存任务失败', true);
      }
    });

    // 导出清单 (TODO.md) 弹窗事件
    document.getElementById('btnExportTodoModal')?.addEventListener('click', async () => {
      const convId = currentConversationId || sessionSelect.value;
      const res = await apiFetch('/api/tasks/export-todo', {
        method: 'POST',
        body: JSON.stringify({ conversationId: convId, saveToWorkspace: false })
      });
      if (res.ok) {
        const data = await res.json();
        const txt = document.getElementById('exportTodoContent');
        if (txt) txt.value = data.markdown || '';
        const hint = document.getElementById('exportTodoSaveHint');
        if (hint) hint.textContent = '';
        modalExportTodo?.classList.remove('hidden');
      } else {
        showToast('获取清单失败', true);
      }
    });

    document.getElementById('btnCloseExportTodoModal')?.addEventListener('click', () => {
      modalExportTodo?.classList.add('hidden');
    });

    document.getElementById('btnCopyExportTodo')?.addEventListener('click', () => {
      const txt = document.getElementById('exportTodoContent');
      if (txt && txt.value) {
        navigator.clipboard.writeText(txt.value);
        showToast('📋 已复制 TODO.md 清单到剪贴板');
      }
    });

    document.getElementById('btnSaveTodoToWorkspace')?.addEventListener('click', async () => {
      const convId = currentConversationId || sessionSelect.value;
      const res = await apiFetch('/api/tasks/export-todo', {
        method: 'POST',
        body: JSON.stringify({ conversationId: convId, saveToWorkspace: true })
      });
      if (res.ok) {
        const data = await res.json();
        const hint = document.getElementById('exportTodoSaveHint');
        if (hint) hint.textContent = `✅ 已成功写入: ${data.savedPath || '项目根目录 TODO.md'}`;
        showToast('💾 TODO.md 已成功保存至项目根目录');
      } else {
        showToast('保存至项目根目录失败', true);
      }
    });

    document.getElementById('btnDownloadTodoFile')?.addEventListener('click', () => {
      const txt = document.getElementById('exportTodoContent')?.value;
      if (!txt) return;
      const blob = new Blob([txt], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'TODO.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('⬇️ 已生成并下载 TODO.md');
    });

    // 实时搜索
    const searchInput = document.getElementById('kanbanSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        kanbanSearchQuery = e.target.value.trim().toLowerCase();
        renderKanbanBoard();
      });
    }

    // 双视图切换
    const btnMilestones = document.getElementById('btnViewMilestones');
    const btnColumns = document.getElementById('btnViewColumns');
    if (btnMilestones && btnColumns) {
      if (kanbanViewMode === 'columns') {
        btnColumns.classList.add('active');
        btnMilestones.classList.remove('active');
      } else {
        btnMilestones.classList.add('active');
        btnColumns.classList.remove('active');
      }

      btnMilestones.addEventListener('click', () => {
        kanbanViewMode = 'milestones';
        localStorage.setItem('ai-assistant-kanban-view', 'milestones');
        btnMilestones.classList.add('active');
        btnColumns.classList.remove('active');
        renderKanbanBoard();
      });

      btnColumns.addEventListener('click', () => {
        kanbanViewMode = 'columns';
        localStorage.setItem('ai-assistant-kanban-view', 'columns');
        btnColumns.classList.add('active');
        btnMilestones.classList.remove('active');
        renderKanbanBoard();
      });
    }

    // 快捷筛选芯片
    document.querySelectorAll('.kanban-filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.kanban-filter-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        kanbanFilter = chip.getAttribute('data-filter') || 'all';
        renderKanbanBoard();
      });
    });

    // 清理已完成
    const btnClearDone = document.getElementById('btnClearDoneTasks');
    if (btnClearDone) {
      btnClearDone.addEventListener('click', () => {
        const convId = currentConversationId || sessionSelect.value;
        requestConfirm({
          title: '🧹 清理已完成任务',
          message: '确定要从当前看板清理所有已完成（Done）的任务卡片吗？',
          confirmText: '确认清理',
          onConfirm: async () => {
            const res = await apiFetch('/api/tasks/clear-done', {
              method: 'POST',
              body: JSON.stringify({ conversationId: convId })
            });
            if (res.ok) {
              showToast('✅ 已清理全部已完成任务');
              loadTasks();
            } else {
              showToast('清理任务失败', true);
            }
          }
        });
      });
    }

    // 重置看板
    document.getElementById('btnResetTasks')?.addEventListener('click', () => {
      const convId = currentConversationId || sessionSelect.value;
      requestConfirm({
        title: '🔄 重置任务看板',
        message: '确定要重置当前会话的任务看板吗？将恢复默认的三阶段里程碑与初始任务模板。',
        confirmText: '确认重置',
        onConfirm: async () => {
          const res = await apiFetch('/api/tasks/reset', {
            method: 'POST',
            body: JSON.stringify({ conversationId: convId })
          });
          if (res.ok) {
            showToast('✅ 看板已重置为初始模板');
            loadTasks();
          } else {
            showToast('重置看板失败', true);
          }
        }
      });
    });
  }

  function populateMilestoneSelect() {
    const sel = document.getElementById('modalTaskMilestone');
    if (!sel) return;
    sel.innerHTML = '';
    cachedMilestones.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.title;
      sel.appendChild(opt);
    });
  }

  async function loadTasks() {
    const convId = currentConversationId || sessionSelect.value;
    const board = document.getElementById('kanbanBoard');

    try {
      const res = await apiFetch(`/api/tasks?conversationId=${encodeURIComponent(convId)}`);
      if (!res.ok) throw new Error('请求任务数据失败');
      const json = await res.json();
      const data = json.data || {};

      cachedMilestones = data.milestones || [];
      cachedTasks = data.tasks || [];

      // 更新进度条指标
      const total = cachedTasks.length;
      const doneCount = cachedTasks.filter((t) => t.status === 'done').length;
      const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
      document.getElementById('taskProgressPercent').textContent = `${percent}% (${doneCount}/${total})`;
      document.getElementById('taskProgressBar').style.width = `${percent}%`;
      taskCountBadge.textContent = total;

      renderKanbanBoard();
    } catch (e) {
      if (board) board.innerHTML = `<div class="empty-placeholder text-danger">加载看板失败: ${e.message}</div>`;
    }
  }

  function renderKanbanBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    // 过滤任务集合（搜索词 + 筛选芯片）
    const filteredTasks = cachedTasks.filter((t) => {
      if (kanbanSearchQuery) {
        const titleMatch = (t.title || '').toLowerCase().includes(kanbanSearchQuery);
        const descMatch = (t.desc || '').toLowerCase().includes(kanbanSearchQuery);
        if (!titleMatch && !descMatch) return false;
      }
      if (kanbanFilter === 'todo') return t.status === 'todo';
      if (kanbanFilter === 'in_progress') return t.status === 'in_progress';
      if (kanbanFilter === 'done') return t.status === 'done';
      if (kanbanFilter === 'priority-high') return t.priority === 'high';
      if (kanbanFilter === 'source-wechat') return t.source === 'wechat';
      return true;
    });

    if (kanbanViewMode === 'columns') {
      // 📊 渲染三列泳道视图
      const todoTasks = filteredTasks.filter((t) => t.status === 'todo');
      const inProgTasks = filteredTasks.filter((t) => t.status === 'in_progress');
      const doneTasks = filteredTasks.filter((t) => t.status === 'done');

      board.innerHTML = `
        <div class="kanban-columns-grid">
          <div class="kanban-column" data-column-status="todo">
            <div class="kanban-column-head">
              <span class="kanban-column-title">⏳ 待办任务</span>
              <span class="kanban-column-count">${todoTasks.length}</span>
            </div>
            <div class="column-tasks-container" data-column-status="todo">
              ${todoTasks.length === 0 ? '<div class="text-muted" style="padding:14px 4px;font-size:10px;text-align:center;">暂无待办卡片</div>' : ''}
              ${todoTasks.map((t) => renderTaskCard(t, true)).join('')}
            </div>
          </div>
          <div class="kanban-column" data-column-status="in_progress">
            <div class="kanban-column-head">
              <span class="kanban-column-title">🚀 进行中</span>
              <span class="kanban-column-count">${inProgTasks.length}</span>
            </div>
            <div class="column-tasks-container" data-column-status="in_progress">
              ${inProgTasks.length === 0 ? '<div class="text-muted" style="padding:14px 4px;font-size:10px;text-align:center;">暂无进行中卡片</div>' : ''}
              ${inProgTasks.map((t) => renderTaskCard(t, true)).join('')}
            </div>
          </div>
          <div class="kanban-column" data-column-status="done">
            <div class="kanban-column-head">
              <span class="kanban-column-title">✅ 已完成</span>
              <span class="kanban-column-count">${doneTasks.length}</span>
            </div>
            <div class="column-tasks-container" data-column-status="done">
              ${doneTasks.length === 0 ? '<div class="text-muted" style="padding:14px 4px;font-size:10px;text-align:center;">暂无已完成卡片</div>' : ''}
              ${doneTasks.map((t) => renderTaskCard(t, true)).join('')}
            </div>
          </div>
        </div>
      `;
    } else {
      // 📋 渲染阶段视图
      if (cachedMilestones.length === 0) {
        if (filteredTasks.length === 0) {
          board.innerHTML = '<div class="empty-placeholder">📋 当前看板暂无任务与阶段<br><span style="font-size:11px;color:var(--text-muted);margin-top:6px;display:inline-block;">可点击上方“+ 新阶段”划分研发阶段，或“+ 新任务”直接录入</span></div>';
        } else {
          board.innerHTML = `
            <div class="milestone-group" data-milestone-id="default">
              <div class="milestone-head-row">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="milestone-title-text">📌 任务列表</span>
                  <span class="text-muted" style="font-size:10px;">${filteredTasks.length} 项</span>
                </div>
              </div>
              <div class="task-list" data-milestone-id="default">
                ${filteredTasks.map((t) => renderTaskCard(t, false)).join('')}
              </div>
            </div>
          `;
        }
      } else {
        let boardHtml = '';
        cachedMilestones.forEach((m) => {
          const mTasks = filteredTasks.filter((t) => t.milestoneId === m.id);
          const canDelete = true;
          boardHtml += `
            <div class="milestone-group" data-milestone-id="${m.id}">
              <div class="milestone-head-row">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="milestone-title-text">${escapeHtml(m.title)}</span>
                  <span class="text-muted" style="font-size:10px;">${mTasks.length} 项</span>
                </div>
                ${canDelete ? `<button class="btn btn-ghost btn-xs text-danger" data-action="delete-milestone" data-id="${m.id}" title="删除该阶段">🗑</button>` : ''}
              </div>
              <div class="task-list" data-milestone-id="${m.id}">
                ${mTasks.length === 0 ? '<div class="text-muted" style="padding:8px 4px;font-size:10px;">无匹配任务卡片</div>' : ''}
                ${mTasks.map((t) => renderTaskCard(t, false)).join('')}
              </div>
            </div>
          `;
        });
        board.innerHTML = boardHtml;
      }
    }

    bindTaskCardActions();
    bindDragAndDrop();
  }

  function renderTaskCard(t, showMilestoneTag = false) {
    const pClass = `priority-${t.priority || 'medium'}`;
    const pLabel = t.priority === 'high' ? '🔴 高' : (t.priority === 'low' ? '🟢 低' : '🟡 中');
    const isWechat = t.source === 'wechat';
    const isFeishu = t.source === 'feishu';

    const statusBadgeText = t.status === 'done' ? '✅ 完成' : (t.status === 'in_progress' ? '🚀 进行' : '⏳ 待办');
    const statusClass = `status-${t.status || 'todo'}`;

    let milestoneTagHtml = '';
    if (showMilestoneTag) {
      const mObj = cachedMilestones.find((m) => m.id === t.milestoneId);
      if (mObj) {
        milestoneTagHtml = `<span class="task-milestone-tag" title="所属阶段: ${escapeHtml(mObj.title)}">📌 ${escapeHtml(mObj.title)}</span>`;
      }
    }

    return `
      <div class="task-card" draggable="true" data-id="${t.id}">
        <div class="task-card-header">
          <span class="task-title">${escapeHtml(t.title)}</span>
          <div class="task-card-tags">
            ${milestoneTagHtml}
            ${isWechat ? '<span class="source-badge">📱 微信</span>' : ''}
            ${isFeishu ? '<span class="source-badge" style="background:rgba(51,112,255,0.15);color:#60a5fa;border-color:rgba(96,165,250,0.4);">🐦 飞书</span>' : ''}
            <span class="priority-badge ${pClass}">${pLabel}</span>
          </div>
        </div>
        ${t.desc ? `<div class="task-desc">${escapeHtml(t.desc)}</div>` : ''}
        <div class="task-card-footer">
          <button class="status-toggle-btn ${statusClass}" data-action="toggle" data-id="${t.id}" title="点击切换状态">
            ${statusBadgeText}
          </button>
          <div class="task-actions-group">
            <button class="task-action-btn" data-action="edit-task" data-id="${t.id}" title="编辑任务">✏️</button>
            <button class="btn btn-primary btn-xs" data-action="dispatch-agent" data-id="${t.id}" data-title="${escapeHtml(t.title)}" data-desc="${escapeHtml(t.desc || '')}" title="向 Agent 派发执行">🚀 派发</button>
            <button class="btn btn-ghost btn-xs text-danger" data-action="delete" data-id="${t.id}" title="删除任务">🗑</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindTaskCardActions() {
    const convId = currentConversationId || sessionSelect.value;

    // 点击切换状态
    document.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await apiFetch('/api/task/toggle', {
          method: 'POST',
          body: JSON.stringify({ conversationId: convId, id })
        });
        loadTasks();
      });
    });

    // 点击编辑任务卡片
    document.querySelectorAll('[data-action="edit-task"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const t = cachedTasks.find((x) => x.id === id);
        if (!t) return;

        document.getElementById('editTaskId').value = t.id;
        document.getElementById('modalEditTaskTitle').value = t.title || '';
        document.getElementById('modalEditTaskDesc').value = t.desc || '';
        document.getElementById('modalEditTaskPriority').value = t.priority || 'medium';
        document.getElementById('modalEditTaskStatus').value = t.status || 'todo';

        const selMilestone = document.getElementById('modalEditTaskMilestone');
        selMilestone.innerHTML = '';
        cachedMilestones.forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.title;
          if (m.id === t.milestoneId) opt.selected = true;
          selMilestone.appendChild(opt);
        });

        document.getElementById('modalEditTask').classList.remove('hidden');
      });
    });

    // 删除阶段
    document.querySelectorAll('[data-action="delete-milestone"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        requestConfirm({
          title: '🗑 删除迭代阶段',
          message: '确定要删除此阶段吗？原阶段下的任务卡片将自动迁移至上一阶段，不会丢失。',
          confirmText: '确认删除',
          onConfirm: async () => {
            const res = await apiFetch('/api/milestone/delete', {
              method: 'POST',
              body: JSON.stringify({ conversationId: convId, id })
            });
            const data = await res.json();
            if (data.error) {
              showToast(data.error, true);
            } else {
              showToast('✅ 阶段已删除');
              loadTasks();
            }
          }
        });
      });
    });

    // 删除任务卡片
    document.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        requestConfirm({
          title: '🗑 删除任务卡片',
          message: '确定要删除该任务卡片吗？删除后不可恢复。',
          confirmText: '确认删除',
          onConfirm: async () => {
            const res = await apiFetch('/api/task/delete', {
              method: 'POST',
              body: JSON.stringify({ conversationId: convId, id })
            });
            if (res.ok) {
              showToast('✅ 任务卡片已删除');
              loadTasks();
            } else {
              showToast('删除任务失败', true);
            }
          }
        });
      });
    });

    // 派发至 Agent
    document.querySelectorAll('[data-action="dispatch-agent"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const title = btn.getAttribute('data-title');
        const desc = btn.getAttribute('data-desc');
        btn.disabled = true;
        btn.textContent = '派发中...';
        const ok = await dispatchToAgent({ title, desc });
        if (ok) {
          await apiFetch('/api/task/toggle', {
            method: 'POST',
            body: JSON.stringify({ conversationId: convId, id, status: 'in_progress' })
          });
          loadTasks();
        }
        btn.disabled = false;
        btn.textContent = '🚀 派发';
      });
    });
  }

  // HTML5 拖拽与目标容器绑定
  function bindDragAndDrop() {
    const convId = currentConversationId || sessionSelect.value;

    // 所有可拖拽卡片
    document.querySelectorAll('.task-card[draggable="true"]').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        const id = card.getAttribute('data-id');
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      });
    });

    // 阶段视图中的拖拽目标容器 (.task-list)
    document.querySelectorAll('.task-list[data-milestone-id]').forEach((listEl) => {
      listEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.classList.add('drag-over');
      });

      listEl.addEventListener('dragleave', (e) => {
        if (!listEl.contains(e.relatedTarget)) {
          listEl.classList.remove('drag-over');
        }
      });

      listEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        listEl.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const targetMilestoneId = listEl.getAttribute('data-milestone-id');
        if (!taskId || !targetMilestoneId) return;

        const res = await apiFetch('/api/task/move', {
          method: 'POST',
          body: JSON.stringify({ conversationId: convId, taskId, targetMilestoneId })
        });
        if (res.ok) {
          showToast('✅ 任务已移动至该阶段');
          loadTasks();
        } else {
          showToast('移动任务失败', true);
        }
      });
    });

    // 三列泳道视图中的拖拽目标容器 (.column-tasks-container)
    document.querySelectorAll('.column-tasks-container[data-column-status]').forEach((colEl) => {
      colEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        colEl.classList.add('drag-over');
      });

      colEl.addEventListener('dragleave', (e) => {
        if (!colEl.contains(e.relatedTarget)) {
          colEl.classList.remove('drag-over');
        }
      });

      colEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        colEl.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const targetStatus = colEl.getAttribute('data-column-status');
        if (!taskId || !targetStatus) return;

        const res = await apiFetch('/api/task/move', {
          method: 'POST',
          body: JSON.stringify({ conversationId: convId, taskId, targetStatus })
        });
        if (res.ok) {
          const statusText = targetStatus === 'done' ? '已完成' : (targetStatus === 'in_progress' ? '进行中' : '待办');
          showToast(`✅ 任务已流转为 [${statusText}]`);
          loadTasks();
        } else {
          showToast('流转任务状态失败', true);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 3. 微信网关 (WeChat Gateway)
  // ---------------------------------------------------------------------------
  function bindWechatEvents() {
    document.getElementById('btnSendSimulate').addEventListener('click', async () => {
      const input = document.getElementById('simMsgInput');
      const val = input.value.trim();
      if (!val) {
        showToast('请输入模拟消息内容', true);
        return;
      }

      const simSource = document.querySelector('input[name="simSource"]:checked')?.value || 'wechat';

      try {
        const res = await apiFetch('/api/wechat/simulate', {
          method: 'POST',
          body: JSON.stringify({ content: val, source: simSource })
        });
        const json = await res.json();
        if (json.success) {
          input.value = '';
          showToast(`✅ [${simSource === 'feishu' ? '飞书' : '微信'}] 消息已注入`);
          loadWechatData();
          loadTasks();
        } else {
          showToast('发送失败: ' + (json.error || '未知错误'), true);
        }
      } catch (e) {
        showToast('发送失败: ' + e.message, true);
      }
    });

    document.querySelectorAll('.filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        activeWechatFilter = chip.getAttribute('data-filter');
        loadWechatData();
      });
    });

    document.querySelectorAll('.quick-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const prompt = chip.getAttribute('data-prompt');
        const input = document.getElementById('simMsgInput');
        if (input && prompt) {
          input.value = prompt;
          input.focus();
        }
      });
    });

    document.getElementById('btnClearWechatMsgs').addEventListener('click', () => {
      requestConfirm({
        title: '🧹 清空多端消息',
        message: '确定清空所有微信与飞书消息历史记录吗？清空后不可恢复。',
        confirmText: '确认清空',
        onConfirm: async () => {
          const res = await apiFetch('/api/wechat/clear-messages', { method: 'POST' });
          if (res.ok) {
            showToast('✅ 消息记录已清空');
            loadWechatData();
          } else {
            showToast('清空消息失败', true);
          }
        }
      });
    });
  }

  async function loadWechatData() {
    const listContainer = document.getElementById('wechatMessagesList');
    try {
      const res = await apiFetch('/api/wechat/data');
      if (!res.ok) throw new Error('网络请求失败');
      const data = await res.json();
      cachedConfig = data.config;

      const msgs = data.messages || [];
      wechatCountBadge.textContent = msgs.length;

      // 自动向 Agent 派发微信/飞书工程指令
      checkWechatAutoDispatch(msgs);

      const filtered = msgs.filter((m) => {
        if (activeWechatFilter === 'all') return true;
        if (activeWechatFilter === 'feishu') return m.source === 'feishu';
        return m.category === activeWechatFilter;
      });

      if (filtered.length === 0) {
        listContainer.innerHTML = '<div class="empty-placeholder">暂无消息记录</div>';
        return;
      }

      let html = '';
      filtered.forEach((m) => {
        const timeStr = m.time ? new Date(m.time).toLocaleTimeString() : '';
        const isTask = m.category === 'project_task';
        const isCmd = m.category === 'command';
        const badgeClass = isTask ? 'status-dispatch' : (isCmd ? 'status-command' : 'status-online');
        const badgeText = isTask ? '🚀 任务' : (isCmd ? '⚙️ 指令' : '💬 问答');

        const source = m.source || 'wechat';
        let sourceBadge = '';
        if (source === 'feishu') {
          sourceBadge = '<span class="source-tag source-feishu">🐦 飞书</span>';
        } else if (source === 'simulate') {
          sourceBadge = '<span class="source-tag source-simulate">🧪 模拟</span>';
        } else {
          sourceBadge = '<span class="source-tag source-wechat">📱 微信</span>';
        }

        html += `
          <div class="msg-card">
            <div class="msg-top">
              <div style="display:flex;align-items:center;gap:6px;">
                ${sourceBadge}
                <span class="msg-from">👤 ${escapeHtml(m.from)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="status-pill ${badgeClass}">${badgeText}</span>
                <span class="text-muted">${timeStr}</span>
                <button class="btn btn-ghost btn-xs text-danger" data-action="delete-wx-msg" data-id="${m.id}" title="删除此消息" style="padding:1px 5px;line-height:1;">🗑</button>
              </div>
            </div>
            <div class="msg-content">${escapeHtml(m.content)}</div>
            ${m.reply ? `<div class="msg-reply">🤖 AI 回复：${escapeHtml(m.reply)}</div>` : ''}
            ${m.status === 'completed' ? '<div style="color:var(--green-glow);font-size:10px;margin-top:3px;">✅ 任务已在看板标记完成</div>' : ''}
            ${isTask && m.status !== 'completed' ? `
              <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:6px;">
                <button class="btn btn-primary btn-xs" data-action="dispatch-wx-msg" data-id="${m.id}" data-content="${escapeHtml(m.content)}" data-from="${escapeHtml(m.from)}">🚀 派发到当前会话</button>
                <button class="btn btn-secondary btn-xs" data-action="newchat-wx-msg" data-id="${m.id}" data-content="${escapeHtml(m.content)}" data-from="${escapeHtml(m.from)}">💬 新会话执行</button>
              </div>
            ` : ''}
          </div>
        `;
      });

      listContainer.innerHTML = html;

      // 绑定单条消息删除事件
      listContainer.querySelectorAll('[data-action="delete-wx-msg"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          requestConfirm({
            title: '🗑 删除微信消息',
            message: '确定要删除此条微信消息记录吗？',
            confirmText: '确认删除',
            onConfirm: async () => {
              const res = await apiFetch('/api/wechat/message/delete', {
                method: 'POST',
                body: JSON.stringify({ id })
              });
              if (res.ok) {
                showToast('✅ 消息已删除');
                loadWechatData();
              } else {
                showToast('删除失败', true);
              }
            }
          });
        });
      });

      // 绑定消息派发事件
      listContainer.querySelectorAll('[data-action="dispatch-wx-msg"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const content = btn.getAttribute('data-content');
          const from = btn.getAttribute('data-from');
          btn.disabled = true;
          btn.textContent = '派发中...';
          const ok = await dispatchToAgent({ content, from }, false);
          if (ok) {
            await apiFetch('/api/wechat/mark-dispatched', {
              method: 'POST',
              body: JSON.stringify({ id })
            });
            loadWechatData();
          }
          btn.disabled = false;
          btn.textContent = '🚀 派发到当前会话';
        });
      });

      listContainer.querySelectorAll('[data-action="newchat-wx-msg"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const content = btn.getAttribute('data-content');
          const from = btn.getAttribute('data-from');
          btn.disabled = true;
          btn.textContent = '启动中...';
          const ok = await dispatchToAgent({ content, from }, true);
          if (ok) {
            await apiFetch('/api/wechat/mark-dispatched', {
              method: 'POST',
              body: JSON.stringify({ id })
            });
            loadWechatData();
          }
          btn.disabled = false;
          btn.textContent = '💬 新会话执行';
        });
      });
    } catch (e) {
      listContainer.innerHTML = `<div class="empty-placeholder text-danger">加载微信数据失败: ${e.message}</div>`;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. MCP 工具扫描
  // ---------------------------------------------------------------------------
  function bindMcpEvents() {
    document.getElementById('btnRefreshMcp').addEventListener('click', () => {
      loadMcpServices();
    });
  }

  async function loadMcpServices() {
    const container = document.getElementById('mcpContainer');
    try {
      const res = await apiFetch('/api/mcp');
      if (!res.ok) throw new Error('扫描 MCP 异常');
      const json = await res.json();
      const servers = json.servers || [];

      if (servers.length === 0) {
        container.innerHTML = '<div class="empty-placeholder">当前环境中未探测到已注册的 MCP Servers</div>';
        return;
      }

      let html = '';
      servers.forEach((s) => {
        html += `
          <div class="mcp-card">
            <div class="mcp-card-title">
              <span>🔌 ${escapeHtml(s.name)}</span>
              <span class="status-pill status-online">${s.toolCount} 工具</span>
            </div>
            <div class="mcp-tools-list">
              ${s.tools.map((t) => `
                <span class="mcp-tool-tag" title="${escapeHtml(t.description)}">${escapeHtml(t.name)}</span>
              `).join('')}
            </div>
          </div>
        `;
      });

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<div class="empty-placeholder text-danger">扫描 MCP 失败: ${e.message}</div>`;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. 综合设置
  // ---------------------------------------------------------------------------
  function updateFeishuStatusUI() {
    const pill = document.getElementById('feishuStatusPill');
    const desc = document.getElementById('feishuStatusDesc');
    const inputFeishuUrl = document.getElementById('cfgFeishuWebhookUrl');
    const selNotifyChannel = document.getElementById('cfgNotifyChannel');
    const btnQuickEnable = document.getElementById('btnQuickEnableFeishu');
    const url = inputFeishuUrl ? inputFeishuUrl.value.trim() : '';
    const ch = selNotifyChannel ? selNotifyChannel.value : 'none';

    if (!pill) return;

    if (!url) {
      pill.textContent = '未绑定';
      pill.className = 'status-pill status-idle';
      if (desc) desc.textContent = '填入 Webhook 即可自动推送卡片';
      if (btnQuickEnable) btnQuickEnable.style.display = 'none';
    } else if (ch === 'feishu') {
      pill.textContent = '已绑定并启用推送';
      pill.className = 'status-pill status-online';
      if (desc) desc.textContent = '任务完成时自动向飞书群推送卡片';
      if (btnQuickEnable) btnQuickEnable.style.display = 'none';
    } else {
      pill.textContent = '已填 Webhook (推送未启用)';
      pill.className = 'status-pill status-idle';
      if (desc) desc.textContent = '当前通知渠道未切换至飞书';
      if (btnQuickEnable) btnQuickEnable.style.display = 'inline-block';
    }
  }

  function updateNotifyChannelVisibility() {
    const selNotifyChannel = document.getElementById('cfgNotifyChannel');
    const ch = selNotifyChannel ? selNotifyChannel.value : 'none';
    const rowWechat = document.getElementById('rowNotifyWechat');
    const containerPushPlus = document.getElementById('rowNotifyPushPlusContainer');
    const containerServerChan = document.getElementById('rowNotifyServerChanContainer');
    const containerWecom = document.getElementById('rowNotifyWecomContainer');
    const containerFeishu = document.getElementById('rowNotifyFeishuContainer');
    const containerCustom = document.getElementById('rowNotifyCustomContainer');

    if (rowWechat) rowWechat.style.display = (ch === 'wechat') ? 'block' : 'none';
    if (containerPushPlus) containerPushPlus.style.display = (ch === 'pushplus') ? 'block' : 'none';
    if (containerServerChan) containerServerChan.style.display = (ch === 'serverchan') ? 'block' : 'none';
    if (containerWecom) containerWecom.style.display = (ch === 'wecom') ? 'block' : 'none';
    if (containerFeishu) containerFeishu.style.display = (ch === 'feishu') ? 'block' : 'none';
    if (containerCustom) containerCustom.style.display = (ch === 'custom') ? 'block' : 'none';

    updateFeishuStatusUI();
  }

  function bindSettingsEvents() {
    const btnToggle = document.getElementById('btnToggleApiKey');
    const inputApiKey = document.getElementById('cfgLlmApiKey');

    if (btnToggle && inputApiKey) {
      btnToggle.addEventListener('click', () => {
        if (inputApiKey.type === 'password') {
          inputApiKey.type = 'text';
          btnToggle.textContent = '隐藏';
        } else {
          inputApiKey.type = 'password';
          btnToggle.textContent = '显示';
        }
      });
    }

    const selNotifyChannel = document.getElementById('cfgNotifyChannel');
    const inputFeishuUrl = document.getElementById('cfgFeishuWebhookUrl');
    const btnQuickEnable = document.getElementById('btnQuickEnableFeishu');

    if (btnQuickEnable) {
      btnQuickEnable.addEventListener('click', () => {
        if (selNotifyChannel) {
          selNotifyChannel.value = 'feishu';
          updateNotifyChannelVisibility();
          showToast('✅ 已将通知渠道切换为飞书群机器人，请点击保存设置生效！');
        }
      });
    }

    if (inputFeishuUrl) {
      inputFeishuUrl.addEventListener('input', updateFeishuStatusUI);
    }

    if (selNotifyChannel) {
      selNotifyChannel.addEventListener('change', updateNotifyChannelVisibility);
    }

    async function testPushChannel(channel) {
      const payload = { channel };
      if (channel === 'pushplus') payload.notifyPushPlusToken = (document.getElementById('cfgNotifyPushPlusToken')?.value || '').trim();
      if (channel === 'serverchan') payload.notifyServerChanKey = (document.getElementById('cfgNotifyServerChanKey')?.value || '').trim();
      if (channel === 'wecom') payload.notifyWecomUrl = (document.getElementById('cfgNotifyWecomUrl')?.value || '').trim();
      if (channel === 'feishu') {
        payload.webhookUrl = (document.getElementById('cfgFeishuWebhookUrl')?.value || '').trim();
        payload.secret = (document.getElementById('cfgFeishuSecret')?.value || '').trim();
      }
      if (channel === 'custom') payload.notifyWebhookUrl = (document.getElementById('cfgNotifyWebhookUrl')?.value || '').trim();

      showToast(`正在发送【${channel}】测试推送...`);
      try {
        const res = await apiFetch('/api/notify/test-push', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message || '🎉 推送测试成功！');
          if (channel === 'wechat') loadWechatData();
        } else {
          showToast(`推送测试失败: ${json.error || ''}`, true);
        }
      } catch (err) {
        showToast(`测试请求异常: ${err.message}`, true);
      }
    }

    const btnTestWechat = document.getElementById('btnTestWechatPush');
    if (btnTestWechat) {
      btnTestWechat.addEventListener('click', () => testPushChannel('wechat'));
    }

    const btnTestPushPlus = document.getElementById('btnTestPushPlusPush');
    if (btnTestPushPlus) {
      btnTestPushPlus.addEventListener('click', () => testPushChannel('pushplus'));
    }

    const btnTestServerChan = document.getElementById('btnTestServerChanPush');
    if (btnTestServerChan) {
      btnTestServerChan.addEventListener('click', () => testPushChannel('serverchan'));
    }

    const btnTestWecom = document.getElementById('btnTestWecomPush');
    if (btnTestWecom) {
      btnTestWecom.addEventListener('click', () => testPushChannel('wecom'));
    }

    const btnTestFeishu = document.getElementById('btnTestFeishuPush');
    if (btnTestFeishu) {
      btnTestFeishu.addEventListener('click', () => testPushChannel('feishu'));
    }

    const btnTestCustom = document.getElementById('btnTestCustomPush');
    if (btnTestCustom) {
      btnTestCustom.addEventListener('click', () => testPushChannel('custom'));
    }

    // 大模型服务商预设联动
    const selProvider = document.getElementById('cfgLlmProvider');
    if (selProvider) {
      selProvider.addEventListener('change', () => {
        const p = selProvider.value;
        const inputUrl = document.getElementById('cfgLlmBaseUrl');
        const inputModel = document.getElementById('cfgLlmModel');
        const inputKey = document.getElementById('cfgLlmApiKey');
        const statusBadge = document.getElementById('apiKeyStatusBadge');
        const hintApiKey = document.getElementById('apiKeyMaskHint');

        if (p === 'antigravity-tools') {
          if (inputUrl) inputUrl.value = 'http://127.0.0.1:8045/v1';
          if (inputModel) inputModel.value = 'gemini-3.8-flash-high';
          if (inputKey) inputKey.placeholder = '无需 Key (本地极速服务)';
          if (statusBadge) {
            statusBadge.textContent = '免Key';
            statusBadge.className = 'status-pill status-online';
          }
          if (hintApiKey) {
            hintApiKey.textContent = '⚡ 使用本地 Antigravity Tools 极速服务 (8045端口)，无需配置 API Key';
            hintApiKey.style.color = 'var(--cyan-glow, #38bdf8)';
          }
        } else if (p === 'deepseek') {
          if (inputUrl) inputUrl.value = 'https://api.deepseek.com/v1';
          if (inputModel) inputModel.value = 'deepseek-chat';
          if (inputKey) inputKey.placeholder = 'sk-...';
        } else if (p === 'openai') {
          if (inputUrl) inputUrl.value = 'https://api.openai.com/v1';
          if (inputModel) inputModel.value = 'gpt-4o-mini';
          if (inputKey) inputKey.placeholder = 'sk-...';
        }
      });
    }

    // 独立卡片：保存大模型日常问答配置
    const btnSaveLlm = document.getElementById('btnSaveLlmConfig');
    if (btnSaveLlm) {
      btnSaveLlm.addEventListener('click', async () => {
        const hint = document.getElementById('llmSaveResultHint');
        if (hint) {
          hint.textContent = '正在保存...';
          hint.style.color = 'var(--text-muted, #888)';
        }

        const provider = document.getElementById('cfgLlmProvider')?.value || 'deepseek';
        const baseUrl = (document.getElementById('cfgLlmBaseUrl')?.value || '').trim();
        const model = (document.getElementById('cfgLlmModel')?.value || '').trim();
        const prompt = (document.getElementById('cfgSystemPrompt')?.value || '').trim();
        const newKey = (document.getElementById('cfgLlmApiKey')?.value || '').trim();

        const payload = {
          llmProvider: provider,
          llmBaseUrl: baseUrl,
          llmModel: model,
          systemPromptQA: prompt
        };
        if (newKey) {
          payload.llmApiKey = newKey;
        } else if (provider === 'antigravity-tools') {
          payload.llmApiKey = 'local';
        }

        try {
          const res = await apiFetch('/api/config/save', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          const json = await res.json();
          if (json.success) {
            if (hint) {
              hint.textContent = '✅ 模型设置已保存！';
              hint.style.color = 'var(--green-glow, #34d399)';
              setTimeout(() => { hint.textContent = ''; }, 3000);
            }
            showToast('✅ 移动端日常问答大模型配置已保存');
            await loadSettings();
          } else {
            if (hint) {
              hint.textContent = '❌ 保存失败: ' + (json.error || '');
              hint.style.color = 'var(--red-glow, #f87171)';
            }
            showToast('❌ 保存失败', true);
          }
        } catch (e) {
          if (hint) {
            hint.textContent = '❌ 保存异常: ' + e.message;
            hint.style.color = 'var(--red-glow, #f87171)';
          }
          showToast('❌ 保存异常: ' + e.message, true);
        }
      });
    }

    // 独立卡片：测试大模型连通性
    async function testLlmConnectivity() {
      const hint = document.getElementById('llmSaveResultHint') || document.getElementById('llmTestResultHint');
      const btn = document.getElementById('btnTestLlmConnect') || document.getElementById('btnTestLlm');
      const originalText = btn ? btn.textContent : '';

      if (hint) {
        hint.textContent = '⏳ 正在测试连通性...';
        hint.style.color = 'var(--cyan-glow, #38bdf8)';
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 测试中...';
      }
      showToast('⏳ 正在向大模型接口发送测试请求...');

      const provider = document.getElementById('cfgLlmProvider')?.value || 'deepseek';
      const baseUrl = (document.getElementById('cfgLlmBaseUrl')?.value || '').trim();
      const model = (document.getElementById('cfgLlmModel')?.value || '').trim();
      const prompt = (document.getElementById('cfgSystemPrompt')?.value || '').trim();
      const newKey = (document.getElementById('cfgLlmApiKey')?.value || '').trim();

      const payload = {
        llmProvider: provider,
        llmBaseUrl: baseUrl,
        llmModel: model,
        systemPromptQA: prompt
      };
      if (newKey) payload.llmApiKey = newKey;

      try {
        const res = await apiFetch('/api/llm/test', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
          const successMsg = `✅ 连通成功 (${json.latencyMs}ms)!`;
          if (hint) {
            hint.textContent = successMsg;
            hint.style.color = 'var(--green-glow, #34d399)';
            setTimeout(() => { hint.textContent = ''; }, 5000);
          }
          showToast(`🎉 大模型测试连通成功！\n耗时: ${json.latencyMs}ms\n回复: ${json.reply || '正常'}`);
        } else {
          const failMsg = `❌ 连通失败: ${json.error || '无法访问'}`;
          if (hint) {
            hint.textContent = failMsg;
            hint.style.color = 'var(--red-glow, #f87171)';
          }
          showToast(failMsg, true);
        }
      } catch (e) {
        const errMsg = `❌ 测试异常: ${e.message}`;
        if (hint) {
          hint.textContent = errMsg;
          hint.style.color = 'var(--red-glow, #f87171)';
        }
        showToast(errMsg, true);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }
    }

    const btnTestLlmConnect = document.getElementById('btnTestLlmConnect');
    if (btnTestLlmConnect) btnTestLlmConnect.addEventListener('click', testLlmConnectivity);
    const btnTestLlm = document.getElementById('btnTestLlm');
    if (btnTestLlm) btnTestLlm.addEventListener('click', testLlmConnectivity);

    const btnRunDiag = document.getElementById('btnRunDiagnosis');
    if (btnRunDiag) {
      btnRunDiag.addEventListener('click', async () => {
        const diagContainer = document.getElementById('diagResultContainer') || document.getElementById('diagnosisResultsContainer');
        const diagList = document.getElementById('diagItemsList') || diagContainer;
        if (!diagContainer) return;

        btnRunDiag.disabled = true;
        btnRunDiag.textContent = '🧪 诊断中...';
        diagContainer.classList.remove('hidden');
        diagContainer.style.display = 'block';
        if (diagList) {
          diagList.innerHTML = '<div class="text-muted" style="padding:10px;text-align:center;">正在对系统进行深度自检与容错诊断...</div>';
        }

        try {
          const res = await apiFetch('/api/services/diagnose');
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          const json = await res.json();
          if (json.results && diagList) {
            diagList.innerHTML = json.results.map((r) => {
              const statusColor = r.status === 'pass' ? 'var(--green-glow, #34d399)' : (r.status === 'warn' ? 'var(--yellow-glow, #fbbf24)' : 'var(--red-glow, #f87171)');
              const statusIcon = r.status === 'pass' ? '✅' : (r.status === 'warn' ? '⚠️' : '❌');
              const badgeClass = r.status === 'pass' ? 'diag-badge-pass' : (r.status === 'warn' ? 'diag-badge-warn' : 'diag-badge-fail');
              const badgeText = r.status === 'pass' ? 'PASS 通过' : (r.status === 'warn' ? 'WARN 提示' : 'FAIL 异常');
              return `
                <div class="diag-item-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:6px;">
                  <div>
                    <div style="font-weight:600;color:#fff;font-size:12px;display:flex;align-items:center;gap:6px;">
                      <span>${statusIcon}</span>
                      <span>${escapeHtml(r.name)}</span>
                    </div>
                    <div style="color:${statusColor};font-size:11px;margin-top:2px;margin-left:22px;">${escapeHtml(r.detail)}</div>
                  </div>
                  <span class="diag-badge ${badgeClass}">${badgeText}</span>
                </div>
              `;
            }).join('');
            showToast('🩺 深度自检与容错诊断完成');
          }
        } catch (e) {
          if (diagList) {
            diagList.innerHTML = `<div class="text-danger" style="padding:8px;font-size:11px;color:var(--red-glow);">❌ 诊断执行异常: ${escapeHtml(e.message)}</div>`;
          }
          showToast(`自检失败: ${e.message}`, true);
        } finally {
          btnRunDiag.disabled = false;
          btnRunDiag.textContent = '🧪 运行自检与容错诊断';
        }
      });
    }

    const btnCloseDiag = document.getElementById('btnCloseDiag');
    if (btnCloseDiag) {
      btnCloseDiag.addEventListener('click', () => {
        const diagContainer = document.getElementById('diagResultContainer') || document.getElementById('diagnosisResultsContainer');
        if (diagContainer) {
          diagContainer.classList.add('hidden');
          diagContainer.style.display = 'none';
        }
      });
    }

    const btnRestartBot = document.getElementById('btnRestartWechatBot') || document.getElementById('btnRestartBot');
    if (btnRestartBot) {
      btnRestartBot.addEventListener('click', async () => {
        btnRestartBot.disabled = true;
        btnRestartBot.textContent = '🔄 重启中...';
        try {
          const res = await apiFetch('/api/services/wechat-bot/restart', { method: 'POST' });
          const json = await res.json();
          if (json.success) {
            showToast(`✅ 微信机器人已重启并由守护中心接管 (PID: ${json.pid || '-'})`);
            if (typeof loadServicesStatus === 'function') loadServicesStatus();
            if (typeof loadServiceStatus === 'function') loadServiceStatus();
          } else {
            showToast(`重启失败: ${json.error || ''}`, true);
          }
        } catch (e) {
          showToast(`请求异常: ${e.message}`, true);
        } finally {
          btnRestartBot.disabled = false;
          btnRestartBot.textContent = '🔄 重启微信机器人';
        }
      });
    }

    const btnToggleLogs = document.getElementById('btnToggleBotLogs');
    const logsBox = document.getElementById('botLogsPanel') || document.getElementById('botLogsContainer');
    const logsContent = document.getElementById('botLogsContent');
    const btnRefreshLogs = document.getElementById('btnRefreshBotLogs');

    async function refreshBotLogs() {
      if (!logsContent) return;
      try {
        const res = await apiFetch('/api/services/wechat-bot/logs');
        const json = await res.json();
        if (json.logs && json.logs.length > 0) {
          logsContent.textContent = json.logs.join('\n');
          logsContent.scrollTop = logsContent.scrollHeight;
        } else {
          logsContent.textContent = '暂无守护进程日志输出';
        }
      } catch (e) {
        logsContent.textContent = `加载日志失败: ${e.message}`;
      }
    }

    if (btnToggleLogs && logsBox) {
      btnToggleLogs.addEventListener('click', () => {
        const isHidden = logsBox.classList.contains('hidden') || logsBox.style.display === 'none';
        if (isHidden) {
          logsBox.classList.remove('hidden');
          logsBox.style.display = 'block';
          btnToggleLogs.textContent = '📋 收起随身端实时日志';
          refreshBotLogs();
        } else {
          logsBox.classList.add('hidden');
          logsBox.style.display = 'none';
          btnToggleLogs.textContent = '📋 展开随身端实时日志';
        }
      });
    }

    if (btnRefreshLogs) {
      btnRefreshLogs.addEventListener('click', () => refreshBotLogs());
    }

    const btnCopyCallback = document.getElementById('btnCopyFeishuCallbackUrl');
    if (btnCopyCallback) {
      btnCopyCallback.addEventListener('click', () => {
        const input = document.getElementById('feishuCallbackUrlDisplay');
        if (input && navigator.clipboard) {
          navigator.clipboard.writeText(input.value);
          showToast('📋 飞书回调地址已复制到剪贴板');
        }
      });
    }

    const btnToggleFeishuAppSec = document.getElementById('btnToggleFeishuAppSecret');
    const inputFeishuAppSec = document.getElementById('cfgFeishuAppSecret');
    if (btnToggleFeishuAppSec && inputFeishuAppSec) {
      btnToggleFeishuAppSec.addEventListener('click', () => {
        if (inputFeishuAppSec.type === 'password') {
          inputFeishuAppSec.type = 'text';
          btnToggleFeishuAppSec.textContent = '隐藏';
        } else {
          inputFeishuAppSec.type = 'password';
          btnToggleFeishuAppSec.textContent = '显示';
        }
      });
    }

    document.getElementById('btnSaveConfig').addEventListener('click', async () => {
      const hint = document.getElementById('saveResultHint');
      hint.textContent = '正在保存...';

      const payload = {
        xmlPort: Number(document.getElementById('cfgXmlPort').value) || 18765,
        token: document.getElementById('cfgToken').value.trim(),
        autoDispatch: document.getElementById('cfgAutoDispatch').checked,
        autoStartWechatBot: document.getElementById('cfgAutoStartWechatBot')?.checked !== false,
        enableAIIntentCheck: document.getElementById('cfgEnableAIIntentCheck')?.checked !== false,
        waitForAgentReply: document.getElementById('cfgWaitForAgentReply').checked,
        waitReplyTimeoutSec: Number(document.getElementById('cfgWaitReplyTimeoutSec').value) || 45,
        notifyChannel: document.getElementById('cfgNotifyChannel').value,
        notifyPushPlusToken: document.getElementById('cfgNotifyPushPlusToken').value.trim(),
        notifyServerChanKey: document.getElementById('cfgNotifyServerChanKey').value.trim(),
        notifyWecomUrl: (document.getElementById('cfgNotifyWecomUrl')?.value || '').trim(),
        notifyWebhookUrl: document.getElementById('cfgNotifyWebhookUrl').value.trim(),
        feishuWebhookUrl: document.getElementById('cfgFeishuWebhookUrl').value.trim(),
        feishuSecret: document.getElementById('cfgFeishuSecret').value.trim(),
        feishuAppId: document.getElementById('cfgFeishuAppId').value.trim(),
        feishuAppSecret: document.getElementById('cfgFeishuAppSecret').value.trim(),
        feishuVerificationToken: document.getElementById('cfgFeishuVerificationToken').value.trim(),
        feishuEncryptKey: document.getElementById('cfgFeishuEncryptKey').value.trim(),
        feishuNotifyOnDispatch: document.getElementById('cfgFeishuNotifyOnDispatch').checked,
        llmProvider: document.getElementById('cfgLlmProvider').value,
        llmBaseUrl: document.getElementById('cfgLlmBaseUrl').value.trim(),
        llmModel: document.getElementById('cfgLlmModel').value.trim(),
        systemPromptQA: document.getElementById('cfgSystemPrompt').value.trim()
      };

      const newKey = inputApiKey.value.trim();
      if (newKey) {
        payload.llmApiKey = newKey;
      }

      try {
        const res = await apiFetch('/api/config/save', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
          hint.textContent = '✅ 保存成功！';
          showToast('✅ 配置保存成功');
          setTimeout(() => { hint.textContent = ''; }, 3000);
          refreshAll();
          loadServiceStatus();
          await loadSettings();
        } else {
          hint.textContent = '❌ 保存失败: ' + (json.error || '');
          showToast('❌ 保存失败', true);
        }
      } catch (e) {
        hint.textContent = '❌ 保存异常: ' + e.message;
        showToast('❌ 保存异常: ' + e.message, true);
      }
    });

    bindWechatQrSettingsEvents();
    initSettingsCollapsible();
  }

  // ---------------------------------------------------------------------------
  // 设置模块折叠与展开管理
  // ---------------------------------------------------------------------------
  const SETTINGS_COLLAPSE_STORAGE_KEY = 'antigravity_settings_collapsed_map';

  function getSettingsCollapseMap() {
    try {
      const raw = localStorage.getItem(SETTINGS_COLLAPSE_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    // 默认折叠较长的配置项，保持运行状态与微信扫码卡片展开
    return {
      autostart: false,
      'wechat-bind': false,
      gateway: true,
      llm: true,
      push: true,
      feishu: true
    };
  }

  function saveSettingsCollapseMap(map) {
    try {
      localStorage.setItem(SETTINGS_COLLAPSE_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function applyBoxCollapseState(box, isCollapsed) {
    if (!box) return;
    const icon = box.querySelector('.box-collapse-icon');
    if (isCollapsed) {
      box.classList.add('collapsed');
      if (icon) icon.textContent = '▸';
    } else {
      box.classList.remove('collapsed');
      if (icon) icon.textContent = '▾';
    }
  }

  function initSettingsCollapsible() {
    const collapseMap = getSettingsCollapseMap();
    const boxes = document.querySelectorAll('#tab-settings .settings-box[data-module]');

    boxes.forEach((box) => {
      const mod = box.getAttribute('data-module');
      if (!mod) return;
      const isCollapsed = !!collapseMap[mod];
      applyBoxCollapseState(box, isCollapsed);

      const header = box.querySelector('.settings-box-header');
      if (header && !header.dataset.collapseBound) {
        header.dataset.collapseBound = 'true';
        header.addEventListener('click', (e) => {
          // 忽略点击内部交互控件（如按钮、下拉、开关、输入框等）
          if (e.target.closest('button, input, select, textarea, a, .compact-switch, label, .hero-pill')) {
            return;
          }
          const currentlyCollapsed = box.classList.contains('collapsed');
          const nextState = !currentlyCollapsed;
          applyBoxCollapseState(box, nextState);
          collapseMap[mod] = nextState;
          saveSettingsCollapseMap(collapseMap);
        });
      }
    });

    // 绑定全部折叠 / 全部展开按钮
    const btnCollapseAll = document.getElementById('btnCollapseAllSettings');
    if (btnCollapseAll && !btnCollapseAll.dataset.bound) {
      btnCollapseAll.dataset.bound = 'true';
      btnCollapseAll.addEventListener('click', () => {
        boxes.forEach((box) => {
          const mod = box.getAttribute('data-module');
          applyBoxCollapseState(box, true);
          if (mod) collapseMap[mod] = true;
        });
        saveSettingsCollapseMap(collapseMap);
      });
    }

    const btnExpandAll = document.getElementById('btnExpandAllSettings');
    if (btnExpandAll && !btnExpandAll.dataset.bound) {
      btnExpandAll.dataset.bound = 'true';
      btnExpandAll.addEventListener('click', () => {
        boxes.forEach((box) => {
          const mod = box.getAttribute('data-module');
          applyBoxCollapseState(box, false);
          if (mod) collapseMap[mod] = false;
        });
        saveSettingsCollapseMap(collapseMap);
      });
    }
  }

  async function loadServiceStatus() {
    try {
      const res = await apiFetch('/api/services/status');
      if (!res.ok) return;
      const data = await res.json();
      const pillServer = document.getElementById('devopsServerStatusPill');
      const pillBot = document.getElementById('devopsBotStatusPill');
      if (pillServer && data.server) {
        pillServer.textContent = `网关端口 ${data.server.port} 运行中`;
        pillServer.className = 'status-pill status-online';
      }
      if (pillBot && data.wechatBot) {
        if (data.wechatBot.running) {
          pillBot.textContent = `微信守护中 (PID ${data.wechatBot.pid})`;
          pillBot.className = 'status-pill status-online';
        } else {
          pillBot.textContent = data.wechatBot.enabled ? '微信离线 (等待拉起)' : '微信守护未启用';
          pillBot.className = 'status-pill status-offline';
        }
      }

      // 自动化监控中心卡片同步
      const elApiPort = document.getElementById('svcApiPort');
      const elApiStatus = document.getElementById('svcApiStatus');
      const elWechatPid = document.getElementById('svcWechatPid');
      const elWechatRestarts = document.getElementById('svcWechatRestarts');
      const elWechatStatus = document.getElementById('svcWechatStatus');
      const elWechatDot = document.getElementById('svcWechatDot');
      const globalBadge = document.getElementById('svcGlobalStatusBadge');

      if (elApiPort && data.server) elApiPort.textContent = data.server.port || 18765;
      if (elApiStatus && data.server) elApiStatus.textContent = data.server.status === 'listening' ? '正常监听中' : '未监听';

      const bot = data.wechatBot || {};
      if (elWechatPid) elWechatPid.textContent = bot.pid ? bot.pid : (bot.running ? '运行中' : '未启动');
      if (elWechatRestarts) elWechatRestarts.textContent = bot.restarts || 0;

      if (elWechatStatus) {
        if (bot.running) {
          elWechatStatus.textContent = bot.pid ? `自动守护中 (PID: ${bot.pid})` : '自动守护中';
          if (elWechatDot) elWechatDot.className = 'badge-dot dot-green';
          if (globalBadge) {
            globalBadge.textContent = '🟢 全部服务自启就绪';
            globalBadge.style.color = 'var(--green-glow, #34d399)';
          }
        } else {
          elWechatStatus.textContent = bot.enabled ? '未运行 (待拉起)' : '自启动已停用';
          if (elWechatDot) elWechatDot.className = 'badge-dot dot-yellow';
          if (globalBadge) {
            globalBadge.textContent = '🟡 微信随身端未运行';
            globalBadge.style.color = 'var(--yellow-glow, #fbbf24)';
          }
        }
      }
    } catch (e) {}
  }

  async function loadSettings() {
    try {
      const res = await apiFetch('/api/wechat/data');
      if (!res.ok) return;
      const json = await res.json();
      const cfg = json.config || {};

      document.getElementById('cfgXmlPort').value = cfg.xmlPort || 18765;
      document.getElementById('cfgToken').value = cfg.token || 'antigravity_token';
      document.getElementById('cfgAutoDispatch').checked = cfg.autoDispatch !== false;
      if (document.getElementById('cfgAutoStartWechatBot')) {
        document.getElementById('cfgAutoStartWechatBot').checked = cfg.autoStartWechatBot !== false;
      }
      if (document.getElementById('cfgEnableAIIntentCheck')) {
        document.getElementById('cfgEnableAIIntentCheck').checked = cfg.enableAIIntentCheck !== false;
      }
      document.getElementById('cfgWaitForAgentReply').checked = cfg.waitForAgentReply !== false;
      document.getElementById('cfgWaitReplyTimeoutSec').value = cfg.waitReplyTimeoutSec || 45;
      document.getElementById('cfgNotifyChannel').value = cfg.notifyChannel || 'none';
      document.getElementById('cfgNotifyPushPlusToken').value = cfg.notifyPushPlusToken || '';
      document.getElementById('cfgNotifyServerChanKey').value = cfg.notifyServerChanKey || '';
      if (document.getElementById('cfgNotifyWecomUrl')) {
        document.getElementById('cfgNotifyWecomUrl').value = cfg.notifyWecomUrl || cfg.notifyWebhookUrl || '';
      }
      document.getElementById('cfgNotifyWebhookUrl').value = cfg.notifyWebhookUrl || '';
      document.getElementById('cfgFeishuWebhookUrl').value = cfg.feishuWebhookUrl || '';
      document.getElementById('cfgFeishuSecret').value = cfg.feishuSecret || '';
      document.getElementById('cfgFeishuAppId').value = cfg.feishuAppId || '';
      document.getElementById('cfgFeishuAppSecret').value = cfg.feishuAppSecret || '';
      document.getElementById('cfgFeishuVerificationToken').value = cfg.feishuVerificationToken || '';
      document.getElementById('cfgFeishuEncryptKey').value = cfg.feishuEncryptKey || '';
      document.getElementById('cfgFeishuNotifyOnDispatch').checked = !!cfg.feishuNotifyOnDispatch;

      const cbDisplay = document.getElementById('feishuCallbackUrlDisplay');
      if (cbDisplay) {
        cbDisplay.value = `${window.location.origin}/api/feishu/event`;
      }

      const selNotifyChannel = document.getElementById('cfgNotifyChannel');
      if (selNotifyChannel) {
        updateNotifyChannelVisibility();
      }

      document.getElementById('cfgLlmProvider').value = cfg.llmProvider || 'deepseek';
      document.getElementById('cfgLlmBaseUrl').value = cfg.llmBaseUrl || 'https://api.deepseek.com/v1';
      document.getElementById('cfgLlmModel').value = cfg.llmModel || 'deepseek-chat';
      document.getElementById('cfgSystemPrompt').value = cfg.systemPromptQA || '';

      const statusBadge = document.getElementById('apiKeyStatusBadge');
      const hintApiKey = document.getElementById('apiKeyMaskHint');
      const inputApiKey = document.getElementById('cfgLlmApiKey');
      if (inputApiKey) inputApiKey.value = '';

      if (cfg.llmApiKeyMasked) {
        if (statusBadge) {
          statusBadge.textContent = '已保存';
          statusBadge.className = 'status-pill status-online';
        }
        if (hintApiKey) {
          hintApiKey.innerHTML = `🔒 已安全保存密钥：<code>${escapeHtml(cfg.llmApiKeyMasked)}</code> (如无需修改请留空，输入新 Key 保存即可覆盖)`;
          hintApiKey.style.color = '#34d399';
        }
      } else {
        const isLocal = (cfg.llmProvider === 'antigravity-tools');
        if (statusBadge) {
          statusBadge.textContent = isLocal ? '免Key' : '未配置';
          statusBadge.className = isLocal ? 'status-pill status-online' : 'status-pill status-idle';
        }
        if (hintApiKey) {
          if (isLocal) {
            hintApiKey.textContent = '⚡ 使用本地 Antigravity Tools 极速服务 (8045端口)，无需配置 API Key';
            hintApiKey.style.color = 'var(--cyan-glow, #38bdf8)';
          } else {
            hintApiKey.textContent = 'ℹ️ 尚未配置 API Key。DeepSeek / OpenAI 请在上方输入 sk-... 密钥并点击保存';
            hintApiKey.style.color = 'var(--text-muted, #94a3b8)';
          }
        }
      }

      loadServiceStatus();
      await loadWechatBindingQrStatus();
    } catch (e) {
      console.error('Load settings error:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // 微信随身端扫码绑定与账号中心管理
  // ---------------------------------------------------------------------------
  let wechatQrPollTimer = null;
  let isWechatRebinding = false;

  function stopWechatQrPolling() {
    if (wechatQrPollTimer) {
      clearInterval(wechatQrPollTimer);
      wechatQrPollTimer = null;
    }
  }

  function startWechatQrPolling() {
    stopWechatQrPolling();
    wechatQrPollTimer = setInterval(async () => {
      if (activeTab !== 'tab-settings') {
        stopWechatQrPolling();
        return;
      }
      if (isWechatRebinding) return;
      await loadWechatBindingQrStatus(false);
    }, 3500);
  }

  async function loadWechatBindingQrStatus(forceRefresh = false) {
    try {
      const res = await apiFetch('/api/wechat/qrcode');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.success) return;

      const pillStatus = document.getElementById('wechatBindingStatusPill');
      const elBotId = document.getElementById('wechatBotIdDisplay');
      const elUserId = document.getElementById('wechatUserIdDisplay');
      const elCredState = document.getElementById('wechatCredStateDisplay');
      const elProcState = document.getElementById('wechatProcessStateDisplay');
      const qrDisplayArea = document.getElementById('wechatQrDisplayArea');
      const boundSuccessArea = document.getElementById('wechatBoundSuccessArea');
      const imgQr = document.getElementById('imgWechatQrCode');
      const linkAuth = document.getElementById('linkWechatAuthPage');
      const qrErrorPh = document.getElementById('qrImgErrorPlaceholder');

      // 1. 随身端进程状态
      if (elProcState) {
        if (data.botRunning) {
          elProcState.textContent = `自动守护中 (PID: ${data.botPid || '-'})`;
          elProcState.style.color = 'var(--green-glow, #34d399)';
        } else {
          elProcState.textContent = '未启动 (待自动拉起)';
          elProcState.style.color = 'var(--yellow-glow, #fbbf24)';
        }
      }

      // 2. 账号与绑定状态判定
      const isBound = !!(data.isBound && data.credentials && data.credentials.hasToken);

      if (isBound) {
        // 已成功绑定
        if (pillStatus) {
          pillStatus.textContent = '🟢 已绑定就绪';
          pillStatus.style.color = 'var(--green-glow, #34d399)';
          pillStatus.style.borderColor = 'rgba(52, 211, 153, 0.35)';
          pillStatus.style.background = 'rgba(52, 211, 153, 0.1)';
        }
        if (elBotId) elBotId.textContent = data.credentials.botId || '-';
        if (elUserId) elUserId.textContent = data.credentials.userId || '已绑定';
        if (elCredState) {
          elCredState.textContent = '有效 (已持久化)';
          elCredState.style.color = 'var(--green-glow, #34d399)';
        }

        // 显示成功卡片，隐藏二维码区
        if (!isWechatRebinding) {
          if (boundSuccessArea) boundSuccessArea.style.display = 'flex';
          if (qrDisplayArea) qrDisplayArea.style.display = 'none';
          stopWechatQrPolling();
        }
      } else {
        // 未绑定或凭证过期，需扫码
        if (pillStatus) {
          pillStatus.textContent = '🟡 待微信扫码';
          pillStatus.style.color = 'var(--yellow-glow, #fbbf24)';
          pillStatus.style.borderColor = 'rgba(251, 191, 36, 0.35)';
          pillStatus.style.background = 'rgba(251, 191, 36, 0.1)';
        }
        if (elBotId) elBotId.textContent = (data.credentials && data.credentials.botId) || '未生成';
        if (elUserId) elUserId.textContent = '等待微信扫码授权...';
        if (elCredState) {
          elCredState.textContent = '暂无凭据 (请使用手机扫码)';
          elCredState.style.color = 'var(--yellow-glow, #fbbf24)';
        }

        // 显示二维码区，隐藏成功提示
        if (boundSuccessArea) boundSuccessArea.style.display = 'none';
        if (qrDisplayArea) qrDisplayArea.style.display = 'flex';

        // 更新二维码图片
        if (imgQr) {
          if (data.hasQr) {
            imgQr.src = `/api/wechat/qrcode.png?t=${forceRefresh ? Date.now() : (data.qrMtime || Date.now())}`;
            imgQr.style.display = 'block';
            if (qrErrorPh) qrErrorPh.style.display = 'none';
          } else {
            imgQr.style.display = 'none';
            if (qrErrorPh) qrErrorPh.style.display = 'flex';
          }
        }

        // 更新授权网页链接
        if (linkAuth) {
          if (data.qrAuthUrl) {
            linkAuth.href = data.qrAuthUrl;
            linkAuth.textContent = data.qrAuthUrl;
          } else {
            linkAuth.href = '#';
            linkAuth.textContent = '手机微信扫描左侧二维码自动生成授权链接';
          }
        }

        // 保持轮询检测用户手机扫码完成
        if (activeTab === 'tab-settings' && !wechatQrPollTimer) {
          startWechatQrPolling();
        }
      }
    } catch (e) {
      console.error('loadWechatBindingQrStatus error:', e);
    }
  }

  function bindWechatQrSettingsEvents() {
    const btnRebind = document.getElementById('btnWechatRebind');
    const btnForceRebind = document.getElementById('btnWechatForceRebind');
    const btnRefreshQr = document.getElementById('btnRefreshWechatQr');
    const btnUnbind = document.getElementById('btnUnbindWechat');
    const qrOverlay = document.getElementById('qrMaskOverlay');
    const qrMaskText = document.getElementById('qrMaskText');
    const qrDisplayArea = document.getElementById('wechatQrDisplayArea');
    const boundSuccessArea = document.getElementById('wechatBoundSuccessArea');
    const imgQr = document.getElementById('imgWechatQrCode');

    async function triggerRebindFlow() {
      if (isWechatRebinding) return;
      isWechatRebinding = true;

      // 切换显示二维码面板并展示 Loading 遮罩
      if (boundSuccessArea) boundSuccessArea.style.display = 'none';
      if (qrDisplayArea) qrDisplayArea.style.display = 'flex';
      if (qrOverlay) {
        qrOverlay.style.display = 'flex';
        if (qrMaskText) qrMaskText.textContent = '正在重置凭据并从腾讯获取最新二维码...';
      }

      if (btnRebind) { btnRebind.disabled = true; btnRebind.textContent = '🔄 正在获取二维码...'; }
      if (btnForceRebind) { btnForceRebind.disabled = true; }

      try {
        const res = await apiFetch('/api/wechat/rebind', { method: 'POST' });
        const json = await res.json();
        if (json.success) {
          showToast('✅ 最新微信绑定二维码已生成，请使用手机微信扫码');
          if (imgQr) {
            imgQr.src = `/api/wechat/qrcode.png?t=${Date.now()}`;
            imgQr.style.display = 'block';
          }
          const qrErrorPh = document.getElementById('qrImgErrorPlaceholder');
          if (qrErrorPh) qrErrorPh.style.display = 'none';
          
          await loadWechatBindingQrStatus(true);
        } else {
          showToast(`获取失败: ${json.error || '未知异常'}`, true);
        }
      } catch (e) {
        showToast(`请求异常: ${e.message}`, true);
      } finally {
        isWechatRebinding = false;
        if (qrOverlay) qrOverlay.style.display = 'none';
        if (btnRebind) { btnRebind.disabled = false; btnRebind.textContent = '⚡ 重新扫码绑定微信'; }
        if (btnForceRebind) { btnForceRebind.disabled = false; }
        // 开启自动轮询，检测扫码完成
        startWechatQrPolling();
      }
    }

    if (btnRebind) {
      btnRebind.addEventListener('click', triggerRebindFlow);
    }
    if (btnForceRebind) {
      btnForceRebind.addEventListener('click', triggerRebindFlow);
    }

    if (btnRefreshQr) {
      btnRefreshQr.addEventListener('click', async () => {
        btnRefreshQr.disabled = true;
        btnRefreshQr.textContent = '🔄 刷新中...';
        await loadWechatBindingQrStatus(true);
        showToast('🔄 微信二维码与绑定状态已刷新');
        btnRefreshQr.disabled = false;
        btnRefreshQr.textContent = '🔄 刷新二维码与状态';
      });
    }

    if (btnUnbind) {
      btnUnbind.addEventListener('click', async () => {
        if (!confirm('确定要解绑当前微信号并清除本地登录凭证吗？\n解绑后需要重新扫码绑定方可使用微信随身端。')) {
          return;
        }
        btnUnbind.disabled = true;
        try {
          const res = await apiFetch('/api/wechat/unbind', { method: 'POST' });
          const json = await res.json();
          if (json.success) {
            showToast('🗑️ 已解绑当前微信号并清除本地凭证');
            await loadWechatBindingQrStatus(true);
          } else {
            showToast(`解绑失败: ${json.error || ''}`, true);
          }
        } catch (e) {
          showToast(`解绑异常: ${e.message}`, true);
        } finally {
          btnUnbind.disabled = false;
        }
      });
    }
  }

  // 工具函数
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.addEventListener('DOMContentLoaded', init);
})();

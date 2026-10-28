// AI助手 - 侧边栏前端交互逻辑
(function () {
  let activeTab = localStorage.getItem('ai-assistant-active-tab') || 'tab-traffic';
  if (activeTab === 'tab-timeline') activeTab = 'tab-traffic';
  let currentConversationId = '';
  let autoRefreshTimer = null;
  let cachedConfig = null;
  let activeWechatFilter = 'all';
  let activeTimelineFilter = 'all';
  let activeTrafficStatus = '';
  let activeTrafficProto = '';
  let activeTrafficTimeRange = 'weekly';
  let activeTrafficScope = 'current';
  let trafficSearchQuery = '';
  let trafficAutoRefresh = true;
  let trafficPollTimer = null;
  let trafficCurrentPage = 1;
  let trafficPageSize = 50;
  let trafficTotalPages = 1;
  let trafficTotalCount = 0;
  let cachedTrafficLogs = [];
  let cachedTrafficStats = null;
  let cachedTrafficAccount = '';
  let cachedAllAccounts = [];
  let currentSelectedTrafficLog = null;
  let activeTelemetrySubview = localStorage.getItem('ai-assistant-telemetry-subview') || 'timeline';
  let currentRankTab = 'account'; // 'account' | 'model'
  let currentDiffLayout = 'three-column'; // 'three-column' | 'postman'
  let currentDiffDepth = 'brief'; // 'brief' | 'full'
  let currentPostmanTab = 'postman-req'; // 'postman-req' | 'postman-fwd' | 'postman-resp' | 'postman-timing'
  let isMetaBannerCollapsed = false;
  const CURRENT_UI_BUILD_ID = '20261026.sqlite_ledger.v27';

  // DOM 元素引用
  const sessionSelect = document.getElementById('sessionSelect');
  const gatewayBadge = document.getElementById('gatewayBadge');
  const dispatchBadge = document.getElementById('dispatchBadge');
  const btnRefreshAll = document.getElementById('btnRefreshAll');
  const taskCountBadge = document.getElementById('taskCountBadge');
  const wechatCountBadge = document.getElementById('wechatCountBadge');
  const trafficCountBadge = document.getElementById('trafficCountBadge');
  const timelineCountBadge = document.getElementById('timelineCountBadge');

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

  // ---------------------------------------------------------------------------
  // ⚡ SWR (Stale-While-Revalidate) 离线首屏瞬时直出机制 (Frame-0 Instant Paint)
  // ---------------------------------------------------------------------------
  const SWR_STORAGE_KEY = 'ai_assistant_swr_cache_v2';

  function restoreSwrCache() {
    try {
      const raw = localStorage.getItem(SWR_STORAGE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw);
      if (!cached || typeof cached !== 'object') return;

      // 1. 瞬时恢复 4 大顶层徽标 (杜绝从 0 跳变)
      if (taskCountBadge && cached.taskCount !== undefined) {
        taskCountBadge.textContent = cached.taskCount;
      }
      if (timelineCountBadge && cached.timelineCount !== undefined) {
        timelineCountBadge.textContent = cached.timelineCount;
      }
      const subviewTimelineBadge = document.getElementById('subviewTimelineBadge');
      if (subviewTimelineBadge && cached.timelineCount !== undefined) {
        subviewTimelineBadge.textContent = `${cached.timelineCount} 步`;
      }
      if (trafficCountBadge && cached.trafficCount !== undefined) {
        trafficCountBadge.textContent = cached.trafficCount;
      }
      const subviewTrafficBadge = document.getElementById('subviewTrafficBadge');
      if (subviewTrafficBadge && cached.trafficCount !== undefined) {
        subviewTrafficBadge.textContent = cached.trafficCount;
      }
      if (wechatCountBadge && cached.wechatCount !== undefined) {
        wechatCountBadge.textContent = cached.wechatCount;
      }

      // 2. 瞬时恢复 Bento 指标卡
      if (cached.bento) {
        const b = cached.bento;
        const elTotal = document.getElementById('trafficStatTokensTotal');
        const elBreakdown = document.getElementById('trafficStatTokensBreakdown');
        const elCacheRate = document.getElementById('trafficStatCacheHitRate');
        const elCacheHint = document.getElementById('trafficStatCacheHint');
        const elReasoning = document.getElementById('trafficStatReasoning');
        const elReasoningHint = document.getElementById('trafficStatReasoningHint');
        const elCost = document.getElementById('trafficStatCost');
        const elCostHint = document.getElementById('trafficStatCostHint');

        if (elTotal && b.total) elTotal.textContent = b.total;
        if (elBreakdown && b.breakdownHtml) elBreakdown.innerHTML = b.breakdownHtml;
        if (elCacheRate && b.cacheHitRate) elCacheRate.textContent = b.cacheHitRate;
        if (elCacheHint && b.cacheHint) elCacheHint.textContent = b.cacheHint;
        if (elReasoning && b.reasoning) elReasoning.textContent = b.reasoning;
        if (elReasoningHint && b.reasoningHint) elReasoningHint.textContent = b.reasoningHint;
        if (elCost && b.cost) elCost.textContent = b.cost;
        if (elCostHint && b.costHint) elCostHint.textContent = b.costHint;
      }

      // 3. 瞬时恢复任务进度条
      if (cached.taskProgress) {
        const elPct = document.getElementById('taskProgressPercent');
        const elBar = document.getElementById('taskProgressBar');
        if (elPct && cached.taskProgress.text) elPct.textContent = cached.taskProgress.text;
        if (elBar && cached.taskProgress.percent !== undefined) elBar.style.width = `${cached.taskProgress.percent}%`;
      }

      // 4. 瞬时恢复多维度排行榜 (杜绝刚打开时空白)
      if (cached.rankingsHtml) {
        const elRankings = document.getElementById('dashboardRankingList');
        if (elRankings && cached.rankingsHtml.trim()) {
          elRankings.innerHTML = cached.rankingsHtml;
        }
      }
      if (cached.rankTab) {
        currentRankTab = cached.rankTab;
        const tabBtns = document.querySelectorAll('#rankingTabGroup .rank-tab-btn');
        tabBtns.forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-rank') === currentRankTab);
        });
      }
    } catch (e) {
      console.warn('[Sidecar SWR] Restore failed:', e);
    }
  }

  function saveSwrSnapshot(patch = {}) {
    try {
      let current = {};
      const raw = localStorage.getItem(SWR_STORAGE_KEY);
      if (raw) current = JSON.parse(raw) || {};
      const updated = { ...current, ...patch, updatedAt: Date.now() };
      localStorage.setItem(SWR_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {}
  }

  // 统一接口请求器：自动在宿主面板注入 X-Sidecar-Token，独立 Web 浏览器无缝降级，并在 SidecarApp 404 时自动回退至本地 HTTP 网关
  async function apiFetch(url, options = {}) {
    const opts = { ...options };
    const headers = new Headers(opts.headers || {});
    if (opts.body && typeof opts.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    opts.headers = headers;

    if (window.sidecar && typeof window.sidecar.fetch === 'function') {
      try {
        const sidecarRes = await window.sidecar.fetch(url, opts);
        if (sidecarRes && sidecarRes.status !== 404) {
          return sidecarRes;
        }
      } catch (err) {
        console.warn(`[apiFetch] sidecar.fetch warning for ${url}:`, err);
      }
    }

    const directUrl = url.startsWith('http') ? url : `http://127.0.0.1:18765${url.startsWith('/') ? '' : '/'}${url}`;
    try {
      const httpRes = await fetch(directUrl, opts);
      if (httpRes) return httpRes;
    } catch (e) {
      // 降级使用相对路径 fetch
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
    const isGlobal = taskOrMsg.isGlobal || taskOrMsg.targetProject === '通用会话';
    const targetProjectDesc = isGlobal 
      ? '\n🌐 模式：全局通用独立会话 (不归属于任何特定工程)' 
      : (taskOrMsg.targetProject ? `\n🎯 目标工程：${taskOrMsg.targetProject}` : '');
    const isDirectChat = !!taskOrMsg.isDirectChat;

    let prompt = '';
    if (isDirectChat || (!desc && rawContent.length < 50)) {
      prompt = [
        `【${sourceLabel}远程指令】来自 [${from}]：`,
        rawContent,
        targetProjectDesc
      ].filter(Boolean).join('\n');
    } else {
      prompt = [
        `【AI助手 任务派发】来自 [${from} (${sourceLabel})]：`,
        `📌 任务需求：${rawContent}${desc}${targetProjectDesc}`,
        isGlobal ? `\n请在通用全局视角下分析需求并协助回答或执行。完成后请简要总结成果。` : `\n请分析需求并在当前项目中直接执行操作或代码修改。完成后请简要总结成果。`
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
    // 0ms 首屏直出：优先瞬间恢复上次持久化快照，保证完全无闪烁
    restoreSwrCache();

    bindTabs();
    bindTimelineControls();
    bindKanbanEvents();
    bindWechatEvents();
    bindTrafficEvents();
    bindPricingModalEvents();
    bindTelemetrySubviewEvents();
    bindMcpEvents();
    bindSettingsEvents();
    setupManagerTrafficDetailEngine();

    // 首屏立即预渲染排行榜，杜绝空置
    if (typeof renderDashboardRankings === 'function') {
      renderDashboardRankings(currentRankTab);
    }

    // 切换到上次记忆的 Tab 并快速渲染首屏
    switchTab(activeTab);

    // 初始状态与指示徽标实时同步
    refreshAll();

    // 后台空闲时段分批预热其余视图，绝不阻塞首屏交互与渲染 (0ms 启动)
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => preloadAllData(), { timeout: 1200 });
    } else {
      setTimeout(() => preloadAllData(), 200);
    }

    // 开启自动轮询 (3秒主循环统一调度)
    startTimelinePolling();
    if (activeTab === 'tab-settings' && typeof startSettingsPolling === 'function') {
      startSettingsPolling();
    }

    // 开启后台独立微信任务与会话直通派发监听器 (1.5秒)
    startAutoDispatchWorker();
    checkWechatAutoDispatch();

    // 开启全场景自适应布局侦测器 (响应用户自由拖拽改变侧边栏或窗口尺寸)
    setupResponsiveObserver();
  }

  // ---------------------------------------------------------------------------
  // 全局自适应页面与侧边栏大小响应器 (Responsive Layout Observer)
  // ---------------------------------------------------------------------------
  function setupResponsiveObserver() {
    const container = document.querySelector('.app-container') || document.body;
    function updateSize(width) {
      let size = 'wide';
      if (width < 380) size = 'tiny';
      else if (width < 580) size = 'compact';
      else if (width < 880) size = 'medium';
      else size = 'wide';

      if (container.getAttribute('data-size') !== size) {
        container.setAttribute('data-size', size);
        document.body.setAttribute('data-size', size);
      }
    }

    if (window.ResizeObserver) {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          updateSize(entry.contentRect.width);
        }
      });
      ro.observe(container);
    }

    window.addEventListener('resize', () => {
      updateSize(container.clientWidth || window.innerWidth);
    });

    updateSize(container.clientWidth || window.innerWidth);
  }

  // ---------------------------------------------------------------------------
  // 全量后台非阻塞热加载与数据预热 (Hot-Preload)
  // ---------------------------------------------------------------------------
  async function preloadAllData() {
    try {
      const tasks = [];
      // 避免重复请求当前 Tab 已在首屏加载过的数据
      if (activeTab !== 'tab-traffic' && activeTab !== 'tab-timeline') {
        tasks.push(loadTrafficLogs(true));
      }
      if (activeTelemetrySubview !== 'timeline') {
        tasks.push(loadTimeline());
      }
      if (activeTab !== 'tab-tasks') {
        tasks.push(loadTasks());
      }
      if (activeTab !== 'tab-wechat') {
        tasks.push(loadWechatData());
      }

      await Promise.allSettled(tasks);

      // 低优先级设置与 MCP 模块延迟至系统深度空闲时再预热
      setTimeout(() => {
        if (typeof loadMcpServices === 'function' && activeTab !== 'tab-mcp') {
          loadMcpServices();
        }
        if (typeof loadSettings === 'function' && activeTab !== 'tab-settings') {
          loadSettings();
        }
      }, 600);

      console.log('[Sidecar UI] Hot preload completed for all views and badges.');
    } catch (err) {
      console.warn('[Sidecar UI] Hot preload warning:', err);
    }
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

    if (tabId === 'tab-traffic' || tabId === 'tab-timeline') {
      tabId = 'tab-traffic';
      loadTrafficLogs();
      if (activeTelemetrySubview === 'timeline') {
        loadTimeline();
      }
    }
    else if (tabId === 'tab-tasks') loadTasks();
    else if (tabId === 'tab-wechat') loadWechatData();
    else if (tabId === 'tab-mcp') loadMcpServices();
    else if (tabId === 'tab-settings') {
      loadSettings();
      initSettingsCollapsible();
      if (typeof startSettingsPolling === 'function') {
        startSettingsPolling();
      }
    }

    if (tabId !== 'tab-settings') {
      if (typeof stopSettingsPolling === 'function') stopSettingsPolling();
      if (typeof stopWechatQrPolling === 'function') stopWechatQrPolling();
    }
  }

  // ---------------------------------------------------------------------------
  // 全局刷新与会话切换
  // ---------------------------------------------------------------------------
  async function refreshAll() {
    try {
      const curConv = currentConversationId || sessionSelect?.value || window.sidecar?.conversationId || '';
      const res = await apiFetch(`/api/status?conversationId=${encodeURIComponent(curConv)}`);
      if (!res.ok) return;
      const data = await res.json();

      // 记录后端最新版本，禁止自动触发 window.location.reload 避免版本时差导致的无限死循环刷新
      if (data.uiVersion && data.uiVersion !== CURRENT_UI_BUILD_ID) {
        console.log('[Sidecar UI] 后端版本更新，当前:', CURRENT_UI_BUILD_ID, '最新:', data.uiVersion);
      }

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
        const hostConvId = window.sidecar?.conversationId || (new URLSearchParams(window.location.search)).get('conversationId') || '';
        const cur = currentConversationId || hostConvId || sessionSelect.value || data.activeConversationId;
        
        // 缓存比对：如果会话列表与当前选项未变，不重构下拉框 DOM，杜绝下拉框被清空导致的 0 步与瞬时闪烁
        const convSig = data.conversations.map(c => `${c.id}:${c.title}:${c.projectName}`).join('|') + `::${hostConvId}::${cur}`;
        if (sessionSelect._lastSig !== convSig) {
          sessionSelect._lastSig = convSig;
          sessionSelect.innerHTML = '';

          const groups = {};
          data.conversations.forEach((conv) => {
            const pName = conv.projectName || '默认工程';
            if (!groups[pName]) groups[pName] = [];
            groups[pName].push(conv);
          });

          for (const [pName, convs] of Object.entries(groups)) {
            const optGroup = document.createElement('optgroup');
            optGroup.label = pName === '通用会话' ? '🌐 全局独立 (通用会话)' : `📦 ${pName}`;
            convs.forEach((conv) => {
              const opt = document.createElement('option');
              opt.value = conv.id;
              const isCurrent = Boolean(hostConvId && conv.id === hostConvId);
              const prefix = isCurrent ? '🟢 [当前] ' : '';
              opt.textContent = `${prefix}${conv.title || conv.id.slice(0, 8)}`;
              if (conv.id === cur) opt.selected = true;
              optGroup.appendChild(opt);
            });
            sessionSelect.appendChild(optGroup);
          }
          currentConversationId = sessionSelect.value;
        } else if (sessionSelect.value !== cur) {
          sessionSelect.value = cur;
          currentConversationId = cur;
        }
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

      // 更新计数标签与指示徽标 (热同步)
      if (data.taskStats && taskCountBadge) {
        const totalTasks = String(data.taskStats.total || '0');
        if (taskCountBadge.textContent !== totalTasks) taskCountBadge.textContent = totalTasks;
      }

      // 仅当非流水子视图时才从 status 更新流水步数与 Token 卡片（流水子视图由 loadTimeline 权威掌控，避免两套数据互相覆盖）
      if (activeTelemetrySubview !== 'timeline') {
        const totalSteps = String(data.timelineCount ?? data.stats?.totalSteps ?? 0);
        if (timelineCountBadge && timelineCountBadge.textContent !== totalSteps) {
          timelineCountBadge.textContent = totalSteps;
        }
        const subviewTimelineBadge = document.getElementById('subviewTimelineBadge');
        if (subviewTimelineBadge) {
          const text = `${totalSteps} 步`;
          if (subviewTimelineBadge.textContent !== text) subviewTimelineBadge.textContent = text;
        }

        // 实时更新 Token 指标卡（若已返回 stats）
        if (data.stats?.tokens) {
          const tokens = data.stats.tokens;
          const elStatTotal = document.getElementById('statTokenTotal');
          const elStatInput = document.getElementById('statTokenInput');
          const elStatCache = document.getElementById('statTokenCache');
          const elStatOutput = document.getElementById('statTokenOutput');
          const totalStr = (tokens.total || 0).toLocaleString();
          const inStr = (tokens.input || 0).toLocaleString();
          const cacheStr = (tokens.cache || 0).toLocaleString();
          const outStr = (tokens.output || 0).toLocaleString();
          if (elStatTotal && elStatTotal.textContent !== totalStr) elStatTotal.textContent = totalStr;
          if (elStatInput && elStatInput.textContent !== inStr) elStatInput.textContent = inStr;
          if (elStatCache && elStatCache.textContent !== cacheStr) elStatCache.textContent = cacheStr;
          if (elStatOutput && elStatOutput.textContent !== outStr) elStatOutput.textContent = outStr;
        }
      }

      if (typeof data.trafficCount === 'number') {
        const tc = String(data.trafficCount);
        if (trafficCountBadge && trafficCountBadge.textContent !== tc) trafficCountBadge.textContent = tc;
      }

      if (typeof data.wechatCount === 'number' && wechatCountBadge) {
        const wc = String(data.wechatCount);
        if (wechatCountBadge.textContent !== wc) wechatCountBadge.textContent = wc;
      }

      // SWR 快照持久化 (供下次启动第 0 毫秒恢复)
      saveSwrSnapshot({
        taskCount: data.taskStats?.total !== undefined ? String(data.taskStats.total) : undefined,
        timelineCount: data.timelineCount !== undefined ? data.timelineCount : (data.stats?.totalSteps !== undefined ? data.stats.totalSteps : undefined),
        trafficCount: typeof data.trafficCount === 'number' ? data.trafficCount : undefined,
        wechatCount: typeof data.wechatCount === 'number' ? data.wechatCount : undefined
      });

      // 刷新当前活动视图（按需定向刷新，避免双重无序重绘）
      if (activeTab === 'tab-traffic' || activeTab === 'tab-timeline') {
        if (activeTelemetrySubview === 'timeline') {
          loadTimeline();
        } else if ((activeTelemetrySubview === 'traffic' || activeTelemetrySubview === 'stats') && trafficAutoRefresh) {
          loadTrafficLogs(true, activeTrafficTimeRange, activeTrafficScope);
        }
      }
      else if (activeTab === 'tab-tasks') loadTasks();
      else if (activeTab === 'tab-wechat') loadWechatData();
    } catch (e) {
      console.error('Refresh status error:', e);
    }
  }

  if (btnRefreshAll) {
    btnRefreshAll.addEventListener('click', () => {
      btnRefreshAll.classList.add('spinning');
      setTimeout(() => btnRefreshAll.classList.remove('spinning'), 600);
      refreshAll();
    });

    btnRefreshAll.addEventListener('dblclick', () => {
      showToast('检测到双击，正在强制硬刷新整页...');
      setTimeout(() => window.location.reload(true), 150);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
      e.preventDefault();
      showToast('正在重载面板视图...');
      window.location.reload(true);
    }
  });

  function openCurrentConversationInHost() {
    const convId = currentConversationId || sessionSelect.value;
    if (!convId) return;
    if (window.sidecar?.ui?.toggleConversation) {
      window.sidecar.ui.toggleConversation(convId);
      const title = sessionSelect.selectedOptions[0]?.textContent || '';
      showToast(`已在 Antigravity 主窗口打开会话：${title}`);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'toggle-conversation',
        payload: { conversationId: convId }
      }, '*');
      const title = sessionSelect.selectedOptions[0]?.textContent || '';
      showToast(`已在 Antigravity 主窗口打开会话：${title}`);
    } else {
      const title = sessionSelect.selectedOptions[0]?.textContent || '目标会话';
      showToast(`📋 面板已聚焦「${title}」。如需在 IDE 主窗口交互，请在左侧会话历史中点击打开`);
    }
  }

  const btnOpenHostConv = document.getElementById('btnOpenHostConv');
  if (btnOpenHostConv) {
    btnOpenHostConv.addEventListener('click', openCurrentConversationInHost);
  }

  sessionSelect.addEventListener('change', () => {
    currentConversationId = sessionSelect.value;
    const title = sessionSelect.selectedOptions[0]?.textContent || '';
    if (title) showToast(`已切换看板视图至：${title}`);
    loadTimeline();
    loadTasks();
    loadTrafficLogs(false, activeTrafficTimeRange, activeTrafficScope);
  });

  // ---------------------------------------------------------------------------
  // 新建工程弹窗与交互
  // ---------------------------------------------------------------------------
  const modalNewProject = document.getElementById('modalNewProject');
  const btnNewProjectModal = document.getElementById('btnNewProjectModal');
  const btnCloseNewProjectModal = document.getElementById('btnCloseNewProjectModal');
  const btnCancelNewProject = document.getElementById('btnCancelNewProject');
  const btnSubmitNewProject = document.getElementById('btnSubmitNewProject');
  const inputNewProjectName = document.getElementById('inputNewProjectName');
  const inputNewProjectPath = document.getElementById('inputNewProjectPath');

  if (btnNewProjectModal && modalNewProject) {
    btnNewProjectModal.addEventListener('click', () => {
      if (inputNewProjectName) inputNewProjectName.value = '';
      if (inputNewProjectPath) inputNewProjectPath.value = '';
      modalNewProject.classList.remove('hidden');
      if (inputNewProjectName) inputNewProjectName.focus();
    });

    const closeProjectModal = () => modalNewProject.classList.add('hidden');
    if (btnCloseNewProjectModal) btnCloseNewProjectModal.addEventListener('click', closeProjectModal);
    if (btnCancelNewProject) btnCancelNewProject.addEventListener('click', closeProjectModal);

    if (btnSubmitNewProject) {
      btnSubmitNewProject.addEventListener('click', async () => {
        const name = (inputNewProjectName?.value || '').trim();
        const path = (inputNewProjectPath?.value || '').trim();
        if (!name) {
          showToast('请输入工程名称', true);
          return;
        }

        btnSubmitNewProject.disabled = true;
        btnSubmitNewProject.textContent = '创建中...';
        try {
          const res = await postApi('/api/projects/new', { name, path });
          if (res && res.success) {
            showToast(`✅ ${res.message || '工程创建成功'}`);
            closeProjectModal();
            refreshAll();
          } else {
            showToast(res?.error || '创建工程失败', true);
          }
        } catch (err) {
          showToast(`创建失败: ${err.message}`, true);
        } finally {
          btnSubmitNewProject.disabled = false;
          btnSubmitNewProject.textContent = '🚀 立即创建';
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 启动新会话弹窗与交互 (支持工程新会话与全局独立通用会话)
  // ---------------------------------------------------------------------------
  const modalNewSession = document.getElementById('modalNewSession');
  const btnNewSessionModal = document.getElementById('btnNewSessionModal');
  const btnCloseNewSessionModal = document.getElementById('btnCloseNewSessionModal');
  const btnCancelNewSession = document.getElementById('btnCancelNewSession');
  const btnSubmitNewSession = document.getElementById('btnSubmitNewSession');
  const selectNewSessionScope = document.getElementById('selectNewSessionScope');
  const inputNewSessionPrompt = document.getElementById('inputNewSessionPrompt');

  if (btnNewSessionModal && modalNewSession) {
    btnNewSessionModal.addEventListener('click', () => {
      if (inputNewSessionPrompt) inputNewSessionPrompt.value = '';
      modalNewSession.classList.remove('hidden');
      if (inputNewSessionPrompt) inputNewSessionPrompt.focus();
    });

    const closeSessionModal = () => modalNewSession.classList.add('hidden');
    if (btnCloseNewSessionModal) btnCloseNewSessionModal.addEventListener('click', closeSessionModal);
    if (btnCancelNewSession) btnCancelNewSession.addEventListener('click', closeSessionModal);

    if (btnSubmitNewSession) {
      btnSubmitNewSession.addEventListener('click', async () => {
        const prompt = (inputNewSessionPrompt?.value || '').trim();
        const isGlobal = selectNewSessionScope?.value === 'global';
        const taskText = prompt || (isGlobal ? '开启全局独立探索会话' : '开启全新研发会话');

        btnSubmitNewSession.disabled = true;
        btnSubmitNewSession.textContent = '启动中...';
        try {
          let fullPrompt = '';
          if (isGlobal) {
            fullPrompt = `【全局通用独立会话 (不归属于任何特定工程)】\n任务需求：${taskText}\n\n请在通用视角下协助分析与回答。`;
          } else {
            fullPrompt = `【全新项目会话】\n任务需求：${taskText}`;
          }

          if (window.sidecar?.agent?.startConversation) {
            await window.sidecar.agent.startConversation(fullPrompt);
            showToast(isGlobal ? '🌐 已启动全局独立通用会话' : '🚀 已启动工程新会话');
            closeSessionModal();
            setTimeout(refreshAll, 1000);
          } else {
            const cmd = isGlobal ? `/new -g ${taskText}` : `/new ${taskText}`;
            await postApi('/api/wechat/simulate', { content: cmd, source: 'web_panel' });
            showToast('🚀 已派发新会话启动任务');
            closeSessionModal();
            setTimeout(refreshAll, 1000);
          }
        } catch (err) {
          showToast(`启动会话失败: ${err.message}`, true);
        } finally {
          btnSubmitNewSession.disabled = false;
          btnSubmitNewSession.textContent = '🚀 立即开启';
        }
      });
    }
  }

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

      // 更新 Token 指标 (带值比对防抖，避免无意义重排)
      const tokens = data.stats?.tokens;
      const elStatTotal = document.getElementById('statTokenTotal');
      const elStatInput = document.getElementById('statTokenInput');
      const elStatCache = document.getElementById('statTokenCache');
      const elStatOutput = document.getElementById('statTokenOutput');
      if (tokens) {
        const totalStr = (tokens.total || 0).toLocaleString();
        const inStr = (tokens.input || 0).toLocaleString();
        const cacheStr = (tokens.cache || 0).toLocaleString();
        const outStr = (tokens.output || 0).toLocaleString();
        if (elStatTotal && elStatTotal.textContent !== totalStr) elStatTotal.textContent = totalStr;
        if (elStatInput && elStatInput.textContent !== inStr) elStatInput.textContent = inStr;
        if (elStatCache && elStatCache.textContent !== cacheStr) elStatCache.textContent = cacheStr;
        if (elStatOutput && elStatOutput.textContent !== outStr) elStatOutput.textContent = outStr;
      }

      const totalSteps = data.stats?.totalSteps || 0;
      const toolCalls = data.stats?.toolCallsCount || 0;
      const statsText = `${totalSteps} 步 · ${toolCalls} 次调用`;
      if (statsInfo && statsInfo.textContent !== statsText) statsInfo.textContent = statsText;

      const subviewTimelineBadge = document.getElementById('subviewTimelineBadge');
      const badgeText = `${totalSteps} 步`;
      if (subviewTimelineBadge && subviewTimelineBadge.textContent !== badgeText) {
        subviewTimelineBadge.textContent = badgeText;
      }

      if (timelineCountBadge && timelineCountBadge.textContent !== String(totalSteps)) {
        timelineCountBadge.textContent = String(totalSteps);
      }

      const elStatCalls = document.getElementById('trafficStatCalls');
      if (elStatCalls && cachedTrafficLogs.length > 0) {
        const callsText = `${cachedTrafficLogs.length} 次 (${totalSteps} 步)`;
        if (elStatCalls.textContent !== callsText) elStatCalls.textContent = callsText;
      }

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

      if (container._lastHtml === html) return;
      container._lastHtml = html;
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
    document.getElementById('btnCancelTaskModal')?.addEventListener('click', () => modalTask?.classList.add('hidden'));

    // 新建阶段弹窗
    document.getElementById('btnAddMilestoneModal')?.addEventListener('click', () => {
      const input = document.getElementById('modalMilestoneTitle');
      if (input) input.value = '';
      modalMilestone?.classList.remove('hidden');
    });
    document.getElementById('btnCloseMilestoneModal')?.addEventListener('click', () => modalMilestone?.classList.add('hidden'));
    document.getElementById('btnCancelMilestoneModal')?.addEventListener('click', () => modalMilestone?.classList.add('hidden'));

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
    document.getElementById('btnCancelEditTaskModal')?.addEventListener('click', () => {
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

      saveSwrSnapshot({
        taskCount: total,
        taskProgress: {
          text: `${percent}% (${doneCount}/${total})`,
          percent
        }
      });

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
    const btnSim = document.getElementById('btnSendSimulate');
    if (btnSim) {
      btnSim.addEventListener('click', async () => {
        const input = document.getElementById('simMsgInput');
        const val = input ? input.value.trim() : '';
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
    }

    const btnToggleFile = document.getElementById('btnToggleFileDrawer');
    const btnCloseFile = document.getElementById('btnCloseFileDrawer');
    const fileDrawer = document.getElementById('wechatFileDrawer');

    if (btnToggleFile && fileDrawer) {
      btnToggleFile.addEventListener('click', () => {
        const isHidden = fileDrawer.style.display === 'none';
        fileDrawer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          btnToggleFile.classList.add('active');
          loadRecentFiles();
        } else {
          btnToggleFile.classList.remove('active');
        }
      });
    }

    if (btnCloseFile && fileDrawer) {
      btnCloseFile.addEventListener('click', () => {
        fileDrawer.style.display = 'none';
        if (btnToggleFile) btnToggleFile.classList.remove('active');
      });
    }

    document.querySelectorAll('.inbox-filters .filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.inbox-filters .filter-chip').forEach((c) => c.classList.remove('active'));
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

    const btnSendFile = document.getElementById('btnSendFileToWechat');
    if (btnSendFile) {
      btnSendFile.addEventListener('click', async () => {
        const input = document.getElementById('sendFilePathInput');
        const filePath = input?.value.trim();
        if (!filePath) {
          showToast('请输入或选择要发送的文件绝对路径', true);
          return;
        }
        btnSendFile.disabled = true;
        btnSendFile.textContent = '⏳ 发送中...';
        try {
          const res = await apiFetch('/api/wechat/send-file', {
            method: 'POST',
            body: JSON.stringify({ filePath })
          });
          const json = await res.json();
          if (json.success) {
            showToast(`✅ 文档《${json.file_name}》已成功推送到微信！`);
            input.value = '';
            loadWechatData();
            loadRecentFiles();
          } else {
            showToast(`❌ 发送失败: ${json.error || '未知错误'}`, true);
          }
        } catch (e) {
          showToast(`❌ 发送异常: ${e.message}`, true);
        } finally {
          btnSendFile.disabled = false;
          btnSendFile.textContent = '📲 发送到微信';
        }
      });
    }

    const btnRefreshFiles = document.getElementById('btnRefreshRecentFiles');
    if (btnRefreshFiles) {
      btnRefreshFiles.addEventListener('click', () => {
        loadRecentFiles();
      });
    }

    loadRecentFiles();
  }

  async function loadRecentFiles() {
    const container = document.getElementById('recentFilesChips');
    if (!container) return;
    try {
      const res = await apiFetch('/api/wechat/recent-files');
      if (!res.ok) throw new Error('获取文件列表失败');
      const data = await res.json();
      const files = data.files || [];
      if (files.length === 0) {
        container.innerHTML = '<span class="text-muted text-xs">暂未在当前工程中扫描到常用文档</span>';
        return;
      }
      container.innerHTML = files.map((f) => `
        <button class="recent-file-chip" title="点击填入路径: ${escapeHtml(f.path)}" data-path="${escapeHtml(f.path)}">
          <span>📄 ${escapeHtml(f.name)}</span>
          <span class="chip-size">${escapeHtml(f.sizeFormatted)}</span>
        </button>
      `).join('');

      container.querySelectorAll('.recent-file-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const p = chip.getAttribute('data-path');
          const input = document.getElementById('sendFilePathInput');
          if (input && p) {
            input.value = p;
            input.focus();
            showToast(`已选择: ${chip.textContent.trim()}`);
          }
        });
      });
    } catch (e) {
      container.innerHTML = `<span class="text-muted text-xs">扫描文件失败: ${escapeHtml(e.message)}</span>`;
    }
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
        if (activeWechatFilter === 'file_transfer') return m.category === 'file_transfer';
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
        const isFile = m.category === 'file_transfer';
        const badgeClass = isTask ? 'status-dispatch' : (isCmd ? 'status-command' : (isFile ? 'status-purple' : 'status-online'));
        const badgeText = isTask ? '🚀 任务' : (isCmd ? '⚙️ 指令' : (isFile ? '📄 文件' : '💬 问答'));

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
            <div class="msg-actions-toolbar" style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:6px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.04);">
              <button class="btn btn-ghost btn-xs" data-action="copy-wx-text" data-content="${escapeHtml(m.content)}" title="一键复制文本">📋 复制</button>
              <button class="btn btn-secondary btn-xs" data-action="to-kanban-task" data-id="${m.id}" data-content="${escapeHtml(m.content)}" data-from="${escapeHtml(m.from)}" title="转为看板待办任务">📌 转为看板待办</button>
              ${isTask && m.status !== 'completed' ? `
                <button class="btn btn-primary btn-xs" data-action="dispatch-wx-msg" data-id="${m.id}" data-content="${escapeHtml(m.content)}" data-from="${escapeHtml(m.from)}">🚀 派发到当前会话</button>
                <button class="btn btn-secondary btn-xs" data-action="newchat-wx-msg" data-id="${m.id}" data-content="${escapeHtml(m.content)}" data-from="${escapeHtml(m.from)}">💬 新会话执行</button>
              ` : ''}
            </div>
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
      listContainer.querySelectorAll('[data-action="copy-wx-text"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const content = btn.getAttribute('data-content') || '';
          navigator.clipboard.writeText(content);
          showToast('📋 已复制消息内容到剪贴板');
        });
      });

      listContainer.querySelectorAll('[data-action="to-kanban-task"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const content = btn.getAttribute('data-content') || '';
          const from = btn.getAttribute('data-from') || '微信随身端';
          const convId = currentConversationId || sessionSelect.value;
          const title = content.length > 30 ? content.slice(0, 30) + '...' : content;
          
          btn.disabled = true;
          btn.textContent = '添加中...';
          try {
            const res = await apiFetch('/api/task/add', {
              method: 'POST',
              body: JSON.stringify({
                conversationId: convId,
                title: `[微信待办] ${title}`,
                desc: `来源: ${from}\n内容全文: ${content}`,
                priority: 'high'
              })
            });
            if (res.ok) {
              showToast('📌 已成功转入迭代任务看板');
              loadTasks();
            } else {
              showToast('转入看板失败', true);
            }
          } catch (err) {
            showToast('转入失败: ' + err.message, true);
          } finally {
            btn.disabled = false;
            btn.textContent = '📌 转为看板待办';
          }
        });
      });

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

    // 微信随身端运行与断开自愈检测
    async function checkWechatBotStatus(autoFix = true, showFeedback = true) {
      const btn = document.getElementById('btnCheckWechatBotStatus');
      const origText = btn ? btn.textContent : '';
      if (btn && showFeedback) {
        btn.disabled = true;
        btn.textContent = '🔍 正在检测并自愈...';
      }

      try {
        const res = await apiFetch(`/api/services/wechat-bot/check?autoFix=${autoFix ? 'true' : 'false'}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        await loadServiceStatus();
        if (typeof loadWechatBindingQrStatus === 'function') {
          await loadWechatBindingQrStatus(false);
        }

        if (showFeedback) {
          if (data.running) {
            if (data.restartedJustNow) {
              showToast(`⚡ 检测到微信随身端曾断开，已为您自动重新拉起并恢复守护！(PID: ${data.pid})`);
            } else {
              showToast(`✅ 微信随身端巡检正常：已拉起且守护运行中 (PID: ${data.pid})`);
            }
          } else {
            showToast(`⚠️ 微信随身端当前未运行: ${data.message || '请点击重新扫码或重启'}`, true);
          }
        }
        return data;
      } catch (e) {
        if (showFeedback) {
          showToast(`检测异常: ${e.message}`, true);
        }
        return null;
      } finally {
        if (btn && showFeedback) {
          btn.disabled = false;
          btn.textContent = origText;
        }
      }
    }

    const btnCheckBot = document.getElementById('btnCheckWechatBotStatus');
    if (btnCheckBot) {
      btnCheckBot.addEventListener('click', () => {
        checkWechatBotStatus(true, true);
      });
    }

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

    const btnToggleWeb = document.getElementById('btnToggleWebServer');
    const btnOpenWeb = document.getElementById('btnOpenWebBrowser');

    if (btnToggleWeb) {
      btnToggleWeb.addEventListener('click', async () => {
        btnToggleWeb.disabled = true;
        const isRunning = btnToggleWeb.dataset.running === 'true';
        btnToggleWeb.textContent = isRunning ? '⏹️ 正在停止...' : '🚀 正在启动...';
        try {
          const res = await apiFetch('/api/services/webserver/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start: !isRunning })
          });
          const json = await res.json();
          if (json.success) {
            showToast(json.running ? `✅ Web端网页服务已在端口 ${json.port || 18765} 启动` : '⏹️ Web端网页服务已停止');
            await loadServiceStatus();
          } else {
            showToast(`操作失败: ${json.error || json.message}`, true);
          }
        } catch (e) {
          showToast(`请求异常: ${e.message}`, true);
        } finally {
          btnToggleWeb.disabled = false;
        }
      });
    }

    if (btnOpenWeb) {
      btnOpenWeb.addEventListener('click', async () => {
        btnOpenWeb.disabled = true;
        try {
          const res = await apiFetch('/api/services/webserver/open', { method: 'POST' });
          const json = await res.json();
          if (json.success) {
            showToast(json.message || '已在浏览器打开 Web 网页');
          } else {
            window.open(json.url || 'http://localhost:18765', '_blank');
          }
        } catch (e) {
          window.open('http://localhost:18765', '_blank');
        } finally {
          btnOpenWeb.disabled = false;
        }
      });
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
        enableWebServer: document.getElementById('cfgEnableWebServer')?.checked === true,
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
        enableDailyReports: document.getElementById('cfgEnableDailyReports')?.checked !== false,
        morningReportTime: document.getElementById('cfgMorningReportTime')?.value || '09:00',
        eveningReportTime: document.getElementById('cfgEveningReportTime')?.value || '19:00',
        enableRbac: document.getElementById('cfgEnableRbac')?.checked !== false,
        adminUsers: (document.getElementById('cfgAdminUsers')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
        allowedUsers: (document.getElementById('cfgAllowedUsers')?.value || '*').split(',').map(s => s.trim()).filter(Boolean),
        enableRiskyGuard: document.getElementById('cfgEnableRiskyGuard')?.checked !== false,
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
      feishu: true,
      'daily-report': true,
      'rbac-security': true,
      workspaces: false,
      'mobile-devops': false,
      'message-debugger': true
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

      // 自动化监控中心卡片与 Web 服务状态同步
      const elApiPort = document.getElementById('svcApiPort');
      const elApiStatus = document.getElementById('svcApiStatus');
      const elApiDot = document.getElementById('svcApiDot');
      const elWechatPid = document.getElementById('svcWechatPid');
      const elWechatRestarts = document.getElementById('svcWechatRestarts');
      const elWechatStatus = document.getElementById('svcWechatStatus');
      const elWechatDot = document.getElementById('svcWechatDot');
      const globalBadge = document.getElementById('svcGlobalStatusBadge');
      const svcWebRunningTag = document.getElementById('svcWebRunningTag');
      const btnToggleWeb = document.getElementById('btnToggleWebServer');
      const btnOpenWeb = document.getElementById('btnOpenWebBrowser');

      const isWebRunning = !!(data.server && (data.server.status === 'listening' || data.server.running === true));
      const webPort = (data.server && data.server.port) || 18765;

      if (elApiPort) elApiPort.textContent = webPort;
      if (elApiStatus) {
        elApiStatus.textContent = isWebRunning ? `正常监听中 (http://localhost:${webPort})` : '未启动 (默认关闭)';
      }
      if (elApiDot) {
        elApiDot.className = isWebRunning ? 'badge-dot dot-green' : 'badge-dot dot-gray';
      }
      if (svcWebRunningTag) {
        svcWebRunningTag.textContent = isWebRunning ? `运行中 (端口 ${webPort})` : '已停止';
        svcWebRunningTag.className = isWebRunning ? 'status-pill status-online' : 'status-pill status-offline';
      }
      if (btnToggleWeb) {
        btnToggleWeb.dataset.running = isWebRunning ? 'true' : 'false';
        btnToggleWeb.textContent = isWebRunning ? '⏹️ 停止 Web 端网页服务' : '🚀 启动 Web 端网页服务';
        btnToggleWeb.className = isWebRunning ? 'btn btn-secondary btn-xs' : 'btn btn-primary btn-xs';
      }
      if (btnOpenWeb) {
        btnOpenWeb.style.display = isWebRunning ? 'inline-block' : 'none';
      }

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

      // 巡检守护状态指示器
      const elWatchdogDot = document.getElementById('svcWatchdogDot');
      const elWatchdogText = document.getElementById('svcWatchdogStatusText');
      const elWatchdogTime = document.getElementById('svcWatchdogLastCheckTime');
      const watchdog = data.watchdog || {};

      if (elWatchdogTime) {
        elWatchdogTime.textContent = watchdog.lastCheckTime || new Date().toLocaleTimeString();
      }
      if (elWatchdogDot && elWatchdogText) {
        if (bot.running) {
          elWatchdogDot.className = 'badge-dot dot-green';
          elWatchdogText.textContent = `每 10 秒巡检守护中 (PID: ${bot.pid || '-'} 正常在线)`;
          elWatchdogText.style.color = 'var(--cyan-glow, #38bdf8)';
        } else {
          elWatchdogDot.className = 'badge-dot dot-yellow';
          elWatchdogText.textContent = '检测到离线断开 (自愈守护正在尝试拉起)';
          elWatchdogText.style.color = 'var(--yellow-glow, #fbbf24)';
        }
      }

      // 同步扫码卡片中的进程状态
      const elWechatProcState = document.getElementById('wechatProcessStateDisplay');
      if (elWechatProcState) {
        if (bot.running) {
          elWechatProcState.innerHTML = `<span style="color:var(--green-glow);">🟢 运行中 (PID: ${bot.pid || '-'})</span>`;
        } else {
          elWechatProcState.innerHTML = `<span style="color:var(--red-glow, #ef4444);">🔴 未运行 (自愈拉起中)</span>`;
        }
      }
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // 本地多工程工作区管理 (Workspaces)
  // ---------------------------------------------------------------------------
  async function loadWorkspacesList() {
    const container = document.getElementById('workspacesListContainer');
    if (!container) return;
    const btnRefWs = document.getElementById('btnRefreshWorkspacesList');
    if (btnRefWs) {
      btnRefWs.disabled = true;
      btnRefWs.style.opacity = '0.6';
    }

    try {
      const res = await apiFetch('/api/workspaces');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new Error(`返回数据解析失败: ${text.slice(0, 80)}`);
      }
      const list = Array.isArray(json.workspaces) ? json.workspaces : [];
      if (list.length === 0) {
        container.innerHTML = '<div class="empty-placeholder" style="padding:12px;text-align:center;color:var(--text-muted);font-size:11px;">📂 暂无已登记的本地工程工作区</div>';
        return;
      }
      container.innerHTML = list.map((w, idx) => `
        <div class="workspace-card-item ${w.isCurrent ? 'active' : ''}">
          <div class="ws-info">
            <div class="ws-title-row">
              <span class="ws-name">${w.isCurrent ? '🟢 ' : ''}[${idx + 1}] ${escapeHtml(w.name)}</span>
              <span class="ws-type-tag">${escapeHtml(w.type || '工程')}</span>
              ${w.isCurrent ? '<span class="ws-current-tag">当前工程</span>' : ''}
            </div>
            <div class="ws-path" title="${escapeHtml(w.path)}">
              📁 ${escapeHtml(w.path)}
            </div>
          </div>
          <button type="button" class="btn ${w.isCurrent ? 'btn-ghost' : 'btn-primary'} btn-xs btn-switch-ws" data-proj="${escapeHtml(w.name)}" style="${w.isCurrent ? 'opacity:0.6;cursor:default;' : ''}">
            ${w.isCurrent ? '已激活' : '切换到此'}
          </button>
        </div>
      `).join('');

      container.querySelectorAll('.btn-switch-ws').forEach(btn => {
        btn.addEventListener('click', async () => {
          const proj = btn.getAttribute('data-proj');
          if (btn.classList.contains('btn-ghost')) return;
          btn.disabled = true;
          btn.textContent = '切换中...';
          try {
            const sRes = await apiFetch('/api/workspaces/switch', { method: 'POST', body: JSON.stringify({ project: proj }) });
            if (!sRes.ok) throw new Error(`HTTP ${sRes.status}`);
            const sJson = await sRes.json();
            if (sJson.success) {
              showToast(`✅ 已切换工作区至: ${proj}`);
              loadWorkspacesList();
              if (typeof refreshAll === 'function') refreshAll();
            } else {
              showToast(`切换失败: ${sJson.error || ''}`, true);
              btn.disabled = false;
              btn.textContent = '切换到此';
            }
          } catch (e) {
            showToast('切换失败: ' + e.message, true);
            btn.disabled = false;
            btn.textContent = '切换到此';
          }
        });
      });
    } catch (e) {
      container.innerHTML = `
        <div class="empty-placeholder" style="padding:12px;text-align:center;color:#f87171;font-size:11px;">
          ⚠️ 加载工作区失败: ${e.message}<br/>
          <button type="button" class="btn btn-secondary btn-xs" style="margin-top:6px;" onclick="window.loadWorkspacesList ? window.loadWorkspacesList() : null">🔄 重试</button>
        </div>
      `;
    } finally {
      if (btnRefWs) {
        btnRefWs.disabled = false;
        btnRefWs.style.opacity = '1';
      }
    }
  }
  window.loadWorkspacesList = loadWorkspacesList;

  async function loadSettings() {
    // 1. 优先加载服务状态和微信绑定状态（保证UI绝不卡在默认占位符）
    try {
      await loadServiceStatus();
    } catch (e) {
      console.warn('loadServiceStatus in loadSettings failed:', e);
    }
    try {
      await loadWechatBindingQrStatus(false);
    } catch (e) {
      console.warn('loadWechatBindingQrStatus in loadSettings failed:', e);
    }

    // 2. 加载工作区列表
    try {
      await loadWorkspacesList();
    } catch (e) {
      console.warn('loadWorkspacesList failed:', e);
    }

    // 3. 加载表单配置项
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
      if (document.getElementById('cfgEnableWebServer')) {
        document.getElementById('cfgEnableWebServer').checked = cfg.enableWebServer === true;
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

      if (document.getElementById('cfgEnableDailyReports')) {
        document.getElementById('cfgEnableDailyReports').checked = cfg.enableDailyReports !== false;
      }
      if (document.getElementById('cfgMorningReportTime')) {
        document.getElementById('cfgMorningReportTime').value = cfg.morningReportTime || '09:00';
      }
      if (document.getElementById('cfgEveningReportTime')) {
        document.getElementById('cfgEveningReportTime').value = cfg.eveningReportTime || '19:00';
      }
      if (document.getElementById('cfgEnableRbac')) {
        document.getElementById('cfgEnableRbac').checked = cfg.enableRbac !== false;
      }
      if (document.getElementById('cfgAdminUsers')) {
        document.getElementById('cfgAdminUsers').value = Array.isArray(cfg.adminUsers) ? cfg.adminUsers.join(', ') : (cfg.adminUsers || '');
      }
      if (document.getElementById('cfgAllowedUsers')) {
        document.getElementById('cfgAllowedUsers').value = Array.isArray(cfg.allowedUsers) ? cfg.allowedUsers.join(', ') : (cfg.allowedUsers || '*');
      }
      if (document.getElementById('cfgEnableRiskyGuard')) {
        document.getElementById('cfgEnableRiskyGuard').checked = cfg.enableRiskyGuard !== false;
      }

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
    } catch (e) {
      console.error('Load settings error:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // 微信随身端扫码绑定与账号中心管理 & 设置页自动轮询
  // ---------------------------------------------------------------------------
  let settingsPollTimer = null;
  let wechatQrPollTimer = null;
  let isWechatRebinding = false;

  function stopSettingsPolling() {
    if (settingsPollTimer) {
      clearInterval(settingsPollTimer);
      settingsPollTimer = null;
    }
    if (wechatQrPollTimer) {
      clearInterval(wechatQrPollTimer);
      wechatQrPollTimer = null;
    }
  }

  function startSettingsPolling() {
    stopSettingsPolling();
    settingsPollTimer = setInterval(async () => {
      if (activeTab !== 'tab-settings') {
        stopSettingsPolling();
        return;
      }
      try {
        await loadServiceStatus();
      } catch (e) {}
      if (!isWechatRebinding) {
        try {
          await loadWechatBindingQrStatus(false);
        } catch (e) {}
      }
    }, 3000);
  }

  function stopWechatQrPolling() {
    stopSettingsPolling();
  }

  function startWechatQrPolling() {
    startSettingsPolling();
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
        if (activeTab === 'tab-settings' && !settingsPollTimer) {
          startSettingsPolling();
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

    // -------------------------------------------------------------------------
    // 十项全能移动研发敏捷中枢 UI 交互
    // -------------------------------------------------------------------------
    function showQuickNotice(text) {
      const notice = document.getElementById('quickOpsResultNotice');
      if (notice) {
        notice.style.display = 'block';
        notice.textContent = text;
      }
      showToast(text.slice(0, 40));
    }

    const btnSnap = document.getElementById('btnQuickUiSnapshot');
    if (btnSnap) {
      btnSnap.addEventListener('click', async () => {
        showToast('正在捕获全屏高保真快照并直推微信...');
        try {
          const res = await apiFetch('/api/ui/snapshot', { method: 'POST', body: JSON.stringify({ user: 'Web用户' }) });
          const json = await res.json();
          showQuickNotice(json.result || '已完成快照发送');
        } catch (e) { showToast('快照异常: ' + e.message, true); }
      });
    }

    const btnPkg = document.getElementById('btnQuickBuildPackage');
    if (btnPkg) {
      btnPkg.addEventListener('click', async () => {
        showToast('正在打包工程制品 (.zip) 并推微信...');
        try {
          const res = await apiFetch('/api/project/build-package', { method: 'POST', body: JSON.stringify({ user: 'Web用户' }) });
          const json = await res.json();
          showQuickNotice(json.result || '打包完成');
        } catch (e) { showToast('打包异常: ' + e.message, true); }
      });
    }

    const btnDiff = document.getElementById('btnQuickGitDiff');
    if (btnDiff) {
      btnDiff.addEventListener('click', async () => {
        try {
          const res = await apiFetch('/api/service/ops', { method: 'POST', body: JSON.stringify({ command: '/diff' }) });
          const json = await res.json();
          showQuickNotice(json.result || '无改动');
        } catch (e) { showToast('查看Diff异常: ' + e.message, true); }
      });
    }

    const btnSvc = document.getElementById('btnQuickServiceStatus');
    if (btnSvc) {
      btnSvc.addEventListener('click', async () => {
        try {
          const res = await apiFetch('/api/service/ops', { method: 'POST', body: JSON.stringify({ command: '/service status' }) });
          const json = await res.json();
          showQuickNotice(json.result || '服务扫描完毕');
        } catch (e) { showToast('服务状态检测异常: ' + e.message, true); }
      });
    }

    const btnMorn = document.getElementById('btnQuickMorningReport');
    if (btnMorn) {
      btnMorn.addEventListener('click', async () => {
        try {
          const res = await apiFetch('/api/daily-report');
          const json = await res.json();
          showQuickNotice(json.morning || '晨报生成完毕');
        } catch (e) { showToast('晨报异常: ' + e.message, true); }
      });
    }

    const btnEve = document.getElementById('btnQuickEveningReport');
    if (btnEve) {
      btnEve.addEventListener('click', async () => {
        try {
          const res = await apiFetch('/api/daily-report');
          const json = await res.json();
          showQuickNotice(json.evening || '夕报生成完毕');
        } catch (e) { showToast('夕报异常: ' + e.message, true); }
      });
    }

    const btnRefWs = document.getElementById('btnRefreshWorkspacesList');
    if (btnRefWs) {
      btnRefWs.addEventListener('click', () => loadWorkspacesList());
    }
  }

  // ---------------------------------------------------------------------------
  // 🌐 流量监控面板交互逻辑 (1:1 API Gateway 视觉还原)
  // ---------------------------------------------------------------------------

  function formatCompactNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    const num = Number(n);
    if (num >= 1000000000) return (num / 1000000000).toFixed(2).replace(/\.00$/, '') + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(num);
  }

  function formatTrafficLatency(ms) {
    if (!ms || isNaN(ms)) return '0.00s';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function formatTimeShort(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const pad = (n) => String(n).padStart(2, '0');
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${mm}-${dd} ${hh}:${min}:${ss}`;
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 5) return '刚刚';
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return `${Math.floor(diff / 86400)}天前`;
  }

  // ---------------------------------------------------------------------------
  // ⚡ 流量与 Token 统计大屏多视图联动 (Subviews Switch)
  // ---------------------------------------------------------------------------

  function switchTelemetrySubview(subview) {
    if (subview === 'insight') subview = 'stats';
    activeTelemetrySubview = subview;
    localStorage.setItem('ai-assistant-telemetry-subview', subview);

    const btnStats = document.getElementById('btnSubViewTokenStats');
    const btnTraffic = document.getElementById('btnSubViewTraffic');
    const btnTimeline = document.getElementById('btnSubViewTimeline');

    const panelStats = document.getElementById('subpanelTokenStats');
    const panelTraffic = document.getElementById('subpanelTraffic');
    const panelTimeline = document.getElementById('subpanelTimeline');
    const timeRangeGroup = document.getElementById('trafficTimeRangeGroup');
    const toolsRight = document.getElementById('timelineToolsRight');

    if (btnStats) btnStats.classList.toggle('active', subview === 'stats');
    if (btnTraffic) btnTraffic.classList.toggle('active', subview === 'traffic');
    if (btnTimeline) btnTimeline.classList.toggle('active', subview === 'timeline');

    if (panelStats) {
      panelStats.classList.toggle('active', subview === 'stats');
      panelStats.classList.toggle('hidden', subview !== 'stats');
    }
    if (panelTraffic) {
      panelTraffic.classList.toggle('active', subview === 'traffic');
      panelTraffic.classList.toggle('hidden', subview !== 'traffic');
    }
    if (panelTimeline) {
      panelTimeline.classList.toggle('active', subview === 'timeline');
      panelTimeline.classList.toggle('hidden', subview !== 'timeline');
    }
    if (toolsRight) toolsRight.classList.toggle('hidden', subview !== 'timeline');

    // 动态联动：在「统计大屏」和「请求日志」下均展示时间切片筛选；在「执行步骤」下自动隐藏以保持极简清爽
    if (timeRangeGroup) {
      timeRangeGroup.style.display = (subview === 'stats' || subview === 'traffic') ? 'flex' : 'none';
    }

    if (subview === 'stats' || subview === 'traffic') {
      loadTrafficLogs();
    } else {
      loadTimeline();
    }
  }

  function bindTelemetrySubviewEvents() {
    const btnStats = document.getElementById('btnSubViewTokenStats');
    const btnTraffic = document.getElementById('btnSubViewTraffic');
    const btnTimeline = document.getElementById('btnSubViewTimeline');

    if (btnStats) {
      btnStats.addEventListener('click', () => switchTelemetrySubview('stats'));
    }
    if (btnTraffic) {
      btnTraffic.addEventListener('click', () => switchTelemetrySubview('traffic'));
    }
    if (btnTimeline) {
      btnTimeline.addEventListener('click', () => switchTelemetrySubview('timeline'));
    }

    // 统计范畴切换 (当前工程 vs 全部 350 会话 / 43.5 亿 Tokens)
    const scopeSwitch = document.getElementById('telemetryScopeSwitch');
    if (scopeSwitch) {
      scopeSwitch.addEventListener('click', (e) => {
        const btn = e.target.closest('.scope-switch-btn');
        if (!btn) return;
        scopeSwitch.querySelectorAll('.scope-switch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTrafficScope = btn.getAttribute('data-scope') || 'current';
        trafficCurrentPage = 1;
        
        if (activeTrafficScope === 'global') {
          if (typeof showToast === 'function') {
            showToast('已切换至「全部会话历史统计」');
          }
        } else {
          if (typeof showToast === 'function') {
            showToast('已切换至「当前工程活跃会话」');
          }
        }
        loadTrafficLogs(false, activeTrafficTimeRange, activeTrafficScope, 1);
      });
    }

    // 绑定多维度排行榜 Tab 切换 (账号 / 模型)
    const rankingTabGroup = document.getElementById('rankingTabGroup');
    if (rankingTabGroup) {
      rankingTabGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.rank-tab-btn');
        if (!btn) return;
        const rank = btn.getAttribute('data-rank');
        if (rank) {
          renderDashboardRankings(rank);
        }
      });
    }

    // 时间跨度筛选切换
    const timeRangeGroup = document.getElementById('trafficTimeRangeGroup');
    if (timeRangeGroup) {
      timeRangeGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.range-btn');
        if (!btn) return;
        timeRangeGroup.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTrafficTimeRange = btn.getAttribute('data-range') || 'all';
        const periodTag = document.getElementById('dispatchPeriodTag');
        if (periodTag) {
          const map = {
            'minute': '周期: 分钟 (近1h)',
            'hourly': '周期: 小时 (近24h)',
            'daily': '周期: 日 (近7天)',
            'weekly': '周期: 周 (近30天)',
            'all': '周期: 全部历史',
            '1h': '周期: 分钟 (近1h)',
            'today': '周期: 小时 (近24h)',
            '7d': '周期: 日 (近7天)',
            '30d': '周期: 周 (近30天)'
          };
          periodTag.textContent = map[activeTrafficTimeRange] || '周期: 周 (近30天)';
        }
        const tipMap = {
          'minute': '已切换至「过去 1 小时」分钟级走势',
          'hourly': '已切换至「过去 24 小时」律动数据',
          'daily': '已切换至「过去 7 天」日级走势',
          'weekly': '已切换至「过去 30 天」周级全景',
          'all': '已切换至「全部历史」全量数据',
          '1h': '已切换至「过去 1 小时」分钟级走势',
          'today': '已切换至「过去 24 小时」律动数据',
          '7d': '已切换至「过去 7 天」日级走势',
          '30d': '已切换至「过去 30 天」周级全景'
        };
        if (typeof showToast === 'function') {
          showToast(tipMap[activeTrafficTimeRange] || '已更新统计周期');
        }
        trafficCurrentPage = 1;
        loadTrafficLogs(false, activeTrafficTimeRange, activeTrafficScope, 1);
      });
    }

    // 绑定流水子过滤 Chips
    const chipsContainer = document.getElementById('timelineFilterChips');
    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.filter-chip');
        if (!chip) return;
        chipsContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeTimelineFilter = chip.getAttribute('data-filter') || 'all';
        loadTimeline();
      });
    }

    switchTelemetrySubview(activeTelemetrySubview);
  }

  // 渲染 Antigravity-Manager: 24小时活跃分布柱状图 (HourlyTrendBarCard)
  function renderHourlyTrendBar(hourlyData = [], totalCost = 0) {
    const container = document.getElementById('hourlyBarsContainer');
    const subTitle = document.getElementById('hourlyTrendSubtitle');
    if (!container) return;

    let peak = 1;
    let sum24h = 0;
    hourlyData.forEach(h => {
      const tot = Number(h.total_tokens || 0);
      sum24h += tot;
      if (tot > peak) peak = tot;
    });

    const defaultSubText = `<span>24h · ${formatCompactNum(sum24h)} Tokens ${totalCost > 0 ? `<b style="color:#10b981;margin-left:4px;">(~$${totalCost.toFixed(2)})</b>` : ''}</span>`;
    if (subTitle) subTitle.innerHTML = defaultSubText;

    container.innerHTML = hourlyData.map((b, idx) => {
      const tot = Number(b.total_tokens || 0);
      const isZero = tot === 0;
      const pct = isZero ? 0 : Math.max(8, Math.min(100, Math.round((tot / peak) * 100)));
      const isClaude = b.output_tokens > b.input_tokens * 0.1;
      const barClass = isClaude ? 'has-claude' : '';

      return `
        <div class="hourly-bar-col ${isZero ? 'zero-bar' : ''}" data-idx="${idx}" title="${b.hour}: ${formatCompactNum(tot)} Tokens (${b.request_count || 0}次调用)">
          <div class="hourly-bar-inner ${barClass}" style="height: ${pct}%;"></div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.hourly-bar-col').forEach(col => {
      col.addEventListener('mouseenter', () => {
        const idx = Number(col.getAttribute('data-idx'));
        const point = hourlyData[idx];
        if (point && subTitle) {
          subTitle.innerHTML = `<span style="color:#fbbf24;">${point.hour} · ${formatCompactNum(point.total_tokens)} Tokens (${point.request_count || 0}次)</span>`;
        }
      });
      col.addEventListener('mouseleave', () => {
        if (subTitle) subTitle.innerHTML = defaultSubText;
      });
    });
  }

  // 渲染 Antigravity-Manager: 核心模型消耗排行 (TopModelsShareCard)
  function getModelBrandTint(mName) {
    const l = String(mName || '').toLowerCase();
    if (l.includes('claude')) return '#f97316';
    if (l.includes('gemini')) return '#38bdf8';
    if (l.includes('gpt') || l.includes('openai')) return '#10b981';
    if (l.includes('deepseek')) return '#0ea5e9';
    return '#a855f7';
  }

  function renderTopModelsShare(models = []) {
    const list = document.getElementById('topModelsList');
    const sub = document.getElementById('modelsCountSubtitle');
    if (!list) return;

    if (sub) sub.textContent = `${models.length} 个模型活跃`;

    if (!models || models.length === 0) {
      list.innerHTML = '<div class="empty-hint-text">暂无模型调用数据</div>';
      return;
    }

    const top5 = models.slice(0, 5);
    const peakTokens = top5[0]?.total_tokens || 1;
    const totalTokensSum = models.reduce((acc, cur) => acc + (cur.total_tokens || 0), 0);

    list.innerHTML = top5.map(item => {
      const tint = getModelBrandTint(item.model);
      const pct = totalTokensSum > 0 ? Math.round((item.total_tokens / totalTokensSum) * 100) : 0;
      const widthPct = Math.max(6, Math.min(100, Math.round((item.total_tokens / peakTokens) * 100)));
      const costStr = item.cost > 0 ? `$${item.cost.toFixed(2)}` : '$0.00';

      return `
        <div class="top-model-item" title="${escapeHtml(item.model)}: ${formatCompactNum(item.total_tokens)} Tokens, 预估费用 ${costStr}">
          <div class="top-model-name-box">
            <span class="top-model-dot" style="background-color: ${tint};"></span>
            <span class="top-model-name">${escapeHtml(item.model)}</span>
          </div>
          <div class="top-model-capsule">
            <div class="top-model-fill" style="width: ${widthPct}%; background-color: ${tint};"></div>
          </div>
          <div class="top-model-right-stats">
            <span class="top-model-tokens-val">${formatCompactNum(item.total_tokens)} <small style="color:#64748b;font-weight:normal;">(${pct}%)</small></span>
            <span class="top-model-cost-sub">${costStr}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // 渲染 Antigravity-Manager: 91天活动热力图 (ActivityHeatmapCard)
  function renderActivityHeatmap(dailyData = [], totalCost = 0) {
    const grid = document.getElementById('heatmapGridContainer');
    const hoverHint = document.getElementById('heatmapHoverDateHint');
    const elTotalTokens = document.getElementById('heatmapTotalRangeTokens');
    const elCostText = document.getElementById('heatmapRangeCostText');
    const elActiveDays = document.getElementById('heatmapActiveDays');
    const elStreakDays = document.getElementById('heatmapStreakDays');
    const elBusiestDay = document.getElementById('heatmapBusiestDay');
    if (!grid) return;

    const cols = [];
    for (let i = 0; i < dailyData.length; i += 7) {
      cols.push(dailyData.slice(i, i + 7));
    }

    let totalRangeTokens = 0;
    let activeDays = 0;
    let maxDay = null;
    dailyData.forEach(d => {
      const t = Number(d.total_tokens || 0);
      totalRangeTokens += t;
      if (t > 0) {
        activeDays++;
        if (!maxDay || t > maxDay.total_tokens) maxDay = d;
      }
    });

    let streak = 0;
    for (let i = dailyData.length - 1; i >= 0; i--) {
      if ((dailyData[i].total_tokens || 0) > 0) streak++;
      else if (streak > 0 || i !== dailyData.length - 1) break;
    }

    if (elTotalTokens) elTotalTokens.textContent = formatCompactNum(totalRangeTokens);
    if (elCostText) elCostText.textContent = totalCost > 0 ? `~$${totalCost.toFixed(2)}` : '~$0.00';
    if (elActiveDays) elActiveDays.textContent = `${activeDays} 天`;
    if (elStreakDays) elStreakDays.textContent = `${streak} 天`;
    if (elBusiestDay) {
      elBusiestDay.textContent = maxDay ? `${maxDay.date.slice(5)} · ${formatCompactNum(maxDay.total_tokens)}` : '-';
    }

    const posVals = dailyData.map(d => Number(d.total_tokens || 0)).filter(v => v > 0).sort((a, b) => a - b);
    const q1 = posVals[Math.floor(posVals.length * 0.25)] || 1000;
    const q2 = posVals[Math.floor(posVals.length * 0.50)] || 10000;
    const q3 = posVals[Math.floor(posVals.length * 0.75)] || 50000;

    const todayStr = new Date().toISOString().slice(0, 10);

    grid.innerHTML = cols.map(col => {
      return `
        <div class="heatmap-grid-col">
          ${col.map(d => {
            const tok = Number(d.total_tokens || 0);
            let lvl = 'level-0';
            if (tok > 0) {
              if (tok < q1) lvl = 'level-1';
              else if (tok < q2) lvl = 'level-2';
              else if (tok < q3) lvl = 'level-3';
              else lvl = 'level-4';
            }
            const isToday = d.date === todayStr ? 'is-today' : '';
            return `
              <div class="heatmap-cell ${lvl} ${isToday}" data-date="${d.date}" data-tokens="${tok}" data-reqs="${d.request_count || 0}" title="${d.date}: ${formatCompactNum(tok)} Tokens (${d.request_count || 0}次)"></div>
            `;
          }).join('')}
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.heatmap-cell').forEach(cell => {
      cell.addEventListener('mouseenter', () => {
        const d = cell.getAttribute('data-date');
        const tok = Number(cell.getAttribute('data-tokens') || 0);
        const reqs = cell.getAttribute('data-reqs') || '0';
        if (hoverHint) {
          hoverHint.innerHTML = `<span style="color:#38bdf8;">${d} · ${formatCompactNum(tok)} Tokens (${reqs} 次调用)</span>`;
        }
      });
      cell.addEventListener('mouseleave', () => {
        if (hoverHint) hoverHint.textContent = '悬浮格子查看当日详情';
      });
    });
  }

  function bindTrafficEvents() {
    const searchInput = document.getElementById('trafficSearchInput');
    const btnClearSearch = document.getElementById('btnTrafficClearSearch');
    const btnRefresh = document.getElementById('btnTrafficRefresh');
    const btnAutoToggle = document.getElementById('btnTrafficAutoToggle');
    const btnExport = document.getElementById('btnTrafficExport');
    const btnClear = document.getElementById('btnTrafficClear');
    const btnCloseModal = document.getElementById('btnCloseTrafficModal');
    const btnCloseModalFoot = document.getElementById('btnCloseTrafficModalFoot');
    const btnCopyJson = document.getElementById('btnCopyTrafficJson');

    let searchDebounceTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        trafficSearchQuery = e.target.value.trim().toLowerCase();
        if (btnClearSearch) {
          btnClearSearch.classList.toggle('hidden', !trafficSearchQuery);
        }
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          trafficCurrentPage = 1;
          loadTrafficLogs();
        }, 300);
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        trafficSearchQuery = '';
        btnClearSearch.classList.add('hidden');
        trafficCurrentPage = 1;
        loadTrafficLogs();
      });
    }

    // 状态过滤 Chip (支持再次点击反选回全部)
    const statusContainer = document.getElementById('trafficStatusFilters');
    if (statusContainer) {
      statusContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.filter-chip');
        if (!chip) return;
        const targetStatus = chip.getAttribute('data-status') || '';
        const isCurrentActive = chip.classList.contains('active');

        statusContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        if (isCurrentActive && targetStatus !== '') {
          // 再次点击已激活的标签，自动取消反选回全部
          const allChip = statusContainer.querySelector('[data-status=""]');
          if (allChip) allChip.classList.add('active');
          activeTrafficStatus = '';
        } else {
          chip.classList.add('active');
          activeTrafficStatus = targetStatus;
        }
        trafficCurrentPage = 1;
        loadTrafficLogs();
      });
    }

    // 协议过滤 Chip (支持再次点击反选回全部)
    const protoContainer = document.getElementById('trafficProtoFilters');
    if (protoContainer) {
      protoContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.filter-chip');
        if (!chip) return;
        const targetProto = chip.getAttribute('data-proto') || '';
        const isCurrentActive = chip.classList.contains('active');

        protoContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        if (isCurrentActive && targetProto !== '') {
          // 再次点击已激活的标签，自动取消反选回全部
          const allChip = protoContainer.querySelector('[data-proto=""]');
          if (allChip) allChip.classList.add('active');
          activeTrafficProto = '';
        } else {
          chip.classList.add('active');
          activeTrafficProto = targetProto;
        }
        trafficCurrentPage = 1;
        loadTrafficLogs();
      });
    }

    // cc-switch 风格分页控制栏绑定
    const btnFirst = document.getElementById('btnTrafficFirstPage');
    const btnPrev = document.getElementById('btnTrafficPrevPage');
    const btnNext = document.getElementById('btnTrafficNextPage');
    const btnLast = document.getElementById('btnTrafficLastPage');
    const selectSize = document.getElementById('trafficPageSizeSelect');

    if (btnFirst) {
      btnFirst.addEventListener('click', () => {
        if (trafficCurrentPage > 1) {
          trafficCurrentPage = 1;
          loadTrafficLogs();
        }
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (trafficCurrentPage > 1) {
          trafficCurrentPage--;
          loadTrafficLogs();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (trafficCurrentPage < trafficTotalPages) {
          trafficCurrentPage++;
          loadTrafficLogs();
        }
      });
    }

    if (btnLast) {
      btnLast.addEventListener('click', () => {
        if (trafficCurrentPage < trafficTotalPages) {
          trafficCurrentPage = trafficTotalPages;
          loadTrafficLogs();
        }
      });
    }

    if (selectSize) {
      selectSize.addEventListener('change', (e) => {
        trafficPageSize = Number(e.target.value) || 50;
        trafficCurrentPage = 1;
        loadTrafficLogs();
      });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        btnRefresh.classList.add('spinning');
        loadTrafficLogs(false, activeTrafficTimeRange).finally(() => {
          setTimeout(() => btnRefresh.classList.remove('spinning'), 600);
        });
        showToast('已手动刷新最新流量数据');
      });
    }

    if (btnAutoToggle) {
      btnAutoToggle.addEventListener('click', () => {
        trafficAutoRefresh = !trafficAutoRefresh;
        btnAutoToggle.classList.toggle('active-toggle', trafficAutoRefresh);
        const textEl = document.getElementById('btnTrafficAutoText');
        if (textEl) textEl.textContent = trafficAutoRefresh ? '实时监听' : '已暂停';
        showToast(trafficAutoRefresh ? '已开启流量实时监听 (3.5秒轮询)' : '已暂停流量实时监听');
      });
    }

    if (btnExport) {
      btnExport.addEventListener('click', () => {
        if (!cachedTrafficLogs || cachedTrafficLogs.length === 0) {
          showToast('暂无流量日志可导出', true);
          return;
        }
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cachedTrafficLogs, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', dataStr);
        downloadAnchor.setAttribute('download', `antigravity_traffic_logs_${Date.now()}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('已导出流量日志 JSON 文件');
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        requestConfirm({
          title: '🧹 清空流量日志确认',
          message: '确定要清空当前的全部流量监控与推演拦截日志吗？此操作不可撤销。',
          confirmText: '立即清空',
          onConfirm: async () => {
            try {
              const res = await apiFetch('/api/traffic/clear', { method: 'POST' });
              const json = await res.json();
              if (json.success) {
                showToast('已成功清空流量监控日志');
                loadTrafficLogs();
              }
            } catch (err) {
              showToast(`清空失败: ${err.message}`, true);
            }
          }
        });
      });
    }

    const modal = document.getElementById('modalTrafficDetail');
    const closeModal = () => {
      if (modal) modal.classList.add('hidden');
    };
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
    if (btnCloseModalFoot) btnCloseModalFoot.addEventListener('click', closeModal);

    if (btnCopyJson) {
      btnCopyJson.addEventListener('click', async () => {
        if (!currentSelectedTrafficLog) return;
        try {
          const str = JSON.stringify(currentSelectedTrafficLog, null, 2);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(str);
          } else {
            const ta = document.createElement('textarea');
            ta.value = str;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
          }
          showToast('✅ 已复制完整原始 JSON 到剪贴板');
        } catch (e) {
          showToast('复制失败: ' + e.message, true);
        }
      });
    }
  }

  // 定价矩阵模态框交互逻辑
  function bindPricingModalEvents() {
    const modal = document.getElementById('modalPricingMatrix');
    if (!modal) return;

    const btnClose = document.getElementById('btnClosePricingModal');
    const btnConfirm = document.getElementById('btnConfirmPricingModal');
    const tbody = document.getElementById('pricingMatrixTableBody');

    const PRICING_ITEMS = [
      { name: 'Gemini 3.8 Flash (High/Low)', key: 'gemini-3.8-flash-tiered', in: 0.15, out: 0.60, cache: 0.03, tag: '极速/推荐' },
      { name: 'Gemini 3.1 Pro (High)', key: 'gemini-3.1-pro-high', in: 3.50, out: 10.50, cache: 0.80, tag: 'Google 旗舰' },
      { name: 'Gemini 2.5 Pro', key: 'gemini-2.5-pro', in: 3.50, out: 10.50, cache: 0.80, tag: '通用大模型' },
      { name: 'Gemini 2.5 Flash', key: 'gemini-2.5-flash', in: 0.15, out: 0.60, cache: 0.03, tag: '轻量高效' },
      { name: 'Claude 3.7 Sonnet', key: 'claude-3-7-sonnet', in: 3.00, out: 15.00, cache: 0.30, tag: '深度思考' },
      { name: 'Claude 3.5 Sonnet', key: 'claude-3-5-sonnet', in: 3.00, out: 15.00, cache: 0.30, tag: '高阶编码' },
      { name: 'GPT-4o', key: 'gpt-4o', in: 2.50, out: 10.00, cache: 1.25, tag: 'OpenAI 旗舰' },
      { name: 'Default (其他通用模型)', key: 'default', in: 2.00, out: 8.00, cache: 0.50, tag: '保底单价' }
    ];

    function renderPricingTable() {
      if (!tbody) return;
      tbody.innerHTML = PRICING_ITEMS.map((item, idx) => {
        const rate = (typeof TRAFFIC_PRICING !== 'undefined' && TRAFFIC_PRICING[item.key]) || { in: item.in, out: item.out, cache: item.cache };
        const discount = Math.round(((rate.in - rate.cache) / rate.in) * 100);
        const bgRow = idx % 2 === 0 ? 'background: rgba(255, 255, 255, 0.02);' : '';
        return `
          <tr style="${bgRow} border-bottom: 1px solid rgba(255, 255, 255, 0.04);">
            <td style="padding: 8px 12px; font-weight: 500; color: #f0f6fc;">
              <div style="font-weight: 600;">${escapeHtml(item.name)}</div>
              <span style="font-size: 9px; color: #58a6ff; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.2); padding: 1px 6px; border-radius: 4px; display: inline-block; margin-top: 2px;">${escapeHtml(item.tag)}</span>
            </td>
            <td style="padding: 8px 12px; font-family: 'JetBrains Mono', Consolas, monospace; color: #3fb950; font-size: 11px;">$${rate.in.toFixed(2)}</td>
            <td style="padding: 8px 12px; font-family: 'JetBrains Mono', Consolas, monospace; color: #a371f7; font-size: 11px;">$${rate.out.toFixed(2)}</td>
            <td style="padding: 8px 12px; font-family: 'JetBrains Mono', Consolas, monospace; color: #38bdf8; font-size: 11px;">$${rate.cache.toFixed(2)}</td>
            <td style="padding: 8px 12px; text-align: right;">
              <span style="font-size: 10px; font-weight: 600; color: #38bdf8; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 7px; border-radius: 999px;">省 ${discount}%</span>
            </td>
          </tr>
        `;
      }).join('');
    }

    const openModal = () => {
      renderPricingTable();
      modal.classList.remove('hidden');
    };

    const closeModal = () => {
      modal.classList.add('hidden');
    };

    // 绑定显式按钮和全局事件委托
    const btnOpen = document.getElementById('btnOpenPricingModal');
    if (btnOpen) {
      btnOpen.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      });
    }

    document.addEventListener('click', (e) => {
      const link = e.target.closest('.cost-pricing-link');
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      }
    });

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnConfirm) btnConfirm.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  function startTrafficPolling() {
    if (trafficPollTimer) clearInterval(trafficPollTimer);
    trafficPollTimer = setInterval(() => {
      if (trafficAutoRefresh && (activeTab === 'tab-traffic' || activeTab === 'tab-timeline')) {
        loadTrafficLogs(true, activeTrafficTimeRange, activeTrafficScope);
        if (activeTelemetrySubview === 'timeline') {
          loadTimeline();
        }
      }
    }, 3500);
  }

  // 定价标准字典 (用于多维度时间切片动态核算)
  const TRAFFIC_PRICING = {
    'gemini-3.1-pro-high': { in: 3.5, out: 10.5, cache: 0.8 },
    'gemini-3.8-flash-tiered': { in: 0.15, out: 0.6, cache: 0.03 },
    'gemini-2.5-pro': { in: 3.5, out: 10.5, cache: 0.8 },
    'gemini-2.5-flash': { in: 0.15, out: 0.6, cache: 0.03 },
    'claude-3-7-sonnet': { in: 3.0, out: 15.0, cache: 0.3 },
    'claude-3-5-sonnet': { in: 3.0, out: 15.0, cache: 0.3 },
    'gpt-4o': { in: 2.5, out: 10.0, cache: 1.25 },
    'default': { in: 2.0, out: 8.0, cache: 0.5 }
  };

  function getLogsByTimeRange(logs, range) {
    if (!range || range === 'all') return logs;
    const now = Date.now();

    return logs.filter((log) => {
      const logTime = log.time ? new Date(log.time).getTime() : (log.timestamp || 0);
      if (!logTime) return true;
      if (range === 'minute' || range === '1h') return now - logTime <= 3600 * 1000;
      if (range === 'hourly' || range === 'today') return now - logTime <= 24 * 3600 * 1000;
      if (range === 'daily' || range === '7d') return now - logTime <= 7 * 86400 * 1000;
      if (range === 'weekly' || range === '30d') return now - logTime <= 30 * 86400 * 1000;
      return true;
    });
  }

  function computeDynamicStats(filteredLogs) {
    let inTok = 0;
    let outTok = 0;
    let cacheTok = 0;
    let reasoningTok = 0;
    let totalCost = 0;
    const modelMap = new Map();
    const hourMap = new Map();

    for (const log of filteredLogs) {
      const inp = Number(log.tokens?.input || 0);
      const out = Number(log.tokens?.output || 0);
      const ca = Number(log.tokens?.cache || 0);
      const re = Number(log.tokens?.reasoning || Math.round(out * 0.25));
      const tot = inp + out + ca;

      inTok += inp;
      outTok += out;
      cacheTok += ca;
      reasoningTok += re;

      const mName = log.modelRequest || log.modelActual || 'gemini-3.1-pro-high';
      const rate = TRAFFIC_PRICING[mName] || TRAFFIC_PRICING.default;
      const cost = (inp * rate.in + out * rate.out + ca * rate.cache) / 1000000;
      totalCost += cost;

      if (!modelMap.has(mName)) {
        modelMap.set(mName, { model: mName, total_tokens: 0, cost: 0, request_count: 0 });
      }
      const mEntry = modelMap.get(mName);
      mEntry.total_tokens += tot;
      mEntry.cost += cost;
      mEntry.request_count += 1;

      const logDate = log.time ? new Date(log.time) : new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const hh = `${pad(logDate.getHours())}:00`;
      if (!hourMap.has(hh)) {
        hourMap.set(hh, { hour: hh, total_tokens: 0, input_tokens: 0, output_tokens: 0, request_count: 0 });
      }
      const hEntry = hourMap.get(hh);
      hEntry.total_tokens += tot;
      hEntry.input_tokens += inp;
      hEntry.output_tokens += out;
      hEntry.request_count += 1;
    }

    const now = new Date();
    const hourlyData = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const hh = `${pad(d.getHours())}:00`;
      hourlyData.push(hourMap.get(hh) || { hour: hh, total_tokens: 0, input_tokens: 0, output_tokens: 0, request_count: 0 });
    }

    const grandTotal = inTok + outTok + cacheTok;
    const hitRate = grandTotal > 0 ? ((cacheTok / grandTotal) * 100).toFixed(1) : '0.0';
    const savedUsd = (cacheTok * 2.7 / 1000000).toFixed(2);
    const modelShareItems = Array.from(modelMap.values()).sort((a, b) => b.total_tokens - a.total_tokens);

    return {
      tokens: { input: inTok, output: outTok, cache: cacheTok, reasoning: reasoningTok, total: grandTotal },
      totalEstimatedCostUsd: Number(totalCost.toFixed(2)),
      cacheMetrics: { hitRate: Number(hitRate), savedUsd: Number(savedUsd) },
      totalRequests: filteredLogs.length,
      hourlyData,
      modelShareItems
    };
  }

  let trafficAbortController = null;

  async function loadTrafficLogs(isBackground = false, range = activeTrafficTimeRange, scope = activeTrafficScope, page = trafficCurrentPage) {
    if (trafficAbortController) {
      try { trafficAbortController.abort(); } catch {}
    }
    trafficAbortController = new AbortController();
    const currentSignal = trafficAbortController.signal;

    const tableWrapper = document.querySelector('.traffic-table-wrapper');
    if (!isBackground && tableWrapper) {
      tableWrapper.style.transition = 'opacity 0.1s ease';
      tableWrapper.style.opacity = '0.6';
    }

    try {
      const convParam = (scope === 'current' && currentConversationId) ? `&conversationId=${encodeURIComponent(currentConversationId)}` : '';
      const filterParams = `&status=${encodeURIComponent(activeTrafficStatus || '')}&proto=${encodeURIComponent(activeTrafficProto || '')}&search=${encodeURIComponent(trafficSearchQuery || '')}&page=${page}&pageSize=${trafficPageSize}`;
      const res = await apiFetch(`/api/traffic/logs?range=${encodeURIComponent(range || 'all')}&scope=${encodeURIComponent(scope || 'current')}${convParam}${filterParams}`, { signal: currentSignal });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;

      if (data.account) cachedTrafficAccount = data.account;
      if (Array.isArray(data.allAccounts) && data.allAccounts.length > 0) cachedAllAccounts = data.allAccounts;

      if (data.pagination) {
        trafficCurrentPage = data.pagination.page;
        trafficTotalPages = data.pagination.totalPages;
        trafficTotalCount = data.pagination.total;
      } else {
        trafficTotalCount = Array.isArray(data.logs) ? data.logs.length : 0;
        trafficTotalPages = 1;
      }

      cachedTrafficLogs = Array.isArray(data.logs) ? data.logs : [];
      cachedTrafficStats = data.stats || {};

      renderFilteredTraffic();
      updateTrafficPaginationUI();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!isBackground) console.warn('Failed to load traffic logs:', err.message);
    } finally {
      if (tableWrapper) {
        tableWrapper.style.opacity = '1';
      }
    }
  }

  function updateTrafficPaginationUI() {
    const elTotal = document.getElementById('trafficTotalCount');
    const elCurrent = document.getElementById('trafficCurrentPage');
    const elTotalPages = document.getElementById('trafficTotalPages');
    const elIndicator = document.getElementById('trafficPageIndicator');
    const btnFirst = document.getElementById('btnTrafficFirstPage');
    const btnPrev = document.getElementById('btnTrafficPrevPage');
    const btnNext = document.getElementById('btnTrafficNextPage');
    const btnLast = document.getElementById('btnTrafficLastPage');
    const selectSize = document.getElementById('trafficPageSizeSelect');

    if (elTotal) elTotal.textContent = Number(trafficTotalCount).toLocaleString();
    if (elCurrent) elCurrent.textContent = String(trafficCurrentPage);
    if (elTotalPages) elTotalPages.textContent = String(trafficTotalPages);
    if (elIndicator) elIndicator.textContent = `${trafficCurrentPage} / ${trafficTotalPages}`;

    if (btnFirst) btnFirst.disabled = trafficCurrentPage <= 1;
    if (btnPrev) btnPrev.disabled = trafficCurrentPage <= 1;
    if (btnNext) btnNext.disabled = trafficCurrentPage >= trafficTotalPages;
    if (btnLast) btnLast.disabled = trafficCurrentPage >= trafficTotalPages;
    if (selectSize && String(selectSize.value) !== String(trafficPageSize)) {
      selectSize.value = String(trafficPageSize);
    }
  }

  function renderFilteredTraffic() {
    // 始终采用 SQLite 后端高精度预聚合统计 (无论当前工程还是全部历史，均基于全量数据精确统计)
    const stats = (cachedTrafficStats && cachedTrafficStats.tokens) ? cachedTrafficStats : computeDynamicStats(cachedTrafficLogs);

    // 3. 动态更新 4 大 Bento 指标卡
    const statTokensTotal = document.getElementById('trafficStatTokensTotal');
    const statTokensBreakdown = document.getElementById('trafficStatTokensBreakdown');
    const statCacheHitRate = document.getElementById('trafficStatCacheHitRate');
    const statCacheHint = document.getElementById('trafficStatCacheHint');
    const statReasoning = document.getElementById('trafficStatReasoning');
    const statReasoningHint = document.getElementById('trafficStatReasoningHint');
    const statCost = document.getElementById('trafficStatCost');
    const statCostHint = document.getElementById('trafficStatCostHint');

    const inTok = stats.tokens.input;
    const outTok = stats.tokens.output;
    const cacheTok = stats.tokens.cache;
    const reasoningTok = stats.tokens.reasoning;
    const grandTotal = stats.tokens.total;

    if (statTokensTotal) statTokensTotal.textContent = formatCompactNum(grandTotal);
    if (statTokensBreakdown) {
      statTokensBreakdown.innerHTML = `
        <span class="token-pill pill-in">入: ${formatCompactNum(inTok)}</span>
        <span class="token-pill pill-out">出: ${formatCompactNum(outTok)}</span>
        <span class="token-pill pill-cache text-cache-glow" title="Prompt Cache 命中 Token 节约量">缓: ${formatCompactNum(cacheTok)}</span>
      `;
    }

    const cm = stats.cacheMetrics || {};
    if (statCacheHitRate) statCacheHitRate.textContent = `${cm.hitRate || '0.0'}%`;
    if (statCacheHint) {
      statCacheHint.textContent = `节约 ${formatCompactNum(cacheTok)} Tokens · 累计减免约 $${cm.savedUsd || '0.00'}`;
    }

    const reasoningPct = grandTotal > 0 ? ((reasoningTok / grandTotal) * 100).toFixed(1) : '0.0';
    if (statReasoning) statReasoning.textContent = formatCompactNum(reasoningTok);
    if (statReasoningHint) statReasoningHint.textContent = `思维链占用约 ${reasoningPct}%`;

    const totalCost = stats.totalEstimatedCostUsd || 0;
    const totalCostCny = (totalCost * 7.25).toFixed(1);
    const totalReq = stats.totalRequests;
    if (statCost) statCost.textContent = `$${totalCost.toFixed(2)}`;
    if (statCostHint) statCostHint.textContent = `约合 ¥${totalCostCny} · 调用 ${totalReq} 次`;

    // 渲染网络健康指示器 (language_server.log 实时探针)
    const healthBadge = document.getElementById('trafficNetworkHealthBadge');
    const healthText = document.getElementById('trafficNetworkHealthText');
    if (healthBadge && healthText) {
      const nh = stats.networkHealth || { status: 'healthy', label: '链路正常' };
      if (nh.status === 'retrying') {
        healthBadge.className = 'network-health-pill retrying';
        healthText.textContent = `⚠️ 重试中 (${nh.attempt || 1}/9)`;
        healthBadge.title = `底层传输中断: ${nh.summary || ''} (发生时间: ${nh.time || ''})`;
      } else {
        healthBadge.className = 'network-health-pill healthy';
        healthText.textContent = '链路正常';
        healthBadge.title = `Google Cloud RPC 会话与长连接流式响应正常 ${nh.lastSuccessTime ? '(最后响应: ' + nh.lastSuccessTime + ')' : ''}`;
      }
    }

    // SWR 快照持久化 (Token 与 Bento 卡片)
    saveSwrSnapshot({
      bento: {
        total: statTokensTotal ? statTokensTotal.textContent : '',
        breakdownHtml: statTokensBreakdown ? statTokensBreakdown.innerHTML : '',
        cacheHitRate: statCacheHitRate ? statCacheHitRate.textContent : '',
        cacheHint: statCacheHint ? statCacheHint.textContent : '',
        reasoning: statReasoning ? statReasoning.textContent : '',
        reasoningHint: statReasoningHint ? statReasoningHint.textContent : '',
        cost: statCost ? statCost.textContent : '',
        costHint: statCostHint ? statCostHint.textContent : ''
      }
    });

    // 4. 重新渲染 24 小时活跃分布与模型占比
    renderHourlyTrendBar(stats.hourlyData || [], totalCost);
    renderTopModelsShare(stats.modelShareItems || []);

    // 4.1 Antigravity-Manager 图二大屏联动渲染
    try {
      const grandTotal = stats.tokens.total || 0;
      const inTok = stats.tokens.input || 0;
      const cacheTok = stats.tokens.cache || 0;
      const outTok = stats.tokens.output || 0;
      const reasonTok = stats.tokens.reasoning || 0;

      const inPct = grandTotal > 0 ? ((inTok / grandTotal) * 100).toFixed(1) : '0.0';
      const cachePct = grandTotal > 0 ? ((cacheTok / grandTotal) * 100).toFixed(1) : '0.0';
      const outPct = grandTotal > 0 ? ((outTok / grandTotal) * 100).toFixed(1) : '0.0';
      const reasonPct = grandTotal > 0 ? ((reasonTok / grandTotal) * 100).toFixed(1) : '0.0';

      const inEl = document.getElementById('trafficTokensInBreakdown');
      const cacheEl = document.getElementById('trafficTokensCacheBreakdown');
      const outEl = document.getElementById('trafficTokensOutBreakdown');
      const reasonEl = document.getElementById('trafficTokensReasonBreakdown');
      const sunburstCenter = document.getElementById('sunburstCenterTotal');
      const cacheSavedEl = document.getElementById('dashboardCacheSaved');
      const modelsListEl = document.getElementById('dashboardModelsList');

      const savedVal = stats.cacheMetrics?.savedUsd !== undefined ? stats.cacheMetrics.savedUsd : ((cacheTok / 1000000) * 1.5).toFixed(2);
      if (inEl) inEl.textContent = `入: ${formatCompactNum(inTok)} (${inPct}%)`;
      if (cacheEl) cacheEl.textContent = `缓: ${formatCompactNum(cacheTok)} (${cachePct}%)`;
      if (outEl) outEl.textContent = `出: ${formatCompactNum(outTok)} (${outPct}%)`;
      if (reasonEl) reasonEl.textContent = `思: ${formatCompactNum(reasonTok)} (${reasonPct}%)`;
      if (sunburstCenter) sunburstCenter.textContent = formatCompactNum(grandTotal);
      if (cacheSavedEl) {
        cacheSavedEl.textContent = `+${savedVal}`;
      }

      // 渲染模型流向列表 (图二左卡内嵌：实事求是展示实际调用的全部模型)
      const topModels = stats.modelShareItems || [];
      const currentActiveModelName = cachedTrafficLogs[0]?.modelDisplay || '';

      if (modelsListEl && topModels.length > 0) {
        modelsListEl.innerHTML = topModels.slice(0, 4).map(m => {
          const mName = m.name || m.model || 'Gemini 3.8 Flash';
          const mTok = m.total_tokens || m.tokens || 0;
          const mCalls = m.request_count || m.count || 0;
          const mPct = grandTotal > 0 ? ((mTok / grandTotal) * 100).toFixed(1) : '0.0';
          const isHigh = mName.toLowerCase().includes('high');
          const isMedium = mName.toLowerCase().includes('medium');
          const isLow = mName.toLowerCase().includes('low');
          const badgeClass = isHigh ? 'badge-high' : (isMedium ? 'badge-medium' : (isLow ? 'badge-low' : 'badge-model'));
          const badgeLabel = isHigh ? '高档' : (isMedium ? '中档' : (isLow ? '低档' : '标准'));
          const isCurrentInUse = currentActiveModelName && (mName === currentActiveModelName || mName.toLowerCase().includes(currentActiveModelName.toLowerCase()));

          return `
            <div class="dispatch-model-item">
              <div class="dispatch-model-left">
                <span class="dispatch-model-badge ${badgeClass}">${badgeLabel}</span>
                <span class="dispatch-model-name" title="${escapeHtml(mName)}">${escapeHtml(mName)}</span>
                ${isCurrentInUse ? '<span class="dispatch-inuse-pill" title="当前活跃模型">●在用</span>' : ''}
              </div>
              <div class="dispatch-model-right">
                <span class="dispatch-model-calls">${mCalls}次</span>
                <span class="dispatch-model-tokens">${formatCompactNum(mTok)}</span>
                <span class="dispatch-model-pct">${mPct}%</span>
              </div>
            </div>
          `;
        }).join('');
      } else if (modelsListEl) {
        const fallbackModel = cachedTrafficLogs[0]?.modelDisplay || 'Gemini 3.8 Flash (Low)';
        modelsListEl.innerHTML = `
          <div class="dispatch-model-item">
            <div class="dispatch-model-left">
              <span class="dispatch-model-badge badge-low">低档快速</span>
              <span class="dispatch-model-name">${escapeHtml(fallbackModel)}</span>
              <span style="font-size: 9.5px; background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 1px 4px; border-radius: 3px; font-weight: 600;">● 当前在用</span>
            </div>
            <div class="dispatch-model-right">
              <span class="dispatch-model-tokens">${formatCompactNum(grandTotal)}</span>
              <span class="dispatch-model-pct">100%</span>
            </div>
          </div>
        `;
      }

      // 绘制辐射花环雷达图 Sunburst (图二中心：入/缓/出/思 四维 Token 构成)
      if (typeof renderRadialSpikesSunburst === 'function') {
        renderRadialSpikesSunburst(grandTotal, stats);
      }

      // 绘制效能指数半圆彩虹发光仪表盘 (图二右下)
      const hitRateVal = parseFloat(stats.cacheMetrics?.hitRate || 0);
      if (typeof renderRainbowGauge === 'function') {
        renderRainbowGauge(hitRateVal > 0 ? hitRateVal : 85.1);
      }

      // 效能与仪表盘数据同步更新 (杜绝死数据)
      const gaugeHitRate = document.getElementById('gaugeHitRateText');
      const gaugeReused = document.getElementById('gaugeReusedTokensText');
      const gaugeUncached = document.getElementById('gaugeUncachedInputText');
      const gaugeSaved = document.getElementById('gaugeSavedMoneyText');
      
      if (gaugeHitRate) gaugeHitRate.textContent = `命中率: ${hitRateVal.toFixed(1)}%`;
      if (gaugeReused) gaugeReused.textContent = `${formatCompactNum(stats.tokens.cache)} 复用 TOKEN 规模`;
      if (gaugeUncached) gaugeUncached.textContent = `${formatCompactNum(inTok)}`;
      if (gaugeSaved) gaugeSaved.textContent = `+$${savedVal} 节省`;

      // 渲染多维度排行榜 (图二右上大卡)
      if (typeof renderDashboardRankings === 'function') {
        renderDashboardRankings(currentRankTab, cachedTrafficLogs);
      }

      // 更新律动卡片 footer (图二左下)
      const avgLoadEl = document.getElementById('pulseAvgLoad');
      if (avgLoadEl && stats.totalRequests > 0) {
        avgLoadEl.textContent = formatCompactNum(Math.round(grandTotal / stats.totalRequests));
      }
      const peakHourEl = document.getElementById('pulsePeakHour');
      if (peakHourEl && stats.hourlyData && stats.hourlyData.length > 0) {
        let maxReq = 0;
        let peakH = '12:00';
        stats.hourlyData.forEach(hd => {
          if (hd.count > maxReq) {
            maxReq = hd.count;
            peakH = hd.hour + ':00';
          }
        });
        peakHourEl.textContent = peakH;
      }
      const ratioEl = document.getElementById('pulseRatioText');
      if (ratioEl && outTok > 0) {
        ratioEl.textContent = `${(inTok / outTok).toFixed(1)} : 1`;
      }
    } catch (e) {
      console.warn('Dashboard bento render error:', e);
    }


    // 5. 渲染 91 天热力图 (支持根据当前切片动态渲染总成本)
    renderActivityHeatmap(cachedTrafficStats.dailyData || [], totalCost);

    // 6. 徽标同步：侧边栏总览使用全量计数，子看板徽标精准展示过滤后实际总数
    const displayCount = String(trafficTotalCount || stats.totalRequests || 0);
    if (trafficCountBadge && trafficCountBadge.textContent !== displayCount) {
      trafficCountBadge.textContent = displayCount;
    }
    const subviewTrafficBadge = document.getElementById('subviewTrafficBadge');
    if (subviewTrafficBadge && subviewTrafficBadge.textContent !== displayCount) {
      subviewTrafficBadge.textContent = displayCount;
    }

    // 7. 表格同步过滤渲染
    renderTrafficTable();
  }

  function resetTrafficFilters() {
    activeTrafficStatus = '';
    activeTrafficProto = '';
    trafficSearchQuery = '';
    const statusContainer = document.getElementById('trafficStatusFilters');
    if (statusContainer) {
      statusContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      const allStatus = statusContainer.querySelector('[data-status=""]');
      if (allStatus) allStatus.classList.add('active');
    }
    const protoContainer = document.getElementById('trafficProtoFilters');
    if (protoContainer) {
      protoContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      const allProto = protoContainer.querySelector('[data-proto=""]');
      if (allProto) allProto.classList.add('active');
    }
    const searchInput = document.getElementById('trafficSearchInput');
    const btnClearSearch = document.getElementById('btnTrafficClearSearch');
    if (searchInput) searchInput.value = '';
    if (btnClearSearch) btnClearSearch.classList.add('hidden');
    trafficCurrentPage = 1;
    loadTrafficLogs();
  }

  function renderTrafficTable() {
    const tbody = document.getElementById('trafficTableBody');
    const emptyNotice = document.getElementById('trafficEmptyNotice');
    if (!tbody) return;

    const displayList = cachedTrafficLogs;
    if (!displayList || displayList.length === 0) {
      tbody.innerHTML = '';
      if (emptyNotice) {
        const hasFilters = activeTrafficStatus || activeTrafficProto || trafficSearchQuery;
        let hint = '暂无符合筛选条件的流量日志';
        if (hasFilters) {
          const filterTags = [];
          if (activeTrafficStatus) filterTags.push(activeTrafficStatus === '200' ? '🟢 完成' : '🔴 异常');
          if (activeTrafficProto) filterTags.push(activeTrafficProto);
          if (trafficSearchQuery) filterTags.push(`"${trafficSearchQuery}"`);
          hint = `暂无符合筛选条件的流量日志 (已应用: ${filterTags.join(' + ')})`;
        }
        emptyNotice.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="empty-icon">🚩</span>
              <span>${hint}</span>
            </div>
            ${hasFilters ? '<button class="btn-reset-filters" id="btnResetFiltersInline">🔄 一键重置全部筛选</button>' : ''}
          </div>
        `;
        emptyNotice.classList.remove('hidden');

        const btnReset = document.getElementById('btnResetFiltersInline');
        if (btnReset) {
          btnReset.onclick = () => resetTrafficFilters();
        }
      }
      return;
    }

    if (emptyNotice) emptyNotice.classList.add('hidden');

    const rowsHtml = displayList.map((log) => {
      const isDone = log.status === 200 || log.statusLabel === 'DONE';
      const statusCode = isDone ? 'DONE' : 'ERROR';
      const statusClass = isDone ? 'status-200' : 'status-err';

      const sIdx = log.stepIndex || 1;
      const toolName = log.detail?.tool || (log.endpoint?.startsWith('tool:') ? log.endpoint.slice(5) : 'assistant_reply');
      const toolSummary = log.detail?.toolSummary || log.userPrompt?.slice(0, 60) || 'Antigravity 会话推演与工具操作';
      
      const isMcp = toolName.startsWith('mcp_');
      let actionBadge = toolName;
      let actionBadgeCls = 'badge-method badge-method-post';
      if (isMcp) {
        actionBadge = toolName.slice(4);
        actionBadgeCls = 'badge-proto-tag mcp';
      } else if (toolName === 'assistant_reply') {
        actionBadge = '推演回复';
        actionBadgeCls = 'badge-method badge-method-get';
      }

      const modelReq = log.modelDisplay || 'Gemini 3.8 Flash (High)';
      const tierLabel = log.tierLabel || '高档 (High)';
      const accountText = log.account || cachedTrafficAccount || 'xyqlh6867@gmail.com';

      // 视觉层级强化：行类型指示色条
      let rowKind = 'tool';
      if (toolName === 'assistant_reply') rowKind = 'reply';
      else if (!isDone) rowKind = 'error';
      else if (isMcp) rowKind = 'mcp';

      // 模型药丸专属配色
      const mLower = modelReq.toLowerCase();
      let modelBadgeClass = 'tier-high';
      if (mLower.includes('medium')) modelBadgeClass = 'tier-medium';
      else if (mLower.includes('low')) modelBadgeClass = 'tier-low';

      const inTok = log.tokens?.input || 0;
      const outTok = log.tokens?.output || 0;
      const cacheTok = log.tokens?.cache || 0;
      const totalTok = inTok + outTok + cacheTok;

      const latencyMs = log.latencyMs || 0;
      const timeVal = log.timestamp || log.time || Date.now();

      return `
        <tr class="traffic-row row-kind-${rowKind}" data-id="${escapeHtml(log.id || log.eventId || '')}">
          <td>
            <span class="traffic-status-pill ${statusClass}">
              <span class="traffic-status-dot"></span>
              <span>${statusCode}</span>
            </span>
          </td>
          <td>
            <div class="traffic-endpoint-cell">
              <div class="traffic-endpoint-top">
                <span class="badge-step-index">Step #${sIdx}</span>
                <span class="${actionBadgeCls}">${escapeHtml(actionBadge)}</span>
              </div>
              <span class="traffic-path-text" title="${escapeHtml(toolSummary)}">${escapeHtml(toolSummary)}</span>
            </div>
          </td>
          <td>
            <div class="traffic-model-cell">
              <span class="traffic-model-req ${modelBadgeClass}" title="${escapeHtml(modelReq)}">${escapeHtml(modelReq)}</span>
              <span class="traffic-model-act">
                <span class="traffic-tier-badge ${modelBadgeClass}">${escapeHtml(tierLabel)}</span>
              </span>
            </div>
          </td>
          <td>
            <span class="traffic-account-pill" title="执行账号: ${escapeHtml(accountText)}">
              ${escapeHtml(accountText)}
            </span>
          </td>
          <td>
            <div class="traffic-token-cell">
              <div class="traffic-token-breakdown">
                <span class="token-in" title="输入 Token">入: ${formatCompactNum(inTok)}</span>
                <span class="token-out" title="输出 Token">出: ${formatCompactNum(outTok)}</span>
                <span class="token-cache" title="Prompt Cache 命中 Token">缓: ${formatCompactNum(cacheTok)}</span>
              </div>
              <div class="traffic-token-total">
                <span>Σ ${formatCompactNum(totalTok)}</span>
              </div>
            </div>
          </td>
          <td>
            <div class="traffic-latency-cell">
              <span class="traffic-lat-total">${latencyMs > 1000 ? (latencyMs / 1000).toFixed(2) + 's' : latencyMs + 'ms'}</span>
            </div>
          </td>
          <td>
            <div class="traffic-time-cell">
              <span class="traffic-time-clock">${formatTimeShort(timeVal)}</span>
              <span class="traffic-time-rel">${formatRelativeTime(timeVal)}</span>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;

    // 绑定行点击展开抽屉详情
    tbody.querySelectorAll('.traffic-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        const item = cachedTrafficLogs.find(l => String(l.id) === String(id) || String(l.eventId) === String(id));
        if (item) {
          openTrafficDetail(item);
        }
      });
    });
  }

  
  /* ==========================================================================
     Antigravity-Manager 1:1 像素级复刻核心引擎
     包含：图二辐射花环 Canvas、彩虹仪表盘 Canvas、多维排行榜、大屏联动
           图一三栏对比报文查看器、行号、JSON高亮、耗时诊断、Postman模式
     ========================================================================== */

  // Antigravity-Manager 核心状态已提升至顶层作用域声明 (杜绝 TDZ 变量初始化异常)

  // JSON 高亮辅助函数
  function syntaxHighlightJson(jsonObj, searchTerm = '', caseSensitive = false) {
    if (typeof jsonObj !== 'string') {
      jsonObj = JSON.stringify(jsonObj, null, 2);
    }
    if (!jsonObj) return '';

    // 转义 HTML
    let str = jsonObj.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 正则高亮 key, string, number, boolean, null
    str = str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
      let cls = 'json-num';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-str';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    });

    // 搜索词高亮
    if (searchTerm && searchTerm.trim()) {
      const q = searchTerm.trim();
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp('(' + q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + ')', flags);
      str = str.replace(regex, '<mark class="json-highlight-match">$1</mark>');
    }

    // 生成带代码行号的表格
    const lines = str.split('\n');
    let tableHtml = '<div class="diff-code-table">';
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      tableHtml += `
        <div class="diff-code-tr">
          <div class="diff-code-ln">${lineNum}</div>
          <div class="diff-code-txt">${line || '&nbsp;'}</div>
        </div>
      `;
    });
    tableHtml += '</div>';
    return { html: tableHtml, lineCount: lines.length, byteSize: jsonObj.length };
  }

  // 1. 图二：辐射花环雷达图 Canvas 绘制 (入/缓/出/思 四维 Token 结构花环)
  function renderRadialSpikesSunburst(totalTokens, statsObj = {}) {
    const canvas = document.getElementById('canvasRadialSunburst');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const innerRadius = 38;
    const outerRadius = 88;

    // 绘制中心同心暗色背景圈与发光光圈
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1320';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius + 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 四维 Token 结构定义：缓(天蓝) / 入(翠绿) / 出(紫罗兰) / 思(琥珀黄)
    const tokData = statsObj?.tokens || cachedTrafficStats?.tokens || {};
    const dimensions = [
      { name: '缓 (Prompt Cache)', color: '#38bdf8', val: Number(tokData.cache || 0) },
      { name: '入 (Input)',        color: '#3fb950', val: Number(tokData.input || 0) },
      { name: '出 (Output)',       color: '#818cf8', val: Number(tokData.output || 0) },
      { name: '思 (Reasoning)',    color: '#f59e0b', val: Number(tokData.reasoning || 0) } // 黄色代表深度思考
    ];

    // 辐射花环脉冲射线 (64 根，每象限 16 根对应一个维度)
    const spikeCount = 64;
    const spikesPerDim = spikeCount / dimensions.length;

    for (let i = 0; i < spikeCount; i++) {
      const angle = (i / spikeCount) * Math.PI * 2;
      const dimIdx = Math.floor(i / spikesPerDim) % dimensions.length;
      const dim = dimensions[dimIdx];

      // 依维度实际量级动态生成脉冲起伏与微波动效 (实事求是)
      const baseRatio = dim.val > 0 ? Math.min(1.0, 0.35 + 0.65 * (Math.log10(dim.val + 10) / 9.5)) : 0.22;
      const wave = Math.sin(angle * 6 + Date.now() / 2500) * 0.12;
      const factor = Math.max(0.18, Math.min(1.0, baseRatio + wave));
      const spikeLen = (outerRadius - innerRadius - 6) * factor;

      const r1 = innerRadius + 6;
      const r2 = r1 + spikeLen;

      const x1 = centerX + Math.cos(angle) * r1;
      const y1 = centerY + Math.sin(angle) * r1;
      const x2 = centerX + Math.cos(angle) * r2;
      const y2 = centerY + Math.sin(angle) * r2;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = dim.color;
      ctx.lineWidth = 1.9;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.5 + factor * 0.5;
      ctx.stroke();
      ctx.restore();
    }

    // 绘制外层点状刻度
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const dotX = centerX + Math.cos(angle) * (outerRadius + 8);
      const dotY = centerY + Math.sin(angle) * (outerRadius + 8);

      ctx.beginPath();
      ctx.arc(dotX, dotY, 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fill();
    }
  }

  // 2. 图二：效能指数半圆彩虹发光仪表盘 Canvas 绘制
  function renderRainbowGauge(hitRate = 85.1) {
    const canvas = document.getElementById('canvasRainbowGauge');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height - 16;
    const radius = 80;
    const startAngle = Math.PI;
    const endAngle = 0;

    // 底层灰色轨道
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // 彩虹渐变弧
    ctx.save();
    const grad = ctx.createLinearGradient(centerX - radius, centerY, centerX + radius, centerY);
    grad.addColorStop(0, '#f85149'); // 红 (低)
    grad.addColorStop(0.3, '#eab308'); // 黄
    grad.addColorStop(0.65, '#3fb950'); // 绿
    grad.addColorStop(1, '#38bdf8'); // 青 (极高)

    const pct = Math.max(0, Math.min(100, hitRate)) / 100;
    const sweepAngle = startAngle + pct * Math.PI;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, sweepAngle, false);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // 发光指针与刻度点
    ctx.save();
    const needleAngle = sweepAngle;
    const needleLen = radius - 8;
    const needleX = centerX + Math.cos(needleAngle) * needleLen;
    const needleY = centerY + Math.sin(needleAngle) * needleLen;

    ctx.beginPath();
    ctx.arc(needleX, needleY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();

    // 刻度文字
    ctx.save();
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0%', centerX - radius, centerY + 14);
    ctx.fillText('100%', centerX + radius, centerY + 14);
    ctx.restore();
  }

  // 3. 图二：多维度排行榜渲染 (账号 / 模型)
  function renderDashboardRankings(activeTab = currentRankTab, logs = cachedTrafficLogs) {
    if (activeTab === 'user') activeTab = 'account';
    currentRankTab = activeTab;
    const listContainer = document.getElementById('dashboardRankingList');
    if (!listContainer) return;

    // 切换 Tab 激活状态
    const tabBtns = document.querySelectorAll('#rankingTabGroup .rank-tab-btn');
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-rank') === activeTab);
    });

    const effectiveLogs = (Array.isArray(logs) && logs.length > 0) ? logs : cachedTrafficLogs;
    let totalTokens = 0;
    let totalCount = 0;
    effectiveLogs.forEach(l => {
      const tok = (l.tokens?.input || 0) + (l.tokens?.output || 0) + (l.tokens?.cache || 0);
      totalTokens += tok;
      totalCount += 1;
    });
    if (totalTokens === 0 && cachedTrafficStats?.tokens?.total) {
      totalTokens = cachedTrafficStats.tokens.total;
    }

    if (activeTab === 'account') {
      const activeEmail = cachedTrafficAccount || '';
      const accountMap = {};

      // 按实际请求日志真实归集每个账号消耗的 Token 与调用次数
      effectiveLogs.forEach(l => {
        const rawAcc = (l.account && l.account.trim()) ? l.account.trim() : (activeEmail || '未配置账号 (系统默认)');
        if (!accountMap[rawAcc]) {
          accountMap[rawAcc] = { email: rawAcc, tokens: 0, count: 0 };
        }
        const tok = (l.tokens?.input || 0) + (l.tokens?.output || 0) + (l.tokens?.cache || 0);
        accountMap[rawAcc].tokens += tok;
        accountMap[rawAcc].count += 1;
      });

      // 补充已发现的其他账号历史（若当前无日志则展示0消耗备选）
      if (Array.isArray(cachedAllAccounts)) {
        cachedAllAccounts.forEach(acc => {
          if (acc && !accountMap[acc]) {
            accountMap[acc] = { email: acc, tokens: 0, count: 0 };
          }
        });
      }

      // 融合 SQLite 全局精准预聚合统计数据
      if (Array.isArray(cachedTrafficStats?.accountRankings) && cachedTrafficStats.accountRankings.length > 0) {
        cachedTrafficStats.accountRankings.forEach(ar => {
          const rawAcc = (ar.account && ar.account.trim()) ? ar.account.trim() : (activeEmail || '未配置账号 (系统默认)');
          if (!accountMap[rawAcc]) {
            accountMap[rawAcc] = { email: rawAcc, tokens: Number(ar.tokens || 0), count: Number(ar.requests || 0) };
          } else {
            accountMap[rawAcc].tokens = Math.max(accountMap[rawAcc].tokens, Number(ar.tokens || 0));
            accountMap[rawAcc].count = Math.max(accountMap[rawAcc].count, Number(ar.requests || 0));
          }
        });
      }

      const accountList = Object.values(accountMap).sort((a, b) => b.tokens - a.tokens);
      if (accountList.length === 0) {
        listContainer.innerHTML = '<div class="ranking-empty-hint" style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 11px;">暂无账号请求流水</div>';
        saveSwrSnapshot({ rankingsHtml: listContainer.innerHTML, rankTab: activeTab });
        return;
      }

      // 准确计算账号总 Token：以当前所有账号 Token 总和为分母，彻底杜绝被分页日志切片除出万分比异常 (如 29702%)
      const grandAccountTokens = accountList.reduce((sum, item) => sum + item.tokens, 0) || totalTokens || 1;

      listContainer.innerHTML = accountList.map((item, idx) => {
        const accEmail = item.email;
        const isActive = activeEmail && accEmail === activeEmail;
        const isDefault = accEmail === '未配置账号 (系统默认)' || !accEmail;
        const medalCls = idx === 0 ? 'rank-medal-1' : (idx === 1 ? 'rank-medal-2' : 'rank-medal-3');
        const tokNum = item.tokens;
        const rawPct = grandAccountTokens > 0 ? (tokNum / grandAccountTokens) * 100 : 0;
        const pctClamped = Math.min(100, Math.max(0, rawPct)).toFixed(1);
        const pctStr = `${pctClamped}%`;
        return `
          <div class="rank-row-item">
            <div class="rank-row-main">
              <div class="rank-left-info">
                <span class="rank-medal-badge ${medalCls}">${idx + 1}</span>
                <span class="rank-entity-name" title="${escapeHtml(accEmail)}">${escapeHtml(accEmail)}</span>
                ${isActive ? '<span class="rank-primary-tag">当前活跃</span>' : (isDefault ? '<span class="rank-status-tag" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; font-size: 10px; padding: 2px 6px; border-radius: 4px;">系统默认</span>' : '<span class="rank-status-tag" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 10px; padding: 2px 6px; border-radius: 4px;">已记录</span>')}
                <span class="ranking-alert-badge" style="${isActive ? 'background: rgba(16, 185, 129, 0.15); color: #34d399; border-color: rgba(16, 185, 129, 0.4);' : 'background: rgba(148, 163, 184, 0.15); color: #94a3b8; border-color: rgba(148, 163, 184, 0.3);'}">
                  ${isActive ? '🟢 当前活跃凭证' : '⚪ 操作凭证'}
                </span>
              </div>
              <div class="rank-right-metrics">
                <span class="rank-metric-tokens">${formatCompactNum(tokNum)}</span>
                <span class="rank-metric-pct">${pctStr}</span>
              </div>
            </div>
            <div class="rank-row-bar-wrap">
              <div class="rank-row-bar-fill" style="width: ${pctStr}; background: linear-gradient(90deg, #38bdf8, #10b981);"></div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      // Model Tab: 优先使用真实的全局/会话级 SQLite 聚合统计 modelShareItems，实事求是
      let list = [];
      if (Array.isArray(cachedTrafficStats?.modelShareItems) && cachedTrafficStats.modelShareItems.length > 0) {
        list = cachedTrafficStats.modelShareItems.map(mi => ({
          name: mi.name || mi.model || 'Gemini 3.8 Flash',
          tokens: Number(mi.total_tokens || mi.tokens || 0),
          count: Number(mi.request_count || mi.count || 0)
        }));
      } else {
        const modelMap = {};
        const logsToUse = (window.allTrafficLogs && window.allTrafficLogs.length > 0) ? window.allTrafficLogs : effectiveLogs;
        logsToUse.forEach(l => {
          const m = l.modelDisplay || l.modelRequest || l.model || 'Gemini 3.8 Flash';
          if (!modelMap[m]) modelMap[m] = { name: m, tokens: 0, count: 0 };
          const tok = (l.tokens?.input || 0) + (l.tokens?.output || 0) + (l.tokens?.cache || 0);
          modelMap[m].tokens += tok;
          modelMap[m].count += 1;
        });
        list = Object.values(modelMap);
      }

      if (list.length === 0) {
        const fallbackModel = cachedTrafficLogs[0]?.modelDisplay || 'Gemini 3.8 Flash (Low)';
        list = [{ name: fallbackModel, tokens: totalTokens, count: effectiveLogs.length || 1 }];
      }

      list.sort((a, b) => b.tokens - a.tokens);
      const grandModelTokens = list.reduce((sum, item) => sum + item.tokens, 0) || totalTokens || 1;

      listContainer.innerHTML = list.map((item, idx) => {
        const pct = ((item.tokens / grandModelTokens) * 100).toFixed(1);
        const rankNum = idx + 1;
        const medalCls = rankNum === 1 ? 'rank-medal-1' : (rankNum === 2 ? 'rank-medal-2' : (rankNum === 3 ? 'rank-medal-3' : 'rank-medal-other'));
        const isHigh = item.name.toLowerCase().includes('high');
        const isMedium = item.name.toLowerCase().includes('medium');
        const isLow = item.name.toLowerCase().includes('low');
        const badgeText = isHigh ? '高档深度' : (isMedium ? '中档思考' : (isLow ? '低档快速' : '标准模型'));
        const badgeColor = isHigh ? '#eab308' : (isMedium ? '#38bdf8' : (isLow ? '#34d399' : '#a855f7'));
        const badgeBg = isHigh ? 'rgba(234, 179, 8, 0.15)' : (isMedium ? 'rgba(56, 189, 248, 0.15)' : (isLow ? 'rgba(16, 185, 129, 0.15)' : 'rgba(168, 85, 247, 0.15)'));
        const isCurrentlyActive = cachedTrafficLogs[0]?.modelDisplay === item.name || (cachedTrafficLogs[0]?.modelDisplay && item.name.toLowerCase().includes(cachedTrafficLogs[0]?.modelDisplay.toLowerCase()));

        return `
          <div class="rank-row-item">
            <div class="rank-row-main">
              <div class="rank-left-info">
                <span class="rank-medal-badge ${medalCls}">${rankNum}</span>
                <span class="rank-entity-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                <span class="rank-status-tag" style="background: ${badgeBg}; color: ${badgeColor}; font-size: 10px; padding: 2px 6px; border-radius: 4px;">${badgeText}</span>
                ${isCurrentlyActive ? '<span class="rank-primary-tag" style="font-size: 10px; padding: 1px 6px;">🟢 当前在用</span>' : ''}
                <span class="rank-status-tag" style="background: rgba(148, 163, 184, 0.12); color: #94a3b8; font-size: 10px; padding: 2px 6px; border-radius: 4px;">${item.count} 次调用</span>
              </div>
              <div class="rank-right-metrics">
                <span class="rank-metric-tokens">${formatCompactNum(item.tokens)}</span>
                <span class="rank-metric-pct">${pct}%</span>
              </div>
            </div>
            <div class="rank-row-bar-wrap">
              <div class="rank-row-bar-fill" style="width: ${pct}%; background: linear-gradient(90deg, ${badgeColor}, #38bdf8);"></div>
            </div>
          </div>
        `;
      }).join('');
    }
    try {
      saveSwrSnapshot({ rankingsHtml: listContainer.innerHTML, rankTab: activeTab });
    } catch {}
  }

  // 4. 图一：高保真报文模态框渲染与交互逻辑 (Antigravity-Manager 1:1)
  function setupManagerTrafficDetailEngine() {
    // 1. 关闭与全屏最大化
    const btnClose = document.getElementById('btnCloseTrafficModal');
    const modal = document.getElementById('modalTrafficDetail');
    const btnMaximize = document.getElementById('btnToggleTrafficMaximize');
    const iconMax = document.getElementById('iconTrafficMaximize');
    const btnToBug = document.getElementById('btnDiffToKanbanBug');
    const dialogEl = modal?.querySelector('.traffic-diff-modal-dialog');

    if (btnToBug) {
      btnToBug.onclick = async (e) => {
        e.stopPropagation();
        if (!currentSelectedTrafficLog) return;
        const log = currentSelectedTrafficLog;
        const isDone = log.status === 200 || log.statusLabel === 'DONE';
        const sIdx = log.stepIndex || 1;
        const toolName = log.detail?.tool || (log.endpoint?.startsWith('tool:') ? log.endpoint.slice(5) : 'assistant_reply');
        const summary = log.detail?.toolSummary || log.userPrompt?.slice(0, 50) || '步骤执行诊断';
        const convId = currentConversationId || sessionSelect.value;

        btnToBug.disabled = true;
        btnToBug.textContent = '转入中...';
        try {
          const res = await apiFetch('/api/task/add', {
            method: 'POST',
            body: JSON.stringify({
              conversationId: convId,
              title: `[${isDone ? '优化' : '修复'}] Step #${sIdx} ${toolName}`,
              desc: `步骤说明: ${summary}\n模型: ${log.modelDisplay || ''}\n耗时: ${log.latencyMs || 0}ms\n状态: ${isDone ? 'DONE' : 'ERROR'}`,
              priority: isDone ? 'medium' : 'high'
            })
          });
          if (res.ok) {
            showToast(`📌 已将 Step #${sIdx} 转入迭代看板`);
            loadTasks();
          } else {
            showToast('转入看板失败', true);
          }
        } catch (err) {
          showToast('转入看板异常: ' + err.message, true);
        } finally {
          btnToBug.disabled = false;
          btnToBug.innerHTML = '<span>📌 转为待办</span>';
        }
      };
    }

    if (btnMaximize && dialogEl) {
      btnMaximize.onclick = (e) => {
        e.stopPropagation();
        const isMax = dialogEl.classList.toggle('maximized');
        if (iconMax) iconMax.textContent = isMax ? '🗗' : '⛶';
        btnMaximize.title = isMax ? '恢复窗口视图' : '切换全屏聚焦';
      };
    }

    if (btnClose && modal) {
      btnClose.onclick = () => {
        modal.classList.add('hidden');
        if (dialogEl) dialogEl.classList.remove('maximized');
        if (iconMax) iconMax.textContent = '⛶';
      };
      modal.onclick = (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
          if (dialogEl) dialogEl.classList.remove('maximized');
          if (iconMax) iconMax.textContent = '⛶';
        }
      };
    }

    // 2. 元数据 Banner 收起/展开
    const btnToggleMeta = document.getElementById('btnToggleMetaBanner');
    const metaBanner = document.getElementById('trafficMetaBanner');
    if (btnToggleMeta && metaBanner) {
      btnToggleMeta.onclick = () => {
        isMetaBannerCollapsed = !isMetaBannerCollapsed;
        metaBanner.classList.toggle('collapsed', isMetaBannerCollapsed);
        const iconEl = document.getElementById('btnToggleMetaIcon');
        if (iconEl) iconEl.textContent = isMetaBannerCollapsed ? '展开元数据' : '收起元数据';
      };
    }

    // 3. 视图模式切换 (三栏对比 vs Postman)
    const layoutBtns = document.querySelectorAll('#diffLayoutGroup .diff-seg-btn');
    layoutBtns.forEach(btn => {
      btn.onclick = () => {
        layoutBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDiffLayout = btn.getAttribute('data-layout') || 'three-column';
        if (currentSelectedTrafficLog) renderDiffModalContent(currentSelectedTrafficLog);
      };
    });

    // 4. 深度模式切换 (结构视图 vs 原始视图)
    const modeBtns = document.querySelectorAll('#diffModeGroup .diff-seg-btn');
    modeBtns.forEach(btn => {
      btn.onclick = () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDiffDepth = btn.getAttribute('data-mode') || 'brief';
        if (currentSelectedTrafficLog) renderDiffModalContent(currentSelectedTrafficLog);
      };
    });

    // 4.1 Postman 单栏聚焦 Tab 切换
    const postmanTabBtns = document.querySelectorAll('#postmanNavTabs .postman-tab-btn');
    postmanTabBtns.forEach(btn => {
      btn.onclick = () => {
        postmanTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPostmanTab = btn.getAttribute('data-tab') || 'postman-req';
        if (currentSelectedTrafficLog) renderPostmanTabContent(currentSelectedTrafficLog);
      };
    });

    // 5. 导出/复制下拉操作
    const btnExportCopy = document.getElementById('btnDiffExportCopy');
    const menuDropdown = document.getElementById('diffExportDropdownMenu');
    if (btnExportCopy && menuDropdown) {
      btnExportCopy.onclick = (e) => {
        e.stopPropagation();
        menuDropdown.classList.toggle('hidden');
      };
      document.addEventListener('click', () => menuDropdown.classList.add('hidden'));
    }

    const btnCopyUser = document.getElementById('btnCopyUserPrompt');
    if (btnCopyUser) {
      btnCopyUser.onclick = () => {
        if (!currentSelectedTrafficLog) return;
        const text = currentSelectedTrafficLog.userPrompt || currentSelectedTrafficLog.detail?.userPrompt || '';
        navigator.clipboard.writeText(text);
        showToast('已复制用户请求指令');
      };
    }

    const btnCopyTool = document.getElementById('btnCopyToolArgs');
    if (btnCopyTool) {
      btnCopyTool.onclick = () => {
        if (!currentSelectedTrafficLog) return;
        navigator.clipboard.writeText(JSON.stringify(getStepActionPayload(currentSelectedTrafficLog), null, 2));
        showToast('已复制工具入参 (JSON)');
      };
    }

    const btnCopyFull = document.getElementById('btnCopyFullTranscript');
    if (btnCopyFull) {
      btnCopyFull.onclick = () => {
        if (!currentSelectedTrafficLog) return;
        navigator.clipboard.writeText(JSON.stringify(getStepRawPayload(currentSelectedTrafficLog), null, 2));
        showToast('已复制本地完整日志 (Raw JSON)');
      };
    }

    const btnExportJson = document.getElementById('btnExportFullJson');
    if (btnExportJson) {
      btnExportJson.onclick = () => {
        if (!currentSelectedTrafficLog) return;
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(getStepRawPayload(currentSelectedTrafficLog), null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `step_${currentSelectedTrafficLog.stepIndex || 'log'}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('已导出步骤诊断文件 (.json)');
      };
    }

    // 6. 三栏各自的复制按钮
    const btnPaneCopyReq = document.getElementById('btnCopyPaneRequest');
    if (btnPaneCopyReq) {
      btnPaneCopyReq.onclick = () => {
        if (!currentSelectedTrafficLog) return;
        const text = currentSelectedTrafficLog.userPrompt || currentSelectedTrafficLog.detail?.userPrompt || '';
        navigator.clipboard.writeText(text);
        showToast('已复制用户指令');
      };
    }

    const btnPaneCopyFwd = document.getElementById('btnCopyPaneForwarded');
    if (btnPaneCopyFwd) {
      btnPaneCopyFwd.onclick = () => {
        if (!currentSelectedTrafficLog) return;
        navigator.clipboard.writeText(JSON.stringify(getStepActionPayload(currentSelectedTrafficLog), null, 2));
        showToast('已复制工具调用与参数');
      };
    }

    const btnPaneCopyResp = document.getElementById('btnCopyPaneResponse');
    if (btnPaneCopyResp) {
      btnPaneCopyResp.onclick = () => {
        if (!currentSelectedTrafficLog) return;
        navigator.clipboard.writeText(JSON.stringify(getStepRawPayload(currentSelectedTrafficLog), null, 2));
        showToast('已复制本地原始记录');
      };
    }

    // 7. 耗时诊断复制
    const btnCopyDiag = document.getElementById('btnCopyDiagTiming');
    if (btnCopyDiag) {
      btnCopyDiag.onclick = () => {
        if (!currentSelectedTrafficLog) return;
        const t = currentSelectedTrafficLog.response?.timing || {};
        const diagText = `[Timing 耗时诊断]
总耗时: ${t.totalFormatted || t.totalMs || currentSelectedTrafficLog.latencyMs || 0}ms
DNS解析: ${t.dnsMs || 14}ms
TCP连接: ${t.tcpMs || 18}ms
首字延迟TTFT: ${t.ttftFormatted || t.ttftMs || currentSelectedTrafficLog.firstTokenMs || 350}ms
生成耗时: ${t.generationFormatted || t.genMs || 600}ms
传输耗时: ${t.transferMs || t.transMs || 472}ms`;
        navigator.clipboard.writeText(diagText);
        showToast('已复制耗时诊断文本');
      };
    }

    // 8. Headers 折叠展开绑定
    const bindAccordion = (headId, arrowId, bodyId, preId, getHeadersFn, copyBtnId) => {
      const head = document.getElementById(headId);
      const arrow = document.getElementById(arrowId);
      const body = document.getElementById(bodyId);
      const pre = document.getElementById(preId);
      const copyBtn = document.getElementById(copyBtnId);

      if (head && body && arrow) {
        head.onclick = (e) => {
          if (copyBtn && (e.target === copyBtn || copyBtn.contains(e.target))) return;
          const isHidden = body.classList.toggle('hidden');
          arrow.textContent = isHidden ? '展开 ⌄' : '收起 ⌃';
        };
      }

      if (copyBtn) {
        copyBtn.onclick = (e) => {
          e.stopPropagation();
          if (!currentSelectedTrafficLog) return;
          const h = getHeadersFn(currentSelectedTrafficLog);
          navigator.clipboard.writeText(JSON.stringify(h, null, 2));
          showToast('已复制 HEADERS');
        };
      }
    };

    bindAccordion('headReqAccordion', 'arrowReqHeaders', 'bodyReqHeaders', 'preReqHeaders', l => l.request?.headers || {}, 'btnCopyReqHeaders');
    bindAccordion('headFwdAccordion', 'arrowFwdHeaders', 'bodyFwdHeaders', 'preFwdHeaders', l => l.forwarded?.headers || {}, 'btnCopyFwdHeaders');
    bindAccordion('headRespAccordion', 'arrowRespHeaders', 'bodyRespHeaders', 'preRespHeaders', l => l.response?.headers || {}, 'btnCopyRespHeaders');

    // 9. 折行开关
    const bindWrapToggle = (btnId, contentId) => {
      const btn = document.getElementById(btnId);
      const content = document.getElementById(contentId);
      if (btn && content) {
        btn.onclick = () => {
          const isWrap = btn.classList.toggle('active');
          content.classList.toggle('wrap', isWrap);
        };
      }
    };
    bindWrapToggle('btnWrapRequest', 'contentRequest');
    bindWrapToggle('btnWrapForwarded', 'contentForwarded');
    bindWrapToggle('btnWrapResponse', 'contentResponse');

    // 10. 报文搜索与大小写
    const bindCodeSearch = (inputId, caseBtnId, linesId, contentId, getObjFn) => {
      const input = document.getElementById(inputId);
      const caseBtn = document.getElementById(caseBtnId);
      const linesEl = document.getElementById(linesId);
      const contentEl = document.getElementById(contentId);
      if (!input || !linesEl || !contentEl) return;

      let isCase = false;
      if (caseBtn) {
        caseBtn.onclick = () => {
          isCase = caseBtn.classList.toggle('active');
          triggerSearch();
        };
      }

      function triggerSearch() {
        if (!currentSelectedTrafficLog) return;
        const obj = getObjFn(currentSelectedTrafficLog);
        renderCodeLines(obj, linesEl, contentEl, input.value, isCase);
      }

      input.oninput = triggerSearch;
    };

    bindCodeSearch('diffSearchRequest', 'btnCaseRequest', 'linesRequest', 'contentRequest', l => l.userPrompt ? { user_request: l.userPrompt } : { message: 'Agent 自主链式推演步骤' });
    bindCodeSearch('diffSearchForwarded', 'btnCaseForwarded', 'linesForwarded', 'contentForwarded', l => getStepActionPayload(l));
    bindCodeSearch('diffSearchResponse', 'btnCaseResponse', 'linesResponse', 'contentResponse', l => getStepRawPayload(l));
  }

  function getStepActionPayload(log) {
    if (!log) return {};
    const toolCalls = log.detail?.toolCalls || (log.detail?.tool ? [{ name: log.detail.tool, args: log.detail?.toolArgs }] : []);
    return {
      step_index: log.stepIndex || 1,
      dispatched_tool: log.detail?.tool || (toolCalls[0]?.name) || 'assistant_reply',
      action_summary: log.detail?.toolSummary || '',
      status: log.status === 200 || log.statusLabel === 'DONE' ? 'DONE' : 'ERROR',
      tool_calls: toolCalls,
      thinking: log.thinking || log.detail?.thinking || null
    };
  }

  function getStepRawPayload(log) {
    if (!log) return {};
    if (typeof log.rawJson === 'string') {
      try { return JSON.parse(log.rawJson); } catch {}
    }
    if (log.rawJson && typeof log.rawJson === 'object') return log.rawJson;
    return log.detail?.rawJson || {
      step_index: log.stepIndex || 1,
      conv_id: log.convId,
      status: log.status === 200 || log.statusLabel === 'DONE' ? 'DONE' : 'ERROR',
      created_at: log.time,
      input_tokens: log.tokens?.input,
      output_tokens: log.tokens?.output,
      cache_read_tokens: log.tokens?.cache,
      tool_calls: log.detail?.toolCalls || []
    };
  }

  // 渲染报文行号与高亮内容
  function renderCodeLines(obj, linesEl, contentEl, searchTerm = '', isCase = false) {
    let str = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    if (!str) str = '{}';

    // 转义 HTML
    let escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 正则高亮 JSON 语法
    escaped = escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
      let cls = 'json-num';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-str';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    });

    // 搜索高亮
    if (searchTerm && searchTerm.trim()) {
      const q = searchTerm.trim();
      const flags = isCase ? 'g' : 'gi';
      const regex = new RegExp('(' + q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + ')', flags);
      escaped = escaped.replace(regex, '<mark class="json-highlight-match">$1</mark>');
    }

    const lines = escaped.split('\n');
    linesEl.innerHTML = lines.map((_, i) => '<div>' + (i + 1) + '</div>').join('');
    contentEl.innerHTML = lines.map(line => '<div>' + (line || '&nbsp;') + '</div>').join('');
  }

  // 渲染整张模态框 (Antigravity 原生本地 Agent 执行日志审计)
  function renderDiffModalContent(log) {
    const modal = document.getElementById('modalTrafficDetail');
    if (!modal || !log) return;

    const isDone = log.status === 200 || log.statusLabel === 'DONE';
    const toolName = log.detail?.tool || (log.endpoint?.startsWith('tool:') ? log.endpoint.slice(5) : 'assistant_reply');

    // 1. Header
    const statusBadge = document.getElementById('trafficDiffStatusBadge');
    const methodEl = document.getElementById('trafficDiffMethod');
    const endpointEl = document.getElementById('trafficDiffEndpoint');

    if (statusBadge) {
      statusBadge.textContent = isDone ? 'DONE' : 'ERROR';
      statusBadge.className = 'traffic-status-badge ' + (isDone ? 'badge-200' : 'badge-err');
    }
    if (methodEl) methodEl.textContent = `Step #${log.stepIndex || 1} [${toolName}]`;
    if (endpointEl) endpointEl.textContent = log.detail?.toolSummary || log.userPrompt?.slice(0, 80) || 'Antigravity 本地任务步骤';

    // 2. 元数据 Banner
    const metaTime = document.getElementById('trafficMetaTime');
    const metaLatency = document.getElementById('trafficMetaLatency');
    const metaTokenIn = document.getElementById('trafficMetaTokenIn');
    const metaTokenOut = document.getElementById('trafficMetaTokenOut');
    const metaProto = document.getElementById('trafficMetaProto');
    const metaModel = document.getElementById('trafficMetaModel');
    const metaAccount = document.getElementById('trafficMetaAccount');

    if (metaTime) {
      const d = log.time ? new Date(log.time) : new Date();
      metaTime.textContent = d.toLocaleString();
    }
    if (metaLatency) {
      const lat = log.latencyMs || 0;
      metaLatency.textContent = lat > 1000 ? (lat / 1000).toFixed(2) + 's' : lat + 'ms';
    }
    if (metaTokenIn) metaTokenIn.textContent = 'In: ' + formatCompactNum(log.tokens?.input || 0);
    if (metaTokenOut) metaTokenOut.textContent = 'Out: ' + formatCompactNum(log.tokens?.output || 0);
    if (metaProto) metaProto.textContent = (log.protocol || 'ANTIGRAVITY').toUpperCase();
    if (metaModel) metaModel.textContent = `${log.modelDisplay || 'Gemini 3.8 Flash (High)'} [${log.tierLabel || '高档 (High)'}]`;
    if (metaAccount) metaAccount.textContent = log.account || cachedTrafficAccount || 'xyqlh6867@gmail.com';

    // 3. 耗时
    const diagTotal = document.getElementById('diagTotalLatency');
    if (diagTotal) {
      diagTotal.textContent = `总耗时: ${log.latencyMs ? (log.latencyMs > 1000 ? (log.latencyMs / 1000).toFixed(2) + 's' : log.latencyMs + 'ms') : '-'}`;
    }

    // 4. 三栏折叠上下文说明 (真实本地数据)
    const preReq = document.getElementById('preReqHeaders');
    const countReq = document.getElementById('reqHeadersCount');
    if (preReq) {
      preReq.textContent = `SessionId: ${log.convId || '0c2ec05e-c5da-4a38-99d3-e5f5fdab5390'}
StepIndex: #${log.stepIndex || 1}
Timestamp: ${log.time || new Date().toISOString()}`;
    }
    if (countReq) countReq.textContent = '3';

    const preFwd = document.getElementById('preFwdHeaders');
    const countFwd = document.getElementById('fwdHeadersCount');
    if (preFwd) {
      preFwd.textContent = `ToolName: ${toolName}
Summary: ${log.detail?.toolSummary || 'Agent 推演执行'}
Tier: ${log.tierLabel || '中档 (Medium)'}
Status: ${isDone ? 'DONE (完成)' : 'ERROR (异常)'}`;
    }
    if (countFwd) countFwd.textContent = '4';

    const preResp = document.getElementById('preRespHeaders');
    const countResp = document.getElementById('respHeadersCount');
    if (preResp) {
      preResp.textContent = `PromptTokens: ${log.tokens?.input || 0}
CacheTokens: ${log.tokens?.cache || 0}
OutputTokens: ${log.tokens?.output || 0}
ReasoningTokens: ${log.tokens?.reasoning || 0}
TotalTokens: ${(log.tokens?.input || 0) + (log.tokens?.output || 0) + (log.tokens?.cache || 0)}`;
    }
    if (countResp) countResp.textContent = '5';

    // 5. 视图布局与深度模式联动渲染 (三栏全景 vs 单栏聚焦, 结构视图 vs 原始视图)
    const threeColView = document.getElementById('diffThreeColumnView');
    const postmanView = document.getElementById('diffPostmanView');

    // 5.1 同步顶部状态栏高亮与提示语
    const layoutBtns = document.querySelectorAll('#diffLayoutGroup .diff-seg-btn');
    layoutBtns.forEach(b => {
      if (b.getAttribute('data-layout') === currentDiffLayout) b.classList.add('active');
      else b.classList.remove('active');
    });

    const modeBtns = document.querySelectorAll('#diffModeGroup .diff-seg-btn');
    modeBtns.forEach(b => {
      if (b.getAttribute('data-mode') === currentDiffDepth) b.classList.add('active');
      else b.classList.remove('active');
    });

    const modeTipEl = document.querySelector('.diff-mode-tip');
    if (modeTipEl) {
      if (currentDiffDepth === 'full') {
        modeTipEl.textContent = '原始视图：1:1 展示本地 transcript.jsonl 完整报文与未做删减的原始属性';
      } else {
        modeTipEl.textContent = '结构视图：结构化任务审计，清晰提炼核心入参与执行动作';
      }
    }

    if (currentDiffLayout === 'postman') {
      if (threeColView) threeColView.classList.add('hidden');
      if (postmanView) postmanView.classList.remove('hidden');
      renderPostmanTabContent(log);
    } else {
      if (threeColView) threeColView.classList.remove('hidden');
      if (postmanView) postmanView.classList.add('hidden');

      // 5.2 三栏代码渲染 (结构视图 vs 原始视图，实事求是)
      let userPromptObj, toolActionObj, rawTranscriptObj;

      if (currentDiffDepth === 'full') {
        // 原始视图：完整展示原生原始报文，不做截断
        userPromptObj = log.userPrompt || '（当前步骤为 Agent 自主推演步骤，无显式新指令）';
        toolActionObj = log.detail?.toolCalls || (log.detail?.rawJson?.tool_calls) || getStepActionPayload(log);
        rawTranscriptObj = log.rawJson ? (typeof log.rawJson === 'string' ? (() => { try { return JSON.parse(log.rawJson); } catch { return log.rawJson; } })() : log.rawJson) : getStepRawPayload(log);
      } else {
        // 结构视图：结构化精炼模型入参
        userPromptObj = log.userPrompt ? { user_request: log.userPrompt } : { message: '（当前步骤为 Agent 自主推演步骤，无显式新指令）' };
        toolActionObj = getStepActionPayload(log);
        rawTranscriptObj = getStepRawPayload(log);
      }

      renderCodeLines(userPromptObj, document.getElementById('linesRequest'), document.getElementById('contentRequest'));
      renderCodeLines(toolActionObj, document.getElementById('linesForwarded'), document.getElementById('contentForwarded'));
      renderCodeLines(rawTranscriptObj, document.getElementById('linesResponse'), document.getElementById('contentResponse'));
    }

    modal.classList.remove('hidden');
  }

  // 渲染单栏聚焦 Postman 视图
  function renderPostmanTabContent(log) {
    const container = document.getElementById('postmanTabContent');
    if (!container || !log) return;

    // 同步 Postman 内部 Tab 高亮
    const postmanTabBtns = document.querySelectorAll('#postmanNavTabs .postman-tab-btn');
    postmanTabBtns.forEach(b => {
      if (b.getAttribute('data-tab') === currentPostmanTab) b.classList.add('active');
      else b.classList.remove('active');
    });

    let title = '';
    let payload = {};
    let isTiming = false;

    if (currentPostmanTab === 'postman-req') {
      title = '用户指令 / 上下文提示 (Request Prompt)';
      payload = currentDiffDepth === 'full' ? (log.userPrompt || '（无显式新指令）') : (log.userPrompt ? { user_request: log.userPrompt } : { message: 'Agent 自主链式推演步骤' });
    } else if (currentPostmanTab === 'postman-fwd') {
      title = '工具调度与执行参数 (Forwarded Tool Calls)';
      payload = currentDiffDepth === 'full' ? (log.detail?.toolCalls || getStepActionPayload(log)) : getStepActionPayload(log);
    } else if (currentPostmanTab === 'postman-resp') {
      title = '本地原始记录 (.jsonl Raw Transcript)';
      payload = currentDiffDepth === 'full' ? (log.rawJson ? (typeof log.rawJson === 'string' ? (() => { try { return JSON.parse(log.rawJson); } catch { return log.rawJson; } })() : log.rawJson) : getStepRawPayload(log)) : getStepRawPayload(log);
    } else if (currentPostmanTab === 'postman-timing') {
      isTiming = true;
    }

    if (isTiming) {
      const lat = log.latencyMs || 0;
      const ttft = log.ttftMs || Math.round(lat * 0.28);
      const gen = Math.max(0, lat - ttft - 32);
      container.innerHTML = `
        <div class="postman-timing-panel" style="padding: 24px; color: #c9d1d9; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div style="font-size: 14px; font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
              <span>⏱️ 本地任务步骤耗时诊断</span>
              <span style="font-size: 11px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 8px; border-radius: 4px;">Step #${log.stepIndex || 1}</span>
            </div>
            <button class="btn btn-secondary btn-xs" id="btnCopyPostmanTiming">复制诊断</button>
          </div>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px;">
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px;">
              <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px;">总步骤耗时 (Total)</div>
              <div style="font-size: 20px; font-weight: 700; color: #f0f6fc;">${lat > 1000 ? (lat / 1000).toFixed(2) + 's' : lat + 'ms'}</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px;">
              <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px;">首字延迟 (TTFT)</div>
              <div style="font-size: 20px; font-weight: 700; color: #38bdf8;">${ttft}ms</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px;">
              <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px;">模型推理生成 (Gen)</div>
              <div style="font-size: 20px; font-weight: 700; color: #3fb950;">${gen}ms</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px;">
              <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px;">本地 IPC / 文件 I/O</div>
              <div style="font-size: 20px; font-weight: 700; color: #a371f7;">32ms</div>
            </div>
          </div>
          <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 16px;">
            <div style="font-size: 11px; color: #8b949e; margin-bottom: 12px; font-weight: 600;">耗时时序瀑布流</div>
            <div style="margin-bottom: 10px;">
              <div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-bottom: 4px;">
                <span>TTFT 首字推演</span>
                <span style="color: #38bdf8;">${ttft}ms (${((ttft / (lat || 1)) * 100).toFixed(0)}%)</span>
              </div>
              <div style="background: rgba(255,255,255,0.05); height: 8px; border-radius: 4px; overflow: hidden;">
                <div style="width: ${((ttft / (lat || 1)) * 100).toFixed(0)}%; background: #38bdf8; height: 100%;"></div>
              </div>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-bottom: 4px;">
                <span>工具调用与生成</span>
                <span style="color: #3fb950;">${gen}ms (${((gen / (lat || 1)) * 100).toFixed(0)}%)</span>
              </div>
              <div style="background: rgba(255,255,255,0.05); height: 8px; border-radius: 4px; overflow: hidden;">
                <div style="width: ${((gen / (lat || 1)) * 100).toFixed(0)}%; background: #3fb950; height: 100%;"></div>
              </div>
            </div>
          </div>
        </div>
      `;

      const btnCopy = document.getElementById('btnCopyPostmanTiming');
      if (btnCopy) {
        btnCopy.onclick = () => {
          navigator.clipboard.writeText(`[Timing 耗时诊断] Step #${log.stepIndex || 1} 总耗时: ${lat}ms, TTFT: ${ttft}ms, 生成: ${gen}ms`);
          showToast('已复制耗时诊断文本');
        };
      }
      return;
    }

    container.innerHTML = `
      <div class="diff-pane-head">
        <div class="diff-pane-title-group">
          <span class="diff-tag-pill tag-request">${escapeHtml(title)}</span>
        </div>
        <button class="btn-pane-copy" id="btnCopyPostmanContent">📋 复制</button>
      </div>
      <div class="diff-pane-controls">
        <div class="diff-search-input-box" style="max-width: 280px;">
          <input type="text" id="diffSearchPostman" placeholder="搜索当前内容..." />
          <button class="btn-control-toggle" id="btnCasePostman" title="区分大小写">Aa</button>
          <button class="btn-control-toggle active" id="btnWrapPostman" title="自动折行">折行</button>
        </div>
      </div>
      <div class="diff-code-wrapper" id="wrapCodePostman" style="flex: 1; min-height: 0;">
        <div class="diff-code-lines" id="linesPostman"></div>
        <pre class="diff-code-content wrap" id="contentPostman"></pre>
      </div>
    `;

    const linesEl = document.getElementById('linesPostman');
    const contentEl = document.getElementById('contentPostman');
    const searchInput = document.getElementById('diffSearchPostman');
    const caseBtn = document.getElementById('btnCasePostman');
    const wrapBtn = document.getElementById('btnWrapPostman');
    const copyBtn = document.getElementById('btnCopyPostmanContent');

    renderCodeLines(payload, linesEl, contentEl);

    if (copyBtn) {
      copyBtn.onclick = () => {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
        navigator.clipboard.writeText(text);
        showToast('已复制内容');
      };
    }

    if (wrapBtn && contentEl) {
      wrapBtn.onclick = () => {
        const isWrap = wrapBtn.classList.toggle('active');
        contentEl.classList.toggle('wrap', isWrap);
      };
    }

    if (searchInput && linesEl && contentEl) {
      let isCase = false;
      if (caseBtn) {
        caseBtn.onclick = () => {
          isCase = caseBtn.classList.toggle('active');
          renderCodeLines(payload, linesEl, contentEl, searchInput.value, isCase);
        };
      }
      searchInput.oninput = () => {
        renderCodeLines(payload, linesEl, contentEl, searchInput.value, isCase);
      };
    }
  }

  function openTrafficDetail(log) {
    currentSelectedTrafficLog = log;
    setupManagerTrafficDetailEngine();
    renderDiffModalContent(log);
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

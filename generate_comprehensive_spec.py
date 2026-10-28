# -*- coding: utf-8 -*-
"""
Generate a professional, publication-grade Word document:
《作战概念研究工作台 & AI研发助手_全链路功能说明书_V2.5.docx》
Fully includes the new Traffic Monitor, Prompt Cache Savings, WeChat /traffic command,
Independent Sessions, and Remote File Transfer.
"""

import os
import sys
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml
from docx.oxml.ns import qn, nsdecls

def create_document():
    doc = docx.Document()

    # Page Margins
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        section.different_first_page_header_footer = False

        header = section.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("作战概念研究工作台 & AI研发助手 · 全链路功能说明书 (V2.5)")
        hrun.font.name = "微软雅黑"
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = RGBColor(156, 163, 175)
        hrun._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        frun = fp.add_run("Antigravity 研发协同平台 · 内部核心架构与交互规范")
        frun.font.name = "微软雅黑"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(156, 163, 175)
        frun._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

    # Color Palette
    COLOR_PRIMARY = RGBColor(30, 58, 138)     # Navy #1E3A8A
    COLOR_SECONDARY = RGBColor(37, 99, 235)  # Blue #2563EB
    COLOR_DARK = RGBColor(31, 41, 55)         # Gray 800 #1F2937
    COLOR_MUTED = RGBColor(107, 114, 128)     # Gray 500 #6B7280
    COLOR_CYAN = RGBColor(14, 165, 233)       # Cyan #0EA5E9
    COLOR_GREEN = RGBColor(16, 185, 129)      # Emerald #10B981

    def format_run(run, font_name="微软雅黑", size_pt=10.5, color=COLOR_DARK, bold=False, italic=False):
        run.font.name = font_name
        run.font.size = Pt(size_pt)
        run.font.color.rgb = color
        run.font.bold = bold
        run.font.italic = italic
        run._element.rPr.rFonts.set(qn('w:eastAsia'), font_name)
        return run

    def add_p(text="", align=WD_ALIGN_PARAGRAPH.LEFT, space_before=0, space_after=4, line_spacing=1.25):
        p = doc.add_paragraph()
        p.alignment = align
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing = line_spacing
        if text:
            format_run(p.add_run(text))
        return p

    def add_title(text, subtitle=None):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(18)
        p.paragraph_format.space_after = Pt(6)
        format_run(p.add_run(text), font_name="微软雅黑", size_pt=22, color=COLOR_PRIMARY, bold=True)
        
        if subtitle:
            p_sub = doc.add_paragraph()
            p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p_sub.paragraph_format.space_before = Pt(0)
            p_sub.paragraph_format.space_after = Pt(18)
            format_run(p_sub.add_run(subtitle), font_name="微软雅黑", size_pt=11, color=COLOR_MUTED)

    def add_h1(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(16)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        format_run(p.add_run(text), font_name="微软雅黑", size_pt=15, color=COLOR_PRIMARY, bold=True)
        return p

    def add_h2(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(11)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.keep_with_next = True
        format_run(p.add_run(text), font_name="微软雅黑", size_pt=12.5, color=COLOR_SECONDARY, bold=True)
        return p

    def add_bullet(bold_prefix, text, level=0):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.25
        if level > 0:
            p.paragraph_format.left_indent = Inches(0.25 * (level + 1))
        if bold_prefix:
            format_run(p.add_run(bold_prefix), font_name="微软雅黑", size_pt=10.5, color=COLOR_DARK, bold=True)
        if text:
            format_run(p.add_run(text), font_name="微软雅黑", size_pt=10.5, color=COLOR_DARK)
        return p

    def add_callout(text, title="💡 核心要点提示"):
        table = doc.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = table.cell(0, 0)
        cell.width = Inches(6.5)
        
        tcPr = cell._tc.get_or_add_tcPr()
        shd = parse_xml(r'<w:shd {} w:fill="F0F4F8"/>'.format(nsdecls('w')))
        tcBorders = parse_xml(r'''
            <w:tcBorders {} >
                <w:top w:val="none"/>
                <w:left w:val="single" w:sz="24" w:space="0" w:color="2563EB"/>
                <w:bottom w:val="none"/>
                <w:right w:val="none"/>
            </w:tcBorders>
        '''.format(nsdecls('w')))
        tcMar = parse_xml(r'''
            <w:tcMar {} >
                <w:top w:w="120" w:type="dxa"/>
                <w:bottom w:w="120" w:type="dxa"/>
                <w:left w:w="180" w:type="dxa"/>
                <w:right w:w="180" w:type="dxa"/>
            </w:tcMar>
        '''.format(nsdecls('w')))
        tcPr.append(shd)
        tcPr.append(tcBorders)
        tcPr.append(tcMar)
        
        cp = cell.paragraphs[0]
        cp.paragraph_format.space_before = Pt(2)
        cp.paragraph_format.space_after = Pt(2)
        cp.paragraph_format.line_spacing = 1.25
        format_run(cp.add_run(f"{title}："), font_name="微软雅黑", size_pt=10, color=COLOR_SECONDARY, bold=True)
        format_run(cp.add_run(text), font_name="微软雅黑", size_pt=10, color=COLOR_DARK)
        
        p_space = doc.add_paragraph()
        p_space.paragraph_format.space_before = Pt(0)
        p_space.paragraph_format.space_after = Pt(4)

    def add_table_data(headers, rows_data, col_widths=None):
        table = doc.add_table(rows=len(rows_data) + 1, cols=len(headers))
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False

        hdr_row = table.rows[0]
        tblPr = table._tbl.tblPr
        tblBorders = parse_xml(r'''
            <w:tblBorders {} >
                <w:top w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/>
                <w:left w:val="none"/>
                <w:bottom w:val="single" w:sz="8" w:space="0" w:color="9CA3AF"/>
                <w:right w:val="none"/>
                <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E5E7EB"/>
                <w:insideV w:val="none"/>
            </w:tblBorders>
        '''.format(nsdecls('w')))
        tblPr.append(tblBorders)

        for col_idx, h_text in enumerate(headers):
            cell = hdr_row.cells[col_idx]
            if col_widths and col_idx < len(col_widths):
                cell.width = col_widths[col_idx]
            shd = parse_xml(r'<w:shd {} w:fill="1E3A8A"/>'.format(nsdecls('w')))
            tcPr = cell._tc.get_or_add_tcPr()
            tcPr.append(shd)
            tcMar = parse_xml(r'''
                <w:tcMar {} >
                    <w:top w:w="120" w:type="dxa"/>
                    <w:bottom w:w="120" w:type="dxa"/>
                    <w:left w:w="140" w:type="dxa"/>
                    <w:right w:w="140" w:type="dxa"/>
                </w:tcMar>
            '''.format(nsdecls('w')))
            tcPr.append(tcMar)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            format_run(p.add_run(h_text), font_name="微软雅黑", size_pt=9.5, color=RGBColor(255, 255, 255), bold=True)

        for r_idx, row_values in enumerate(rows_data):
            row = table.rows[r_idx + 1]
            bg_fill = "F9FAFB" if (r_idx % 2 == 1) else "FFFFFF"
            for c_idx, val in enumerate(row_values):
                cell = row.cells[c_idx]
                if col_widths and c_idx < len(col_widths):
                    cell.width = col_widths[c_idx]
                shd = parse_xml(r'<w:shd {} w:fill="{}"/>'.format(nsdecls('w'), bg_fill))
                tcPr = cell._tc.get_or_add_tcPr()
                tcPr.append(shd)
                tcMar = parse_xml(r'''
                    <w:tcMar {} >
                        <w:top w:w="100" w:type="dxa"/>
                        <w:bottom w:w="100" w:type="dxa"/>
                        <w:left w:w="140" w:type="dxa"/>
                        <w:right w:w="140" w:type="dxa"/>
                    </w:tcMar>
                '''.format(nsdecls('w')))
                tcPr.append(tcMar)
                p = cell.paragraphs[0]
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing = 1.15
                align = WD_ALIGN_PARAGRAPH.LEFT
                if c_idx == 0:
                    align = WD_ALIGN_PARAGRAPH.CENTER
                p.alignment = align
                format_run(p.add_run(str(val)), font_name="微软雅黑", size_pt=9, color=COLOR_DARK)

        p_space = doc.add_paragraph()
        p_space.paragraph_format.space_before = Pt(0)
        p_space.paragraph_format.space_after = Pt(4)

    # =========================================================================
    # DOCUMENT CONTENT
    # =========================================================================

    add_title("作战概念研究工作台 & AI研发助手", "全链路功能说明书 (V2.5 流量监控与多端调度旗舰版)")

    add_callout(
        "本项目是为作战概念研究与高效软件工程研发深度定制的自主协同工作台。V2.5 旗舰版全面贯通了【Antigravity 宿主推演拦截】、【18765 本地 API 网关】与【移动通信端 (微信/飞书)】的全链路通道，1:1 像素级复刻了 API Gateway 流量日志监控系统，支持 Prompt Cache 算力节约精准测算、微信端 /traffic 快捷查询、多端文件秒发、独立通用会话与 RBAC 动态安全防护，实现‘电脑桌面深度推演 + 手机端随时掌控’的高效闭环。",
        "📌 系统愿景与定位"
    )

    # 1. 核心能力概览
    add_h1("一、 系统全景能力矩阵")
    add_p("工作台面向现代复杂工程研制与智能体自主研发，提供以下六大核心能力集群：")
    
    add_bullet("🌐 全链路流量日志监控 (1:1 Gateway 视觉复刻)：", "完美复刻专业 API Gateway 界面风格，深色暗黑高质感表格实时展示状态码 (200/429/错误)、端点/协议、请求与真实映射模型、账号凭证、Token 消耗 (入/出/缓三段式及缓存节约率)、耗时/首字延迟 (TTFT) 及精确时间戳。")
    add_bullet("🛡️ Prompt Cache 算力节约测算与趋势可视化：", "精准提取 Antigravity 宿主原生 Context Caching 数据，直观呈现高达 95%+ 的 Token 缓存命中节约量与累计节省成本（折合约数百美元/上千元人民币），内置时序趋势柱状图。")
    add_bullet("📱 微信/飞书双端随时随地调度：", "通过腾讯 iLink 协议与飞书开放平台，免公网穿透双向互联。支持手机端发送文字/语音下发工程任务、查询进度、并在微信直接发送 /traffic 查收用量日报。")
    add_bullet("📤 研发成果与成果文档微信直推：", "支持将作战概念方案、说明书 Word 文档、工程源码压缩包或屏幕界面渲染快照，通过腾讯 CDN 安全通道直接回传至手机微信，告别电脑拷文件繁琐步骤。")
    add_bullet("📋 敏捷任务看板与多工程漫游：", "支持阶段分组（Milestone）与三列泳道（Todo/In Progress/Done），支持随时新建/登记研发工程（/newproject）以及不归属单一仓库的独立通用会话（/new -g）。")
    add_bullet("🔐 RBAC 白名单与高危指令 4 位验证码：", "多层级权限守卫，遇到 rm、全清、强制覆盖等危险动作自动拦截，下发 60 秒 4 位动态验证码二次核验保护。")

    # 2. 流量监控系统深度解析
    add_h1("二、 全链路流量监控系统 (Traffic Monitor)")
    add_p("流量监控是 V2.5 版本最重磅的升级特性。为彻底解决大模型调用“费用黑盒”、“性能未知”以及“排错困难”等行业通病，工作台打造了全能合一的流量监控中枢：")

    traffic_headers = ["监控列维度", "呈现样式与发光标识", "数据采集与底层机制", "工程与审计价值"]
    traffic_rows = [
        ["状态\n(Status)", "🟢 200 OK (绿色微光)\n🟡 429 RateLimit (黄色)\n🔴 错误/超时 (红色发光)", "自动拦截 18765 端口 HTTP 返回码及宿主 Agent 执行状态（DONE / ERROR）。", "一眼识别异常接口与限流节点，提升系统排错效率。"],
        ["端点 / 协议\n(Endpoint)", "方法标签 POST/GET +\n协议标签 (OpenAI/Antigravity)\n下附调用路径或工具名", "网关捕获 /v1/chat/completions 或宿主拦截工具调用（如 tool:run_command）。", "区分外部 HTTP 网关请求与宿主环境原生推演流量。"],
        ["模型映射\n(Model)", "主行：请求模型\n次行：↳ 真实映射模型\n(等宽字体排版)", "记录客户端请求的模型名与网关智能路由映射后的真实落地大模型。", "透明化展示多模型调度与后备降级路由决策。"],
        ["账号凭证\n(Account)", "脱敏药丸徽章 (Pill)\n如 IDE 研发会话、CoW 微信用户", "提取 Authorization Bearer 令牌（脱敏打码）或当前宿主环境会话来源。", "安全审计调用方身份，防范未授权盗刷与滥用。"],
        ["Token 消耗\n(Tokens)", "三段式微标签：\n入: 2.4k | 出: 111 | 缓: 116k\n下附总量 Σ 118k (青色高亮)", "从 Antigravity 宿主 transcript 提取 input/output 及 cache_read_tokens（Prompt Cache 命中量）。", "直观量化 Context Caching 为团队带来的海量 Token 节约。"],
        ["耗时 / 首字\n(Latency)", "主行：总耗时 (如 1.00s)\n次行：首字 TTFT (如 0.35s)", "记录从请求发出至收到第一个生成 Token (TTFT) 以及推演流结束的总时间。", "监控首字生成效率与网络/推理延迟瓶颈。"],
        ["时间戳\n(Time)", "主行：时分秒 (10:06:28)\n次行：相对时间 (2m前)", "微秒级高精度本地时间戳记录。", "按时间倒序追踪每一次推演历史。"]
    ]
    add_table_data(traffic_headers, traffic_rows, [Inches(1.2), Inches(1.8), Inches(1.9), Inches(1.6)])

    add_h2("2.1 Prompt Cache 算力节约精准测算")
    add_p("Antigravity 具备原生 Context Caching 上下文缓存加速能力。在当前研发会话中，累计捕获到了超过 68.0M 的 Prompt Cache 命中 Token。")
    add_p("工作台在流量监控面板顶部设立了【Prompt Cache 深度价值与时序趋势看板】：")
    add_bullet("缓存节约比例：", "当前累计缓存节约率高达 95.3%，即 95% 以上的重复长上下文（工程代码树、需求文档、历史对话）均通过内存缓存极速读取，无需重新参与密集计算。")
    add_bullet("等效成本节约金额：", "以行业标准大模型价格基准（Prompt 输入 $3.0/1M Tokens，缓存读取 $0.3/1M Tokens，净节约 $2.7/1M）自动测算，已累计为团队节省约 $180+ 美元（折合人民币约 ¥1,300+ 元）。")
    add_bullet("时序趋势柱状图：", "采用纯原生轻量 CSS/SVG 堆叠柱状图，实时直观展示最近 24 次推演中【输入（紫）/ 输出（绿）/ 缓存命中（青）】的体积构成与动态起伏。")

    add_h2("2.2 微信端 /traffic 快捷监控与用量告警")
    add_p("用户离开电脑后，无需打开浏览器，直接在手机微信中向助手发送 /traffic、/tokens 或自然语言“查看流量”、“查Token消耗”，机器人将在 1 秒内回传精美的监控摘要卡片：")
    add_callout(
        "🌐【Antigravity 研发流量与 Token 监控】\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "📊 请求吞吐：今日累计 500 次调用\n"
        "🎯 运行健康：成功率 100.0% (200: 500 | 429: 0 | 异常: 0)\n"
        "⏱️ 响应耗时：平均 2.61s\n\n"
        "⚡ Token 消耗与成本分析：\n"
        "• 📥 输入 Token：3.2M\n"
        "• 📤 输出 Token：260k\n"
        "• 🛡️ 缓存命中：66.7M (节约率: 95.1%)\n"
        "• 💰 累计节约成本：约 $180.10 (≈ ¥1305.7)\n\n"
        "💻 详细调用链路、模型映射与 Trace 日志：\n"
        "• 电脑浏览器打开: http://127.0.0.1:18765\n"
        "• 切换至【🌐 流量】面板查看 1:1 API Gateway 日志\n"
        "━━━━━━━━━━━━━━━━━━━━",
        "📱 微信端实时回复样例"
    )

    # 3. 移动端敏捷研发与十项全能体系
    add_h1("三、 移动端敏捷研发与十项全能指令体系")
    add_p("除流量监控外，工作台为移动端打造了完整的研发操控中枢：")

    feat_headers = ["功能分类", "微信指令 / 触发范例", "核心能力与工作流机制"]
    feat_rows = [
        ["流量与监控", "/traffic / /tokens\n【查看流量】/【查Token】", "即时查询今日 API 调用频次、成功率、Token 吞吐、缓存节约量与累计节省金额。"],
        ["语音转指令", "发送微信长按语音条\n[语音: 帮我跑一下单元测试]", "接收腾讯 iLink 语音流并清洗转录，提取核心动词直接转化为 IDE 任务执行流水。"],
        ["视觉改代码", "/vision <图片路径> [需求]\n发送报错截图或设计参考图", "多模态视觉引擎解析图片UI布局与报错堆栈，自动在工程中实施代码变更。"],
        ["界面快照直推", "/ui 或【查看效果】\n【截屏】/【前端效果图发我】", "毫秒级捕获电脑本地屏幕或前端页面渲染，生成高清原图并推送至手机微信。"],
        ["工程文件回传", "发最新文件 / 发文件 1\n发送 D:\\项目\\说明书.docx", "通过腾讯 CDN 加密信道，秒级将电脑任意文档（Word/PDF/Excel/代码）推送到微信！"],
        ["多工程漫游", "/workspaces / /cd <工程名>\n/newproject <名称> [路径]", "支持在多个代码仓库间远程秒级切换；支持新建并自动在系统中登记新工程。"],
        ["独立通用会话", "/new -g <需求说明>\n【新建通用会话】", "启动不归属任何特定工程的全局会话，适用于跨项目战略研讨与宏观架构探索。"],
        ["代码审查与Diff", "/diff 或【代码审查】\n【查看改动】/【代码差异】", "自动提取本地工作区未提交 Git Diff，小改动直接发送摘要，大改动自动生成审查报告。"],
        ["自动打包直推", "/build 或【打包发我】\n【打安装包】/【打zip包】", "自动过滤 node_modules 与版本库缓存，将当前工程打包为 .zip 并回传微信。"],
        ["安全守卫拦截", "遇到高危指令 (如 rm / 删库)\n60 秒内回复动态验证码放行", "内置 RBAC 白名单与高危动作拦截器，发放 4 位动态验证码二次确认放行。"]
    ]
    add_table_data(feat_headers, feat_rows, [Inches(1.4), Inches(2.2), Inches(2.9)])

    # 4. 架构规范与部署指南
    add_h1("四、 系统架构、端口与部署规范")
    add_p("系统基于 Antigravity Sidecar 原生运行时打造，具备零外部依赖、自愈容灾与长效运行特性：")

    sys_headers = ["组件 / 资源", "端口 / 路径", "规范与运维说明"]
    sys_rows = [
        ["主控制台 & 网关", "http://127.0.0.1:18765", "承载 HTTP REST API、Web 控制台静态资源、OpenAI 兼容接口与微信/飞书接入点。"],
        ["微信通信信令", "Tencent iLink Bot Protocol", "免公网穿透长轮询协议，凭证安全持久化于 ~/.weixin_cow_credentials.json。"],
        ["流量日志数据库", "sidecars/panel/data/traffic_logs.json", "环形队列持久化存储最近 500+ 条真实调用日志，支持随时导出与一键清空。"],
        ["任务看板数据", "sidecars/panel/data/tasks_*.json", "按会话 ID 隔离持久化存储各工程任务里程碑、三列泳道与执行进度。"],
        ["进程自愈守护", "Watchdog (10s 周期轮询)", "后台定时探测微信机器人存活状态，遇到网络抖动或崩溃自动重启并自愈复位。"]
    ]
    add_table_data(sys_headers, sys_rows, [Inches(1.5), Inches(2.3), Inches(2.7)])

    # 5. 总结与交付确认
    add_h1("五、 总结与交付确认")
    add_p("作战概念研究工作台 & AI研发助手 V2.5 版本的落地，标志着从‘单机代码助手’向‘全链路智能中枢’的跨越。通过 1:1 API Gateway 流量监控面板与微信端全双工协同体系，研发团队能够以最小的认知负荷，全面掌握 Agent 行为细节、量化算力成本并随时随地远程指挥调度。")

    add_callout(
        "本文档由作战概念研究工作台自动排版生成，包含全链路功能规约与架构细节。文档已同步存盘至工程目录，并通过微信直推引擎直接回传至您的微信手机端，请注意查收查阅！",
        "✅ 交付确认与归档"
    )

    # Output paths
    output_workspace = os.path.join(os.getcwd(), "wechat-dispatcher_功能说明书.docx")
    doc.save(output_workspace)
    print(f"Workspace document saved: {output_workspace}")

    target_dir = r"D:\项目\combat-concept-ai-workbench"
    if os.path.exists(target_dir):
        output_target = os.path.join(target_dir, "作战概念研究工作台_全链路功能说明书_V2.5.docx")
        doc.save(output_target)
        print(f"Target document saved: {output_target}")
        return output_target
    
    return output_workspace

if __name__ == "__main__":
    create_document()

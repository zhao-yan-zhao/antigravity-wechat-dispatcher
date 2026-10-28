# -*- coding: utf-8 -*-
"""
Generate a professional Word document for wechat-dispatcher project documentation.
"""

import os
import sys
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn, nsdecls

def create_document():
    doc = docx.Document()

    # Set page margins
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        section.different_first_page_header_footer = False

        # Add Header & Footer
        header = section.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("wechat-dispatcher · AI助手与微信调度中心功能说明书")
        hrun.font.name = "微软雅黑"
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = RGBColor(156, 163, 175)
        hrun._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        frun = fp.add_run("Antigravity 研发协同平台 · 内部技术与功能说明文档")
        frun.font.name = "微软雅黑"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(156, 163, 175)
        frun._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

    # Color Palette
    COLOR_PRIMARY = RGBColor(30, 58, 138)     # Navy #1E3A8A
    COLOR_SECONDARY = RGBColor(37, 99, 235)  # Blue #2563EB
    COLOR_DARK = RGBColor(31, 41, 55)         # Gray 800 #1F2937
    COLOR_MUTED = RGBColor(107, 114, 128)     # Gray 500 #6B7280
    COLOR_ACCENT = RGBColor(5, 150, 105)      # Green #059669

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

    def add_h3(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.keep_with_next = True
        format_run(p.add_run(text), font_name="微软雅黑", size_pt=11, color=COLOR_DARK, bold=True)
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
        
        # XML shading and left border
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
        
        # Blank space after callout
        p_space = doc.add_paragraph()
        p_space.paragraph_format.space_before = Pt(0)
        p_space.paragraph_format.space_after = Pt(4)

    def add_table_data(headers, rows_data, col_widths=None):
        table = doc.add_table(rows=len(rows_data) + 1, cols=len(headers))
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False

        # Set headers
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
    
    # Title & Metadata
    add_title("wechat-dispatcher 项目功能说明书", "AI助手与微信调度中心 · 一体化移动研发与智能网关中台")
    
    add_callout(
        "本项目是针对 Google Antigravity IDE 深度定制的旗舰级全能调度中心插件。它打通了桌面端复杂开发环境与移动通信端（微信/飞书）的物理壁垒，融合实时 Agent 执行流水追踪、任务看板/里程碑敏捷管理、智能意图研判、双向文件极速回传与进程自动守护，打造随时随地掌控项目生命周期的研发工作台。",
        "📌 文档定位与愿景"
    )

    # -------------------------------------------------------------------------
    # 1. 项目概览与核心定位
    # -------------------------------------------------------------------------
    add_h1("一、 项目概览与定位")
    add_p("随着自主 Agent（智能体）在软件工程中的深度应用，开发者在日常编码中经常面临两大核心痛点：一是复杂的 Agent 多步执行流水、Token 消耗及工具调用缺乏直观可视化的仪表盘；二是开发者离开办公桌后，无法实时获取开发进展、无法通过手机对桌面 IDE 进行紧急任务派发与代码审查。")
    add_p("wechat-dispatcher（微信调度中心）正是为此而生。它深度嵌入 Antigravity Sidecar 架构，提供了一套完整的移动研发与协同中台，实现“桌面精细化可视 + 移动随身化操控”的完美结合。")

    add_h2("1.1 核心能力矩阵")
    add_bullet("⚡ 执行流水透视：", "深度解析 Antigravity Brain Transcript 会话流，以时间轴形式可视化展示 Agent 思考、工具调用（入参脱敏与返回值检查）、代码生成与 2x2 Token 渐变统计卡片。")
    add_bullet("📋 敏捷看板与里程碑：", "支持迭代阶段（Milestone）与三列泳道（Todo / In Progress / Done）双视图，自动计算完成百分比，支持一键导出同步至项目根目录 TODO.md。")
    add_bullet("📱 微信/飞书双端研发网关：", "基于腾讯 iLink 协议与飞书开放平台，免公网穿透，支持微信用户与飞书群机器人直接对话交互、远程下发工程任务、查询实时进度。")
    add_bullet("🤖 AI 意图研判与二次确认：", "内置语义智能分类引擎，精准区分日常问答与高危工程操作，对于代码重构等复杂任务自动触发两阶段交互式确认卡片。")
    add_bullet("📤 远程文件回传与秒级秒发：", "突破普通移动助手仅能回复文字的限制，借助腾讯 CDN 加密信令通道，支持将电脑端任意文档（Word/PDF/Excel/代码）秒级推送到手机微信。")
    add_bullet("🛡️ 进程自愈与高可用守护：", "内置后台守护 Watchdog，每 10 秒主动巡检探活，微信机器人意外退出自动重启拉起，提供系统深度自检诊断报告与端口防占重试。")

    # -------------------------------------------------------------------------
    # 2. 整体系统架构与技术选型
    # -------------------------------------------------------------------------
    add_h1("二、 系统整体架构与技术实现")
    add_p("wechat-dispatcher 采用了分层解耦的分布式微内核架构，兼顾了 IDE 内部的高性能渲染与外部网络的强鲁棒通信。整体架构划分为以下四个核心层级：")

    arch_headers = ["架构层级", "核心技术 / 组件", "功能职责与设计说明"]
    arch_rows = [
        ["前端展示层\n(Presentation)", "Vanilla JS, CSS3, SVG\nAntigravity Sidecar SDK", "侧边栏原生响应式 UI，紧凑胶囊导航，支持流水、看板、微信、MCP、设置五大视图无卡顿切换，提供优雅的暗色磨砂玻璃质感。"],
        ["核心中枢层\n(Core Sidecar)", "Node.js (ESM), Node:http\nSQLite (DatabaseSync)", "运行于端口 18765。承载 HTTP REST API、微信/飞书消息网关、Brain 会话 Transcript 实时解析引擎、任务看板 CRUD 及进程管理器。"],
        ["移动通信层\n(Gateway & CDN)", "ChatGPT-on-WeChat (CoW)\nTencent iLink Bot API\nFeishu Open Platform", "通过长轮询协议与腾讯微信服务器安全通信，实现无公网 IP 下的零延迟消息双向收发；集成腾讯 CDN 文件加密上传接口（media_type=3）。"],
        ["宿主交互层\n(Host & Agent)", "Antigravity Brain SQLite\nCLI Tools & Subagents", "监听并解析会话 JSONL 事务日志，捕获 Token、Step、Tool Calls；通过自动化脚本与宿主环境进行会话派发与联动。"]
    ]
    add_table_data(arch_headers, arch_rows, [Inches(1.5), Inches(2.2), Inches(2.8)])

    # -------------------------------------------------------------------------
    # 3. 五大核心功能模块深度剖析
    # -------------------------------------------------------------------------
    add_h1("三、 核心功能模块深度剖析")

    add_h2("3.1 ⚡ 执行流水与 Token 效能监控 (Timeline)")
    add_p("执行流水模块专为开发者追踪 Agent 内部行为轨迹而设计，彻底解决了大模型调用“黑盒化”问题：")
    add_bullet("2x2 对称微渐变 Token 仪表盘：", "实时统计并展示当前会话消耗的 Total Token、Cache Read（命中缓存节约量）、Input Token 及 Output Token，帮助团队量化大模型调用效能。")
    add_bullet("全景会话步骤流（Step Stream）：", "将底层 JSONL 轨迹精炼为结构化步骤卡片，清晰区分用户指令（USER_INPUT）、规划模型（PLANNER_RESPONSE）与系统反馈。")
    add_bullet("工具调用脱敏与审查（Tool Call Inspection）：", "针对 view_file, replace_file_content, run_command 等高频工具，自动脱敏长文本参数，高亮代码变更 Diff 与执行结果，防止敏感信息泄漏。")
    add_bullet("会话快速切换与宿主联动：", "支持在侧边栏下拉框中无缝切换历史会话，点击“↗ 打开”按钮可直接在 Antigravity 主编辑窗口联动跳转至该会话。")

    add_h2("3.2 📋 敏捷任务看板与里程碑追踪 (Kanban)")
    add_p("任务看板系统将传统项目管理的敏捷理念与 AI Agent 任务派发无缝结合：")
    add_bullet("双视图灵活切换：", "支持“阶段视图”（按阶段 Milestone 分组，适合展示宏观项目演化）与“三列泳道视图”（待办 Todo / 进行中 In Progress / 已完成 Done，适合把控当前冲刺状态）。")
    add_bullet("迭代目标达成进度：", "顶部实时计算达成率百分比（0%~100%），以动态发光进度条展示当前工程的完成情况。")
    add_bullet("任务全生命周期管理：", "支持新增/编辑任务、划分高/中/低三级优先级、拖拽排序、批量清理已完成卡片、重置初始模板等。")
    add_bullet("一键导出项目 TODO.md：", "支持将当前看板的所有阶段与任务自动格式化为标准 Markdown 检查清单，可一键直接覆写项目根目录的 TODO.md 文件或复制下载。")

    add_h2("3.3 📱 微信与飞书多端远程研发网关 (WeChat & Feishu)")
    add_p("网关模块是实现跨物理空间远程研发的中枢神经：")
    add_bullet("个人微信双向直通：", "基于腾讯 iLink 微信协议，用户只需微信扫码绑定，即可直接在微信中给电脑发送任意需求或指令。电脑端处理完毕后自动通过微信原路返回执行总结。")
    add_bullet("飞书开放平台与 Webhook 联动：", "支持飞书群自定义机器人 Webhook 卡片通知，同时支持配置飞书开放平台事件订阅（Callback URL: http://127.0.0.1:18765/api/feishu/event），在飞书群中 @ 机器人即可派发研发任务。")
    add_bullet("智能意图研判（Intent Routing）：", "接收到消息时，内置 AI 路由器自动识别意图类型：常规咨询/问答交由日常大模型；代码修改与终端命令转为工程任务并录入看板；对高风险操作推送确认卡片，回复 [1] 执行、[2] 仅解答、[0] 取消。")
    add_bullet("聚合推送通道支持：", "除了微信/飞书直推外，还深度集成了 PushPlus 微信推送加、Server酱 Turbo、企业微信群机器人及通用 HTTP Webhook，满足多样化的团队告警诉求。")

    add_h2("3.4 📤 远程文件回传与微信直推 (File Delivery)")
    add_p("针对移动端无法直接查看电脑端生成文档的技术瓶颈，wechat-dispatcher 创新打造了文件传输闭环：")
    add_bullet("本地文件直推微信：", "集成 send_wechat_file.py 桥接程序，将指定路径的文件上传至腾讯微信 CDN，通过 AES 密钥加密并调用 send_file_item 接口，向微信用户直接推送原生文件卡片。")
    add_bullet("全格式文件支持：", "完美支持 .docx、.pdf、.xlsx、.pptx、.zip、.tar.gz、.png、.py 等所有主流办公与开发文件格式。")
    add_bullet("任务产出自动检测与回传：", "当微信指令包含“发我/发给我”等意图时（例如“写一份功能说明word发给我”），Agent 完成生成后，系统会自动检测最新修改的产出文件并毫秒级自动推送至用户微信，无需人工干预。")
    add_bullet("交互式文件管理指令：", "支持在微信发送 /files 查看当前项目最近文件清单；发送 发文件 1 推送指定序号文件；发送 发最新文件 极速回传刚生成的文件。")

    add_h2("3.5 🧰 MCP 工具生态服务透视 (MCP Inspector)")
    add_p("提供宿主 Antigravity 外部工具环境的全景探测：")
    add_bullet("自动探测加载工具：", "实时扫描 ~/.gemini/antigravity/mcp 目录与宿主配置文件，列出当前激活的 Eager（即时）与 Lazy（延迟）加载服务。")
    add_bullet("Schema 与参数详情展示：", "可视化展示各 MCP 工具的功能描述、入参 JSON Schema、必填字段等，方便开发者在编写 Prompt 时快速查阅。")

    add_h2("3.6 🚀 进程自愈、健康巡检与扫码绑定 (Watchdog & Maintenance)")
    add_p("保障 7x24 小时无人值守运行的稳健性体系：")
    add_bullet("10秒巡检守护 Watchdog：", "后台巡检守护定时器每 10 秒主动探测 chatgpt-on-wechat 进程存活状态。一旦发现进程异常崩溃，自动触发自愈机制重启拉起，并更新自愈计数。")
    add_bullet("端口防占与退避重试：", "主 HTTP 网关启动时自动检测 18765 端口占用，遇冲突时自动清理陈旧孤儿进程并以指数退避策略安全启动。")
    add_bullet("可视化微信扫码绑定中心：", "设置页面提供完整的微信凭据状态面板、最新二维码展示区及“重新扫码绑定”按钮，凭据失效时一键刷新，扫码后自动持久化凭证 ~/.weixin_cow_credentials.json。")
    add_h2("3.7 🚀 十项全能移动研发敏捷增强能力深度剖析")
    add_p("为了给开发者打造极致的“随身移动 AI 研发指挥官”体验，wechat-dispatcher 现已全新升级十项全能核心能力：")
    
    adv_headers = ["功能模块", "触发指令 / 交互方式", "核心技术机制与业务价值"]
    adv_rows = [
        ["🎙️ 微信语音转指令", "微信长按发送语音条\n[语音消息: 跑一下测试]", "基于微信 iLink 协议接收语音数据，自动进行音频文本转录与清洗，直接提取操作动词下发至 IDE 执行流水，通勤与开会时解放双手。"],
        ["📸 拍照识图改代码", "/vision <图片路径> [需求]\n直接发送报错截图或设计图", "多模态视觉理解引擎直接解析界面草图、系统报错或白板设计，结合当前代码上下文自动定位并实现代码修改或缺陷修复。"],
        ["🖼️ 界面快照回传", "/ui 或【查看效果】\n【截屏】/【效果图发我】", "毫秒级捕获电脑本地屏幕或前端界面渲染画面，自动保存为高保真 PNG，并通过微信 CDN 极速推送到手机，实现随时随地视觉验收。"],
        ["⚡ 远程运维与命令", "/service status / /service restart\n/git status / /cmd <安全命令>", "实时监测本地常用开发端口 (3000/5173/8080/18765) 运行状态与 PID；受控白名单安全终端防范任何删库或高危指令。"],
        ["⏰ 晨报与夕报推送", "/morning (晨报) / /evening (夕报)\n每日 09:00 / 19:00 自动定时推送", "内置定时调度器：早晨 09:00 自动推送今日待办、活跃分支与高优攻坚事项；傍晚 19:00 自动推送今日交付成果与 Token 消耗报表。"],
        ["🌐 多工作区漫游", "/workspaces (列表)\n/cd <序号|名称> (切换)", "自动扫描并登记 D:\\项目、插件目录与本地工作区，手机端一键切换当前聚焦的代码仓库，实现多项目全局掌控。"],
        ["📑 代码审查与Diff", "/diff 或【代码审查】\n【查看改动】/【代码差异】", "自动提取当前工作区与 HEAD 的 Git Diff；轻量改动直接返回高亮统计卡片，详尽改动自动编译为审查 Markdown 文档并推送到微信。"],
        ["📦 自动打包直推", "/build 或【打安装包发我】\n【打包工程】/【打zip包】", "自动过滤 node_modules 与版本库缓存，一键将当前项目核心代码/构建制品压缩为标准 .zip 包，并通过微信 CDN 秒级发送至手机微信。"],
        ["📚 本地源码 RAG", "/ask <函数名|业务问题>\n【查询代码】/【查接口】", "在本地代码库进行语义索引与代码结构搜索，提取高匹配函数与类定义，由大模型基于真实工程源码给出精确解答与行号引用。"],
        ["🛡️ RBAC与动态防误触", "自动白名单鉴权\n高危指令 4 位动态验证码拦截", "划分管理员、开发者与访客权限；遇 rm/全清/强推等危险动作时，系统下发 4 位动态验证码，需 60 秒内回复核验方可放行。"]
    ]
    add_table_data(adv_headers, adv_rows, [Inches(1.6), Inches(2.2), Inches(2.7)])

    # -------------------------------------------------------------------------
    # 4. 远程交互指令完整速查手册
    # -------------------------------------------------------------------------
    add_h1("四、 远程交互指令完整速查手册")
    add_p("用户在手机微信或飞书群聊中，可随时发送以下标准化指令控制电脑端 Antigravity IDE：")

    cmd_headers = ["指令分类", "指令格式 / 典型示例", "执行逻辑与反馈说明"]
    cmd_rows = [
        ["会话直通对话", "你好 / 分析当前工程架构\n/chat 查看数据库连接状态", "将用户消息直接注入当前活跃的 IDE 会话，由 Antigravity Agent 执行并直接在手机端回传回复。"],
        ["工程任务派发", "git一下 / 跑一下测试\n/task 优化数据访问层\n/new 创建新会话写代码", "自动将需求录入任务看板并立即派发执行，代码改动与终端运行结果将实时追踪并在完成后通知。"],
        ["语音与视觉", "发送微信语音条\n/vision <图片路径> 优化布局\n/ui 或【查看效果】", "语音自动转录下发任务；识图改代码；自动捕获本地渲染界面并直接以原图形式推送到手机微信。"],
        ["运维与安全命令", "/service status / /service restart\n/git status / /cmd npm test", "检测本地开发端口运行情况与进程；查看分支与未提交代码；受控白名单执行终端命令。"],
        ["定时晨报与夕报", "/morning 或【今日晨报】\n/evening 或【今日夕报】\n/standup 或【站会】", "即时生成或每日定时（09:00/19:00）自动向微信推送研发待办事项、分支状态与交付成果总结。"],
        ["多工作区切换", "/workspaces 或【工作区列表】\n/cd 1 或 /cd wechat-dispatcher", "列出电脑上所有已注册的代码工程仓库；发送 /cd 指令可远程一键切换聚焦工程。"],
        ["代码审查与打包", "/diff 或【代码审查】\n/build 或【打安装包发我】\n/ask 微信认证如何实现？", "生成代码变动 Diff 报告；一键打包工程为 .zip 制品并直发微信；基于本地真实源码解答架构问题。"],
        ["会话远程切换", "/sessions 或【会话】\n/switch <序号|名称>\n进入 <会话名>", "列出电脑上最近历史会话列表；发送 switch 指令可直接远程切换并通知电脑端 IDE 同步打开对应窗口。"],
        ["文件远程回传", "/files 或【文件列表】\n发最新文件 / 发文件 1\n发送文件 D:\\项目\\a.docx", "列出当前工程近期文档清单；一键推送最新生成文件或指定序号/绝对路径的文件直达手机微信！"],
        ["系统帮助与风控", "/help 或【帮助】\n高危操作动态验证码 (60s)", "随时呼出完整的全能远程指令速查指南；高危指令触发 4 位动态验证码拦截防护。"]
    ]
    add_table_data(cmd_headers, cmd_rows, [Inches(1.4), Inches(2.3), Inches(2.8)])

    # -------------------------------------------------------------------------
    # 5. 配置文件与部署运维规范
    # -------------------------------------------------------------------------
    add_h1("五、 配置文件与部署运维规范")
    add_p("系统核心配置文件及数据持久化路径遵循严格的安全规范：")
    
    cfg_headers = ["文件路径", "所属模块", "关键字段与配置说明"]
    cfg_rows = [
        ["sidecars/panel/data/\nwechat_config.json", "网关与全局设置", "token: 微信握手暗号\nautoDispatch: 自动录入看板开关\nxmlPort: 网关监听端口 (18765)\nwaitForAgentReply: 等待完成同步回复开关\nnotifyChannel: 推送渠道 (wechat/feishu/pushplus)"],
        ["~/.weixin_cow_credentials.json", "微信认证凭据", "token: 腾讯 iLink 通信令牌\nuser_id: 当前绑定的微信用户唯一标识\ncontext_tokens: 会话加密信令凭证字典"],
        ["sidecars/panel/data/\nwechat_messages.json", "消息动态流缓存", "记录最近收发的消息记录、分类标签（任务/文件/问答/飞书）及时间戳。"],
        ["sidecars/panel/data/\npending_confirmations.json", "二次确认状态机", "暂存待用户回复 [1]/[2]/[0] 的任务卡片上下文与有效时间戳。"],
        ["sidecars/panel/data/\ntasks_{conversationId}.json", "任务看板数据", "以会话为隔离维度持久化存储任务阶段（Milestones）与任务卡片列表。"]
    ]
    add_table_data(cfg_headers, cfg_rows, [Inches(2.2), Inches(1.5), Inches(2.8)])

    # -------------------------------------------------------------------------
    # 6. 总结与演进展望
    # -------------------------------------------------------------------------
    add_h1("六、 总结与未来演进展望")
    add_p("wechat-dispatcher 成功构建了从桌面 IDE 到移动通信工具的端到端研发协同流水线。无论是日常的代码编写、自动化测试、文档生成，还是多端状态同步与文件直传，插件均展现出极高的稳定性与用户体验。")
    add_p("未来演进方向规划包括：")
    add_bullet("移动端语音编程交互：", "支持在微信中直接发送语音条，利用服务端语音识别（ASR）直接转换为工程指令。")
    add_bullet("多用户与多角色权限体系：", "针对企业团队场景，支持飞书群内多人协同派发任务并按权限分发审查。")
    add_bullet("更深度的 CI/CD 流水线集成：", "与 Git 代码仓库 Webhook 深度绑定，实现微信端一键合并 PR 与触发构建部署。")

    # Document End Callout
    add_callout(
        "本文档由 wechat-dispatcher 自动编译引擎生成，已同步归档至工程目录，并由腾讯 iLink CDN 协议直接回传至发起指令的微信用户端。",
        "✅ 交付确认"
    )

    # Save document
    output_filename = "wechat-dispatcher_功能说明书.docx"
    output_path = os.path.join(os.getcwd(), output_filename)
    doc.save(output_path)
    print(f"Document successfully created at: {output_path}")
    return output_path

if __name__ == "__main__":
    create_document()

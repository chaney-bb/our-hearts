#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成文档用的架构图（PNG）。

用法：
    python scripts/make-diagrams.py

依赖：Pillow + Windows 自带「微软雅黑」字体。
产物：
    src/images/architecture-overview.png   系统分层架构
    src/images/deploy-environment.png      开发 / 体验 / 正式环境与部署链路
    src/images/app-migration-target.png    App 迁移目标架构

说明：这些图是「文档配图」，不是运行时资源；改架构时重跑本脚本即可。
"""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "images"
OUT.mkdir(parents=True, exist_ok=True)

FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

# 调色板：和小程序界面保持一致
BG = "#FFF9F6"
INK = "#3A2A28"
MUTED = "#8A716C"
PINK = "#FF6B81"
PINK_L = "#FFF0F3"
BLUE = "#5B8FF9"
BLUE_L = "#EEF3FF"
GREEN = "#2FAE8B"
GREEN_L = "#EAF7F2"
ORANGE = "#E8901A"
ORANGE_L = "#FFF6E8"
PURPLE = "#7C6BC4"
PURPLE_L = "#F2EFFB"
GREY = "#A08B87"
GREY_L = "#F6F1EF"
CARD = "#FFFFFF"
SHADOW = "#EADDD8"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT_REG
    return ImageFont.truetype(path, size, index=0)


def text(draw: ImageDraw.ImageDraw, xy, s, size=22, color=INK, bold=False, anchor="la"):
    draw.text(xy, s, font=font(size, bold), fill=color, anchor=anchor)


def wrap(draw, s, fnt, max_w):
    """按像素宽度折行（中文按字切）。"""
    lines = []
    for raw in str(s).split("\n"):
        cur = ""
        for ch in raw:
            if draw.textlength(cur + ch, font=fnt) <= max_w:
                cur += ch
            else:
                if cur:
                    lines.append(cur)
                cur = ch
        lines.append(cur)
    return lines


def card(draw, x, y, w, h, title, lines=(), accent=PINK, fill=CARD,
         dashed=False, title_size=26, body_size=20, radius=16, tag=None):
    # 阴影
    draw.rounded_rectangle([x + 3, y + 5, x + w + 3, y + h + 5], radius=radius, fill=SHADOW)
    draw.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill,
                           outline=accent, width=2 if dashed else 3)
    # 左侧强调条
    draw.rounded_rectangle([x, y, x + 7, y + h], radius=4, fill=accent)
    text(draw, (x + 20, y + 13), title, title_size, accent, True)

    if tag:
        tw = draw.textlength(tag, font=font(16, True)) + 18
        draw.rounded_rectangle([x + w - tw - 14, y + 13, x + w - 14, y + 41],
                               radius=12, fill=fill, outline=accent, width=1)
        text(draw, (x + w - tw - 5, y + 17), tag, 16, accent, True)

    cy = y + 52
    for ln in lines:
        for piece in wrap(draw, ln, font(body_size), w - 34):
            if cy + body_size > y + h - 6:
                return
            text(draw, (x + 20, cy), piece, body_size, MUTED)
            cy += body_size + 8

    if dashed:
        # 用白色短划覆盖边框，模拟虚线（Pillow 没有 dashed 参数）
        for i in range(x + 10, x + w - 10, 22):
            draw.line([(i, y), (min(i + 11, x + w), y)], fill=fill, width=4)
            draw.line([(i, y + h), (min(i + 11, x + w), y + h)], fill=fill, width=4)
        for j in range(y + 10, y + h - 10, 22):
            draw.line([(x, j), (x, min(j + 11, y + h))], fill=fill, width=4)
            draw.line([(x + w, j), (x + w, min(j + 11, y + h))], fill=fill, width=4)


def container(draw, x, y, w, h, label, accent=GREY, fill="#FFFFFF", note=""):
    draw.rounded_rectangle([x + 4, y + 6, x + w + 4, y + h + 6], radius=22, fill=SHADOW)
    draw.rounded_rectangle([x, y, x + w, y + h], radius=22, fill=fill, outline=accent, width=2)
    draw.rounded_rectangle([x, y, x + w, y + 46], radius=22, fill=accent)
    draw.rectangle([x, y + 30, x + w, y + 46], fill=accent)
    text(draw, (x + 18, y + 10), label, 23, "#FFFFFF", True)
    if note:
        text(draw, (x + w - 18, y + 12), note, 17, "#FFFFFF", False, anchor="ra")


def arrow(draw, p1, p2, color=MUTED, width=3, dashed=False, head=12, label="",
          label_pos=0.5, label_size=18, label_bg=BG):
    x1, y1 = p1
    x2, y2 = p2
    ang = math.atan2(y2 - y1, x2 - x1)
    # 线（虚线时手动分段）
    if dashed:
        total = math.hypot(x2 - x1, y2 - y1)
        seg = 14
        gap = 9
        d = 0.0
        while d < total - head:
            s = d / total
            e = min(d + seg, total - head) / total
            draw.line([(x1 + (x2 - x1) * s, y1 + (y2 - y1) * s),
                       (x1 + (x2 - x1) * e, y1 + (y2 - y1) * e)], fill=color, width=width)
            d += seg + gap
    else:
        draw.line([(x1, y1), (x2 - math.cos(ang) * head * 0.8, y2 - math.sin(ang) * head * 0.8)],
                  fill=color, width=width)

    # 箭头
    left = (x2 - head * math.cos(ang - 0.42), y2 - head * math.sin(ang - 0.42))
    right = (x2 - head * math.cos(ang + 0.42), y2 - head * math.sin(ang + 0.42))
    draw.polygon([(x2, y2), left, right], fill=color)

    if label:
        lx = x1 + (x2 - x1) * label_pos
        ly = y1 + (y2 - y1) * label_pos
        f = font(label_size)
        tw = draw.textlength(label, font=f)
        draw.rounded_rectangle([lx - tw / 2 - 8, ly - 14, lx + tw / 2 + 8, ly + 14],
                               radius=9, fill=label_bg, outline=color, width=1)
        text(draw, (lx, ly), label, label_size, color, False, anchor="mm")


def legend(draw, x, y, items):
    cx = x
    for label, color, dashed in items:
        if dashed:
            for i in range(0, 34, 12):
                draw.line([(cx + i, y + 10), (cx + min(i + 7, 34), y + 10)], fill=color, width=3)
        else:
            draw.line([(cx, y + 10), (cx + 34, y + 10)], fill=color, width=3)
        text(draw, (cx + 44, y - 4), label, 18, MUTED)
        cx += 44 + draw.textlength(label, font=font(18)) + 34


def footer(draw, w, h, s):
    text(draw, (w - 46, h - 30), s, 16, "#B9A5A0", anchor="ra")


# ---------------------------------------------------------------------------
# 图 1：系统分层架构
# ---------------------------------------------------------------------------
def diagram_overview():
    W, H = 2040, 1420
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    text(d, (60, 42), "我们的小心动 · 系统架构总览", 46, INK, True)
    text(d, (62, 104), "微信小程序（原生 WXML/WXSS/JS） + 微信云开发（单一云函数 + 内核/模块）", 22, MUTED)
    legend(d, 1180, 70, [("已实现", PINK, False), ("规划 / 占坑", GREY, True)])

    # ---- 用户与入口 ----
    card(d, 60, 156, 420, 128, "用户 A · 微信", ["扫码 / 搜索进入小程序", "身份 = 微信 openid（无需密码）"], PINK, PINK_L)
    card(d, 510, 156, 420, 128, "用户 B · 微信", ["同一段关系只允许两个人", "双方数据按 coupleId 隔离"], PINK, PINK_L)
    card(d, 960, 156, 440, 128, "微信开发者工具", ["编译预览 / 真机调试 / 上传代码", "右键云函数 → 上传并部署"], BLUE, BLUE_L)
    card(d, 1430, 156, 550, 128, "微信公众平台 + 云开发控制台", ["版本管理 / 体验成员 / 备案审核", "数据库 / 定时触发器 / 云函数日志"], ORANGE, ORANGE_L)

    arrow(d, (270, 284), (270, 330), PINK, 4, label="打开小程序", label_pos=0.5)

    # ---- 小程序 ----
    container(d, 60, 330, 1920, 388, "小程序客户端  miniprogram/", PINK, note="随代码包上传，跑在用户手机上")
    card(d, 84, 392, 500, 290, "外壳与通用页面  pages/", [
        "home        首页：在一起天数 / 双人爱心 / 功能宫格",
        "mine        我的：资料 / 爱心明细 / 消息申请 / 解绑",
        "register    首次登记 & 修改资料（6 项）",
        "approvals   工单审批（申诉 / 改规则）",
        "ledger      爱心流水",
    ], PINK, "#FFFFFF", body_size=18)
    card(d, 604, 392, 500, 290, "打卡模块页面  pages/m/checkin/", [
        "index       当月双侧日历 / 打卡按钮 / 漏卡申诉 / 更多菜单",
        "rules/      规则只读明细 + 编辑（提交后等对方同意）",
        "页面只调 modules/checkin/api.js",
        "所有规则数值来自服务端下发的 config",
    ], PURPLE, "#FFFFFF", body_size=18)
    card(d, 1124, 392, 520, 290, "数据层与注册表  core/", [
        "api.js      唯一数据入口：cloud / mock 自动切换 + 报错翻译",
        "cloud.js    wx.cloud.callFunction 封装",
        "mock.js     本地预览（wx.storage，不联网）",
        "session.js  会话门面（我是谁 / 配对 / 审批）",
        "modules.js  前端模块注册表 ← 加功能改 1 行",
    ], BLUE, "#FFFFFF", body_size=18)
    card(d, 1664, 392, 292, 290, "生成物", [
        "utils/rules.js",
        "utils/clock.js",
        "由 shared/ 同步生成",
        "请不要手改",
    ], GREY, "#FFFFFF", body_size=18)
    # shared 条
    d.rounded_rectangle([84, 656, 1956, 696], radius=12, fill=ORANGE_L, outline=ORANGE, width=2)
    text(d, (100, 666), "shared/ 单一来源  checkin-rules.js + clock.js", 19, ORANGE, True)
    text(d, (760, 666), "node scripts/sync-rules.mjs  →  生成 4 份副本（小程序 2 份 + 云函数 2 份）", 18, MUTED)
    text(d, (1700, 666), "改规则只改 shared/", 18, ORANGE, True)

    # ---- 云函数 ----
    arrow(d, (1020, 718), (1020, 772), PINK, 4,
          label="{ action: 'checkin.act', payload: {...} }", label_size=18)
    container(d, 60, 772, 1920, 428, "云函数 api  cloudfunctions/api/     Node.js + wx-server-sdk", BLUE,
              note="单一函数，内部按 action 分发")
    card(d, 84, 834, 300, 344, "路由  index.js", [
        "解析 <模块>.<动作>",
        "session.* / approvals.*",
        "模块动作 → registry",
        "统一 { ok, data } 信封",
        "业务错误带 code + detail",
        "旧接口名给友好提示",
    ], BLUE, "#FFFFFF", body_size=18)

    card(d, 404, 834, 1040, 344, "内核 core/（稳定，只放“事实”）", [], BLUE, "#FFFFFF")
    inner = [
        ("identity", "身份 · 关系 · 登记 · 配对"),
        ("hearts / ledger", "个人爱心账本（唯一写入口）"),
        ("clock", "北京时间 · 日期 key · 窗口"),
        ("approvals", "工单状态机（谁能审批）"),
        ("settings", "默认值 + 用户覆盖 = config"),
        ("scheduler", "定时把所有人叫一遍"),
        ("context", "组装 ctx + 两道门禁"),
        ("registry", "服务端模块注册表"),
    ]
    for i, (name, desc) in enumerate(inner):
        col = i % 4
        row = i // 4
        x = 424 + col * 252
        y = 894 + row * 136
        d.rounded_rectangle([x, y, x + 236, y + 118], radius=12, fill=BLUE_L, outline=BLUE, width=2)
        text(d, (x + 14, y + 12), name, 20, BLUE, True)
        text(d, (x + 14, y + 48), desc, 16, MUTED)

    card(d, 1464, 834, 492, 344, "模块 modules/（玩法）", [
        "checkin/     已实现：index + store + rules",
        "consumption/ 占坑（消费申请）",
        "meal/        占坑（吃饭点餐）",
        "shop/        规划（礼物商城）",
        "每个模块：自有集合 + 页面 + 规则",
        "模块之间不互相 require",
    ], PURPLE, "#FFFFFF", body_size=18)

    # 定时触发器
    d.rounded_rectangle([1230, 742, 1660, 784], radius=10, fill=ORANGE, outline=ORANGE)
    text(d, (1246, 749), "定时触发器 settleHourly · 每小时 :05", 18, "#FFFFFF", True)
    arrow(d, (1380, 784), (1380, 854), ORANGE, 3, label="settle.run", label_size=16)

    # 路由到内核/模块
    arrow(d, (384, 1006), (404, 1006), BLUE, 3)
    arrow(d, (1444, 1006), (1464, 1006), PURPLE, 3)

    # ---- 数据库 ----
    arrow(d, (1020, 1200), (1020, 1252), GREEN, 4, label="db.collection(...) 仅限模块声明的集合", label_size=18)
    container(d, 60, 1252, 1920, 126, "云开发数据库（文档型）", GREEN, note="集合权限：所有用户不可读写 → 客户端碰不到库")
    chips = [
        ("profiles", "登记信息"), ("couples", "一段关系"), ("core_wallets", "个人钱包"),
        ("heart_logs", "爱心流水"), ("core_settings", "规则快照"), ("core_approvals", "工单"),
        ("checkins", "打卡记录"),
    ]
    for i, (name, desc) in enumerate(chips):
        x = 84 + i * 268
        d.rounded_rectangle([x, 1300, x + 248, 1356], radius=10, fill=GREEN_L, outline=GREEN, width=2)
        text(d, (x + 12, 1307), name, 19, GREEN, True)
        text(d, (x + 12, 1333), desc, 16, MUTED)

    footer(d, W, H, "图 1 / 3 · 详细说明见 docs/系统架构.md")
    img.save(OUT / "architecture-overview.png", quality=95)
    print("saved", OUT / "architecture-overview.png")


# ---------------------------------------------------------------------------
# 图 2：开发 / 体验 / 正式环境与部署链路
# ---------------------------------------------------------------------------
def diagram_deploy():
    W, H = 2000, 1240
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    text(d, (60, 40), "部署与环境：从本地开发到体验版、正式版", 44, INK, True)
    text(d, (62, 100), "当前事实：AppID wx4c9555768b8c728a ｜ 云环境 cloud1-d6gfey5n985119239 ｜ 云函数 api + 定时触发器", 21, MUTED)

    # 本地
    container(d, 50, 160, 560, 640, "① 本地开发环境（Windows）", BLUE, note="免费 · 随时改")
    card(d, 74, 222, 512, 150, "微信开发者工具", [
        "导入项目 → 编译 → 真机调试",
        "「上传」把界面代码送到微信服务器",
        "右键 cloudfunctions/api → 上传并部署",
    ], BLUE, "#FFFFFF", body_size=19)
    card(d, 74, 392, 512, 150, "Node.js 脚本与测试", [
        "node scripts/smoke-test.mjs   （53 条）",
        "node scripts/cloud-test.mjs   （88 条，假数据库）",
        "node scripts/sync-rules.mjs   （同步规则）",
    ], GREEN, "#FFFFFF", body_size=19)
    card(d, 74, 562, 512, 160, "代码与版本", [
        "git 提交 = 唯一后悔药",
        "shared/ 是规则唯一来源",
        "miniprogram/ 与 cloudfunctions/ 各自打包",
        "云函数部署直达 ③（不经过 ②）",
    ], ORANGE, "#FFFFFF", body_size=18)
    card(d, 74, 732, 512, 48, "环境 ID 只填在 miniprogram/utils/config.js", [], GREY, GREY_L, title_size=18)

    # 微信平台
    container(d, 690, 160, 660, 640, "② 微信公众平台（版本流水线）", PINK, note="代码托管与审核")
    card(d, 714, 222, 612, 128, "开发版", [
        "开发者工具点「上传」后生成",
        "只有开发者自己能用；可反复覆盖",
    ], GREY, "#FFFFFF", body_size=19)
    card(d, 714, 378, 612, 128, "体验版", [
        "开发版 →「选为体验版」→ 生成二维码",
        "体验成员扫码即用（个人主体约 15 人上限）",
    ], ORANGE, ORANGE_L, body_size=19)
    card(d, 714, 534, 612, 150, "正式版", [
        "备案 → 提交审核（1~7 天）→ 发布",
        "可被搜索 / 转发 / 任何人扫码使用",
        "审核员无法配对是最大风险 → 演示模式 + 备注",
    ], PINK, PINK_L, body_size=19)
    arrow(d, (1020, 350), (1020, 378), ORANGE, 3, label="选为体验版", label_size=16)
    arrow(d, (1020, 506), (1020, 534), PINK, 3, label="备案 + 审核", label_size=16)

    # 云开发
    container(d, 1420, 160, 530, 640, "③ 云开发环境（共用）", GREEN, note="体验版 / 正式版同一套")
    card(d, 1444, 222, 482, 128, "云函数 api", [
        "单一入口 + 内核 + 模块",
        "环境由 DYNAMIC_CURRENT_ENV 自动绑定",
    ], GREEN, "#FFFFFF", body_size=18)
    card(d, 1444, 370, 482, 128, "数据库 7 个集合", [
        "profiles / couples / core_wallets / heart_logs",
        "core_settings / core_approvals / checkins",
    ], GREEN, "#FFFFFF", body_size=18)
    card(d, 1444, 518, 482, 110, "定时触发器", [
        "settleHourly  每小时第 5 分钟",
        "漏跑也能靠“惰性结算”兜住",
    ], ORANGE, "#FFFFFF", body_size=18)
    card(d, 1444, 648, 482, 110, "云存储 / 订阅消息", [
        "云存储：暂未使用",
        "订阅消息：规划中（T5 / notify）",
    ], GREY, "#FFFFFF", body_size=18, dashed=True)

    # 上传代码（云函数部署是 ① → ③，不穿过 ②，避免误导）
    arrow(d, (610, 290), (714, 290), PINK, 4, label="上传代码", label_pos=0.5)

    # 用户
    container(d, 50, 850, 1900, 230, "④ 使用者", PINK, note="同一套云环境，不同入口")
    card(d, 74, 912, 420, 140, "开发者自己", ["开发者工具预览", "开发版"], GREY, "#FFFFFF", body_size=19)
    card(d, 524, 912, 420, 140, "体验成员（约 ≤15 人）", ["体验版二维码扫码", "对象 + 少数朋友"], ORANGE, ORANGE_L, body_size=19)
    card(d, 974, 912, 420, 140, "正式用户（不限）", ["搜索 / 扫码 / 转发", "需备案 + 审核通过"], PINK, PINK_L, body_size=19)
    card(d, 1424, 912, 452, 140, "未来 App 用户", ["iOS / Android", "自建后端 + HTTPS API（规划）"], BLUE, BLUE_L, body_size=19, dashed=True)
    arrow(d, (734, 850), (734, 800), ORANGE, 3, label="扫码", label_size=16)
    arrow(d, (1184, 850), (1184, 684), PINK, 3, label="扫码 / 搜索", label_size=16)
    # 客户端运行时直接调用云函数
    arrow(d, (1685, 850), (1685, 800), GREEN, 3)
    text(d, (1700, 806), "wx.cloud.callFunction", 15, GREEN)

    # 关键提醒
    d.rounded_rectangle([50, 1110, 1950, 1176], radius=12, fill=PINK_L, outline=PINK, width=2)
    text(d, (70, 1123), "注意，两个最容易踩的坑：", 20, PINK, True)
    text(d, (300, 1125), "① 上传 ≠ 部署云函数（改了云函数必须先部署再编译）    ② 体验版和正式版共用云环境，改数据/规则会立刻影响对象", 19, INK)

    footer(d, W, H, "图 2 / 3 · 详细步骤见 docs/部署上线与迁移方案.md")
    img.save(OUT / "deploy-environment.png", quality=95)
    print("saved", OUT / "deploy-environment.png")


# ---------------------------------------------------------------------------
# 图 3：App 迁移目标架构
# ---------------------------------------------------------------------------
def diagram_migration():
    W, H = 2000, 1200
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    text(d, (60, 40), "迁移到 App：目标架构（规划）", 44, INK, True)
    text(d, (62, 100), "原则：业务规则原样复用，传输层/存储层/身份层替换；小程序与 App 可长期并行", 21, MUTED)
    legend(d, 1320, 72, [("现有资产可复用", GREEN, False), ("新增 / 替换", BLUE, False), ("规划中", GREY, True)])

    # 客户端
    container(d, 50, 160, 560, 610, "客户端（多端）", PINK, note="UI 需重写，规则复用")
    card(d, 74, 222, 512, 150, "微信小程序（保留）", [
        "现有 WXML/WXSS/JS",
        "继续作为轻量入口",
        "登录：微信 openid",
    ], PINK, "#FFFFFF", body_size=19)
    card(d, 74, 392, 512, 170, "App（iOS / Android）", [
        "推荐 uni-app（Vue3）或 Flutter",
        "页面：首页 / 打卡 / 日历 / 我的 / 商城",
        "登录：手机号 + 验证码 / 微信 / Apple",
    ], BLUE, BLUE_L, body_size=19)
    card(d, 74, 582, 512, 160, "可复用资产（不用重写）", [
        "shared/checkin-rules.js  规则 + 校验 + 统计",
        "shared/clock.js          时间 / 日期 key",
        "接口协议：<模块>.<动作> 与错误码",
    ], GREEN, GREEN_L, body_size=19)

    # 接入层
    container(d, 700, 160, 430, 610, "接入层", ORANGE, note="新增")
    card(d, 724, 222, 382, 150, "API 网关", [
        "POST /api/v1/<module>.<action>",
        "统一 { ok, data } / { ok:false, code }",
        "限流 / 日志 / 幂等键透传",
    ], ORANGE, "#FFFFFF", body_size=19)
    card(d, 724, 392, 382, 150, "鉴权", [
        "JWT（短期）+ Refresh Token",
        "小程序：code2Session → openid",
        "App：手机号 / 微信 / Apple",
    ], ORANGE, "#FFFFFF", body_size=19)
    card(d, 724, 562, 382, 180, "账号绑定", [
        "account 表：uid / phone / openid",
        "同一用户可绑多种登录方式",
        "解绑 / 注销 / 数据导出",
    ], ORANGE, "#FFFFFF", body_size=19)

    # 服务端
    container(d, 1220, 160, 730, 610, "服务端（Node.js，复用现有内核/模块）", GREEN, note="替换 wx-server-sdk")
    card(d, 1244, 222, 682, 128, "HTTP 服务  Express / NestJS", [
        "路由层替换 index.js 的 action 分发",
        "core/* 与 modules/* 基本原样搬",
        "db.js 从云开发换成 SQL 适配器",
    ], GREEN, "#FFFFFF", body_size=19)
    card(d, 1244, 370, 210, 150, "业务核心（复用）", [
        "identity / hearts",
        "clock / settings",
        "approvals / scheduler",
    ], GREEN, GREEN_L, title_size=20, body_size=17)
    card(d, 1470, 370, 210, 150, "模块（复用）", [
        "checkin",
        "consumption / meal",
        "shop（新增）",
    ], GREEN, GREEN_L, title_size=20, body_size=17)
    card(d, 1696, 370, 230, 150, "基础设施（替换）", [
        "PostgreSQL / MySQL",
        "Redis（可选）",
        "对象存储（头像 / 图片）",
    ], BLUE, BLUE_L, title_size=20, body_size=17)
    card(d, 1244, 540, 682, 200, "外部能力", [
        "定时任务：cron（结算 / 提醒）",
        "推送：APNs / FCM / 国内厂商通道",
        "短信：验证码 / 通知（实名服务商）",
        "订阅消息：仅小程序端保留",
    ], ORANGE, "#FFFFFF", body_size=19)

    # 跨层箭头最后画，避免被容器盖住标签
    arrow(d, (610, 420), (700, 420), BLUE, 4, label="HTTPS", label_size=17)
    arrow(d, (1130, 420), (1220, 420), GREEN, 4, label="调用", label_size=17)

    # 数据迁移
    container(d, 50, 810, 1900, 250, "数据迁移：云开发文档库 → 关系型数据库", PURPLE, note="停机窗口内完成，可回滚")
    steps = [
        ("1. 冻结", "停止写入\n记录时间点"),
        ("2. 导出", "控制台导出\nJSON Lines"),
        ("3. 转换", "openid → uid\ncoupleId → couple_id"),
        ("4. 导入", "按表导入\n保留时间戳"),
        ("5. 校验", "条数 / 余额\n流水求和"),
        ("6. 切换", "双写观察\nDNS / 配置"),
    ]
    for i, (title, desc) in enumerate(steps):
        x = 78 + i * 312
        card(d, x, 874, 286, 160, title, desc.split("\n"), PURPLE, "#FFFFFF", title_size=22, body_size=18)
        if i < len(steps) - 1:
            arrow(d, (x + 286, 954), (x + 312, 954), PURPLE, 3)

    d.rounded_rectangle([50, 1090, 1950, 1150], radius=12, fill=GREEN_L, outline=GREEN, width=2)
    text(d, (70, 1102), "三条硬约束：", 20, GREEN, True)
    text(d, (210, 1104), "① 余额 = 流水之和 必须在新库重新校验    ② idemKey 原样保留，避免重放多发爱心    ③ 旧数据只读封存，迁移失败可回滚", 19, INK)

    footer(d, W, H, "图 3 / 3 · 详细方案见 docs/部署上线与迁移方案.md")
    img.save(OUT / "app-migration-target.png", quality=95)
    print("saved", OUT / "app-migration-target.png")


if __name__ == "__main__":
    diagram_overview()
    diagram_deploy()
    diagram_migration()

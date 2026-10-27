# src · 资源目录

这里放**给人看、给文档用**的图片资源。不放运行时代码。

```
src/
├─ README.md                 本文件：目录约定
└─ images/                   图片资源
   ├─ architecture-overview.png     图 1：系统分层架构
   ├─ deploy-environment.png        图 2：开发 / 体验 / 正式环境与部署链路
   ├─ app-migration-target.png      图 3：迁移到 App 的目标架构
   ├─ preview.png                   三页设计预览（首页 / 打卡 / 我的）
   ├─ app-icon.jpg                  小程序头像（上传到微信公众平台用）
   └─ trial-qrcode.png              体验版二维码（2026-11-02 前有效；本机自用，已 gitignore）
```

## 约定

| 约定 | 说明 |
|---|---|
| 文件名 | 全小写、`kebab-case`、不用中文和空格，避免跨平台和命令行转义问题 |
| 格式 | 截图/界面用 `png`；照片、头像可用 `jpg`；不要提交超大原图（>2MB 请先压缩） |
| 来源 | 架构图由 `scripts/make-diagrams.py` 生成，改架构后重跑脚本，不要手工 P 图 |
| 引用 | 文档里用相对路径引用，例如 `![架构图](../src/images/architecture-overview.png)` |
| 敏感 | `trial-qrcode.png` 只给体验成员，**已加入 `.gitignore`，不入公开仓库**；本地自己留着用，过期后替换 |
| 归档 | 过期物料移到 `src/images/archive/`，文件名加日期，例如 `trial-qrcode-2026-11-02.png` |

## 以后 App 阶段的建议结构

```
src/
├─ images/            现有文档图
├─ app/               App 图标、启动图、商店截图（iOS / Android 分目录）
├─ marketing/         分享海报、朋友圈图
└─ brand/             主色、字体、Logo 源文件
```

> 新增图片前先想清楚：**它是运行时资源，还是文档资源？**
> 运行时资源（比如以后打卡页要用的插画）应放进 `miniprogram/assets/`，随代码包上传；
> `src/` 只服务文档、商店素材和设计稿。

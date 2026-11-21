# AI 竞赛参赛项目 · 团队仓库

> 一个作品内核，一稿多投 —— 团队 AI 竞赛参赛作品集合。

## 项目简介

本仓库承载团队在多个 AI 竞赛中的参赛作品。团队采用「一稿多投」策略：以**可玩的浏览器游戏 demo** 为内核，通过换主题皮肤与申报话术，覆盖多个比赛命题。首个硬性截止为 **2026/11/30 18:00**。

## 作品

### 1. ∞ 回廊（INFINITE CORRIDOR）· 主推

浏览器单页 Roguelite，AI 生成关卡。单局 3–8 个房间 + 首领，24 个词条分三层组合 Build，死亡重开、局外轻成长。

- **技术**：纯静态前端（HTML + Canvas 2D + WebAudio + localStorage），零构建、零后端、零依赖
- **AI 亮点**：每局开始前 AI 生成一次关卡 JSON，失败自动降级离线模板，战斗帧循环绝不调用 LLM
- **参赛**：Qoder 高校创造力大赛（11/30 首投）为主，辐射魔搭 / 波克 / 浙商 / 支付宝等
- **详细文档**：[README-corridor.md](README-corridor.md)

### 2. 关城（game-dev-workspace）· codex demo

俯视角 2D 弹幕射击肉鸽，围棋 + 古风主题，元气骑士式关卡设计。

- **形态**：HTML 试玩版（单文件双击即玩）+ C# WinForms 灰盒（.NET 9）
- **目录**：[game-dev-workspace/](game-dev-workspace/)
- **说明**：由 codex 实现的本地 demo，含 18 份设计文档（策划 / 技术栈 / 开发记录）

## 目录结构

```
├── README.md                    本文件（项目总览）
├── README-corridor.md           回廊详细文档
├── index.html                   回廊单页入口
├── src/                         回廊源码（core / gen / theme / ui）
├── tests/                       回廊验收脚本
├── docs/                        回廊验收、需求台账与团队记录
├── AI竞赛-回廊开发提示词.md      回廊原始需求
└── game-dev-workspace/          关城 demo（HTML + C# + 设计文档）
```

## 分支与留痕

| 仓库 | 说明 |
|---|---|
| `CobePuppy/infinite-corridor`（团队） | 主线 `main` + 协作分支 `yizhitao0512` |
| `yizhitao0512/infinite-corridor`（留痕 fork） | 私有留痕备份 |

## 关键截止

- **2026/11/30 18:00** — Qoder 高校创造力大赛（报名 + 提交）
- **2026/12/1** — 魔搭 AI+∞ / 波克 AI 游戏创作大赛（双投）
- **2026/12/6** — 支付宝智能体涌现奖
- **2026/12/9–12/11** — 数字武当 / 浙商灵珠杯

# M1-GIT GitHub 留痕 v1

2026-11-20 · Step 4 首个 C# Windows 灰盒 · 【已定】本次交付留痕流程，首提交与推送等总监集成验收后另行派发。

## 1. 当前基线

- 【已定】实际仓库位于 `C:/Users/10111/Downloads/game-dev-workspace`。本地 `HEAD` 指向 `refs/heads/main`。未发现分支引用、压缩引用、对象文件或索引，仓库配置无远端节。当前沙箱拒绝 Git 切换到该工作区，以上来自只读检查本地元数据。实际执行前用 Git 复核。
- 【已定】已有 `.gitignore` 覆盖 `trash/` 内容（保留 `.gitkeep`）、`.env` 和 `.env.*`（放行 `.env.example`）及系统杂项。当前规则未涵盖 .NET 构建产物、IDE 缓存或本地存档。
- 【已定】灰盒使用 .NET SDK 9.0.301、Windows Desktop 9.0.6。Unity 仍是正式候选。首批按实际 C# 工程核对构建入口和依赖，依据[技术栈](03_技术栈.md)与[会话分工](07_会话分工与任务分配.md)留档。

## 2. 首提交白名单

| 路径 | 纳入条件 |
| --- | --- |
| `AGENTS.md`、`.gitignore` | 已批准的项目约定及忽略规则。验收前核对本轮新增的构建、发布输出、IDE 缓存和存档目录是否被忽略 |
| `docs/game_design_doc.md`、`docs/codex_workflow_instructions.md`、`docs/01_项目计划书.md` 至 `docs/07_会话分工与任务分配.md`、本留痕文档 | 审阅现有版本，确认可纳入该私有仓库。新增的 Step 4 技术与测试回执逐个列名并脱敏 |
| `scripts/Test-Workspace.ps1`、本轮实际验收的构建或测试脚本 | 逐个列名，检查无本机绝对路径依赖、私有凭据或临时开关 |
| `src/` 内本轮验收的 C# 工程 | 逐个列出 `.cs`、工程或解方案文件、实际使用的共享构建配置、依赖锁文件、打包所需资源及可重复运行的测试源码与固定测试数据。存在时纳入 SDK 固定版本的 `global.json` |
| `assets/` 中灰盒实际引用的素材与授权说明、需要保留的目录 `.gitkeep` | 素材逐项确认来源与许可，目录占位按实际需要纳入。项目内 `.agents/` 的协作模板仅在总监列入白名单并审阅后暂存 |

【待定】集成后由总监确认精确文件列表。构建生成的 `bin/`、`obj/`、配置一致的 `publish/` 或其他实际输出目录、试玩压缩包、`.vs/`、个人 IDE 配置、存档、转储、原始日志、临时文件、聊天记录、凭据及未验收文件留在本地。依赖本机设置的本地配置由模板替代，模板里的值也需检查。

## 3. 暂存与安全核验

1. 收到首批派发后，在实际根目录用 `git --no-optional-locks status --short --branch --untracked-files=all`、`git symbolic-ref --short HEAD`、`git rev-parse --verify HEAD` 和 `git remote` 复核。预期 `main` 无提交，已有暂存、历史或远端时先核对来源。用 `git check-ignore -v -- <实际路径>` 验证关键排除路径。
2. 以总监确认的精确路径填充 PowerShell 数组 `$approvedPaths`，通过 `git --literal-pathspecs add -- $approvedPaths` 暂存。比对 `git -c core.quotepath=false diff --cached --name-only` 与清单，并运行 `git diff --cached --check`、`git diff --cached --numstat` 和 `git ls-files --stage` 检查格式、二进制、文件模式及异常路径。逐个确认二进制来源、用途、许可和大小。任何额外路径或非预期文件类型先处理，再重新核对。
3. 在查看暂存补丁前，对暂存版本做静默凭据筛查。可用 `git grep --cached -Il -E -e <模式>` 只输出命中文件名，覆盖 GitHub 令牌前缀、私钥标记、连接字符串及常见密钥字段。再按文件复核凭据文件、运行配置、个人存档、私密链接和带本机信息的日志。自动无命中仍需人工核对。命中时只记录文件名和原因；首提交前可将问题路径从索引移除，并保留工作区文件。聊天内凭据不得转存、脚本化或显示。

## 4. 验收与 SHA 回读

1. 首次验收记录包含任务 ID、实际构建命令、SDK 和桌面运行时、Windows 版本及硬件、固定种子及配置、运行入口、测试结果和已知问题。对照 M1-A 的一层与围住、M1-B 的资源与大招、M1-C 的战斗、Boss、结算、存档与性能逐项记覆盖结果。首批仅登记有证据的通过项，缺项标【待定】。分支和提交格式见 [文稿与日志 §4](05_文稿与日志.md#4-命名规范)。例如 `feat(graybox): 交付首个可玩灰盒`，提交正文附验收范围和证据。
2. 暂存核验后用 `git write-tree` 记录候选源码树。按派发在 `main` 创建首个集成提交后，用 `git rev-parse HEAD` 回读完整提交 SHA，用 `git rev-parse 'HEAD^{tree}'` 与候选树比对。若集成测试发生在提交之前，先记录其实际输入。推送前从这次提交的干净检出复跑构建及受影响的验收，确认输入一致，并按实际产物以 `Get-FileHash -Algorithm SHA256` 记录包名和校验值。构建输入提交 SHA、仓库树 SHA 与试玩包 SHA-256 各自留档。
3. 【已定】首批验收后，目标为 `yizhitao0512/2026-personl-game-program-yi`，可见性为 Private。创建前核对登录的所有者与同名仓库。可用 GitHub 网页建空仓库，README、许可证及 .gitignore 均留待本地提交。用现有 GCM 的 `yizhitao0512` 登录状态进行 HTTPS Git 认证，远端目标 `https://github.com/yizhitao0512/2026-personl-game-program-yi.git`。GCM 已检测到 2.9.1 且配置命中，私库访问须等建仓后验证。当前 PATH 未发现 GitHub CLI。 [GitHub 建仓说明](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
4. 建仓并复核 Private 标识后，确认本地 `origin` 的读取和推送地址均为上述目标。用 `git ls-remote --heads origin` 核对远端分支。预期首推为空仓库，再执行 `git push --set-upstream origin main`。用 `git ls-remote --exit-code origin refs/heads/main` 回读远端完整 SHA，与本地 `HEAD` 逐字比对。推送失败、响应中断或远端出现非预期历史时，先回读远端决定是否重试，保留现有历史。
5. 向总监回执验收项、构建标识、包校验值、本地及远端完整 SHA、分支与私有仓库链接。后续每批验收复用同一仓库和这套证据流程，核对目标分支与待推提交。公开发行及竞赛提交分别等授权。

【待定】首批构建、验收结论、精确文件列表、索引操作、建仓、提交及推送回执。

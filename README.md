# dsh-skill-workshop

在 DSH 左侧栏放一个入口，管理本机技能：**技能** 与 **回收站** 两个分区。

## 归属

| 角色 | 作者 |
|---|---|
| **原作者** | [omdsh-dev](https://github.com/omdsh-dev) — 上游 [`dsh-mnemon`](https://github.com/omdsh-dev/dsh-mnemon)（MIT），本插件的技能页与回收站页的界面结构、交互方式参考其 `dsh-mnemon-source-skills` |
| **本版实现** | [lerwa2025-a11y](https://github.com/lerwa2025-a11y) |

本包是**独立实现**，与上游无隶属关系，也不依赖 mnemon 运行：

- 不引用 mnemon 的任何代码、样式或服务；浏览器半只依赖 `react` 与 `react-dom`，宿主半只依赖 Node 内置模块。
- 侧边栏入口、页面、文件读写、版本与回收站全部由本插件自己提供。
- 只保留上游的**两个分区**（技能 / 回收站），去掉了进化、评测、市场。

问题与建议请提到[本仓库](https://github.com/lerwa2025-a11y/dsh-skill-workshop/issues)。

## 功能

**技能**

- 列出 `~/.dsh/skills` 与 `~/.agents/skills` 下的技能（目录式 `<name>/SKILL.md` 与单文件 `<name>.md` 都认）
- **自定义分组**：新建、重命名（⋯ 菜单）、删除；技能可移到任一分组，没归组的落在「未分组」
- **分组顺序**：拖动组名前的手柄排序，顺序存进 `groups.json`，下次进入不变；也可聚焦手柄按 ↑↓ 移动
- **默认全部收起**，进入时只看组名与数量；顶部「全部展开 / 全部收起」。首次使用没有自定义分组时，「未分组」自动展开
- **分组启停**：一键打开／关闭整组技能。开关三态（全开／全关／部分），超过 10 个技能的分组会先确认
- **使用**：把 `/name` 排进对话输入框
- **输入框旁的技能按钮**：加号左边一个按钮，点开直接搜索选技能，等于不用打斜杠命令。可在「插件 → 技能工坊」关掉
- **编辑**：整份 SKILL.md 源码编辑，保存带内容哈希校验
- **开关**：一键停用或启用
- **调用方式**：模型自动 + 斜杠命令 / 仅斜杠命令 / 仅模型自动 / 都不启用
- **版本历史**：每次内容保存前留存上一版，可对比、可恢复
- **新建**：指定名字、描述、技能目录与分组
- **删除**：移进回收站

**回收站**

- 列出已删除的技能，含删除时间、体积、原路径
- 恢复到原位置，或彻底删除
- 支持清空整个回收站

## 架构

插件分成 Host 与 Browser 两半，通过同源 HTTP 路由通信。

```
Browser（client.js）                 Host（index.js）
  skill-workshop 面板                  /skill-workshop/*  路由
  侧边栏图标          ── fetch ──▶      读写 SKILL.md
  输入框技能按钮                        版本留存 / 回收站 / 分组
```

**Browser 半** 注册四处：

| 位置 | 作用 |
|---|---|
| `sidebar.panellist` | 左侧栏图标 |
| `main`（key `skill-workshop`） | 中间栏的整页面板 |
| `conversation.input.left` | 输入框旁的技能按钮（可关）+ `/name` 桥接 |
| `plugins.detail.section` | 插件详情页上的开关 |

**Host 半** 直接操作文件系统，不经过其他插件：

| 路由 | 作用 |
|---|---|
| `GET /skill-workshop/catalog` | 扫描所有根目录，返回技能清单与分组 |
| `GET /skill-workshop/skill` | 单个技能的正文、附带文件、版本列表 |
| `GET /skill-workshop/trash` | 回收站条目 |
| `GET /skill-workshop/version` | 某一历史版本的正文 |
| `GET /skill-workshop/groups` | 分组定义与成员归属 |
| `GET/POST /skill-workshop/settings` | 插件设置（输入框按钮开关） |
| `POST /skill-workshop/skill/{create,save,invocation,delete}` | 新建 / 保存 / 改调用方式 / 删除 |
| `POST /skill-workshop/version/restore` | 恢复历史版本 |
| `POST /skill-workshop/trash/{restore,purge,empty}` | 恢复 / 彻底删除 / 清空 |
| `POST /skill-workshop/groups/{create,rename,delete,assign,reorder,invocation}` | 分组增删改名 / 移动技能 / 排序 / 整组启停 |

## 数据

| 路径 | 内容 |
|---|---|
| `~/.dsh/skills/`、`~/.agents/skills/` | 技能本体，插件只读写、不拥有 |
| `~/.dsh/dsh-skill-workshop/versions/` | 历史版本 |
| `~/.dsh/dsh-skill-workshop/trash/` | 回收站 |
| `~/.dsh/dsh-skill-workshop/groups.json` | 分组、成员归属、上一档调用方式 |
| `~/.dsh/dsh-skill-workshop/settings.json` | 插件设置 |

数据放在 DSH home 下，不放在插件目录里（`node_modules` 会被包管理器整体替换）。

## 写入规则

- **frontmatter 按文本修改**，不做解析再重写的往返，以免破坏其他工具写入的嵌套结构与块标量。
- **每次写入都携带内容哈希**；页面读到的版本与磁盘不一致时拒绝写入，不会静默覆盖别处的修改。
- **被同名技能遮蔽的技能只读**：DSH 按根目录优先级只加载同名里的一个，改被遮蔽的那份不会有任何效果。

## 安装

```bash
dsh plugin add dsh-skill-workshop
```

或本地目录安装：把本包放到 `$DSH_HOME/plugins-src/dsh-skill-workshop/`，profile 的 `package.json` 依赖写
`"dsh-skill-workshop": "file:<该路径>"`，再 `pnpm install --no-frozen-lockfile`。

安装或更新后需要重启 DSH（宿主不热重载已加载的 ESM）。

## 许可证

MIT，见 [LICENSE](LICENSE)。

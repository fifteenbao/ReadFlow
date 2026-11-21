# ReadFlow

[English](README.en.md)

ReadFlow 是一个开源 Chrome 插件。你可以收藏文章和视频稍后看，在自建资料库里用标签和笔记整理收藏。

**收藏前需要连接自建的 ReadFlow 服务。** 项目提供服务端源码，资料保存在你自己的 SQLite 数据库里。

## 功能进度

- [x] **稍后看**：收藏链接，查看未读和已读。
- [x] **资料夹**：创建文件夹和子文件夹，按类型、标签或星标查找。
- [x] **标签与笔记**：在列表中直接编辑，新建或修改笔记最多 140 字。
- [x] **CSV 导出**：从设置下载收藏、标签、笔记和文件夹路径。
- [ ] **Agent 阅读回顾**（待完成）

## 安装 Chrome 插件

需要 Chrome 106+。下载插件 ZIP 后解压到固定目录。 [下载 Chrome 插件](https://github.com/fifteenbao/ReadFlow/releases/latest)

在 `chrome://extensions` 开启「开发者模式」，点击「加载已解压的扩展程序」，选择含 `manifest.json` 的目录。更新时使用原目录并点击「重新加载」。

**把服务配置交给你的 agent**：提供仓库目录和下方配置指南。拿到 HTTPS 服务地址后，在插件设置中配对，然后就可以收藏。

[给 agent 的配置步骤](SETUP.md#交给-agent-配置) · [完整配置指南](SETUP.md)

## 文件结构

| 文件或目录 | 用途 |
| --- | --- |
| `src/`、`icons/`、`manifest.json` | Chrome 插件的代码、图标和清单。 |
| `server/` | 自建服务、连接协议与管理命令。从 `server/serve.mjs` 启动。 |
| `scripts/`、`package.json` | 打包、测试和检查命令。 |
| `test/`、`test-support/` | 自动测试及共用的模拟环境。 |
| [SETUP.md](SETUP.md) | 安装后的服务配置、配对、备份与升级。 |
| [AGENTS.md](AGENTS.md) | 给修改仓库的编码助手看的协作规则与产品边界。 |
| [docs/](docs/) | 架构与接口参考。 |
| [LICENSE](LICENSE) | 项目的 MIT 许可证。允许使用、修改与分发代码，复制或分发代码时须保留原版权与许可声明。 |

## 版本迭代

- **V0.4.4**：深色列表、资料夹、自动刷新、行内编辑。
- **V0.4.3**：更新界面和安装说明。
- **V0.4.2**：简化配对和收藏弹窗。
- **V0.4.1**：引入 SQLite 资料库和 CSV 导出。

[完整更新日志](CHANGELOG.md) · [Shrikhand 字体许可](src/fonts/Shrikhand-OFL.txt)

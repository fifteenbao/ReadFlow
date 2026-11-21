# 安装与部署 ReadFlow

[English](SETUP.en.md)

[项目导览](README.md) · [交给 agent 配置](#交给-agent-配置) · [升级已有服务](#升级已有服务)

首次收藏前，请部署 ReadFlow 服务并完成 Chrome 配对。需要协助时，可把项目目录和本页交给自己的 agent。

## 1. 初始化数据库

参考服务需要单机 POSIX 环境、Node.js **22.13+**（内置 `node:sqlite`），无需安装 npm 依赖。部分 Node 版本会显示 SQLite 实验性提示。新建资料库时，在仓库根目录运行以下命令。已有部署请见[升级已有服务](#升级已有服务)。

```sh
mkdir -m 700 private
cp server/host.example.json private/host.json
chmod 600 private/host.json
```

编辑 `private/host.json` 中的配置。真实配置和凭证保存在私有目录。

| 字段 | 用途 |
| --- | --- |
| `baseUrl` | 完整 HTTPS 地址，包含应用子路径 |
| `extensionId` | Chrome 的 32 位扩展 ID，字符范围为 a–p。安装插件后再填，空值期间无法配对 |
| `stateDir` | 私有数据库目录，例如 `./state`。路径相对于配置文件，HTTP 服务和任务使用同一目录 |
| `connector.storageProvider` | 固定为 `database` |
| `connector.language` | 默认语言，填 `zh` 或 `en` |

```sh
node server/run.mjs init private/host.json
node server/run.mjs check private/host.json
node server/run.mjs audit private/host.json
```

初始化创建 `state/readflow.sqlite` 及固定资料库身份，不覆盖已有内容。收藏、配对和任务状态保存在 SQLite；`state.json` 仅为初始化／权限检查文件。目录须为 0700、文件 0600，归运行服务的 uid 所有，不允许符号链接或多重硬链接（nlink 必须为 1）。`audit` 检查私有目录权限，`check` 检查数据库。

## 2. 接入 HTTPS

将 `createHost(config).handleRequest` 接入已有 HTTPS 服务，或显式启动仅监听本机回环地址的参考服务，再由已有 HTTPS 代理转发：

```sh
node server/serve.mjs private/host.json
```

参考服务默认只监听 `127.0.0.1:8787`，可通过配置的 `port` 修改。对外通过已有 HTTPS 代理提供访问，回环端口仅在本机使用。

- 代理保留完整请求路径、`Origin`、`Content-Type` 和 `X-ReadFlow-*` 签名头，支持 POST 和 OPTIONS。访问日志省略请求正文及签名头。
- 请求体上限为 20 MiB，认证响应应禁用缓存。
- HTTP 服务和处理任务使用同一个非特权账号和配置。修改配置后重启服务。

## 3. 安装并配对 Chrome

按 [README](README.md#安装-chrome-插件) 安装。将 `chrome://extensions` 显示的真实扩展 ID 填入服务端 `extensionId`，重启服务。

**保持安装文件夹固定。移动解压目录可能改变扩展 ID，需要更新服务端白名单，否则会收到 `403 ORIGIN_DENIED`。扩展 ID 不是认证密钥。**

在插件设置填写 HTTPS 服务地址，在 Step 2 点击“连接服务器，获取指纹”，授权该主机。点击“复制确认任务”，交给服务管理员；核对完整指纹和扩展 ID 后批准：

```sh
node server/run.mjs pair-list private/host.json
node server/run.mjs pair-approve private/host.json --pair-id REQUEST_ID --fingerprint DISPLAYED_HEX
```

服务器批准后，插件自动检查授权、验证服务并保存连接，无需用户点击完成。保持设置页打开；关闭后重新打开会继续检查待处理申请。网络异常会显示重试提示，申请过期或变更需重新获取指纹并发送新的确认任务。无需填写表格链接或密钥。先收藏一条测试链接，验证数据库同步和 CSV。

### 拒绝与撤销浏览器配对

服务管理员可在服务设备执行：

```sh
node server/run.mjs pair-reject private/host.json --pair-id YOUR_PAIR_REQUEST_ID
node server/run.mjs pair-revoke private/host.json --pair-id YOUR_APPROVED_PAIR_ID
```

待批准申请十分钟过期。每个浏览器配对范围最多保留三个待批准申请和十六个已批准设备。过期后请重新获取指纹。重新安装扩展、换 Chrome 配置文件或改变服务地址后，可能需要重新配对。

浏览器本地保存私钥，服务端保留公钥。撤销需要在服务端执行 `pair-revoke`，之后该设备无法发出有效签名请求。保护好 Chrome 配置文件。

## 4. CSV 导出

设置中的“下载 CSV”刷新后下载数据库全部素材。列为标题、链接、阅读状态、时间、标签、笔记、标记已读时间、用途、类型、星标、三项来源及文件夹路径。

## 备份、运维与升级

备份前暂停 HTTP 服务和写入任务。复制完整私有状态目录、实际配置、环境文件及配对身份，保留文件所有权和权限。CSV 适合导出素材，配对和任务状态需要从完整备份恢复。

SQLite 使用 FULL 同步提交和 DELETE 日志，由进程间锁保护写入。`state.lock` 记录持锁 pid；持锁进程已退出时下次获取会自动清锁，仍存活则返回 LOCK_BUSY。用 `audit` 和 `inbox-pending` 排查；飞书收录可保留发送回执以便核对。参考服务为单机部署，资料库最多 10,000 条。

外部链接收录可单独配置，见[可选链接收录](docs/ARCHITECTURE.md#可选链接收录)。已启用收录时，可经用户授权用相同配置、`stateDir`、运行账号和环境调度 `node server/run.mjs ingest private/host.json --env private/host.env`。

### 升级已有服务

1. 记录当前提交和启动方式，检查是否有本地改动，暂停写入并完成备份。
2. 更新到目标版本，核对 `package.json` 和 `manifest.json` 的版本一致。运行 `npm test`、`npm run security` 和 `npm run doctor -- --config private/host.json`。
3. 以原配置、原 `stateDir`、原账号、HTTPS 子路径和进程管理方式重启。继续使用现有数据库和配对身份。若旧部署的入口仍指向原目录，将启动命令改为 `node server/serve.mjs`，把已有任务改用 `node server/run.mjs`，保留各自原有参数。
4. 在实际部署中检查 HTTPS、浏览器配对、旧收藏及已读时间、CSV。插件与服务端代码配套时，在资料夹验证新建文件夹和移动素材。
5. 若需回滚，保留诊断并暂停新写入，再从备份恢复所需代码和状态。处理好升级后新增的资料。

## 交给 agent 配置

将项目目录和需求提供给自己的 agent，要求它先读 `AGENTS.md` 和本文：

1. 只检查相关运行环境、HTTPS、私有存储和调度能力，不扫描无关凭证；新增平台、账号或费用前先征求同意。
2. 按上述顺序初始化、检查、安装和配对。核对完整指纹后才批准，不通过重置数据库来掩盖错误。
3. 在授权范围验证收藏去重、标签／笔记修改、断网保存失败且无本地暂存、未读／已读切换、文件夹创建与移动，以及 CSV，区分模拟测试与真实验证。
4. 若用户另行要求验证 agent 接口，检查其 HTTPS 可达性和签名能力，按[下文](#agent-接入与配对)完成独立配对与查询验证。
5. 交付服务地址、固定安装目录、验证结果、备份位置和未完成事项。配置助手不等于内置 AI Review。

## Agent 接入与配对

以下步骤用于验证已有 agent 能否读取资料库。Agent 阅读回顾工作流仍待完成。

agent 的运行环境须能访问服务的完整 HTTPS 地址，并能运行项目自带的签名工具（Node.js 22.13+）或实现同一[签名 HTTP 协议](docs/ARCHITECTURE.md#agent-签名)。代理需转发 `v1/agent/*` 路径和签名头。浏览器和 agent 分别配对。

在 **agent 的运行环境**中，从仓库根目录运行。将示例地址替换为自己的完整服务地址。若已有 `agent.json`，跳过 `init`，沿用原身份。

```sh
mkdir -p private
chmod 700 private
node server/agent-client.mjs init private/agent.json https://connection.example.com/readflow/
node server/agent-client.mjs pair private/agent.json
```

工具将私钥保存在 `agent.json`（权限 0600）。只将配对 ID 和完整指纹交给服务管理员。管理员在 **ReadFlow 服务设备** 核对两者后批准：

```sh
node server/run.mjs agent-pair-list private/host.json
node server/run.mjs agent-pair-approve private/host.json --pair-id 'PAIR_ID' --fingerprint 'FULL_FINGERPRINT'
```

将占位符替换为核对过的值。申请十分钟后过期，可用原身份再次运行 `pair`。配对后，在 agent 环境运行 `node server/agent-client.mjs query private/agent.json` 检查能否查到最近 30 天收藏的测试条目。

批准后，agent 可以读取整本资料库（含笔记），也拥有追加已确认回顾的接口权限。只批准你信任的运行环境。需要撤销时，在服务设备运行 `node server/run.mjs agent-pair-revoke private/host.json --pair-id 'PAIR_ID'`。

## 完成标准

确认 Chrome 收藏成功入库，元数据与阅读状态一致，并能在 CSV 中找到该素材。若另行验证 agent 接口，单独记录配对和查询结果。

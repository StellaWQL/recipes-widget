# 藏书仓库同步服务

这个目录为静态纸剧场网站补上 EPUB 上传服务。书籍通过 GitHub API 写入指定仓库，其他设备再从同一仓库读取。浏览器中的 IndexedDB 仍可保留本地副本，但它不再是跨设备藏书的唯一存储。

本更新包没有部署此服务，也没有配置真实仓库凭据。因此，仅覆盖网页文件不会自动开通远程同步。服务启动但配置不完整时，状态接口会明确返回 `configured: false`，上传接口不会返回入库成功。

## 对接当前项目

现有源码确认的书源如下。

| 配置项 | 默认值 |
| --- | --- |
| `GITHUB_OWNER` | `StellaWQL` |
| `GITHUB_REPO` | `recipes-widget` |
| `GITHUB_BRANCH` | `practice` |
| `GITHUB_BOOKS_PATH` | `data/books` |

现有文件中没有 `.gitmodules` 或其他独立子仓库记录。如果本地项目已经把藏书移入另一个 subrepo，请在服务端修改以上四项。不能通过网页上传参数切换仓库或目录。

## 启动

需要 Node.js 20 或更新版本。不需要 `npm install`。ZIP 解析复用网站的 `reader-room/vendor/jszip.min.js`，XML 解析器和许可证放在本目录的 `vendor` 中。

把 `library-sync-server` 放在网站根目录，与 `reader-room` 同级。命令在本目录执行。

```sh
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

把随机结果填入私有 `.env` 的 `LIBRARY_UPLOAD_KEY`，再填好 `GITHUB_TOKEN`。它们是两种不同的凭据。

- `GITHUB_TOKEN` 只放在服务端。可使用仅授权目标仓库、具备 Contents 读写权限的 fine-grained personal access token，也可由已有的 GitHub App 服务提供 installation token。使用有期限的 installation token 时，需要已有服务负责续期并重启或更新此进程配置。
- `LIBRARY_UPLOAD_KEY` 是独立的书库连接密钥，至少 32 个字符。网页只使用这把密钥连接本服务。不要把 GitHub token 填到网页中。
- `.env` 不提交到仓库，不放进静态网站目录的公开下载位置。

```sh
node --env-file=.env server.mjs
```

默认只监听本机 `127.0.0.1:8787`，仅提供 API。可在同一文件中设置 `STATIC_ROOT=..`，让它在本地同时提供现有网站。静态服务不提供点文件、本服务目录或指向根目录之外的符号链接。

浏览器地址为 `http://127.0.0.1:8787/reader-room/index.html` 时，`ALLOWED_ORIGINS` 应包含 `http://127.0.0.1:8787`。其他网站地址同理，只填协议、主机和端口，不带路径或结尾斜杠。多个来源用逗号分隔。不要填 `*`。

## 发布到可跨设备访问的环境

1. 在可以运行长期 Node.js 进程的服务上部署这个目录，并保留相邻的 `reader-room/vendor/jszip.min.js` 和其许可证。
2. 使用该平台的私有环境变量设置 GitHub token、书库连接密钥和明确的网站来源。按平台要求设置 `HOST=0.0.0.0`、`PORT`。
3. 通过 HTTPS 地址提供 `/api/library/` 接口。可以把这个路径反向代理到现有网站同一来源，也可以使用单独的 HTTPS 服务地址。
4. 在 `reader-room/config.js` 中将 `repositorySync.endpoint` 设置为完整的服务地址，如 `https://你的服务域名/api/library/`。如果已经通过同一来源反向代理 `/api/library/`，保留默认值即可。收书画面没有服务器地址输入框。
5. 在网页收书界面填入独立书库连接密钥。实际 GitHub token 始终留在服务端。
6. 上传一本 EPUB，确认接口返回提交 SHA，或返回已经核实的重复文件结果。再从另一台设备连接同一服务，检查书目和正文。

GitHub Pages 是静态托管，不能只把 `server.mjs` 上传到 Pages 就运行后端。它可以继续托管原网页，另行连接这个 HTTPS 服务。服务端使用固定的 GitHub API 主机，不读取客户端传入的下载网址，也不把 GitHub 返回的临时下载地址直接交给客户端。

目标分支必须允许该身份提交。分支保护、权限过期或服务离线都会返回明确错误。网页应继续保留本地文件，并将其标为待同步。不能把这些错误显示成文件已损坏或入库成功。

## API

除状态和预检 OPTIONS 外，以下请求均需 `Authorization: Bearer <LIBRARY_UPLOAD_KEY>`。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/library/status` | 无需密钥，返回是否已配置、单次大小限制 |
| `GET /health/status` | 与上面相同，用于服务状态检查 |
| `GET /api/library/books` | 读取最新仓库书目 |
| `GET /api/library/books/{id}/content` | 按不透明书籍 ID 读取 EPUB，校验大小和 Git blob hash |
| `POST /api/library/books` | 接收标准化 EPUB，并提交到固定书源目录 |

POST 使用 `Content-Type: application/epub+zip`，请求体是文件二进制。`X-Book-Filename` 使用 `encodeURIComponent` 编码文件名。客户端不发送仓库地址、路径、GitHub token 或 Base64 内容。

新上传成功返回 `201`。

```json
{
  "synced": true,
  "alreadyPresent": false,
  "book": {
    "id": "64位路径哈希",
    "key": "repo:64位路径哈希",
    "filename": "书名--16位内容哈希.epub",
    "title": "书名",
    "author": "作者",
    "size": 1000,
    "sha": "Git blob SHA",
    "contentUrl": "/api/library/books/64位路径哈希/content"
  },
  "commit": { "sha": "真实Git提交SHA", "url": "GitHub提交地址" }
}
```

同名同内容重试会先核对 GitHub 上的大小与 blob hash，返回 `200`、`alreadyPresent: true`、`commit: null`。这表示仓库已有经过核实的完整文件，不会编造新提交，也不会重复写入。不同内容绝不覆盖已有文件。

错误统一为 `{"error":{"code":"…","message":"…","retryable":false}}`。常见情况如下。

| HTTP 状态 | 错误码 | 含义 |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` | 连接密钥缺失或错误 |
| 403 | `ORIGIN_NOT_ALLOWED` | 当前网页来源未被允许 |
| 409 | `CONTENT_CONFLICT` | 同一路径已有不同内容，原文件未覆盖 |
| 413 | `TOO_LARGE` / `EXPANDED_TOO_LARGE` | 文件超过设定限制 |
| 422 | `INVALID_EPUB` | 未通过压缩目录、XML 清单或正文存在性检查 |
| 429 | `GITHUB_RATE_LIMIT` / `UPLOAD_BUSY` | 可以稍后重试 |
| 502 | `GITHUB_PERMISSION` | 服务端仓库授权需要检查 |
| 502 | `GITHUB_UNAVAILABLE` | 没有收到可核实的 GitHub 成功响应 |
| 503 | `NOT_CONFIGURED` | 后端未配置完整，没有远程写入 |

上传默认上限 25 MiB，展开后上限 200 MiB，目录项最多 8000，单个 XML 清单最多 4 MiB。服务当前支持普通 ZIP 格式 EPUB，不支持 ZIP64 或加密分卷。Mac `.epub` 文件夹包和外层 ZIP 应先经过现有前端标准化，再发给此服务。书库目录接口目前最多支持少于 1000 项；达到限制会明确报错，不会悄悄漏掉后面的书。

新书的正文、内嵌封面与其他 EPUB 字节不会被服务重绘或改写。仓库中的文件保留到你主动删除或变更仓库内容。未建立跨设备阅读进度同步，本轮同步的是藏书文件与书目。

## 验证

```sh
npm test
```

测试使用注入的模拟 GitHub，不包含真实 token，也不会产生远程提交。覆盖认证、CORS、UTF-16 XML、非法文件、资源限制、内容完整性、重复重试、同时上传、下载、远程失败和成功确认时机。`createLibraryServer(config, { fetchImpl })` 和 `GitHubLibrary` 均可注入模拟 fetch。

## 依赖与资料

- JSZip 复用项目现有版本和许可证。
- SAX 1.6.1 源码位于 `vendor/sax.cjs`，Blue Oak Model License 1.0.0 位于 `vendor/sax.LICENSE`。
- GitHub Contents API 文档 https://docs.github.com/en/rest/repos/contents?apiVersion=2026-03-10
- GitHub Pages 托管说明 https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site

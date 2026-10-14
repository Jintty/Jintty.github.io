# Jintty's Blog

用 Pandoc 把 Markdown 编译成静态 HTML 的个人博客。客户端零 JavaScript，数学公式走 MathML 原生渲染，代码高亮在构建时完成。

## 依赖

只需要两样东西：

| 依赖 | 说明 |
|---|---|
| **pandoc** | 唯一的构建工具。本机装在 `~/.local/bin/pandoc`（官方静态二进制，不经过 pacman） |
| **Node.js** | 跑构建脚本。`build.mjs` 只用 Node 内置模块，**零 npm 依赖** |

构建脚本会自动在 `~/.local/bin/pandoc`、`/usr/local/bin/pandoc`、`/usr/bin/pandoc` 里找 pandoc，也可以用环境变量覆盖：

```bash
PANDOC=/path/to/pandoc node build.mjs
```

## 常用命令

```bash
# 构建到 docs/
node build.mjs

# 构建并启动本地预览（默认 http://localhost:8000）
node build.mjs --serve

# 指定端口
PORT=8123 node build.mjs --serve
```

## 目录结构

```
blog/
├── site.json                 站点配置（标题、作者、URL、语言）
├── build.mjs                 构建脚本（零 npm 依赖）
├── templates/layout.html     页面骨架，纯 HTML + {{占位符}}
├── assets/
│   ├── style.css             全部样式（明暗主题 / 代码高亮 / MathML）
│   └── fonts/                自托管字体（含候选，见文末 Credits）
├── src/posts/                文章（Markdown）
└── docs/                     构建产物，GitHub Pages 从这里发布
```

## 写一篇文章

在 `src/posts/` 下新建 `.md` 文件。文件名里的日期前缀会用于排序和 URL：

```
src/posts/2026-09-20-my-post.md   ->   /posts/my-post.html
```

开头的 front matter：

```yaml
---
title: My Post Title          # 必填，用作页面标题
date: 2026-09-20              # 用于排序；缺省时从文件名推断
tags: [systems, security]     # 会生成标签页
summary: One-sentence blurb.  # 用于首页列表和 <meta description>
toc: true                     # 可选，生成目录
draft: true                   # 可选，构建时跳过
---
```

正文从 `##` 开始写——`title` 已经由模板渲染成 `<h1>`。

### 数学

用标准的 `$...$` 和 `$$...$$`：

```markdown
行内公式 $E = mc^2$。

$$
(AB)_{ij} = \sum_{k=1}^{n} a_{ik} b_{kj}
$$
```

输出的是 MathML，浏览器原生渲染。

### 脚注

标准 Markdown 脚注，渲染在文章末尾：

```markdown
MathML reached Baseline in 2025[^baseline].

[^baseline]: Baseline 表示所有主流浏览器的最新版本都支持。
```

### 图片

放在 `src/posts/` 里，用相对路径引用即可（构建时会一起复制）：

```markdown
![说明文字](diagram.svg)
```

## 站点配置

`site.json`：

```json
{
  "title": "Jintty's Blog",
  "author": "Jintty",
  "description": "...",
  "lang": "en",
  "baseUrl": "https://jintty.github.io",
  "basePath": ""
}
```

- **`baseUrl` / `basePath`**：部署在 `USERNAME.github.io` 根域时 `basePath` 留空；部署在项目页（`USERNAME.github.io/repo`）时设为 `"/repo"`。
- **`lang`**：决定 `<html lang>`、Atom feed 的语言标记、以及英文断词的词典选择。

## 部署

推送到 GitHub，在仓库 Settings → Pages 里把 Source 设为 `main` 分支的 `/docs` 目录即可。产物里已经包含 `.nojekyll`，无需额外配置。

## Credits & Licenses

这个站点的版式不是我自己设计的，它建立在别人公开的工作之上：

### 版式

**[Tufte CSS](https://edwardtufte.github.io/tufte-css/)** — Copyright (c) 2014 Dave Liepmann, MIT License.

`assets/style.css` 保留了 Tufte CSS 的字号层级（3.2 / 2.2 / 1.7 / 1.4rem）、衬线正文和克制的配色，但**布局已改为单栏**：边注系统（`.sidenote` / `.marginnote` / `margin-toggle`）被整体移除，因为它把正文锁死在 55% 宽度，而这个站点用不到边注。其余改动（CSS 变量明暗主题、代码高亮、MathML、站点结构）见 `style.css` 头部注释。

### 字体

| 字体 | 用途 | 许可 | 分发方式 |
|---|---|---|---|
| **[IBM Plex Serif](https://github.com/IBM/plex)** | 正文（当前） | SIL OFL 1.1<br>Copyright © 2017 IBM Corp. | 自托管于 `assets/fonts/ibm-plex-serif/` |
| **[Source Code Pro](https://github.com/adobe-fonts/source-code-pro)** | 代码（当前） | SIL OFL 1.1<br>Copyright 2010, 2012 Adobe | 自托管于 `assets/fonts/source-code-pro/` |
| **[Literata](https://github.com/googlefonts/literata)** | 正文（候选） | SIL OFL 1.1<br>Copyright 2017 The Literata Project Authors | 自托管于 `assets/fonts/literata/` |
| **[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)** | 代码（候选） | SIL OFL 1.1<br>Copyright 2020 The JetBrains Mono Project Authors | 自托管于 `assets/fonts/jetbrains-mono/` |
| **[IBM Plex Mono](https://github.com/IBM/plex)** | 代码（候选） | SIL OFL 1.1<br>Copyright © 2017 IBM Corp. | 自托管于 `assets/fonts/ibm-plex-mono/` |
| **[STIX Two Math](https://github.com/stipub/stixfonts)** | 数学 | SIL OFL 1.1<br>Copyright 2001–2021 The STIX Fonts Project Authors | 仅按名称引用，**不随站点分发** |
| Noto Serif CJK SC | 中文回退 | — | 仅按名称引用，不随站点分发 |

自托管字体因为会随站点部署出去，OFL 的署名在 CSS 头部和页面页脚都保留了。它们都是**拉丁子集**（每个文件 11–23 KB），不含汉字——中文会自动回退到字体栈里后面的系统衬线字体。

**候选字体不会被访客下载**：浏览器只请求 `--font-serif` / `--font-mono` 实际引用的字体。`style.css` 里那些未被引用的 `@font-face` 声明不会触发任何网络请求。切换字体只需改 `:root` 里那两行。

### 数学渲染

数学输出为 **MathML**，由浏览器原生渲染，不依赖任何 JavaScript 库。`--mathml` 是 Pandoc 的 `--math-method` 默认值。

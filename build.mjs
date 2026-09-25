#!/usr/bin/env node
/**
 * 极简博客构建器
 * ---------------------------------------------------------------------------
 * Markdown -> 静态 HTML。唯一的外部依赖是 pandoc。
 * 零 npm 依赖：只用 Node 内置模块。
 *
 *   node build.mjs           构建到 docs/
 *   node build.mjs --serve   构建后起本地预览服务器（默认 8000 端口）
 *
 * 环境变量：
 *   PANDOC=/path/to/pandoc   指定 pandoc 可执行文件
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, cpSync, statSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createServer } from 'node:http';

const ROOT      = dirname(fileURLToPath(import.meta.url));
const SRC_POSTS = join(ROOT, 'src', 'posts');
const OUT       = join(ROOT, 'docs');
const ASSETS    = join(ROOT, 'assets');
const TEMPLATES = join(ROOT, 'templates');
/** 定位 pandoc：环境变量 > 用户本地安装 > 常见系统位置 > 交给 PATH */
function findPandoc() {
  if (process.env.PANDOC) return process.env.PANDOC;
  const candidates = [
    join(homedir(), '.local', 'bin', 'pandoc'),
    '/usr/local/bin/pandoc',
    '/usr/bin/pandoc',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return 'pandoc';
}

const PANDOC    = findPandoc();

/* ------------------------------------------------------------------ 方言 */

const FROM = 'gfm+tex_math_dollars';

// 脚注 -> Tufte 边注。filter 缺失时静默降级为普通脚注。
const FILTER   = join(ROOT, 'filters', 'sidenotes.lua');
const hasFilter = existsSync(FILTER);

// --section-divs 是 Tufte 布局的前提：正文要被包进 <section>，
// CSS 才能用 `section > p` 把正文限制在 55% 宽度，把右侧留给边注。
const TO = [
  '-t', 'html',
  '--mathml',
  '--wrap=none',
  '--section-divs',
  ...(hasFilter ? [`--lua-filter=${FILTER}`] : []),
];

/* ------------------------------------------------------------ 小工具函数 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const stripTags = (html) => String(html ?? '')
  .replace(/<[^>]*>/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** 标签 -> 安全的文件名/URL 片段。保留中日韩等 Unicode 字母。 */
function slugify(s) {
  return String(s).trim().toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '') || 'untagged';
}

/** 调用 pandoc，输入从 stdin，返回 stdout */
function pandoc(args, input) {
  return execFileSync(PANDOC, args, {
    input,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

/* ------------------------------------------------- pandoc JSON metadata 解析 */

function inlinesToText(inlines) {
  if (!Array.isArray(inlines)) return '';
  return inlines.map((i) => {
    if (i.t === 'Str') return i.c;
    if (i.t === 'Space' || i.t === 'SoftBreak' || i.t === 'LineBreak') return ' ';
    if (i.t === 'Code') return Array.isArray(i.c) ? i.c[1] : '';
    if (i.t === 'Math') return Array.isArray(i.c) ? i.c[1] : '';
    return '';
  }).join('').trim();
}

/** 把 pandoc 的 meta 节点转成 JS 值 */
function metaValue(node) {
  if (node === undefined || node === null) return undefined;
  switch (node.t) {
    case 'MetaString':  return node.c;
    case 'MetaBool':    return node.c;
    case 'MetaInlines': return inlinesToText(node.c);
    case 'MetaList':    return node.c.map(metaValue);
    case 'MetaBlocks':  return node.c.map((b) => stripTags(blockText(b))).join(' ').trim();
    case 'MetaMap':     return Object.fromEntries(
                          Object.entries(node.c).map(([k, v]) => [k, metaValue(v)]));
    default:            return '';
  }
}

function blockText(block) {
  if (!block || !block.c) return '';
  if (Array.isArray(block.c)) {
    return block.c.map((x) => (x && typeof x === 'object'
      ? (x.t === 'Str' ? x.c : (x.c ? blockText(x) : ''))
      : String(x))).join(' ');
  }
  return '';
}

const metaText = (node) => {
  const v = metaValue(node);
  if (v === undefined) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
};

/* ------------------------------------------------------------ HTML 后处理 */

function postProcess(html) {
  let out = html;

  // 1. 块级公式被 pandoc 包在 <p> 里，去掉多余包裹
  //    （用 display="block" 精确定位，避免误伤含公式的普通段落）
  out = out.replace(/<p>(<math display="block"[\s\S]*?<\/math>)<\/p>/g, '$1');

  // 2. 表格外面包一层，便于小屏横向滚动（类名沿用 tufte-css 的约定）
  out = out
    .replace(/<table(\s|>)/g, '<div class="table-wrapper"><table$1')
    .replace(/<\/table>/g, '</table></div>');

  return out;
}

/** 从正文 HTML 里抽取 h2/h3 生成目录
 *  启用 --section-divs 后，标题的 id 落在 <section> 上而不是 <hN> 上 */
function buildToc(html) {
  const re = /<section ([^>]*)>\s*<h([23])[^>]*>([\s\S]*?)<\/h\2>/g;
  const items = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const idM = attrs.match(/id="([^"]+)"/);
    const lvlM = attrs.match(/class="level([23])"/);
    if (!idM || !lvlM) continue;
    items.push({ level: Number(lvlM[1]), id: idM[1], text: stripTags(m[3]) });
  }
  if (items.length < 2) return '';
  return `<nav class="toc">
  <p class="toc-title">Contents</p>
  <ul>
${items.map((i) => `    <li class="toc-level-${i.level}"><a href="#${esc(i.id)}">${esc(i.text)}</a></li>`).join('\n')}
  </ul>
</nav>`;
}

/* ---------------------------------------------------------------- 站点配置 */

function loadSite() {
  const f = join(ROOT, 'site.json');
  if (!existsSync(f)) {
    console.error('✗ 缺少 site.json');
    process.exit(1);
  }
  return JSON.parse(readFileSync(f, 'utf8'));
}

/* ---------------------------------------------------------------- 读取文章 */

function readPosts() {
  if (!existsSync(SRC_POSTS)) return [];
  const files = readdirSync(SRC_POSTS).filter((f) => f.endsWith('.md')).sort();

  const posts = files.map((f) => {
    const file = join(SRC_POSTS, f);
    const raw = readFileSync(file, 'utf8');
    const stem = basename(f, '.md');

    let ast;
    try {
      ast = JSON.parse(pandoc(['-f', FROM, '-t', 'json'], raw));
    } catch (e) {
      console.error(`✗ pandoc 解析失败: src/posts/${f}`);
      console.error(String(e.stderr || e.message).trim());
      process.exit(1);
    }
    const meta = ast.meta || {};

    // slug / 日期：优先 frontmatter，其次文件名前缀 YYYY-MM-DD-
    let slug = stem;
    let date = '';
    const dm = stem.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (dm) { date = dm[1]; slug = dm[2]; }

    const fmDate = metaText(meta.date);
    if (fmDate) date = fmDate.slice(0, 10);

    // tags：兼容 [a, b] / "a, b" / "a"
    let tags = metaValue(meta.tags);
    if (tags === undefined) tags = [];
    else if (!Array.isArray(tags)) tags = String(tags).split(/[,，]\s*/);
    tags = tags.map((t) => String(t).trim()).filter(Boolean);

    // toc: true 打开目录
    const tocFlag = metaValue(meta.toc);
    const wantsToc = tocFlag === true || String(tocFlag).toLowerCase() === 'true';

    const bodyHtml = postProcess(
      pandoc(['-f', FROM, ...TO], raw)
    );

    return {
      slug,
      file: `src/posts/${f}`,
      title: metaText(meta.title) || slug,
      date,
      summary: metaText(meta.summary),
      tags,
      drafts: metaValue(meta.draft) === true,
      bodyHtml,
      toc: wantsToc ? buildToc(bodyHtml) : '',
    };
  });

  return posts
    .filter((p) => !p.drafts)
    .sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
}

/* ---------------------------------------------------------------- 渲染页面 */

function makeRenderer(site, posts) {
  const layoutTpl = readFileSync(join(TEMPLATES, 'layout.html'), 'utf8');
  const BASE = String(site.basePath || '').replace(/\/+$/, '');
  const SITE_URL = String(site.baseUrl || '').replace(/\/+$/, '') + BASE;
  const YEAR = String(new Date().getFullYear());

  function render({ title, description, content, ogType = 'website', extraHead = '' }) {
    return layoutTpl
      .replaceAll('{{lang}}', site.lang || 'zh-CN')
      .replaceAll('{{siteTitle}}', esc(site.title))
      .replaceAll('{{siteAuthor}}', esc(site.author))
      .replaceAll('{{basePath}}', BASE)
      .replaceAll('{{title}}', esc(title))
      .replaceAll('{{description}}', esc(description))
      .replaceAll('{{ogType}}', ogType)
      .replaceAll('{{extraHead}}', extraHead)
      .replaceAll('{{year}}', YEAR)
      .replaceAll('{{content}}', content);   // 必须最后
  }

  const tagLinks = (tags) => tags
    .map((t) => `<a class="tag" href="${BASE}/tags/${slugify(t)}.html">${esc(t)}</a>`)
    .join('');

  const postMeta = (p) => `<div class="post-meta">${
    p.date ? `<time datetime="${p.date}">${p.date}</time>` : ''
  }${tagLinks(p.tags)}</div>`;

  const pageTitle = (suffix) =>
    suffix ? `${suffix} · ${site.title}` : `${site.title} — ${site.description}`;

  return { render, BASE, SITE_URL, postMeta, pageTitle };
}

/* --------------------------------------------------------------- 写文件 */

const written = [];

function emit(relPath, content) {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  written.push(relPath);
}

/* ---------------------------------------------------------------- Atom feed */

function renderFeed(site, posts, SITE_URL) {
  const limit = site.feedLimit || 20;
  const iso = (d) => {
    const t = d ? new Date(d) : new Date();
    return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
  };
  const updated = posts.length && posts[0].date ? iso(posts[0].date) : new Date().toISOString();

  const entries = posts.slice(0, limit).map((p) => `  <entry>
    <title>${esc(p.title)}</title>
    <link href="${SITE_URL}/posts/${p.slug}.html"/>
    <id>${SITE_URL}/posts/${p.slug}.html</id>
    <updated>${iso(p.date)}</updated>
${p.tags.map((t) => `    <category term="${esc(t)}"/>`).join('\n')}
    <content type="html">${esc(p.bodyHtml)}</content>
  </entry>`).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${esc(site.lang || 'zh-CN')}">
  <title>${esc(site.title)}</title>
  <subtitle>${esc(site.description)}</subtitle>
  <link rel="self" href="${SITE_URL}/feed.xml"/>
  <link href="${SITE_URL}/"/>
  <updated>${updated}</updated>
  <id>${SITE_URL}/</id>
  <author><name>${esc(site.author)}</name></author>
  <generator>pandoc + build.mjs</generator>
${entries}
</feed>
`;
}

/* ------------------------------------------------------------------ 主流程 */

function build() {
  // 0. 检查 pandoc
  try {
    execFileSync(PANDOC, ['--version'], { stdio: 'pipe' });
  } catch {
    console.error('✗ 找不到 pandoc。请安装后重试：');
    console.error('    sudo pacman -S pandoc-cli');
    console.error('  或用 PANDOC=/path/to/pandoc 指定路径。');
    process.exit(1);
  }

  const site = loadSite();
  const posts = readPosts();

  // 1. 清空输出目录
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const { render, BASE, SITE_URL, postMeta, pageTitle } = makeRenderer(site, posts);

  // 2. 每篇文章
  for (const p of posts) {
    emit(`posts/${p.slug}.html`, render({
      title: pageTitle(p.title),
      description: p.summary || stripTags(p.bodyHtml).slice(0, 140),
      content: `<article>
  <header class="post-header">
    <h1>${esc(p.title)}</h1>
${postMeta(p)}
  </header>
${p.toc}
${p.bodyHtml}
</article>`,
      ogType: 'article',
      extraHead: `<meta property="article:published_time" content="${p.date}">`,
    }));
  }

  // 3. 首页
  const indexBody = posts.length
    ? posts.map((p) => `<article class="post-item">
  <h2><a href="${BASE}/posts/${p.slug}.html">${esc(p.title)}</a></h2>
${postMeta(p)}
${p.summary ? `  <p class="summary">${esc(p.summary)}</p>` : ''}
</article>`).join('\n')
    : '<p>No posts yet. Drop a <code>.md</code> file into <code>src/posts/</code>.</p>';

  emit('index.html', render({
    title: pageTitle(''),
    description: site.description,
    content: indexBody,
  }));

  // 4. 归档页（按年份分组）
  const byYear = new Map();
  for (const p of posts) {
    const y = p.date ? p.date.slice(0, 4) : 'Undated';
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(p);
  }
  const archiveBody = [...byYear.entries()].map(([year, list]) => `<section>
  <h2 class="archive-year">${esc(year)}</h2>
  <ul class="archive-list">
${list.map((p) => `    <li><time datetime="${p.date}">${p.date ? p.date.slice(5) : ''}</time><a href="${BASE}/posts/${p.slug}.html">${esc(p.title)}</a></li>`).join('\n')}
  </ul>
</section>`).join('\n');

  emit('archive.html', render({
    title: pageTitle('Archive'),
    description: `All ${posts.length} posts`,
    content: `<h1 class="page-title">Archive</h1>\n${archiveBody || '<p>Nothing here yet.</p>'}`,
  }));

  // 5. 标签页
  const tagMap = new Map();
  for (const p of posts) {
    for (const t of p.tags) {
      const k = slugify(t);
      if (!tagMap.has(k)) tagMap.set(k, { name: t, posts: [] });
      tagMap.get(k).posts.push(p);
    }
  }
  for (const [key, { name, posts: list }] of tagMap) {
    emit(`tags/${key}.html`, render({
      title: pageTitle(`Tagged: ${name}`),
      description: `Posts tagged ${name}`,
      content: `<h1 class="page-title">Tagged: ${esc(name)}</h1>
<ul class="archive-list">
${list.map((p) => `  <li><time datetime="${p.date}">${p.date || ''}</time><a href="${BASE}/posts/${p.slug}.html">${esc(p.title)}</a></li>`).join('\n')}
</ul>`,
    }));
  }
  // 标签总览
  if (tagMap.size) {
    emit('tags.html', render({
      title: pageTitle('Tags'),
      description: 'All tags',
      content: `<h1 class="page-title">Tags</h1>
<div class="tag-cloud">${[...tagMap.entries()].map(([k, v]) =>
        `<a class="tag" href="${BASE}/tags/${k}.html">${esc(v.name)} <span>${v.posts.length}</span></a>`
      ).join('')}</div>`,
    }));
  }

  // 6. feed
  emit('feed.xml', renderFeed(site, posts, SITE_URL));

  // 7. 静态资源
  if (existsSync(ASSETS)) {
    cpSync(ASSETS, OUT, { recursive: true });
  }

  // 8. 文章目录下的图片等资源（colocate）
  if (existsSync(SRC_POSTS)) {
    for (const f of readdirSync(SRC_POSTS)) {
      if (f.endsWith('.md') || f.startsWith('.')) continue;
      cpSync(join(SRC_POSTS, f), join(OUT, 'posts', f), { recursive: true });
    }
  }

  // 9. 禁止 GitHub Pages 走 Jekyll
  emit('.nojekyll', '');

  // 10. favicon
  if (!existsSync(join(OUT, 'favicon.svg'))) {
    emit('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1b1b1f"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="15" font-weight="600" fill="#fcfcfa" text-anchor="middle">${esc((site.title || 'B').trim()[0] || 'B')}</text></svg>`);
  }

  // 汇总
  console.log(`✓ 构建完成  ——  ${posts.length} 篇文章, ${tagMap.size} 个标签, ${written.length} 个文件`);
  console.log(`  输出目录: docs/`);
  if (posts.length) {
    console.log(`  最新一篇: ${posts[0].date || '(无日期)'}  ${posts[0].title}`);
  }
  console.log(`  本地预览: node build.mjs --serve`);

  return { posts, site };
}

/* -------------------------------------------------------------- 预览服务器 */

function serve(dir, port = 8000) {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.xml':  'application/atom+xml; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.woff2':'font/woff2',
    '.txt':  'text/plain; charset=utf-8',
    '.pdf':  'application/pdf',
  };

  createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(dir, p);
    if (!full.startsWith(dir) || !existsSync(full) || statSync(full).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1>');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(full)] || 'application/octet-stream' });
    res.end(readFileSync(full));
  }).listen(port, () => {
    console.log(`\n  预览: http://localhost:${port}/`);
    console.log('  Ctrl-C 停止\n');
  });
}

/* ------------------------------------------------------------------ 入口 */

build();
if (process.argv.includes('--serve')) {
  serve(OUT, Number(process.env.PORT) || 8000);
}

-- 把 pandoc 的脚注转成 Tufte CSS 的 sidenote 结构
-- ---------------------------------------------------------------------------
-- pandoc 默认把脚注堆到文末的 <section class="footnotes"> 里，而 Tufte 的
-- 边注是内联在正文中、靠 float 浮到右侧栏的。这个 filter 在 AST 层面完成
-- 转换，所以位置天然正确，不需要事后用正则搬运 HTML。
--
-- 生成的 HTML：
--   <label for="sn-1" class="margin-toggle sidenote-number"></label>
--   <input type="checkbox" id="sn-1" class="margin-toggle"/>
--   <span class="sidenote">…</span>
--
-- 编号由 CSS counter 完成，窄屏折叠靠 checkbox，两者都是零 JS。
--
-- 关键点：这里返回的是「元素列表」而不是 RawInline 字符串，内容交回 pandoc
-- 主流程渲染。这样脚注里的数学会使用命令行指定的 --mathml，与正文一致。
-- （用 pandoc.write() 另起一次渲染则不会继承这些设置，公式会降级成 <em>/<sup>。）

local counter = 0

function Note(el)
  counter = counter + 1
  local id = 'sn-' .. counter

  -- 扁平化成 inlines：边注通常只有一段，多段时用空格连接。
  local inlines = pandoc.utils.blocks_to_inlines(el.content, { pandoc.Space() })

  local out = {
    pandoc.RawInline('html',
      '<label for="' .. id .. '" class="margin-toggle sidenote-number"></label>'),
    pandoc.RawInline('html',
      '<input type="checkbox" id="' .. id .. '" class="margin-toggle"/>'),
    pandoc.RawInline('html', '<span class="sidenote">'),
  }

  for _, inline in ipairs(inlines) do
    out[#out + 1] = inline
  end

  out[#out + 1] = pandoc.RawInline('html', '</span>')
  return out
end

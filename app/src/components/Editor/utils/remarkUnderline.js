import { visit } from 'unist-util-visit';

// HTML <u>...</u> as the on-disk representation of underlined text. Markdown
// has no native underline; we round-trip it through raw inline HTML, which
// remark-parse emits as adjacent `html` nodes ('<u>', '</u>') around the
// in-between phrasing content. This plugin collapses that run into a single
// custom mdast node:
//   { type: 'underline', children: [...phrasing] }
// The matching stringify handler below re-emits <u>...</u>.
//
// Note: this differs from remarkSpoiler's text-regex approach because
// CommonMark recognizes <u> as raw inline HTML, so we never see the markers
// inside a single text node — they're already siblings by the time we run.

const OPEN_RE = /^<u>$/i;
const CLOSE_RE = /^<\/u>$/i;

export function remarkUnderline() {
  return (tree) => {
    visit(tree, (node) => {
      if (!Array.isArray(node.children) || node.children.length < 2) return;
      const children = node.children;
      let i = 0;
      while (i < children.length) {
        const child = children[i];
        if (child.type === 'html' && OPEN_RE.test(child.value)) {
          // Find the matching closing tag in the same parent. We don't
          // support nesting (<u> inside <u>) — first close wins.
          let j = i + 1;
          while (j < children.length) {
            const c = children[j];
            if (c.type === 'html' && CLOSE_RE.test(c.value)) break;
            j++;
          }
          if (j < children.length) {
            const inner = children.slice(i + 1, j);
            const underlineNode = {
              type: 'underline',
              children: inner.length > 0 ? inner : [{ type: 'text', value: '' }],
            };
            children.splice(i, j - i + 1, underlineNode);
            i += 1;
            continue;
          }
        }
        i += 1;
      }
    });
  };
}

// Stringify-side handler. Uses state.containerPhrasing so nested formatting
// (bold/italic/links/spoilers inside an underline) is serialized correctly
// rather than collapsed to plain text.
export function underlineHandler(node, _parent, state, info) {
  const exit = state.enter('underline');
  const inner = state.containerPhrasing(node, {
    ...info,
    before: '>',
    after: '<',
  });
  exit();
  return `<u>${inner}</u>`;
}

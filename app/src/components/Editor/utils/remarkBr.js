import { visit } from 'unist-util-visit';

// Table cells store multi-line content as `<br>` (the GFM/portable convention, since a
// markdown table cell can't hold a literal newline). remark-parse emits `<br>` as a
// raw inline `html` node; this converts it to a real mdast `break` node, which
// remark-rehype renders as a <br> — so multi-line cells read the same in the reading
// view as in the editor. Mirrors remarkUnderline's raw-HTML-node approach.
const BR_RE = /^<br\s*\/?>$/i;

export function remarkBr() {
  return (tree) => {
    visit(tree, (node) => {
      if (!Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c.type === 'html' && BR_RE.test((c.value || '').trim())) {
          node.children[i] = { type: 'break' };
        }
      }
    });
  };
}

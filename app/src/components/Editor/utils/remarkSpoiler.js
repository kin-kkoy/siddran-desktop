import { visit, SKIP } from 'unist-util-visit';

// Discord-style spoiler.
//
// On-disk format: <spoiler>...</spoiler>. Mirrors remarkUnderline's approach.
// CommonMark recognizes raw inline HTML, so the inner content is parsed
// normally — nested **bold**, *italic*, [links](), <u>, autolinks, etc. all
// become real mdast nodes by the time this plugin runs.
//
// Why HTML and not the original ||...||? GFM's autolink-literal extension
// runs during parse (micromark) and grabs URL-like substrings before any
// transformer can intervene. For ||abcd.com||, GFM grabs `abcd.com` plus a
// trailing `|` as eligible URL punctuation, shattering the ||...|| pair into
// [text:'||', link:'abcd.com|', text:'|']. No post-parse transformer can
// recover that. Switching to <spoiler> sidesteps the conflict entirely
// because raw inline HTML is parsed before autolink considers its contents.
//
// Backwards compatibility: legacy notes saved with ||...|| still load via
// the secondary text-regex pass and the autolink-shattered re-stitcher.
// Migration is gradual — re-saved notes adopt the new format silently.

const OPEN_RE = /^<spoiler>$/i;
const CLOSE_RE = /^<\/spoiler>$/i;

// Legacy: ||hidden text|| (no pipes inside). Tight delimiters (non-space just
// inside each ||) so prose like `x || y || z` isn't mis-spoilered; matches the
// editor's Lezer Spoiler rule.
const LEGACY_SPOILER_RE = /\|\|(?=\S)([^|]+?)(?<=\S)\|\|/g;

// Legacy fallback for the autolink-shattered case: when GFM autolink ran
// before us and broke ||URL|| into [text:'||', link, text:'||']. Re-stitches
// those siblings into a spoiler wrapping the link.
function reStitchAutolinkedLegacy(children) {
  let i = 0;
  while (i < children.length - 2) {
    const a = children[i];
    const b = children[i + 1];
    const c = children[i + 2];
    if (
      a.type === 'text' && typeof a.value === 'string' && a.value.endsWith('||') &&
      b.type === 'link' &&
      c.type === 'text' && typeof c.value === 'string' && c.value.startsWith('||')
    ) {
      const before = a.value.slice(0, -2);
      const after = c.value.slice(2);
      const spoilerNode = { type: 'spoiler', children: [b] };
      const replacement = [];
      if (before) replacement.push({ type: 'text', value: before });
      replacement.push(spoilerNode);
      if (after) replacement.push({ type: 'text', value: after });
      children.splice(i, 3, ...replacement);
      i += replacement.length;
    } else {
      i += 1;
    }
  }
}

export function remarkSpoiler() {
  return (tree) => {
    // Pass 1: collapse <spoiler>...</spoiler> sibling pairs into spoiler nodes
    visit(tree, (node) => {
      if (!Array.isArray(node.children) || node.children.length < 2) return;
      const children = node.children;
      let i = 0;
      while (i < children.length) {
        const child = children[i];
        if (child.type === 'html' && OPEN_RE.test(child.value)) {
          let j = i + 1;
          while (j < children.length) {
            const c = children[j];
            if (c.type === 'html' && CLOSE_RE.test(c.value)) break;
            j++;
          }
          if (j < children.length) {
            const inner = children.slice(i + 1, j);
            const spoilerNode = {
              type: 'spoiler',
              children: inner.length > 0 ? inner : [{ type: 'text', value: '' }],
            };
            children.splice(i, j - i + 1, spoilerNode);
            i += 1;
            continue;
          }
        }
        i += 1;
      }
    });

    // Pass 2: legacy ||...|| in plain text nodes (where GFM autolink didn't
    // fire on the inner content). Inner is treated as text only — by the time
    // we run, GFM has committed parsing decisions, so richer legacy content
    // (bold inside ||...||) is flattened on first migration. Acceptable.
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined) return;
      const value = node.value;
      const matches = [...value.matchAll(LEGACY_SPOILER_RE)];
      if (matches.length === 0) return;

      const newNodes = [];
      let cursor = 0;
      for (const match of matches) {
        const start = match.index;
        const end = start + match[0].length;
        if (start > cursor) {
          newNodes.push({ type: 'text', value: value.slice(cursor, start) });
        }
        newNodes.push({
          type: 'spoiler',
          children: [{ type: 'text', value: match[1] }],
        });
        cursor = end;
      }
      if (cursor < value.length) {
        newNodes.push({ type: 'text', value: value.slice(cursor) });
      }
      parent.children.splice(index, 1, ...newNodes);
      return [SKIP, index + newNodes.length];
    });

    // Pass 3: legacy autolink-shattered case across siblings
    visit(tree, (node) => {
      if (Array.isArray(node.children) && node.children.length >= 3) {
        reStitchAutolinkedLegacy(node.children);
      }
    });
  };
}

// Stringify-side. Uses containerPhrasing (same pattern as underlineHandler)
// so nested formatting/links/etc. are recursively serialized rather than
// dropped. Always emits the new <spoiler>...</spoiler> form.
export function spoilerHandler(node, _parent, state, info) {
  const exit = state.enter('spoiler');
  const inner = state.containerPhrasing(node, {
    ...info,
    before: '>',
    after: '<',
  });
  exit();
  return `<spoiler>${inner}</spoiler>`;
}

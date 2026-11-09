// Block-level markdown rendering.
//
// `renderMarkdown` renders the whole document to one HTML string, so every edit
// rebuilds every DOM node and re-runs layout for the entire document. For large
// files (hundreds of KB) that is the dominant cost of typing.
//
// Here the same markdown-it instance parses once, then renders **each top-level
// block** on its own and tags the result with a content hash. The caller keeps
// the previous hashes and passes them back, so only blocks whose content changed
// get replaced in the DOM — the rest keep their existing nodes and layout.

import { md, prepareShiki } from "./markdown";
import type { Theme } from "./theme";

/** One top-level markdown block, rendered. */
export type MdBlock = {
  /** Content hash: unchanged blocks are not touched in the DOM. */
  key: string;
  html: string;
};

export type MdBlocks = { blocks: MdBlock[] };

/** The token fields the hash and the grouping need. */
type Tok = {
  type: string;
  level: number;
  /** 1 = opening, -1 = closing, 0 = self-contained. */
  nesting: number;
  content: string;
  markup: string;
  info: string;
  tag: string;
  attrs: [string, string][] | null;
};

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), FNV_PRIME);
  }
  return h;
}

/** Content hash of one top-level block's tokens. */
function blockKey(tokens: Tok[]): string {
  let h = FNV_OFFSET;
  for (const t of tokens) {
    h = fnv(h, t.type);
    h = fnv(h, t.tag);
    if (t.markup) h = fnv(h, t.markup);
    if (t.info) h = fnv(h, t.info);
    if (t.content) h = fnv(h, t.content);
    if (t.attrs) for (const [k, v] of t.attrs) h = fnv(h, k + v);
  }
  return (h >>> 0).toString(36);
}

/**
 * Parse `src` and render it block by block.
 *
 * Reference-style links still resolve: `md.parse` fills `env` with the link and
 * footnote definitions of the whole document, and every block is rendered with
 * that same `env`.
 */
export async function renderMarkdownBlocks(src: string, theme: Theme): Promise<MdBlocks> {
  const source = await prepareShiki(src, theme);
  const env: Record<string, unknown> = {};
  const tokens = md.parse(source, env) as unknown as Tok[];

  // Every *opening* token at level 0 starts a new top-level block
  // (paragraph_open, heading_open, fence, table_open, ...). Closing tokens are
  // also level 0 but must stay in the block they close.
  const groups: Tok[][] = [];
  for (const token of tokens) {
    if (token.level === 0 && token.nesting !== -1) groups.push([]);
    const group = groups[groups.length - 1];
    if (group) group.push(token);
  }

  return {
    blocks: groups.map((group) => ({
      key: blockKey(group),
      html: md.renderer.render(group as never, md.options, env),
    })),
  };
}

/** Parse one block's HTML into the single element it produces. */
function elementOf(html: string): Element | null {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.firstElementChild;
}

const KEY_ATTR = "data-mdblock";

/**
 * Make `root` show `next`, reusing the DOM nodes of blocks whose hash did not
 * change. Only the span between the longest common prefix and suffix is
 * touched, so an in-place edit replaces exactly one node.
 *
 * Returns true when the document changed at all (callers use it to decide
 * whether to re-run the decorations).
 */
export function applyBlocks(root: Element, next: MdBlocks): boolean {
  const current = Array.from(root.children);
  const currentKeys = current.map((el) => el.getAttribute(KEY_ATTR));
  const nextKeys = next.blocks.map((b) => b.key);

  const limit = Math.min(currentKeys.length, nextKeys.length);
  let head = 0;
  while (head < limit && currentKeys[head] === nextKeys[head]) head++;
  let tail = 0;
  while (
    tail < limit - head &&
    currentKeys[currentKeys.length - 1 - tail] === nextKeys[nextKeys.length - 1 - tail]
  ) {
    tail++;
  }

  const removed = current.slice(head, current.length - tail);
  if (removed.length === 0 && head + tail === nextKeys.length) {
    // Same nodes, same order: nothing to do.
    return false;
  }

  // Bulk case (first render, or a change that replaces a large span): one
  // innerHTML beats thousands of per-block template parses.
  let anchor: Element | null = current[current.length - tail] ?? null;
  if (current.length === 0 || removed.length > 512) {
    root.innerHTML = next.blocks.map((b) => b.html).join("");
    const children = root.children;
    if (children.length === next.blocks.length) {
      for (let i = 0; i < children.length; i++) children[i].setAttribute(KEY_ATTR, nextKeys[i]);
      return true;
    }
    // A block rendered to zero or several elements: fall through to the
    // per-block path, which tolerates a mismatch by dropping that block.
    root.replaceChildren();
    anchor = null;
  }

  // Nodes of removed blocks may be reused when their hash shows up again (a
  // block that moved, or an edit that reverted).
  const pool = new Map<string, Element[]>();
  for (const el of removed) {
    const key = el.getAttribute(KEY_ATTR);
    if (!key) continue;
    const bucket = pool.get(key);
    if (bucket) bucket.push(el);
    else pool.set(key, [el]);
  }

  const fragment = document.createDocumentFragment();
  for (let i = head; i < nextKeys.length - tail; i++) {
    const block = next.blocks[i];
    const reused = pool.get(block.key)?.shift();
    if (reused) {
      fragment.appendChild(reused);
      continue;
    }
    const el = elementOf(block.html);
    if (!el) continue;
    el.setAttribute(KEY_ATTR, block.key);
    fragment.appendChild(el);
  }

  for (const el of removed) el.remove();
  root.insertBefore(fragment, anchor);
  return true;
}

export const TEXT_DIRECTION_OPTIONS = ["auto", "ltr", "rtl"] as const;
export type TextDirection = (typeof TEXT_DIRECTION_OPTIONS)[number];

export const DEFAULT_TEXT_DIRECTION: TextDirection = "auto";

export function normalizeTextDirection(value: unknown): TextDirection {
  return typeof value === "string" && TEXT_DIRECTION_OPTIONS.includes(value as TextDirection)
    ? (value as TextDirection)
    : DEFAULT_TEXT_DIRECTION;
}

const TECHNICAL_SELECTOR = "code, kbd, samp, pre, .mdv-codeblock, .mdv-mermaid, .mdv-plantuml";

// Right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan,
// Arabic presentation forms.
const RTL_CHAR = /[\u0591-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

/**
 * Applies native Unicode BiDi behavior to rendered markdown without changing
 * the source. Each prose block gets its own direction in auto mode so a
 * document can mix RTL and LTR paragraphs naturally.
 *
 * Writing `dir` on every block is expensive on long documents: each attribute
 * invalidates the block's bidi paragraph, and a 10k-block file spends most of a
 * second in style recalculation. In auto mode `dir` is therefore only written
 * on blocks that actually contain RTL characters — everything else inherits the
 * element's own resolved direction, which is the same rendering.
 */
export function applyTextDirection(article: HTMLElement, direction: TextDirection): void {
  article.setAttribute("dir", direction);

  for (const child of Array.from(article.children)) {
    // A block that keeps the direction it already has needs no write.
    const wanted = direction !== "auto" || RTL_CHAR.test(child.textContent ?? "") ? direction : null;
    if (wanted === null) {
      if (child.hasAttribute("dir") && child.getAttribute("dir") === "auto") child.removeAttribute("dir");
      continue;
    }
    if (child.getAttribute("dir") !== wanted) child.setAttribute("dir", wanted);
  }

  for (const node of Array.from(article.querySelectorAll(TECHNICAL_SELECTOR))) {
    node.setAttribute("dir", "ltr");
  }
}

// Worker side of the block renderer: parse + render + shiki highlight happen
// here so a large document never blocks the UI thread.

import { renderMarkdownBlocks, type MdBlocks } from "./markdown-blocks";
import type { Theme } from "./theme";

export type RenderRequest = { id: number; src: string; theme: Theme };
export type RenderResponse = { id: number; blocks: MdBlocks };

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const { id, src, theme } = event.data;
  void renderMarkdownBlocks(src, theme).then(
    (blocks) => (self as unknown as Worker).postMessage({ id, blocks } satisfies RenderResponse),
    (error: unknown) =>
      (self as unknown as Worker).postMessage({ id, error: String(error) } as never),
  );
};

// Client side of the block renderer.
//
// One worker per app instance, at most one render in flight at a time: while a
// render is running, newer requests replace the queued one (the same
// "parse the newest version only" rule the app already used for its
// background parse).

import type { MdBlocks } from "./markdown-blocks";
import type { RenderRequest, RenderResponse } from "./markdown.worker";
import type { Theme } from "./theme";

type Waiter = { resolve: (blocks: MdBlocks) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const waiters = new Map<number, Waiter>();
/** The request that is queued but not yet sent. */
let queued: RenderRequest | null = null;
let busy = false;

function start(): Worker {
  const created = new Worker(new URL("./markdown.worker.ts", import.meta.url), {
    type: "module",
    name: "marka-md-render",
  });
  created.onmessage = (event: MessageEvent<RenderResponse & { error?: string }>) => {
    const { id, blocks, error } = event.data;
    const waiter = waiters.get(id);
    waiters.delete(id);
    busy = false;
    if (waiter) {
      if (error) waiter.reject(new Error(error));
      else if (blocks) waiter.resolve(blocks);
    }
    flush();
  };
  created.onerror = (event) => {
    // A worker that failed to load cannot be reused; drop it and fail what is
    // waiting, so the caller can fall back to rendering on this thread.
    console.error("marka.md: markdown worker failed", event.message);
    worker = null;
    busy = false;
    for (const waiter of waiters.values()) waiter.reject(new Error(event.message));
    waiters.clear();
    queued = null;
  };
  return created;
}

function flush(): void {
  if (!worker || busy || !queued) return;
  const request = queued;
  queued = null;
  busy = true;
  worker.postMessage(request);
}

/** Render `src` off the UI thread; the newest call wins. */
export function renderBlocksOffThread(src: string, theme: Theme): Promise<MdBlocks> {
  worker ??= start();
  const id = nextId++;
  return new Promise<MdBlocks>((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    queued = { id, src, theme };
    // Everyone still waiting for an older render will never see it applied.
    for (const [pendingId, waiter] of waiters) {
      if (pendingId === id) break;
      waiter.reject(new Error("superseded"));
      waiters.delete(pendingId);
    }
    flush();
  });
}

/** Whether a renderer worker is available at all (browsers with workers). */
export function blocksOffThreadAvailable(): boolean {
  return typeof Worker !== "undefined";
}

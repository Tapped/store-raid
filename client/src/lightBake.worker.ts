import { type BakeInput, bakeLight } from "./lightBake";

/** Bakes interior light off the page's thread: a BakeInput in, a BakeOutput back. */
const scope = self as unknown as {
  onmessage: (event: MessageEvent<BakeInput>) => void;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const output = bakeLight(event.data);
  scope.postMessage(output, [output.a.buffer, output.b.buffer]);
};

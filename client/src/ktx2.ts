import { AutoReleaseWorkerPool, KhronosTextureContainer2 } from "@babylonjs/core";
import { initializeWebWorker } from "@babylonjs/core/Misc/khronosTextureContainer2Worker";
import bc7 from "@babylonjs/ktx2decoder/wasm/uastc_bc7.wasm?url";
import zstd from "@babylonjs/ktx2decoder/wasm/zstddec.wasm?url";

/**
 * KTX2 textures, which models built by `pnpm run model` carry (scripts/models/ktx.ts): the GPU
 * keeps them compressed, as BC7, at a quarter of the video memory of the same picture unpacked.
 *
 * Babylon decodes them in workers, and by default fetches the decoder and its WebAssembly from its
 * CDN. Importing this module makes it use ours instead: the decoder from the npm package, bundled
 * into a worker of our own, and the two WebAssembly files it needs here, served with the game.
 */

const absolute = (url: string) => new URL(url, location.href).href;
const urls = {
  jsDecoderModule: "",
  wasmUASTCToBC7: absolute(bc7),
  wasmZSTDDecoder: absolute(zstd),
} as Parameters<typeof initializeWebWorker>[2];

/** As many at once as half the processor's threads, up to 8: a village is some sixty textures. */
const workers = Math.max(1, Math.min(8, Math.floor((navigator.hardwareConcurrency ?? 4) / 2)));

KhronosTextureContainer2.WorkerPool = new AutoReleaseWorkerPool(workers, () =>
  initializeWebWorker(
    new Worker(new URL("./ktx2Worker.ts", import.meta.url), { type: "module" }),
    undefined,
    urls,
  ),
);

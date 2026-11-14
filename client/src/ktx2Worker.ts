import { workerFunction } from "@babylonjs/core/Misc/khronosTextureContainer2Worker";
import * as decoder from "@babylonjs/ktx2decoder";

// A worker that turns KTX2 textures into what the GPU takes (see ktx2.ts). Babylon's worker code
// looks the decoder up as a global when it's told where the WebAssembly files are.
(globalThis as { KTX2DECODER?: unknown }).KTX2DECODER = decoder;
workerFunction(decoder);

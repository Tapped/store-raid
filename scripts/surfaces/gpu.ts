/**
 * WebGPU in Node (Dawn, from the `webgpu` package) for the surface baker, and WGSL modules put
 * together from files, with compile errors pointed back at the file and line they came from.
 */

import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { create, globals } from "webgpu";

Object.assign(globalThis, globals);

const here = import.meta.dirname;
export const LIB_DIR = resolve(here, "lib");
export const RECIPE_DIR = resolve(here, "recipes");

/** The GPU, kept referenced so Dawn stays up; let go of it with `closeGpu()` so Node can exit. */
let gpu: GPU | undefined;

export async function openGpu(): Promise<GPUDevice> {
  // D3D12 on Windows, where Dawn compiles with DXC: a heavy recipe takes about a second.
  gpu = create([]);
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter: the surface baker needs a GPU");
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBuffersPerShaderStage: Math.min(16, adapter.limits.maxStorageBuffersPerShaderStage),
    },
  });
  device.addEventListener("uncapturederror", (event) => {
    console.error((event as GPUUncapturedErrorEvent).error.message);
  });
  return device;
}

export function closeGpu(device: GPUDevice): void {
  device.destroy();
  gpu = undefined;
}

/** A compile error, its message already pointed at the files. */
export class ShaderError extends Error {}

/** sRGB colour (0 to 1) as linear. */
export function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * `hex(0xRRGGBB)` in WGSL becomes its linear colour as a vec3f literal, so it works in `const`s.
 * Only the line's columns move; lines stay where they were.
 */
function expandHex(text: string): string {
  return text.replace(/\bhex\(\s*0x([0-9a-fA-F]{6})\s*\)/g, (_, code: string) => {
    const n = Number.parseInt(code, 16);
    const c = [16, 8, 0].map((s) => linear(((n >> s) & 255) / 255).toPrecision(9));
    return `vec3f(${c.join(", ")})`;
  });
}

/** The library's files in the order they go in: noise, recipe, common, then the rest by name. */
export function libraryFiles(): string[] {
  const first = ["noise.wgsl", "recipe.wgsl", "common.wgsl"];
  const rest = readdirSync(LIB_DIR)
    .filter((f) => f.endsWith(".wgsl") && !first.includes(f))
    .sort();
  return [...first, ...rest].map((f) => resolve(LIB_DIR, f));
}

interface Part {
  /** The file it came from, or a name in angle brackets for generated code. */
  file: string;
  text: string;
}

/** WGSL put together from parts, which knows which part each line came from. */
export class Source {
  readonly code: string;
  private readonly parts: { file: string; start: number; lines: string[] }[] = [];

  constructor(parts: Part[]) {
    let line = 1;
    const texts: string[] = [];
    for (const part of parts) {
      const text = expandHex(part.text.replace(/\r\n/g, "\n"));
      const lines = part.text.replace(/\r\n/g, "\n").split("\n");
      this.parts.push({ file: part.file, start: line, lines });
      texts.push(text);
      line += lines.length;
    }
    this.code = texts.join("\n");
  }

  static files(files: string[], extra: Part[] = []): Source {
    return new Source([
      ...files.map((file) => ({ file, text: readFileSync(file, "utf8") })),
      ...extra,
    ]);
  }

  /** Where line `n` of the whole module came from. */
  where(n: number): { file: string; line: number; text: string } | undefined {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const part = this.parts[i];
      if (n >= part.start) {
        const line = n - part.start;
        return { file: part.file, line: line + 1, text: part.lines[line] ?? "" };
      }
    }
    return undefined;
  }

  /** Compile messages as `file:line:col: error: message`, the line, and a caret under it. */
  format(messages: readonly GPUCompilationMessage[]): string {
    const out: string[] = [];
    for (const m of messages) {
      const at = m.lineNum > 0 ? this.where(m.lineNum) : undefined;
      if (!at) {
        out.push(`${m.type}: ${m.message}`);
        continue;
      }
      const file = at.file.startsWith("<")
        ? at.file
        : relative(process.cwd(), at.file).replaceAll("\\", "/");
      const [first, ...more] = m.message.split("\n");
      out.push(`${file}:${at.line}:${m.linePos}: ${m.type}: ${first}`);
      const gutter = String(at.line).padStart(5);
      out.push(`${gutter} | ${at.text}`);
      const caret = "^".repeat(Math.max(1, Math.min(m.length, at.text.length - m.linePos + 1)));
      out.push(`${" ".repeat(5)} | ${" ".repeat(Math.max(0, m.linePos - 1))}${caret}`);
      const rest = more.join("\n").trim();
      if (rest) out.push(rest.replace(/^/gm, "        "));
    }
    return out.join("\n");
  }

  /** The module, or a ShaderError saying where it went wrong. */
  async compile(device: GPUDevice, label: string): Promise<GPUShaderModule> {
    device.pushErrorScope("validation");
    const module = device.createShaderModule({ label, code: this.code });
    const info = await module.getCompilationInfo();
    const error = await device.popErrorScope();
    const shown = info.messages.filter((m) => m.type !== "info");
    if (info.messages.some((m) => m.type === "error")) throw new ShaderError(this.format(shown));
    if (shown.length > 0) console.warn(this.format(shown));
    if (error) throw new ShaderError(error.message);
    return module;
  }
}

/** A compute pipeline, or a ShaderError with the reason. Several may be made at once. */
export async function pipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  entryPoint: string,
  layout: GPUPipelineLayout,
): Promise<GPUComputePipeline> {
  try {
    return await device.createComputePipelineAsync({ layout, compute: { module, entryPoint } });
  } catch (e) {
    throw new ShaderError(`${entryPoint}: ${(e as Error).message}`);
  }
}

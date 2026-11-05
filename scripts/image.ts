/**
 * Makes an image with Google's Nano Banana Pro (Gemini 3 Pro Image) and saves it in `assets/`.
 *
 *   pnpm run image -- "<prompt>" <path in assets/> [options]
 *
 *   --ref <file>       an image to edit or follow, repeatable (a path in assets/ or anywhere)
 *   --aspect <w:h>     1:1 (default), 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
 *   --size <1K|2K|4K>  resolution the model makes (default 1K)
 *   --resize <w[xh]>   scale the result, e.g. 1024 or 1024x512, for textures
 *   --force            overwrite an existing file
 *
 * The extension picks the format: .webp, .png or .jpg. The model's reply text, if any, is printed.
 *
 * The API key comes from GEMINI_API_KEY, which can be set in a `.env` file (git ignores it) in this
 * checkout or, for worktrees, in `main/`. See `.env.example`. GEMINI_IMAGE_MODEL overrides `gemini-3-pro-image-preview`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { sharedAssets } from "./sharedAssets";

// `pnpm run image -- ...` passes the `--` on, and parseArgs would read every flag after it as text.
const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
const { values, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    ref: { type: "string", multiple: true, default: [] },
    aspect: { type: "string", default: "1:1" },
    size: { type: "string", default: "1K" },
    resize: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

const [prompt, out] = positionals;
if (!prompt || !out) {
  console.error(
    'Usage: pnpm run image -- "<prompt>" <path in assets/> [--ref file] [--aspect 16:9]',
  );
  console.error("       [--size 1K|2K|4K] [--resize 1024[x512]] [--force]");
  process.exit(1);
}

const assets = sharedAssets();
const target = resolve(assets, out);
const format = { ".webp": "webp", ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg" }[
  extname(target).toLowerCase()
] as "webp" | "png" | "jpeg" | undefined;
if (!format) fail(`${out}: use .webp, .png or .jpg`);
if (existsSync(target) && !values.force) fail(`${out} exists: pass --force to overwrite it`);

loadEnvFiles();
const key = process.env.GEMINI_API_KEY;
if (!key)
  fail("No API key: set GEMINI_API_KEY, or add GEMINI_API_KEY=... to .env (see .env.example)");
const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image-preview";

const refs = await Promise.all(
  values.ref.map(async (file) => {
    const path = isAbsolute(file)
      ? file
      : existsSync(resolve(assets, file))
        ? resolve(assets, file)
        : resolve(file);
    // The API takes PNG, JPEG and WebP; PNG covers anything sharp reads.
    const png = await sharp(path).png().toBuffer();
    return { inlineData: { mimeType: "image/png", data: png.toString("base64") } };
  }),
);

console.log(
  `${model}: ${out} (${values.aspect}, ${values.size}${refs.length ? `, ${refs.length} ref` : ""})`,
);
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [...refs, { text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: values.aspect, imageSize: values.size },
      },
    }),
  },
);
if (!response.ok) fail(`${response.status} ${response.statusText}\n${await response.text()}`);

interface Part {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
}
const body = (await response.json()) as {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};
const candidate = body.candidates?.[0];
const parts = candidate?.content?.parts ?? [];
for (const part of parts) if (part.text && !part.thought) console.log(part.text.trim());
// Thinking models may return draft images marked as thoughts first: keep the last real one.
const image = parts.filter((p) => p.inlineData && !p.thought).at(-1)?.inlineData;
if (!image) {
  const why =
    body.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no image in the reply";
  fail(`No image: ${why}`);
}

let picture = sharp(Buffer.from(image.data, "base64"));
if (values.resize) {
  const [width, height] = values.resize.split("x").map(Number);
  picture = picture.resize(width, height || width, { fit: "fill" });
}
mkdirSync(dirname(target), { recursive: true });
const info = await picture.toFormat(format, format === "png" ? {} : { quality: 90 }).toFile(target);
console.log(`Wrote ${target} (${info.width}x${info.height}, ${Math.round(info.size / 1024)} KB)`);

/** Loads `.env` from this checkout, then from `main/`. Neither overrides what's already set. */
function loadEnvFiles() {
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
  }).trim();
  for (const checkout of new Set([resolve(import.meta.dirname, ".."), dirname(gitDir)])) {
    const file = resolve(checkout, ".env");
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Reads a `.unitypackage`: a tar.gz holding one folder per asset, named by its guid, with the file
 * (`asset`), Unity's import settings (`asset.meta`) and its path in the Unity project (`pathname`).
 *
 * Files are written to `<dir>/x/<guid>/` and nowhere else: entry names are only ever used once
 * they match a guid, so a hostile package can't write outside the cache.
 */
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createGunzip } from "node:zlib";

export interface Entry {
  guid: string;
  /** The asset's path in the Unity project, e.g. `Assets/Pack/Prefabs/SM_Crate.prefab`. */
  path: string;
}

const ENTRY = /^(?:\.\/)?([0-9a-f]{32})\/(asset|asset\.meta|pathname)$/;
/** Assets up to this size are kept on the first pass, so prefabs and materials never need a second. */
const SMALL = 4 * 1024 * 1024;

type OnFile = (guid: string, part: string, data: Buffer) => void;

/** Streams the package once, handing over each wanted file whole. */
async function readPackage(
  file: string,
  want: (guid: string, part: string, size: number) => boolean,
  onFile: OnFile,
) {
  let buf: Buffer = Buffer.alloc(0);
  let longName: string | null = null;
  let entry: {
    name: string;
    type: string;
    keep: boolean;
    chunks: Buffer[];
    remain: number;
    pad: number;
  } | null = null;

  for await (const chunk of createReadStream(file).pipe(createGunzip()) as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (entry) {
        const n = Math.min(entry.remain, buf.length);
        if (n && entry.keep) entry.chunks.push(buf.subarray(0, n));
        buf = buf.subarray(n);
        entry.remain -= n;
        if (entry.remain > 0 || buf.length < entry.pad) break;
        buf = buf.subarray(entry.pad);
        if (entry.keep) {
          const data = Buffer.concat(entry.chunks);
          if (entry.type === "L") {
            longName = data.toString("utf8").replace(/\0.*$/s, "");
          } else {
            const m = ENTRY.exec(entry.name);
            if (m) onFile(m[1], m[2], data);
          }
        }
        entry = null;
        continue;
      }
      if (buf.length < 512) break;
      const header = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (header.every((b) => b === 0)) continue;
      const field = (from: number, to: number) =>
        header.toString("latin1", from, to).replace(/\0.*$/s, "");
      let name = field(0, 100);
      const prefix = field(345, 500);
      if (prefix) name = `${prefix}/${name}`;
      if (longName) {
        name = longName;
        longName = null;
      }
      const size = Number.parseInt(field(124, 136).trim() || "0", 8);
      const type = String.fromCharCode(header[156]);
      const m = ENTRY.exec(name);
      const isFile = type === "0" || type === "\0";
      entry = {
        name,
        type,
        keep: type === "L" || (isFile && !!m && want(m[1], m[2], size)),
        chunks: [],
        remain: size,
        pad: (512 - (size % 512)) % 512,
      };
    }
  }
}

export class UnityPackage {
  readonly entries = new Map<string, Entry>();

  private constructor(
    readonly file: string,
    readonly dir: string,
  ) {}

  /** Opens a package, indexing it on the first run and reusing the index after. */
  static async open(file: string, dir: string): Promise<UnityPackage> {
    const pkg = new UnityPackage(file, dir);
    const stamp = `${statSync(file).size}:${statSync(file).mtimeMs}`;
    const indexFile = `${dir}/index.json`;
    if (existsSync(indexFile)) {
      const index = JSON.parse(readFileSync(indexFile, "utf8")) as {
        stamp: string;
        entries: Entry[];
      };
      if (index.stamp === stamp) {
        for (const e of index.entries) pkg.entries.set(e.guid, e);
        return pkg;
      }
    }
    console.log(`Indexing ${file}...`);
    await readPackage(
      file,
      (_guid, part, size) => part !== "asset" || size <= SMALL,
      (guid, part, data) => {
        if (part === "pathname") {
          const path = data.toString("utf8").split("\n")[0].trim();
          pkg.entries.set(guid, { guid, path });
        } else {
          pkg.write(guid, part, data);
        }
      },
    );
    writeFileSync(indexFile, JSON.stringify({ stamp, entries: [...pkg.entries.values()] }));
    return pkg;
  }

  private write(guid: string, part: string, data: Buffer) {
    mkdirSync(`${this.dir}/x/${guid}`, { recursive: true });
    writeFileSync(`${this.dir}/x/${guid}/${part}`, data);
  }

  /** Where an asset's file is on disk, once extracted. */
  assetFile(guid: string): string {
    return `${this.dir}/x/${guid}/asset`;
  }

  has(guid: string): boolean {
    return existsSync(this.assetFile(guid));
  }

  text(guid: string): string {
    return readFileSync(this.assetFile(guid), "utf8");
  }

  path(guid: string): string | undefined {
    return this.entries.get(guid)?.path;
  }

  /** The file name of an asset, e.g. `SM_Crate.prefab`. */
  name(guid: string): string | undefined {
    return this.path(guid)?.split("/").pop();
  }

  find(test: (e: Entry) => boolean): Entry[] {
    return [...this.entries.values()].filter(test);
  }

  /** Makes sure these assets are on disk, reading the package again only if some aren't. */
  async extract(guids: Iterable<string>) {
    const missing = new Set([...guids].filter((g) => this.entries.has(g) && !this.has(g)));
    if (!missing.size) return;
    console.log(`Extracting ${missing.size} large assets...`);
    await readPackage(
      this.file,
      (guid, part) => missing.has(guid) && part !== "pathname",
      (guid, part, data) => this.write(guid, part, data),
    );
  }
}

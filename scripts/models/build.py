"""
Run by index.ts inside Blender. Arguments after --:

  <job.json>                   run one job (see pipeline.py) and exit
  --serve <dir> <idle seconds> stay running: take each <dir>/*.job.json in turn, run it, and exit
                               after that long without a job. Saves starting Blender, importing
                               the exporter and loading Cycles' kernels on every build.

Every job writes {"models": {name: result}, "log": [lines]} to the job's "result" path, the log
being the lines printed with a MODEL prefix. Before each job, pipeline.py, lib.py and every other
module in this folder are loaded again, so edits to them take effect without restarting.
"""

import glob
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


class Log:
    """Passes stdout through, keeping the MODEL lines for the result."""

    def __init__(self, out):
        self.out, self.lines, self.partial = out, [], ""

    def write(self, text):
        self.out.write(text)
        self.partial += text
        *done, self.partial = self.partial.split("\n")
        self.lines += [line[6:] for line in done if line.startswith("MODEL ")]

    def flush(self):
        self.out.flush()


def fresh_modules():
    """Forget every module loaded from this folder, so the next import reads it from disk."""
    for name, mod in list(sys.modules.items()):
        path = getattr(mod, "__file__", None) or ""
        if name != "__main__" and os.path.abspath(path).startswith(HERE + os.sep):
            del sys.modules[name]


def run(job_path):
    job = json.load(open(job_path, encoding="utf8"))
    log = Log(sys.stdout)
    sys.stdout = log
    try:
        fresh_modules()
        import pipeline

        models = pipeline.run(job)
    except Exception:
        import traceback

        for line in traceback.format_exc().splitlines():
            print("MODEL", line)
        models = {}
    finally:
        sys.stdout = log.out
    tmp = job["result"] + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump({"models": models, "log": log.lines}, f)
    os.replace(tmp, job["result"])


def _age(path):
    try:
        return os.path.getmtime(path)
    except OSError:  # taken by another server meanwhile
        return 0


def serve(folder, idle):
    os.makedirs(folder, exist_ok=True)
    pid = os.getpid()
    marker = os.path.join(folder, "server.json")
    with open(marker, "w", encoding="utf8") as f:
        json.dump({"pid": pid}, f)
    print(f"Serving model jobs from {folder}, until {idle} s without one", flush=True)
    last = time.time()
    while time.time() - last < idle:
        jobs = sorted(glob.glob(os.path.join(folder, "*.job.json")), key=_age)
        if not jobs:
            time.sleep(0.1)
            continue
        for path in jobs:
            claimed = f"{path[: -len('.job.json')]}.{pid}.running"
            try:
                os.rename(path, claimed)  # another server may have taken it
            except OSError:
                continue
            started = time.time()
            run(claimed)
            os.remove(claimed)
            print(f"Job {os.path.basename(path)} took {time.time() - started:.1f} s", flush=True)
            last = time.time()
    try:
        if json.load(open(marker, encoding="utf8")).get("pid") == pid:
            os.remove(marker)
    except (OSError, ValueError):
        pass


args = sys.argv[sys.argv.index("--") + 1:]
if args[0] == "--serve":
    serve(args[1], float(args[2]))
else:
    run(args[0])

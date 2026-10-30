const POLL_MS = 5000;

/** The commit main was built from. The merge bot writes this file as it swaps in a finished build. */
async function deployedBuild(): Promise<string | undefined> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}.game-build`, { cache: "no-store" });
    const text = (await res.text()).trim();
    // Anything else is a missing file answered with the page itself.
    return res.ok && /^[0-9a-f]{40}$/.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Reloads the page as soon as a newer build of main is being served. */
export function reloadOnNewBuild(): void {
  let loaded: string | undefined;
  setInterval(async () => {
    const build = await deployedBuild();
    if (!build) return;
    loaded ??= build;
    if (build === loaded) return;
    location.reload();
  }, POLL_MS);
}

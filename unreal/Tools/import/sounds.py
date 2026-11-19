"""
Imports staged sounds into Content/, run in a headless editor by `pnpm run ue sounds`.

`sounds.ts` has written each sound in `../assets/audio/sfx` as a WAV in `Saved/Import/sounds/`,
with `sounds.json` saying which of them loop. Each goes to `/Game/Audio/<name>` as a sound wave,
which script plays by name (`Sounds::Wave` in Script/Sound/Sounds.as). A loop is marked looping,
and plays on silently while it's out of earshot, so it's still going when the listener comes back.

Content/ is never in git: running this again rebuilds the sounds.
"""

import json
import os

import unreal

STAGED = os.path.join(unreal.Paths.project_saved_dir(), "Import", "sounds")
ROOT = "/Game/Audio"


def log(text):
    unreal.log("sounds: " + text)


def main():
    with open(os.path.join(STAGED, "sounds.json"), encoding="utf-8") as f:
        sounds = json.load(f)
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    imported = 0
    failed = 0
    for sound in sounds:
        name = sound["name"]
        task = unreal.AssetImportTask()
        task.set_editor_property("filename", os.path.join(STAGED, name + ".wav"))
        task.set_editor_property("destination_path", ROOT)
        task.set_editor_property("destination_name", name)
        task.set_editor_property("replace_existing", True)
        task.set_editor_property("automated", True)
        task.set_editor_property("save", False)
        tools.import_asset_tasks([task])
        wave = unreal.load_asset(f"{ROOT}/{name}.{name}")
        if not isinstance(wave, unreal.SoundWave):
            log(f"{name} failed: no sound wave")
            failed += 1
            continue
        wave.set_editor_property("looping", sound["loop"])
        if sound["loop"]:
            wave.set_editor_property(
                "virtualization_mode", unreal.VirtualizationMode.PLAY_WHEN_SILENT
            )
        unreal.EditorAssetLibrary.save_loaded_asset(wave, False)
        log(f"{name} ok {wave.get_editor_property('duration'):.2f} s{' loop' if sound['loop'] else ''}")
        imported += 1
    log(f"done: {imported} imported, {failed} failed")


main()

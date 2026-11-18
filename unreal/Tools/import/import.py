"""
Imports staged models into Content/, run in a headless editor by `pnpm run ue import`.

`stage.ts` has written each model in `../assets/models` as a glTF Interchange can read, in
`Saved/Import/models/<folder>/<name>.glb`. Each goes to `/Game/Models/<folder>/<name>/`: the mesh,
named `<name>`, beside its materials and textures. A static model's nodes are combined into one
static mesh, built with Nanite; a skinned one (characters) is a skeletal mesh with its skeleton
and animations. Materials are Interchange's glTF material instances.

Content/ is never in git: throwing it away and running the import again rebuilds it.
The list of models comes in the file named by the environment's STORE_RAID_IMPORT, one name per
line (`props/tv`); a line per model goes to the log as `import: <name> ...`, and a summary at the end.
"""

import os

import unreal

STAGED = os.path.join(unreal.Paths.project_saved_dir(), "Import", "models")
ROOT = "/Game/Models"


def log(text):
    unreal.log("import: " + text)


def pipelines(skinned):
    """The glTF pipeline (materials from glTF's model) and a generic assets pipeline, with Nanite."""
    stack = unreal.InterchangePipelineStackOverride()
    stack.add_pipeline(unreal.InterchangeGLTFPipeline())
    assets = unreal.InterchangeGenericAssetsPipeline()
    assets.set_editor_property("use_source_name_for_asset", True)
    assets.set_editor_property("asset_type_sub_folders", False)
    # Interchange turns glTF's (x, y, z) into Unreal's (x, z, y). The game's models face glTF's +z
    # and their right is -x (as Babylon loads them), which should be Unreal's +X (north, as
    # World::ToWorld has it) and +Y (east): a quarter turn back about the vertical. Not for a skinned
    # model: Interchange turns its skeleton by the offset but not its vertices, so posed bones and the
    # mesh they move are a quarter turn apart. Those face Unreal's +Y, and script turns the component.
    if not skinned:
        assets.set_editor_property("import_offset_rotation", unreal.Rotator(roll=0, pitch=0, yaw=-90))
    mesh = assets.get_editor_property("mesh_pipeline")
    mesh.set_editor_property("import_static_meshes", True)
    mesh.set_editor_property(
        "combine_static_meshes_behavior", unreal.InterchangeCombineStaticMeshesBehavior.ALL
    )
    mesh.set_editor_property("build_nanite", True)
    mesh.set_editor_property("generate_lightmap_u_vs", False)
    mesh.set_editor_property("import_skeletal_meshes", skinned)
    mesh.set_editor_property("create_physics_asset", False)
    animation = assets.get_editor_property("animation_pipeline")
    animation.set_editor_property("import_animations", skinned)
    stack.add_pipeline(assets)
    return stack


def is_skinned(path):
    """Whether a glTF binary has skins, from its JSON chunk."""
    import json
    import struct

    with open(path, "rb") as file:
        file.seek(12)
        length, _ = struct.unpack("<II", file.read(8))
        return bool(json.loads(file.read(length)).get("skins"))


def allow_usage(paths, flags):
    """
    Interchange makes materials without usage flags but the default ones, and the game then draws
    a mesh used another way with the default material: a skinned model's on a skeletal mesh, and a
    static one's on instanced static meshes, which props, scenery and the level's pieces are drawn
    as. Sets the flags on each material of ours the model's materials rest on.
    """
    bases = {}
    for path in paths:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.MaterialInterface):
            base = asset.get_base_material()
            bases[base.get_path_name()] = base
    for path, base in bases.items():
        if not path.startswith("/Game/"):
            log(f"  {path} is the engine's: can't set its usage")
            continue
        missing = [flag for flag in flags if not base.get_editor_property(flag)]
        if missing:
            for flag in missing:
                base.set_editor_property(flag, True)
            unreal.MaterialEditingLibrary.recompile_material(base)
            unreal.EditorAssetLibrary.save_loaded_asset(base)


def import_model(name):
    source = os.path.join(STAGED, name + ".glb")
    destination = ROOT + "/" + name
    skinned = is_skinned(source)
    # ue.ts has removed the model's folder before the editor started: deleting it here would leave
    # its objects in memory, which the import then skips making again.
    task = unreal.AssetImportTask()
    task.filename = source
    task.destination_path = destination
    task.automated = True
    task.replace_existing = True
    task.save = True
    task.options = pipelines(skinned)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = unreal.EditorAssetLibrary.list_assets(destination, recursive=True)
    if skinned:
        allow_usage(paths, ["used_with_skeletal_mesh"])
    else:
        allow_usage(paths, ["used_with_instanced_static_meshes", "used_with_nanite"])
    meshes = []
    for path in paths:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.StaticMesh):
            nanite = asset.get_editor_property("nanite_settings").get_editor_property("enabled")
            tris = asset.get_num_triangles(0)
            box = asset.get_bounding_box()
            lo, hi = box.min / 100, box.max / 100
            meshes.append(
                f"{asset.get_name()} static nanite={nanite} tris={tris}"
                f" x {lo.x:.2f}..{hi.x:.2f} y {lo.y:.2f}..{hi.y:.2f} z {lo.z:.2f}..{hi.z:.2f}"
            )
        elif isinstance(asset, unreal.SkeletalMesh):
            meshes.append(f"{asset.get_name()} skeletal")
        elif isinstance(asset, unreal.AnimSequence):
            meshes.append(f"{asset.get_name()} animation")
    ok = bool(meshes)
    log(f"{name} {'ok' if ok else 'FAILED'} {len(paths)} assets: {'; '.join(meshes)}")
    return ok


def main():
    with open(os.environ["STORE_RAID_IMPORT"], encoding="utf8") as file:
        names = [line.strip() for line in file if line.strip()]
    failed = [name for name in names if not import_model(name)]
    log(f"done: {len(names) - len(failed)} imported, {len(failed)} failed {' '.join(failed)}")


main()

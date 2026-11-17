"""
The surface library as materials, run in a headless editor by `pnpm run ue surfaces`.

`surfaces.ts` has staged each surface's textures as PNG in `Saved/Import/surfaces/`, with
`surfaces.json` saying each one's tile, tint and whether it's upright. Each surface goes to
`/Game/Surfaces/<name>/`: its textures `<name>-base` (sRGB colour, paint coverage in alpha),
`<name>-normal` (OpenGL's convention, green up the picture, as baked) and `<name>-orm` (AO,
roughness, metalness), and `MI_<name>`, an instance of `/Game/Surfaces/M_Surface`.

M_Surface projects its textures from the world, so a mesh needs no texture coordinates: a box
scaled to any size shows its surface at the real size, `Tile` meters a repeat. Each face takes the
plane its normal is closest to: floors and ceilings x and y, walls along themselves and up, with v
0 on every multiple of `Tile` in height, as upright surfaces in the web game have v 0 on a storey's
floor. The normal map is turned into the world by the same projection, so the material's normal is
in world space. The colour is the bake's plus the paint where its alpha lets it, `base + tint *
alpha`, the paint in linear colour from an instance's custom data 0 to 2 (an instanced mesh paints
each instance its own colour), else the `Tint` parameter. Surfaces that can't be painted have a
tint of black.

Content/ is never in git: running this again rebuilds the surfaces.
"""

import json
import os

import unreal

STAGED = os.path.join(unreal.Paths.project_saved_dir(), "Import", "surfaces")
ROOT = "/Game/Surfaces"
MATERIAL = ROOT + "/M_Surface"

assets = unreal.AssetToolsHelpers.get_asset_tools()
library = unreal.MaterialEditingLibrary


def log(text):
    unreal.log("surfaces: " + text)


def import_texture(name, kind):
    source = os.path.join(STAGED, f"{name}-{kind}.png")
    folder = f"{ROOT}/{name}"
    task = unreal.AssetImportTask()
    task.filename = source
    task.destination_path = folder
    task.destination_name = f"{name}-{kind}"
    task.automated = True
    task.replace_existing = True
    task.save = False
    assets.import_asset_tasks([task])
    texture = unreal.EditorAssetLibrary.load_asset(f"{folder}/{name}-{kind}")
    if texture is None:
        raise RuntimeError(f"{source} didn't import")
    if kind == "base":
        texture.set_editor_property("srgb", True)
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_DEFAULT)
    elif kind == "normal":
        texture.set_editor_property("srgb", False)
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        texture.set_editor_property("flip_green_channel", False)
    else:
        texture.set_editor_property("srgb", False)
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
    texture.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_WORLD)
    unreal.EditorAssetLibrary.save_loaded_asset(texture)
    return texture


# The plane a face is projected from, by its normal N (world space): floors and ceilings take x and
# y, walls along themselves and z. U is the world direction of +u, V of up the picture (-v).
PROJECTION = """
float3 A = abs(N);
float3 U;
float3 V;
if (A.z >= A.x && A.z >= A.y) { U = float3(0, N.z >= 0 ? 1 : -1, 0); V = float3(1, 0, 0); }
else if (A.x >= A.y) { U = float3(0, N.x >= 0 ? -1 : 1, 0); V = float3(0, 0, 1); }
else { U = float3(N.y >= 0 ? 1 : -1, 0, 0); V = float3(0, 0, 1); }
"""

UV_CODE = PROJECTION + """
float3 M = P * 0.01;
return float2(dot(M, U), -dot(M, V)) / Tile;
"""

NORMAL_CODE = PROJECTION + """
return normalize(T.x * U + T.y * V + T.z * N);
"""


def custom(material, code, output, inputs, x, y):
    node = library.create_material_expression(material, unreal.MaterialExpressionCustom, x, y)
    node.set_editor_property("code", code)
    node.set_editor_property("output_type", output)
    pins = []
    for name in inputs:
        pin = unreal.CustomInput()
        pin.set_editor_property("input_name", name)
        pins.append(pin)
    node.set_editor_property("inputs", pins)
    return node


def texture_parameter(material, name, sampler, texture, x, y):
    node = library.create_material_expression(material, unreal.MaterialExpressionTextureSampleParameter2D, x, y)
    node.set_editor_property("parameter_name", name)
    node.set_editor_property("sampler_type", sampler)
    node.set_editor_property("texture", texture)
    return node


def make_material(defaults):
    """M_Surface, with the textures of `defaults` (a staged surface's name) as its parameters' defaults."""
    # Built again in place, so the instances that already point at it keep it.
    if unreal.EditorAssetLibrary.does_asset_exist(MATERIAL):
        material = unreal.EditorAssetLibrary.load_asset(MATERIAL)
        library.delete_all_material_expressions(material)
    else:
        material = assets.create_asset("M_Surface", ROOT, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property("tangent_space_normal", False)
    material.set_editor_property("used_with_instanced_static_meshes", True)

    position = library.create_material_expression(material, unreal.MaterialExpressionWorldPosition, -1400, 0)
    normal = library.create_material_expression(material, unreal.MaterialExpressionVertexNormalWS, -1400, 200)
    tile = library.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -1400, 400)
    tile.set_editor_property("parameter_name", "Tile")
    tile.set_editor_property("default_value", 1.0)

    uv = custom(material, UV_CODE, unreal.CustomMaterialOutputType.CMOT_FLOAT2, ["P", "N", "Tile"], -1100, 100)
    library.connect_material_expressions(position, "", uv, "P")
    library.connect_material_expressions(normal, "", uv, "N")
    library.connect_material_expressions(tile, "", uv, "Tile")

    folder = f"{ROOT}/{defaults}/{defaults}"
    load = unreal.EditorAssetLibrary.load_asset
    base = texture_parameter(material, "Base", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, load(f"{folder}-base"), -800, -300)
    bump = texture_parameter(material, "Normal", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, load(f"{folder}-normal"), -800, 100)
    orm = texture_parameter(material, "ORM", unreal.MaterialSamplerType.SAMPLERTYPE_MASKS, load(f"{folder}-orm"), -800, 500)
    for sample in (base, bump, orm):
        library.connect_material_expressions(uv, "", sample, "UVs")

    # The paint: an instance's custom data, else the parameter.
    tint = library.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -800, -600)
    tint.set_editor_property("parameter_name", "Tint")
    tint.set_editor_property("default_value", unreal.LinearColor(0, 0, 0, 1))
    paint = library.create_material_expression(material, unreal.MaterialExpressionPerInstanceCustomData3Vector, -500, -600)
    paint.set_editor_property("data_index", 0)
    library.connect_material_expressions(tint, "", paint, "DefaultValue")
    painted = library.create_material_expression(material, unreal.MaterialExpressionMultiply, -300, -500)
    library.connect_material_expressions(paint, "", painted, "A")
    library.connect_material_expressions(base, "A", painted, "B")
    colour = library.create_material_expression(material, unreal.MaterialExpressionAdd, -150, -400)
    library.connect_material_expressions(base, "RGB", colour, "A")
    library.connect_material_expressions(painted, "", colour, "B")
    library.connect_material_property(colour, "", unreal.MaterialProperty.MP_BASE_COLOR)

    world = custom(material, NORMAL_CODE, unreal.CustomMaterialOutputType.CMOT_FLOAT3, ["T", "N"], -400, 100)
    library.connect_material_expressions(bump, "RGB", world, "T")
    library.connect_material_expressions(normal, "", world, "N")
    library.connect_material_property(world, "", unreal.MaterialProperty.MP_NORMAL)

    library.connect_material_property(orm, "R", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION)
    library.connect_material_property(orm, "G", unreal.MaterialProperty.MP_ROUGHNESS)
    library.connect_material_property(orm, "B", unreal.MaterialProperty.MP_METALLIC)

    library.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    return material


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_instance(material, surface):
    name = surface["name"]
    folder = f"{ROOT}/{name}"
    path = f"{folder}/MI_{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    instance = assets.create_asset(f"MI_{name}", folder, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    library.set_material_instance_parent(instance, material)
    load = unreal.EditorAssetLibrary.load_asset
    library.set_material_instance_texture_parameter_value(instance, "Base", load(f"{folder}/{name}-base"))
    library.set_material_instance_texture_parameter_value(instance, "Normal", load(f"{folder}/{name}-normal"))
    library.set_material_instance_texture_parameter_value(instance, "ORM", load(f"{folder}/{name}-orm"))
    library.set_material_instance_scalar_parameter_value(instance, "Tile", surface["tile"])
    tint = surface["tint"]
    if tint:
        r, g, b = (srgb_to_linear(c) for c in tint)
        library.set_material_instance_vector_parameter_value(instance, "Tint", unreal.LinearColor(r, g, b, 1))
    library.update_material_instance(instance)
    unreal.EditorAssetLibrary.save_loaded_asset(instance)


def main():
    with open(os.path.join(STAGED, "surfaces.json"), encoding="utf8") as file:
        surfaces = json.load(file)
    done = []
    failed = []
    for surface in surfaces:
        try:
            for kind in ("base", "normal", "orm"):
                import_texture(surface["name"], kind)
            done.append(surface)
            log(f"{surface['name']} textures ok")
        except Exception as error:  # noqa: BLE001 - reported and counted
            failed.append(surface["name"])
            log(f"{surface['name']} FAILED: {error}")
    if not done:
        log("done: 0 made, nothing imported")
        return
    defaults = "concrete-block" if any(s["name"] == "concrete-block" for s in done) else done[0]["name"]
    material = make_material(defaults)
    for surface in done:
        make_instance(material, surface)
    log(f"done: {len(done)} made, {len(failed)} failed {' '.join(failed)}")


main()

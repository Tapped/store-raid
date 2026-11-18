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

Wear darkens the colour as client/src/parts.ts and building.ts bake it into vertex colours, but per
pixel, from the world position and what an instance's custom data 3 to 14 says about where it is
(`FWear` in Script/Level/Building.as): dirt rising from the floor, darker corners, scuffs, damp,
oil, slow patchiness. Painted surfaces are multiplied by it, the others by it in a warm grime
colour (`Painted` says which). An instance without that data has no wear.

It also makes `/Game/Surfaces/M_Glow`, which isn't a surface: the glow of a flickering fitting
(Script/Level/Fittings.as), its emissive `Glow`, set every frame from the fitting's flicker; and
`/Game/Surfaces/M_Dying`, the post-process that shows a player close to death (Script/UI/Dying.as).

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
return normalize((T.x * U + T.y * V) * Bump + T.z * N);
"""


# Wear, per pixel: `WEAR` and the wear functions of client/src/building.ts, with parts.ts's noise3
# bit for bit, in game meters (x east, y up, z north). D1 to D4 are the instance's custom data 3 to
# 14: kind, floor, ceiling; dirt, flags, extra; and four numbers that depend on the kind. Returns the
# surface's colour, worn.
WEAR_CODE = """
struct Worn
{
    float Hash(int3 C, int Seed)
    {
        uint H = (asuint(C.x) * 0x27d4eb2du) ^ (asuint(C.y) * 0x165667b1u) ^ (asuint(C.z) * 0x9e3779b1u) ^ asuint(Seed);
        H = (H ^ (H >> 15)) * 0x85ebca77u;
        H = (H ^ (H >> 13)) * 0xc2b2ae3du;
        return float(H ^ (H >> 16)) / 4294967296.0;
    }
    float Noise(float3 P, int Seed)
    {
        float3 I = floor(P);
        float3 F = P - I;
        float3 S = F * F * (3 - 2 * F);
        int3 C = int3(I);
        float A = lerp(lerp(Hash(C, Seed), Hash(C + int3(1, 0, 0), Seed), S.x), lerp(Hash(C + int3(0, 1, 0), Seed), Hash(C + int3(1, 1, 0), Seed), S.x), S.y);
        float B = lerp(lerp(Hash(C + int3(0, 0, 1), Seed), Hash(C + int3(1, 0, 1), Seed), S.x), lerp(Hash(C + int3(0, 1, 1), Seed), Hash(C + int3(1, 1, 1), Seed), S.x), S.y);
        return lerp(A, B, S.z);
    }
    float Mottle(float3 P, int Seed)
    {
        float N = Noise(P / 2.3, Seed) * 0.65 + Noise(P / 0.7, Seed + 9) * 0.35;
        return 1 + (N - 0.5) * 2 * 0.12;
    }
    // How much of the square R round a point on a floor or ceiling is wall, from where its four walls' faces are.
    float Enclosed(float3 G, float4 Faces, float R)
    {
        float X = saturate((R - (G.x - Faces.x)) / (2 * R)) + saturate((R - (Faces.y - G.x)) / (2 * R));
        float Z = saturate((R - (G.z - Faces.z)) / (2 * R)) + saturate((R - (Faces.w - G.z)) / (2 * R));
        return saturate(X + Z - X * Z);
    }
};
Worn W;
const float GRIME = 0.55;
const float CORNERS = 0.5;
const float SCUFFS = 0.18;
const float DAMP = 0.3;
float3 G = float3(P.y, P.z, P.x) * 0.01;
float3 Nm = float3(N.y, N.z, N.x);
int Kind = (int)round(D1.x);
float Base = D1.y;
float Ceiling = D1.z;
float Dirt = D2.x;
int Flags = (int)round(D2.y);
int Seed = (int)round(D4.y);
float K = 1;
if (Kind == 1)
{
    // A wall: grime from the floor, corners, scuffs, damp, the ceiling's edge.
    float H = G.y - Base;
    K = W.Mottle(G, Seed);
    float Patch = 0.6 + 0.4 * W.Noise(float3(G.x * 1.3, 0, G.z * 1.3), Seed + 3);
    K *= 1 - GRIME * Dirt * 0.6 * (1 - smoothstep(0, 0.5, H)) * Patch;
    if (abs(Nm.y) < 0.5)
    {
        float Along = abs(Nm.x) > 0.5 ? G.z : G.x;
        // D3.x and D3.y: where the face's corners are along it; D3.z and D4.x: how dark each corner is.
        float Corner = max(D3.z * saturate(1 - (Along - D3.x) / 0.5), D4.x * saturate(1 - (D3.y - Along) / 0.5));
        K *= 1 - CORNERS * 0.7 * Corner;
        if ((Flags & 1) != 0 && H > 0.1 && H < 1.2)
        {
            float S = smoothstep(0.5, 0.75, W.Noise(float3(G.x * 1.6, G.y * 3, G.z * 1.6), Seed + 5));
            K *= 1 - SCUFFS * S * Dirt * smoothstep(0.1, 0.3, H) * (1 - smoothstep(0.9, 1.2, H));
        }
        if ((Flags & 2) != 0)
        {
            float Storey = D2.z;
            float Streak = smoothstep(0.62, 0.8, W.Noise(float3(Along * 1.8, 0.5, Storey), Seed + 11));
            float Reach = 0.6 + 1.6 * W.Noise(float3(Along * 0.7, 2.5, Storey), Seed + 12);
            K *= 1 - DAMP * 0.8 * Streak * smoothstep(Ceiling - Base - Reach, Ceiling - Base, H);
            K *= 1 - DAMP * 0.4 * (1 - smoothstep(0.2, 0.45, H));
        }
    }
    K *= 1 - 0.15 * (1 - smoothstep(0, 0.4, Ceiling - G.y));
    K = max(0.15, K);
}
else if (Kind == 2)
{
    // A floor: darker by the walls, oil, broad dirt. D2.z is the oil, D4.z the floor's tone.
    K = W.Mottle(G, Seed) * D4.z;
    float Occ = W.Enclosed(G, float4(D3.x, D3.y, D3.z, D4.x), 0.4);
    K *= 1 - CORNERS * 0.6 * smoothstep(0.05, 0.6, Occ) * (0.5 + Dirt * 0.5);
    if (D2.z > 0)
        K *= 1 - 0.4 * D2.z * smoothstep(0.55, 0.78, W.Noise(float3(G.x / 1.4, 0, G.z / 1.4), Seed + 21));
    K *= 1 - 0.15 * Dirt * W.Noise(float3(G.x / 3, 1, G.z / 3), Seed + 22);
    K = max(0.2, K);
}
else if (Kind == 3)
{
    // A ceiling: darker by the walls, damp stains.
    K = W.Mottle(G, Seed + 1);
    float Occ = W.Enclosed(G, float4(D3.x, D3.y, D3.z, D4.x), 0.4);
    K *= 1 - CORNERS * 0.5 * smoothstep(0.05, 0.6, Occ);
    if ((Flags & 2) != 0)
        K *= 1 - DAMP * 0.7 * smoothstep(0.6, 0.8, W.Noise(float3(G.x / 1.7, 3, G.z / 1.7), Seed + 31));
    K = max(0.2, K);
}
else if (Kind == 4)
{
    // Steelwork and fittings: mottled, darker low down.
    K = W.Mottle(G, Seed + 2) * (1 - 0.3 * Dirt * (1 - smoothstep(0, 0.4, G.y - Base)));
}
if (Painted > 0.5)
    return Colour * K;
// Grime's colour on surfaces that aren't painted: a little warm.
const float3 TINT = float3(0.86, 0.8, 0.72);
return Colour * K * (TINT + (1 - TINT) * min(1, K));
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
    # The corrugated sheets laid over cladding are imported models, with Nanite.
    material.set_editor_property("used_with_nanite", True)

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

    # Wear, from the instance's custom data 3 to 14; none without it (kind 0).
    is_painted = library.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -500, -900)
    is_painted.set_editor_property("parameter_name", "Painted")
    is_painted.set_editor_property("default_value", 0.0)
    inputs = ["Colour", "Painted", "P", "N", "D1", "D2", "D3", "D4"]
    worn = custom(material, WEAR_CODE, unreal.CustomMaterialOutputType.CMOT_FLOAT3, inputs, 0, -700)
    library.connect_material_expressions(colour, "", worn, "Colour")
    library.connect_material_expressions(is_painted, "", worn, "Painted")
    library.connect_material_expressions(position, "", worn, "P")
    library.connect_material_expressions(normal, "", worn, "N")
    for k, index in enumerate((3, 6, 9, 12)):
        data = library.create_material_expression(
            material, unreal.MaterialExpressionPerInstanceCustomData3Vector, -300, -1200 + k * 120
        )
        data.set_editor_property("data_index", index)
        library.connect_material_expressions(data, "", worn, f"D{k + 1}")
    library.connect_material_property(worn, "", unreal.MaterialProperty.MP_BASE_COLOR)

    # How strong the baked bumps are: less where the geometry has them too (corrugated sheets).
    strength = library.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -700, 300)
    strength.set_editor_property("parameter_name", "Bump")
    strength.set_editor_property("default_value", 1.0)
    world = custom(material, NORMAL_CODE, unreal.CustomMaterialOutputType.CMOT_FLOAT3, ["T", "N", "Bump"], -400, 100)
    library.connect_material_expressions(bump, "RGB", world, "T")
    library.connect_material_expressions(normal, "", world, "N")
    library.connect_material_expressions(strength, "", world, "Bump")
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
    library.set_material_instance_scalar_parameter_value(instance, "Painted", 1.0 if tint else 0.0)
    if tint:
        r, g, b = (srgb_to_linear(c) for c in tint)
        library.set_material_instance_vector_parameter_value(instance, "Tint", unreal.LinearColor(r, g, b, 1))
    library.update_material_instance(instance)
    unreal.EditorAssetLibrary.save_loaded_asset(instance)


def make_glow():
    """M_Glow: a dark, glossy surface giving off `Glow`, linear colour times strength."""
    path = ROOT + "/M_Glow"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        material = unreal.EditorAssetLibrary.load_asset(path)
        library.delete_all_material_expressions(material)
    else:
        material = assets.create_asset("M_Glow", ROOT, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property("two_sided", True)
    material.set_editor_property("used_with_nanite", True)
    glow = library.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -400, 0)
    glow.set_editor_property("parameter_name", "Glow")
    glow.set_editor_property("default_value", unreal.LinearColor(3, 2.85, 2.58, 1))
    library.connect_material_property(glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    base = library.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, -400, 200)
    base.set_editor_property("constant", unreal.LinearColor(0.6, 0.6, 0.58, 1))
    library.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
    rough = library.create_material_expression(material, unreal.MaterialExpressionConstant, -400, 400)
    rough.set_editor_property("r", 0.3)
    library.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    library.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    log("M_Glow ok")


DYING = """
// Close to death: the picture closes in from the edges, red-black, drains of colour and darkens,
// all of it throbbing with Pulse, a heartbeat from 0 to 1. Amount is 0 well, 1 at death's door.
float2 P = (UV - 0.5) * float2(Size.x / Size.y, 1);
float D = length(P) / length(float2(Size.x / Size.y, 1) * 0.5);
float Close = lerp(1.25, 0.3, Amount) - 0.12 * Pulse * Amount;
float Edge = smoothstep(Close, Close + 0.6, D);
float Grey = dot(Colour, float3(0.2126, 0.7152, 0.0722));
float3 C = lerp(Colour, Grey.xxx, saturate(Amount * 0.9));
C *= 1 - 0.45 * Amount * Amount - 0.15 * Pulse * Amount;
float3 Blood = Grey * float3(0.9, 0.06, 0.05) + float3(0.05, 0, 0) * Amount;
C = lerp(C, Blood, saturate(Edge * 1.5));
return C * (1 - 0.9 * Edge * Edge);
"""


def make_dying():
    """M_Dying: the post-process for a player close to death, after tonemapping, with `Amount` and `Pulse`."""
    path = ROOT + "/M_Dying"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        material = unreal.EditorAssetLibrary.load_asset(path)
        library.delete_all_material_expressions(material)
    else:
        material = assets.create_asset("M_Dying", ROOT, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property("material_domain", unreal.MaterialDomain.MD_POST_PROCESS)
    material.set_editor_property("blendable_location", unreal.BlendableLocation.BL_SCENE_COLOR_AFTER_TONEMAPPING)
    scene = library.create_material_expression(material, unreal.MaterialExpressionSceneTexture, -800, 0)
    scene.set_editor_property("scene_texture_id", unreal.SceneTextureId.PPI_POST_PROCESS_INPUT0)
    screen = library.create_material_expression(material, unreal.MaterialExpressionScreenPosition, -800, 200)
    size = library.create_material_expression(material, unreal.MaterialExpressionViewSize, -800, 350)
    amount = library.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -800, 450)
    amount.set_editor_property("parameter_name", "Amount")
    pulse = library.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -800, 550)
    pulse.set_editor_property("parameter_name", "Pulse")
    node = custom(material, DYING, unreal.CustomMaterialOutputType.CMOT_FLOAT3, ["Colour", "UV", "Size", "Amount", "Pulse"], -400, 200)
    mask = library.create_material_expression(material, unreal.MaterialExpressionComponentMask, -600, 0)
    mask.set_editor_property("r", True)
    mask.set_editor_property("g", True)
    mask.set_editor_property("b", True)
    library.connect_material_expressions(scene, "Color", mask, "")
    library.connect_material_expressions(mask, "", node, "Colour")
    library.connect_material_expressions(screen, "ViewportUV", node, "UV")
    library.connect_material_expressions(size, "", node, "Size")
    library.connect_material_expressions(amount, "", node, "Amount")
    library.connect_material_expressions(pulse, "", node, "Pulse")
    library.connect_material_property(node, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    library.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    log("M_Dying ok")


def main():
    make_glow()
    make_dying()
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

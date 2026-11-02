"""Subvocal Radar enclosure + product renders, built by Blender in background mode.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P hardware/enclosure/make_enclosure.py -- [--renders]

Makes a 2-part 3D-printable case for the 17 x 46 mm board (all dimensions in mm, Blender unit = 1 mm):
  * tray  - holds the board on a ledge; recess under the board for the USB-C plug's lower half
  * lid   - slides over the tray (0.15 mm clearance); its top is 1.47 mm thick everywhere, a half wavelength in PLA
            (eps_r ~2.8) at 61 GHz, with a 2.45 mm (half wavelength) air gap above the radar, so the plastic is
            close to transparent for the radar. Pin hole for BOOT, window for the LED.
  * the plug end is flush with the front of the USB-C plug housing, so the plug's metal shell fully inserts.
Writes stl/subvocal-radar-tray.stl, stl/subvocal-radar-lid.stl, subvocal-radar-enclosure.blend and (with --renders)
renders/*.png.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(HERE, 'build')
GEO = json.load(open(os.path.join(B, 'board_geometry.json')))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

# ------------------------------------------------------------------ dimensions (mm)
BOARD_T = 0.8
CLR = 0.25             # board to tray pocket
WALL = 1.2             # tray wall
SKIRT_CLR = 0.15       # tray to lid skirt
LID_WALL = 1.2
LID_TOP = 1.47         # half wavelength in PLA at 61 GHz
RADAR_TOP = BOARD_T + 0.9
LID_INNER = RADAR_TOP + 2.45   # half-wavelength air gap above the radar
FLOOR = 1.2
UNDER = 0.6            # clearance under the board (bottom pads, solder)
PLUG_FRONT = -0.96     # front face of the USB-C plug housing (Molex 105444 drawing)
BX0, BX1, BY0, BY1 = 0.0, 17.0, 1.0, 46.0

TRAY = dict(x0=BX0 - CLR - WALL, x1=BX1 + CLR + WALL, y0=PLUG_FRONT, y1=BY1 + CLR + WALL, z0=-UNDER - FLOOR, z1=BOARD_T)
LID = dict(x0=TRAY['x0'] - SKIRT_CLR - LID_WALL, x1=TRAY['x1'] + SKIRT_CLR + LID_WALL, y0=PLUG_FRONT,
           y1=TRAY['y1'] + SKIRT_CLR + LID_WALL, z0=TRAY['z0'] + 0.8, z1=LID_INNER + LID_TOP)

def comp(ref): return next(c for c in GEO['components'] if c['ref'] == ref)

# ------------------------------------------------------------------ helpers
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 0.001; sc.unit_settings.length_unit = 'MILLIMETERS'

def material(name, color, metallic=0.0, rough=0.5, transmission=0.0, coat=0.0, image=None, emission=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes.get('Principled BSDF')
    def setin(k, v):
        if k in bsdf.inputs: bsdf.inputs[k].default_value = v
    setin('Base Color', (*color, 1)); setin('Metallic', metallic); setin('Roughness', rough)
    setin('Transmission Weight', transmission); setin('Coat Weight', coat)
    if emission: setin('Emission Color', (*emission, 1)); setin('Emission Strength', 3.0)
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(image)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return m

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

def box(name, x0, x1, y0, y1, z0, z1, mat=None, bevel=0.0):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=bm.verts)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    if mat: ob.data.materials.append(mat)
    if bevel > 0:
        bv = ob.modifiers.new('bevel', 'BEVEL'); bv.width = bevel; bv.segments = 5; bv.limit_method = 'ANGLE'
        apply(ob, bv)
    return ob

def cylinder(name, x, y, z0, z1, r, mat=None, seg=48):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=z1 - z0)
    bmesh.ops.translate(bm, vec=(x, y, (z0 + z1) / 2), verts=bm.verts)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    if mat: ob.data.materials.append(mat)
    return ob

def apply(ob, mod):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)

def cut(ob, cutter, delete=True):
    m = ob.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cutter; m.solver = 'EXACT'
    apply(ob, m)
    if delete: bpy.data.objects.remove(cutter, do_unlink=True)

# ------------------------------------------------------------------ materials
M = dict(
    top=material('pcb_top', (1, 1, 1), rough=0.35, coat=0.3, image=os.path.join(B, 'board_top.png')),
    bottom=material('pcb_bottom', (1, 1, 1), rough=0.35, coat=0.3, image=os.path.join(B, 'board_bottom.png')),
    edge=material('pcb_edge', srgb('#C9C1A0'), rough=0.6),
    ic=material('ic', srgb('#1B1C1F'), rough=0.45),
    radar=material('radar', srgb('#2A2C30'), rough=0.3),
    gold=material('gold', srgb('#D8B45A'), metallic=1.0, rough=0.25),
    tin=material('tin', srgb('#C9CCD1'), metallic=1.0, rough=0.3),
    cap=material('cap', srgb('#B48A5A'), rough=0.5),
    res=material('res', srgb('#1E1E20'), rough=0.5),
    ferrite=material('ferrite', srgb('#3A3B3E'), rough=0.6),
    led=material('led', srgb('#E0302A'), rough=0.15, transmission=0.6, emission=srgb('#FF3A2A')),
    steel=material('steel', srgb('#D7DADF'), metallic=1.0, rough=0.18),
    plastic_black=material('plug_housing', srgb('#141416'), rough=0.55),
    lid=material('lid', srgb('#0E8A82'), rough=0.42, coat=0.15),
    tray=material('tray', srgb('#2B2F36'), rough=0.5),
    floor=material('floor', srgb('#E6E8EB'), rough=0.85),
)

# ------------------------------------------------------------------ board
def board():
    me = bpy.data.meshes.new('pcb'); bm = bmesh.new()
    vs = [bm.verts.new((p['x'], p['y'], 0.0)) for p in GEO['outline']]
    f = bm.faces.new(vs); bmesh.ops.recalc_face_normals(bm, faces=[f])
    if f.normal.z > 0: f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    top_verts = [v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, BOARD_T), verts=top_verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)      # extrusion leaves the new top face pointing down
    bm.normal_update()
    uv = bm.loops.layers.uv.new()
    for face in bm.faces:
        n = face.normal
        face.material_index = 0 if n.z > 0.5 else (1 if n.z < -0.5 else 2)
        for lp in face.loops:
            x, y = lp.vert.co.x, lp.vert.co.y
            u = x / 17.0
            lp[uv].uv = (u if n.z >= -0.5 else 1 - u, y / 46.0)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('PCB', me); sc.collection.objects.link(ob)
    for k in ('top', 'bottom', 'edge'): ob.data.materials.append(M[k])
    return ob

# realistic part bodies (w along the part's x, h along y, height), keyed by footprint
BODY = {
    'QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm': (7.0, 7.0, 0.9, 'ic'),
    'BGT60TR13C_PG-VF2BGA-40': (5.0, 6.5, 0.9, 'radar'),
    'SOIC-8_3.9x4.9mm_P1.27mm': (3.9, 4.9, 1.5, 'ic'),
    'SOT-23-5': (1.6, 2.9, 1.1, 'ic'),
    'C_0402_1005Metric': (1.0, 0.5, 0.5, 'cap'), 'R_0402_1005Metric': (1.0, 0.5, 0.35, 'res'),
    'L_0402_1005Metric': (1.0, 0.5, 0.5, 'ferrite'), 'C_0603_1608Metric': (1.6, 0.8, 0.8, 'cap'),
    'C_0805_2012Metric': (2.0, 1.25, 1.0, 'cap'), 'L_1008_2520Metric': (2.5, 2.0, 1.2, 'ferrite'),
    'LED_0603_1608Metric': (1.6, 0.8, 0.6, 'led'),
    'Crystal_SMD_3225-4Pin_3.2x2.5mm': (3.2, 2.5, 0.8, 'tin'), 'Oscillator_SMD_Abracon_ASE-4Pin_3.2x2.5mm': (3.2, 2.5, 1.0, 'tin'),
    'SW_SPST_B3U-1000P': (3.0, 2.5, 1.2, 'ic'),
}

def parts():
    obs = []
    for c in GEO['components']:
        if c['side'] != 'front' or c['footprint'] not in BODY: continue
        w, h, z, mat = BODY[c['footprint']]
        if int(round(c['rot'])) % 180 == 90: w, h = h, w
        ob = box(c['ref'], c['x'] - w / 2, c['x'] + w / 2, c['y'] - h / 2, c['y'] + h / 2, BOARD_T, BOARD_T + z, M[mat], bevel=min(0.08, z * 0.15))
        obs.append(ob)
        if mat in ('cap', 'res', 'ferrite'):   # tinned end caps
            ax = w > h; L = (w if ax else h) * 0.22
            for s in (-1, 1):
                if ax: e = box(c['ref'] + '_t', c['x'] + s * (w / 2 - L / 2) - L / 2, c['x'] + s * (w / 2 - L / 2) + L / 2, c['y'] - h / 2 - 0.01, c['y'] + h / 2 + 0.01, BOARD_T, BOARD_T + z + 0.01, M['tin'])
                else: e = box(c['ref'] + '_t', c['x'] - w / 2 - 0.01, c['x'] + w / 2 + 0.01, c['y'] + s * (h / 2 - L / 2) - L / 2, c['y'] + s * (h / 2 - L / 2) + L / 2, BOARD_T, BOARD_T + z + 0.01, M['tin'])
                obs.append(e)
        if c['footprint'].startswith('SW_'):
            obs.append(cylinder('SW1_actuator', c['x'], c['y'], BOARD_T + z, BOARD_T + 1.6, 0.85, M['steel']))
        if c['footprint'].startswith('SOIC') or c['footprint'] == 'SOT-23-5':
            n = 4 if c['footprint'].startswith('SOIC') else 3
            pitch = 1.27 if n == 4 else 0.95
            for side in (-1, 1):
                for k in range(n if (n == 4 or side < 0) else 2):
                    off = (k - (n - 1) / 2) * pitch if (n == 4 or side < 0) else (-0.95 if k == 0 else 0.95)
                    reach = (w if int(round(c['rot'])) % 180 == 0 else h) / 2
                    lx, ly = (c['x'] + side * (reach + 0.35), c['y'] + off) if int(round(c['rot'])) % 180 == 0 else (c['x'] + off, c['y'] + side * (reach + 0.35))
                    obs.append(box(c['ref'] + '_lead', lx - 0.25, lx + 0.25, ly - 0.2, ly + 0.2, BOARD_T, BOARD_T + 0.45, M['tin']))
    # radar: antennas in the package top (Rx2 / Tx above, Rx3 / Rx1 below, 2.5 mm apart)
    u = comp('U7')
    for dx, dy in ((-1.25, 1.25), (1.25, 1.25), (-1.25, -1.25), (1.25, -1.25)):
        obs.append(box('U7_ant', u['x'] + dx - 0.55, u['x'] + dx + 0.55, u['y'] + dy - 0.55, u['y'] + dy + 0.55, RADAR_TOP, RADAR_TOP + 0.01, M['gold']))
    # USB-C plug: housing straddling the board and the metal shell out of the front
    cx = 8.5
    obs.append(box('J1_housing_top', cx - 4.3, cx + 4.3, PLUG_FRONT, 2.46, BOARD_T, BOARD_T + 0.8, M['plastic_black'], bevel=0.1))
    obs.append(box('J1_housing_bot', cx - 4.3, cx + 4.3, PLUG_FRONT, 2.46, -0.8, 0.0, M['plastic_black'], bevel=0.1))
    shell = box('J1_shell', cx - 4.17, cx + 4.17, PLUG_FRONT - 6.65, PLUG_FRONT, BOARD_T / 2 - 1.28, BOARD_T / 2 + 1.28, M['steel'])
    bv = shell.modifiers.new('round', 'BEVEL'); bv.width = 1.2; bv.segments = 10; bv.limit_method = 'ANGLE'; bv.angle_limit = math.radians(60)
    apply(shell, bv)
    tongue = box('J1_tongue', cx - 3.3, cx + 3.3, PLUG_FRONT - 6.4, PLUG_FRONT - 0.3, BOARD_T / 2 - 0.85, BOARD_T / 2 + 0.85, M['ic'])
    cut(shell, tongue)
    obs.append(shell)
    return obs

# ------------------------------------------------------------------ enclosure
def tray():
    t = TRAY
    ob = box('Tray', t['x0'], t['x1'], t['y0'], t['y1'], t['z0'], t['z1'], M['tray'], bevel=0.6)
    cut(ob, box('c_pocket', BX0 - CLR, BX1 + CLR, BY0 - CLR, BY1 + CLR, 0.0, t['z1'] + 1))                     # board pocket
    cut(ob, box('c_under', BX0 + 1.0, BX1 - 1.0, BY0 + 1.0, BY1 - 1.0, -UNDER, 0.01))                        # clearance under the board
    cut(ob, box('c_plug', 8.5 - 4.55, 8.5 + 4.55, t['y0'] - 1, 2.75, -1.0, t['z1'] + 1))                      # plug housing + lower shell
    return ob

def lid():
    t = LID
    ob = box('Lid', t['x0'], t['x1'], t['y0'], t['y1'], t['z0'], t['z1'], M['lid'], bevel=0.9)
    cut(ob, box('c_skirt', TRAY['x0'] - SKIRT_CLR, TRAY['x1'] + SKIRT_CLR, t['y0'] - 1, TRAY['y1'] + SKIRT_CLR, t['z0'] - 1, TRAY['z1']))
    cut(ob, box('c_cavity', BX0 - CLR, BX1 + CLR, BY0 - CLR - 0.75, BY1 + CLR, TRAY['z1'] - 0.01, LID_INNER))
    cut(ob, box('c_plug', 8.5 - 4.55, 8.5 + 4.55, t['y0'] - 1, 2.75, TRAY['z1'] - 0.1, BOARD_T + 1.0))
    sw, d1 = comp('SW1'), comp('D1')
    cut(ob, cylinder('c_boot', sw['x'], sw['y'], LID_INNER - 0.5, t['z1'] + 1, 0.8))                            # BOOT: press with a SIM pin
    cut(ob, cylinder('c_led', d1['x'], d1['y'], LID_INNER - 0.5, t['z1'] + 1, 0.6))                             # power LED window
    # debossed label near the plug end (kept away from the radar window)
    cu = bpy.data.curves.new('label', 'FONT'); cu.body = 'SUBVOCAL'; cu.size = 2.6; cu.extrude = 0.6; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    txt = bpy.data.objects.new('c_label', cu); sc.collection.objects.link(txt)
    txt.location = (8.5, 18.0, t['z1']); txt.rotation_euler = (0, 0, math.radians(90))
    with bpy.context.temp_override(object=txt, active_object=txt, selected_objects=[txt], selected_editable_objects=[txt]):
        bpy.ops.object.convert(target='MESH')
    cut(ob, txt)
    # radar window marker: a shallow groove ring around (not over) the radar footprint
    u = comp('U7')
    ring = box('c_ring', u['x'] - 4.2, u['x'] + 4.2, u['y'] - 4.9, u['y'] + 4.9, t['z1'] - 0.25, t['z1'] + 1)
    inner = box('c_ring_in', u['x'] - 3.7, u['x'] + 3.7, u['y'] - 4.4, u['y'] + 4.4, t['z1'] - 1, t['z1'] + 2)
    cut(ring, inner)
    cut(ob, ring)
    return ob

pcb = board(); comps = parts()
tray_ob = tray(); lid_ob = lid()

# ------------------------------------------------------------------ STL export (print orientation is the slicer's job)
os.makedirs(os.path.join(HERE, 'stl'), exist_ok=True)
def export(ob, path):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True, global_scale=1.0, apply_modifiers=True)
export(tray_ob, os.path.join(HERE, 'stl', 'subvocal-radar-tray.stl'))
export(lid_ob, os.path.join(HERE, 'stl', 'subvocal-radar-lid.stl'))

dims = {k: [round(v, 2) for v in (o.dimensions.x, o.dimensions.y, o.dimensions.z)] for k, o in (('tray', tray_ob), ('lid', lid_ob))}
print('ENCLOSURE', json.dumps(dims))

# ------------------------------------------------------------------ scene for renders
def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def setup_render():
    sc.render.engine = 'CYCLES'
    # CPU: this PC's GPU (Pascal, sm_60) is too old for Blender 5.2's CUDA kernels. Set SUBVOCAL_GPU=OPTIX/CUDA/HIP to try a GPU.
    dev = os.environ.get('SUBVOCAL_GPU')
    if dev:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = dev; prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    sc.cycles.samples = 96; sc.cycles.use_denoising = True; sc.cycles.use_adaptive_sampling = True
    sc.render.threads_mode = 'AUTO'
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1200
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [i.name for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['look'].enum_items] else 'None'
    w = bpy.data.worlds.new('studio'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (*srgb('#EEF1F4'), 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    floor = box('Floor', -400, 400, -400, 400, -60, TRAY['z0'] - 0.01, M['floor'])
    for name, rot, strength, angle in (('key', (math.radians(50), 0, math.radians(35)), 3.2, 12), ('rim', (math.radians(60), 0, math.radians(200)), 1.6, 6)):
        L = bpy.data.lights.new(name, 'SUN'); L.energy = strength; L.angle = math.radians(angle)
        o = bpy.data.objects.new(name, L); o.rotation_euler = rot; sc.collection.objects.link(o)
    cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 85; cam_d.clip_start = 1; cam_d.clip_end = 5000
    cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam); sc.camera = cam
    return cam, floor

def move(obs, dz=0, dx=0, dy=0):
    for o in obs: o.location.z += dz; o.location.x += dx; o.location.y += dy

if '--renders' in ARGS:
    cam, floor = setup_render()
    os.makedirs(os.path.join(HERE, 'renders'), exist_ok=True)
    board_all = [pcb] + comps
    # 1. hero: closed, plug towards the camera
    cam.location = (95, -110, 85); look_at(cam, (8.5, 18, 0))
    sc.render.filepath = os.path.join(HERE, 'renders', 'hero-closed.png'); bpy.ops.render.render(write_still=True)
    # 2. exploded: lid up, board up
    move(board_all, dz=10); move([lid_ob], dz=26)
    floor.location.z = 0
    cam.location = (120, -120, 95); look_at(cam, (8.5, 20, 14))
    sc.render.filepath = os.path.join(HERE, 'renders', 'exploded.png'); bpy.ops.render.render(write_still=True)
    # 3. board only, top-down three-quarter
    lid_ob.hide_render = True; tray_ob.hide_render = True; move(board_all, dz=-10)
    cam.location = (-40, -70, 120); look_at(cam, (8.5, 22, 0)); cam.data.lens = 90
    sc.render.filepath = os.path.join(HERE, 'renders', 'board.png'); bpy.ops.render.render(write_still=True)
    lid_ob.hide_render = False; tray_ob.hide_render = False; move([lid_ob], dz=-26)

bpy.ops.file.pack_all()   # textures inside the .blend, so it opens complete from the repo
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'subvocal-radar-enclosure.blend'))
print('DONE')

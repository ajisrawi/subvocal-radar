"""Board textures for the Blender render, drawn from the real layout (build/board_geometry.json):
green solder mask, copper traces under the mask, ENIG (gold) pads, vias, white silkscreen outlines.
    python hardware/enclosure/make_board_texture.py  ->  build/board_top.png, build/board_bottom.png"""
import json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
g = json.load(open(os.path.join(HERE, 'build', 'board_geometry.json')))
PX = 40                                   # pixels per mm
X0, X1, Y0, Y1 = 0.0, 17.0, 0.0, 46.0     # texture covers the board's bounding box (tongue starts at y 0.04)
Wpx, Hpx = int((X1 - X0) * PX), int((Y1 - Y0) * PX)

def P(x, y): return ((x - X0) * PX, (Y1 - y) * PX)

MASK, TRACE, GOLD, HOLE, SILK = (24, 86, 54), (36, 112, 70), (214, 178, 84), (30, 30, 30), (236, 238, 232)

def draw(side):
    im = Image.new('RGB', (Wpx, Hpx), MASK)
    d = ImageDraw.Draw(im)
    layer = 'F.Cu' if side == 'front' else 'B.Cu'
    for t in g['traces']:
        if t['layer'] != layer: continue
        pts = [P(q['x'], q['y']) for q in t['points']]
        wpx = max(2, int(t['width'] * PX))
        d.line(pts, fill=TRACE, width=wpx, joint='curve')
        for q in pts: d.ellipse((q[0] - wpx / 2, q[1] - wpx / 2, q[0] + wpx / 2, q[1] + wpx / 2), fill=TRACE)
    for p in g['pads']:
        if p['side'] != side and not p['th']: continue
        if p['ref'].startswith('J1') and side == 'front' and p['ref'] == 'J1B': continue
        x, y = P(p['x'], p['y']); w, h = p['w'] * PX / 2, p['h'] * PX / 2
        if p['shape'] == 'circle': d.ellipse((x - w, y - h, x + w, y + h), fill=GOLD)
        else: d.rounded_rectangle((x - w, y - h, x + w, y + h), radius=min(w, h) * 0.25, fill=GOLD)
    for v in g['vias']:
        x, y = P(v['x'], v['y']); r = v['d'] * PX / 2; rh = v['drill'] * PX / 2
        d.ellipse((x - r, y - r, x + r, y + r), fill=(44, 120, 78))      # tented vias: a bump under the mask
        d.ellipse((x - rh, y - rh, x + rh, y + rh), fill=(20, 60, 38))
    if side == 'front':
        # silkscreen: IC outlines and pin-1 marks
        for c in g['components']:
            if c['side'] != 'front': continue
            if not c['ref'].startswith(('U', 'X', 'Y', 'SW', 'L')): continue
            bw, bh = (c['body']['w'], c['body']['h'])
            x, y = P(c['x'], c['y']); hw, hh = bw * PX / 2 + 4, bh * PX / 2 + 4
            for (ax, ay, bx, by) in ((x - hw, y - hh, x - hw + 18, y - hh), (x - hw, y - hh, x - hw, y - hh + 18),
                                     (x + hw, y + hh, x + hw - 18, y + hh), (x + hw, y + hh, x + hw, y + hh - 18)):
                d.line((ax, ay, bx, by), fill=SILK, width=4)
        u7 = next(c for c in g['components'] if c['ref'] == 'U7')
        ax, ay = P(u7['x'] - 2.95, u7['y'] + 3.6)
        d.ellipse((ax - 8, ay - 8, ax + 8, ay + 8), fill=SILK)
    else:
        f = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 40)
        txt = Image.new('RGBA', (900, 120), (0, 0, 0, 0))
        ImageDraw.Draw(txt).text((0, 0), 'github.com/ajisrawi/subvocal-radar', font=f, fill=SILK + (255,))
        txt = txt.transpose(Image.FLIP_LEFT_RIGHT)          # bottom side is seen mirrored in texture space
        im.paste(txt, (int(1.5 * PX), int((Y1 - 30) * PX)), txt)
    return im

os.makedirs(os.path.join(HERE, 'build'), exist_ok=True)
draw('front').save(os.path.join(HERE, 'build', 'board_top.png'))
draw('back').transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(HERE, 'build', 'board_bottom.png'))
print('textures', Wpx, Hpx)

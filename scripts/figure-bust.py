# 女性素体胸形收圆（Blender 无界面运行）：在 figure-neutral.mjs 的输出上，把胸的尖顶 / 下沿急转 / 折痕收成光滑圆丘。
# 只改胸块前表面的 POSITION / NORMAL，直接改写 GLB 二进制；骨骼、权重、索引、其余顶点逐字节不动。
# 用法：
#   node scripts/figure-neutral.mjs /tmp/orig.glb /tmp/stage.glb
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/figure-bust.py -- /tmp/stage.glb public/assets/figures/bodychan_female.glb [cast=0.7 smooth=12]
# 做法：每侧在胸峰后方放一个球心，Cast 修改器把胸前表面按权重朝球面贴（尖顶补圆、折痕填平），
# 再用 Laplacian Smooth（保体积）把过渡磨顺；权重 = 以胸峰为中心的高斯，只在胸块（网格连通块）的正面。
# 法线取 Blender 按新几何算的顶点法线，在改动区与原法线渐变混合。坐标：glTF (x, y, z) = Blender (x, z, −y)。
import bpy, sys, json, struct, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
K = {'cast': 1.0, 'smooth': 3, 'sigma': 0.035, 'R': 0.07}
for kv in argv[2:]:
    k, v = kv.split('='); K[k] = float(v)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = [o for o in bpy.data.objects if o.type == 'MESH'][0]
me = ob.data
nv = len(me.vertices)
co0 = [v.co.copy() for v in me.vertices]

# 胸块：从胸峰附近的顶点出发，沿边 + 同位置顶点做连通块
adj = [[] for _ in range(nv)]
for e in me.edges:
    a, b = e.vertices; adj[a].append(b); adj[b].append(a)
pos = {}
for i, c in enumerate(co0):
    pos.setdefault((round(c.x, 5), round(c.y, 5), round(c.z, 5)), []).append(i)
for same in pos.values():
    for i in same: adj[i].extend(j for j in same if j != i)
apex = []
for sd in (1, -1):  # 胸峰 = 胸部一带最靠前（Blender −Y）的点
    cand = [i for i, c in enumerate(co0) if 0.03 < sd * c.x < 0.13 and 1.15 < c.z < 1.3 and abs(c.y) < 0.2]
    apex.append(min(cand, key=lambda i: co0[i].y))
chest, stack = set(), [apex[0]]
while stack:
    i = stack.pop()
    if i in chest: continue
    chest.add(i); stack.extend(adj[i])
assert apex[1] in chest and 300 < len(chest) < 2000, len(chest)

grp = ob.vertex_groups.new(name='bust')
w = [0.0] * nv
for i in chest:
    c = co0[i]
    for a in apex:
        d2 = (c - co0[a]).length_squared
        w[i] = max(w[i], math.exp(-d2 / (2 * K['sigma'] ** 2)))
    if c.y > co0[apex[0]].y + 0.09: w[i] = 0  # 胸块背面 / 内壁
    if w[i] > 1e-3: grp.add([i], w[i], 'REPLACE')

# 每侧一个 Cast：球心在胸峰后方 R，球半径 R（胸峰位置不变）
R = K['R']
for k, a in enumerate(apex):
    g = ob.vertex_groups.new(name=f'bust{k}')
    for i in chest:
        if w[i] > 1e-3 and (co0[i].x > 0) == (co0[a].x > 0): g.add([i], w[i], 'REPLACE')
    emp = bpy.data.objects.new(f'c{k}', None); bpy.context.scene.collection.objects.link(emp)
    emp.location = co0[a] + Vector((0, R, 0))
    m = ob.modifiers.new(f'cast{k}', 'CAST')
    m.cast_type = 'SPHERE'; m.factor = K['cast']; m.size = R; m.use_radius_as_size = False
    m.object = emp; m.use_transform = False; m.vertex_group = g.name
sm = ob.modifiers.new('smooth', 'LAPLACIANSMOOTH')
sm.iterations = int(K['smooth']); sm.lambda_factor = 0.5; sm.use_volume_preserve = True; sm.vertex_group = 'bust'

dg = bpy.context.evaluated_depsgraph_get()
ev = ob.evaluated_get(dg).to_mesh()
assert len(ev.vertices) == nv
newco = [ob.matrix_world @ v.co for v in ev.vertices]
newn = [Vector(n.vector) for n in ev.vertex_normals]

# 改写 GLB：accessor 0 = POSITION，1 = NORMAL
buf = bytearray(open(src, 'rb').read())
jl = struct.unpack_from('<I', buf, 12)[0]
js = json.loads(buf[20:20 + jl]); bin0 = 20 + jl + 8
def base(ai):
    a = js['accessors'][ai]; bv = js['bufferViews'][a['bufferView']]
    return bin0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
pb, nb = base(0), base(1)
moved = 0
for i in range(nv):
    t = min(1.0, w[i] * 4)
    if t < 1e-3: continue
    p = newco[i]
    struct.pack_into('<3f', buf, pb + i * 12, p.x, p.z, -p.y)
    on = Vector(struct.unpack_from('<3f', buf, nb + i * 12))
    nn = Vector((newn[i].x, newn[i].z, -newn[i].y))
    n = (on * (1 - t) + nn * t).normalized()
    struct.pack_into('<3f', buf, nb + i * 12, n.x, n.y, n.z)
    moved = max(moved, (p - co0[i]).length)
open(out, 'wb').write(buf)
print('BUST', K, 'verts', sum(1 for x in w if x > 1e-3), 'maxMove %.4f' % moved)

import { endpointSchedule } from '../anim/schedule.js';
import { intervalSchedule } from '../anim/pathGen.js';
// @ts-check
import { Path, pathOptionsFor } from '../anim/Path.js';
import { createEmptyDocument, validate } from '../doc/schema.js';
import { addCharacter, charName, newId } from '../doc/edit.js';
import { aimRotation, cameraMove } from '../anim/cameraMoves.js';

export const SCENE_PRESETS = [
  { title: '欲言又止', detail: '双人 · 12 秒 · 两次靠近与延迟后退', stages: '稳定双人 → 推近侧移 → 20° 浅弧 → 停住' },
  { title: '走了，又停住', detail: '双人 · 14 秒 · 离开、回望、再离开', stages: '长椅建立 → 侧移 → 回望停顿 → 后拉抬升' },
  { title: '巷口截线', detail: '双人 · 12 秒 · 绕行与切线追踪', stages: '斜向追踪 → 绕角 55° → 推近交汇 → 转身' },
  { title: '错身后回望', detail: '双人 · 12 秒 · 错过后先后转身', stages: '双人横移 → 错身停顿 → 20° 浅弧 → 推近' },
  { title: '越过门槛', detail: '单人 · 10 秒 · 遮挡中走入画面', stages: '低机位遮挡 → 横移显露 → 推近升高 → 中景' },
  { title: '绕到她的视线里', detail: '单人 · 12 秒 · 110° 揭示与迟来的回应', stages: '背侧环绕 → 轻升揭示 → 推近回应 → 停住' },
  { title: '绕过桌角', detail: '三人 · 14 秒 · 绕桌、退让、侧移', stages: '三人建立 → 桌外 35° 弧线 → 侧移升高 → 三角构图' },
  { title: '六人合围亮相', detail: '六人 · 12 秒 · 分批汇入浅 V 队形', stages: '中心人物 → 两段后拉升高 → 12° 浅弧 → 群像' },
];

/** 编排直接生成文档；描述仅供后续 AI 修改，不参与模板的确定性调度。 */
/** @param {number} index @param {{ratio?:import("../types/vocab.js").Ratio}} [options] */
export function createPresetScene(index, { ratio = '16:9' } = {}) {
  const preset = SCENE_PRESETS[index];
  if (!preset) throw new Error('未知预制场景');
  const durations = [12, 14, 12, 12, 10, 12, 14, 12];
  const doc = createEmptyDocument({ name: preset.title });
  doc.timeline.duration = durations[index];
  doc.scene.ratio = ratio;
  const p3 = ([x, z]) => [x, 0, z];
  const cast = (name, at, { body = 'male', yaw = 0, pose = null } = {}) => addCharacter(doc, { name: charName(name.charCodeAt(0) - 65), body, pos: p3(at), yaw, pose });
  const prop = (name, at, size, color = '#666b73') => {
    const item = { type: 'prop', id: newId(doc), name, kind: 'box', color, visible: true,
      transform: { pos: p3(at), rot: [0, 0, 0], scale: size.map(v => v / 0.8) } };
    doc.entities.push(item);
    return item;
  };
  const track = (ent, property, entries) => {
    doc.timeline.tracks.push({ id: newId(doc), target: ent.id, property,
      keys: entries.map(([t, value, ease = 'smooth']) => ({ t, value, ease })) });
  };
  const yawTo = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
  const faces = new Map();
  const face = (ent, t, target, end = t + 0.8) => {
    const list = faces.get(ent.id) || [];
    const at = positionAt(ent, t);
    const angle = yawTo(at, target);
    list.push([t, null, 'smooth'], [end, [0, angle, 0], 'step']);
    faces.set(ent.id, list);
  };
  const routes = new Map();
  function positionAt(ent, t) {
    const route = routes.get(ent.id);
    if (!route) return [ent.transform.pos[0], ent.transform.pos[2]];
    let at = [ent.transform.pos[0], ent.transform.pos[2]];
    for (const leg of route) {
      if (t < leg.start) break;
      if (t >= leg.end) at = leg.points.at(-1);
      else break;
    }
    return at;
  }
  const walk = (ent, legs) => {
    routes.set(ent.id, legs);
    const points = [ent.transform.pos.slice()];
    const sections = [];
    for (const leg of legs) {
      const from = points.length - 1;
      for (const p of leg.points) points.push(p3(p));
      sections.push({ from, to: points.length - 1, start: leg.start, end: leg.end, curve: 'smooth' });
      const previous = from ? [points[from][0], points[from][2]] : [ent.transform.pos[0], ent.transform.pos[2]];
      const next = leg.points[0];
      const angle = yawTo(previous, next);
      const list = faces.get(ent.id) || [];
      list.push([Math.max(0, leg.start - 0.35), null, 'smooth'],
        [leg.start, [0, angle, 0], 'linear']);
      if (leg.points.length > 1) {
        const mid = leg.points.at(-2), end = leg.points.at(-1);
        list.push([(leg.start + leg.end) / 2, [0, yawTo(mid, end), 0], 'linear']);
      }
      list.push([leg.end, list.at(-1)[1], 'step']);
      faces.set(ent.id, list);
    }
    const continuous = legs.length > 1 && legs.every((leg, i) => !i || leg.start === legs[i - 1].end);
    const path = { id: newId(doc), target: ent.id, points, closed: false, start: continuous ? legs[0].start : 0,
      duration: continuous ? legs.at(-1).end - legs[0].start : doc.timeline.duration, orient: 'keep' };
    path.schedule = endpointSchedule(points, false, path.duration, 'smooth');
    if (continuous) path.schedule = [0, ...legs.flatMap(leg => leg.points.map((_, i) => leg.start - legs[0].start + (leg.end - leg.start) * (i + 1) / leg.points.length))]
      .map((t, i) => ({ i, t, ...(i === 0 ? { curve: 'cubic', baseCurve: 'smooth' } : {}) }));
    else path.schedule = intervalSchedule(path, sections).map((entry, i) => i && entry.curve ? { ...entry, inherited: true } : entry);
    doc.paths.push(path);
  };
  // Compose existing generators into a single explicitly timed position path. Zero-length
  // waypoint intervals hold still; other phase boundaries keep a continuous speed.
  const camera = (initial, phases, fov) => {
    const characters = doc.entities.filter(e => e.type === 'character');
    const models = new Map(characters.map(e => [e.id, doc.paths.find(p => p.target === e.id)]).filter(([, p]) => p).map(([id, p]) => [id, new Path(p, pathOptionsFor('character'))]));
    const focus = t => {
      const points = characters.map(e => { const p = models.get(e.id); return p ? p.positionAt(p.distanceAt(t)).toArray() : e.transform.pos; });
      const center = [0, 1, 0];
      for (const p of points) { center[0] += p[0] / points.length; center[2] += p[2] / points.length; }
      if (index === 7 && t < 3) { const u = t / 3; center[0] = points[0][0] * (1 - u) + center[0] * u; center[2] = points[0][2] * (1 - u) + center[2] * u; }
      return center;
    };
    let position = initial.slice(), start = 0;
    // Portrait templates use real camera distance, keeping FOV and narrative movements.
    const [w, h] = ratio.split(':').map(Number);
    if (w / h < 1 && index === 7) position[2] += 13.2;
    const points = [position.slice()], times = [0];
    for (const [end, moves] of phases) {
      if (!moves.length) { points.push(position.slice()); times.push(end); start = end; continue; }
      const aim = focus(start);
      const models = moves.map(([name, params]) => {
        const move = cameraMove(name, { position, aim, params: { ...params, duration: end - start } });
        return new Path({ ...move, start: 0, schedule: endpointSchedule(move.points, move.closed, move.duration), orient: 'keep' });
      });
      const count = Math.max(2, Math.ceil((end - start) * 6));
      for (let i = 1; i <= count; i++) {
        const next = position.slice();
        for (const model of models) {
          const p = model.positionAt(model.length * i / count).toArray();
          p.forEach((v, k) => { next[k] += v - position[k]; });
        }
        points.push(next); times.push(start + (end - start) * i / count);
      }
      position = points.at(-1); start = end;
    }
    const json = { id: newId(doc), target: '', points, closed: false, start: 0, duration: doc.timeline.duration,
      orient: 'keep', interpolation: 'polyline', schedule: times.map((t, i) => ({ i, t, ...(i === 0 ? { curve: 'cubic', baseCurve: 'smooth' } : {}) })) };
    const path = new Path(json), aim = focus(0);
    const cam = { type: 'camera', id: newId(doc), name: '机位1', visible: true,
      transform: { pos: points[0], rot: aimRotation(points[0], aim, 0), scale: [1, 1, 1] }, fov, roll: 0, lookAt: aim };
    json.target = cam.id; doc.entities.push(cam); doc.paths.push(json);
    doc.scene.activeCameraId = doc.timeline.mainCameraId = cam.id;
    // Dense orientation samples use actual character paths, not sparse arrival positions.
    // Quaternion interpolation in Track keeps heading continuous across Euler wrapping.
    const keys = [];
    for (let i = 0; i <= doc.timeline.duration * 12; i++) {
      const t = i / 12;
      keys.push([t, aimRotation(path.positionAt(path.distanceAt(t)).toArray(), focus(t), 0), 'linear']);
    }
    track(cam, 'rot', keys);
    return cam;
  };

  if (index === 0) {
    const a = cast('A', [-2.8, 0.8], { yaw: 75 }), b = cast('B', [0.9, -0.2], { body: 'female', yaw: 75 });
    prop('右侧花池', [3.8, -2.2], [2.1, 0.45, 0.8], '#536b5a');
    walk(a, [{ start: 0, end: 3, points: [[-2, 1.1], [-1.1, 0.6]] }, { start: 4.5, end: 8, points: [[-0.7, 0.9], [-0.2, 0.8]] }]);
    walk(b, [{ start: 6, end: 8, points: [[1, -0.35], [1.1, -0.5]] }]);
    face(b, 3.4, [-1.1, 0.6], 4.2); face(b, 8.1, [-0.2, 0.8], 9.2);
    camera([0, 1.55, 7.5], [[3, []], [4.5, []], [8, [['push_in', { amount: .8 }], ['truck', { amount: .4, dir: 'right' }]]], [10.5, [['half_orbit', { sweep: 20, dir: 'ccw' }]]], [12, []]], 45);
  } else if (index === 1) {
    prop('长椅座面', [0, 0], [2.1, 0.45, 0.6], '#745a4a'); prop('长椅靠背', [0, -0.33], [2.1, 0.8, 0.16], '#745a4a');
    const a = cast('A', [-0.5, 0.22], { pose: 'sit', yaw: 0 }), b = cast('B', [0.9, 1], { body: 'female', yaw: -140 });
    walk(b, [{ start: 2, end: 6, points: [[1.7, 1.3], [2.8, 0.8]] }, { start: 8, end: 12, points: [[3.4, 0.1], [4, -0.8]] }]);
    face(b, 6.1, [-0.5, 0.2], 6.9); face(b, 8, [4, -0.8], 8.6); face(a, 12, [4, -0.8], 13);
    camera([4.8, 1.45, 6.5], [[2, []], [6, [['truck', { amount: 1, dir: 'right' }]]], [8, []], [12, [['pull_out', { amount: 1.2 }], ['crane', { amount: .3, dir: 'up' }]]], [14, []]], 48);
  } else if (index === 2) {
    prop('巷口障碍', [0, 0], [1.6, 1.9, 2], '#59616b');
    const a = cast('A', [-3, 2], { yaw: 75 }), b = cast('B', [-4.2, 3.5], { body: 'female', yaw: 110 });
    walk(a, [{ start: 0, end: 4, points: [[-1.7, 2.4], [0.8, 2.2]] }, { start: 4, end: 8, points: [[2.5, 0.5], [2.7, -1.6]] }, { start: 8, end: 10, points: [[4.2, -2.5]] }]);
    walk(b, [{ start: 0.6, end: 4, points: [[-2.4, 2.7], [-1.2, 1.9]] }, { start: 4, end: 8, points: [[1.4, 1.7], [2, -0.3]] }, { start: 8, end: 10.6, points: [[3.1, -1.8]] }]);
    face(a, 10.2, [3.1, -1.8], 11); face(b, 10.7, [4.2, -2.5], 11.5);
    camera([1.5, 2.1, 9], [[4, [['truck', { amount: 2.2, dir: 'right' }], ['push_in', { amount: .5 }]]], [8, [['half_orbit', { sweep: 55, dir: 'ccw' }]]], [10, [['push_in', { amount: .7 }]]], [12, []]], 52);
  } else if (index === 3) {
    const a = cast('A', [-3, 0.5], { yaw: 90 }), b = cast('B', [3, -0.5], { body: 'female', yaw: -90 });
    walk(a, [{ start: 0, end: 5.5, points: [[-0.6, 0.7], [1.1, 0.5]] }]);
    walk(b, [{ start: 0, end: 5, points: [[0.6, -0.7], [-1.1, -0.5]] }, { start: 5, end: 6.5, points: [[-1.6, -0.6]] }]);
    face(a, 6.5, [-1.6, -0.6], 8); face(b, 8, [1.1, 0.5], 9.5);
    camera([0, 1.6, 8], [[5.5, [['truck', { amount: 1.2, dir: 'right' }]]], [6.5, []], [9.5, [['half_orbit', { sweep: 20, dir: 'ccw' }]]], [11, [['push_in', { amount: .6 }]]], [12, []]], 48);
  } else if (index === 4) {
    prop('左立柱', [-1.4, -0.8], [0.6, 2.9, 0.6]); prop('右立柱', [1.4, -0.8], [0.6, 2.9, 0.6]);
    const a = cast('A', [-1.6, -2.2], { yaw: 30 });
    walk(a, [{ start: 0, end: 2, points: [[-0.7, -1.3]] }, { start: 2, end: 5, points: [[-0.3, -0.4], [0, 0.8]] }]);
    face(a, 5, [0.2, 5.3], 6);
    camera([.8, 1, 6.5], [[2, []], [5, [['truck', { amount: .6, dir: 'left' }]]], [8, [['push_in', { amount: 1.2 }], ['crane', { amount: .35, dir: 'up' }]]], [10, []]], 42);
  } else if (index === 5) {
    const a = cast('A', [0, 0], { body: 'female', yaw: 15 });
    walk(a, [{ start: 3, end: 6, points: [[0.18, 0.12], [0.35, 0.2]] }]);
    const cam = camera([-2.25, 1.5, -3.897], [[4.5, [['half_orbit', { sweep: 55, dir: 'ccw' }]]], [9, [['spiral', { sweep: 55, dir: 'ccw', rise: .25 }]]], [10.5, [['push_in', { amount: .5 }]]], [12, []]], 42);
    const end = doc.paths.find(p => p.target === cam.id).points.at(-1);
    face(a, 9, [end[0], end[2]], 10.5);
  } else if (index === 6) {
    prop('会议桌', [0, 0], [2.4, 0.75, 1.2], '#5a514b');
    const a = cast('A', [0, 1.8], { yaw: 180 }), b = cast('B', [-0.7, -1.5], { body: 'female', yaw: 0 }), c = cast('C', [1, -1.6], { yaw: 0 });
    walk(a, [{ start: 3, end: 7, points: [[-1.7, 1.5], [-2, 0.3], [-1.8, -0.5]] }]);
    walk(b, [{ start: 7, end: 9, points: [[-0.6, -2]] }]);
    walk(c, [{ start: 7.5, end: 9, points: [[1.6, -1.5]] }]);
    face(a, 9, [-0.6, -2], 11); face(b, 7, [-1.8, -0.5], 8);
    camera([-5.5, 1.9, 6.5], [[3, []], [7, [['half_orbit', { sweep: 35, dir: 'ccw' }]]], [9, [['truck', { amount: .6, dir: 'right' }], ['crane', { amount: .2, dir: 'up' }]]], [11, [['push_in', { amount: .5 }]]], [14, []]], 48);
  } else {
    /** @type {[string,number[],number[],number[],number,number][]} */
    const data = [
      ['A', [0, -3.5], [-0.25, -1.5], [0, 1.2], 0, 6],
      ['B', [-3.8, -1], [-2.5, -0.2], [-1.4, 0.4], 1, 6.5],
      ['C', [3.8, -1.8], [2.5, -0.5], [1.4, 0.2], 1.8, 7],
      ['D', [-4.5, -3], [-3.6, -1.8], [-2.7, -0.8], 2.4, 7.2],
      ['E', [4.5, -3.5], [3.7, -2], [2.7, -0.9], 3, 7.8],
      ['F', [1, -5], [0.6, -3], [0.5, -1.5], 2, 8],
    ];
    for (const [name, start, via, end, begin, finish] of data) {
      const a = cast(name, start, { body: ['B', 'C', 'E'].includes(name) ? 'female' : 'male' });
      walk(a, [{ start: begin, end: finish, points: [via, end] }]);
      face(a, 8, [end[0], 8], 9);
    }
    camera([0, 1.65, 3.5], [[3, [['pull_out', { amount: 1 }]]], [8, [['pull_out', { amount: 2 }], ['crane', { amount: .8, dir: 'up' }]]], [10, [['half_orbit', { sweep: 12, dir: 'ccw' }]]], [12, []]], 48);
  }
  for (const [id, entries] of faces) {
    const ent = doc.entities.find(e => e.id === id);
    const byTime = new Map([[0, [0, ent.transform.rot.slice(), 'step']], ...entries.map(e => [e[0], e])]);
    let previous = ent.transform.rot.slice();
    const keys = [...byTime.values()].sort((a, b) => a[0] - b[0]).map(([t, value, ease]) => {
      previous = value || previous;
      return [t, previous.slice(), ease];
    });
    track(ent, 'rot', keys);
  }
  const result = validate(doc);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return doc;
}

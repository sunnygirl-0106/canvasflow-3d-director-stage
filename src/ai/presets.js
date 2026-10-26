import { createEmptyDocument, validate } from '../doc/schema.js';
import { addCharacter, charName, newId } from '../doc/edit.js';
import { aimRotation } from '../anim/cameraMoves.js';

export const SCENE_PRESETS = [
  { title: '欲言又止', detail: '双人 · 12 秒 · 两次靠近与延迟后退' },
  { title: '走了，又停住', detail: '双人 · 14 秒 · 离开、回望、再离开' },
  { title: '巷口截线', detail: '双人 · 12 秒 · 绕行与切线追踪' },
  { title: '错身后回望', detail: '双人 · 12 秒 · 错过后先后转身' },
  { title: '越过门槛', detail: '单人 · 10 秒 · 遮挡中走入画面' },
  { title: '绕到她的视线里', detail: '单人 · 12 秒 · 110° 揭示与迟来的回应' },
  { title: '绕过桌角', detail: '三人 · 14 秒 · 绕桌、退让、侧移' },
  { title: '六人合围亮相', detail: '六人 · 12 秒 · 分批汇入浅 V 队形' },
];

/** 编排直接生成文档；描述仅供后续 AI 修改，不参与模板的确定性调度。 */
export function createPresetScene(index) {
  const preset = SCENE_PRESETS[index];
  if (!preset) throw new Error('未知预制场景');
  const durations = [12, 14, 12, 12, 10, 12, 14, 12];
  const doc = createEmptyDocument({ name: preset.title });
  doc.timeline.duration = durations[index];
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
    const timedSegments = [];
    for (const leg of legs) {
      const from = points.length - 1;
      for (const p of leg.points) points.push(p3(p));
      timedSegments.push({ from, to: points.length - 1, start: leg.start, end: leg.end });
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
      duration: continuous ? legs.at(-1).end - legs[0].start : doc.timeline.duration, speed: 'smooth', orient: 'keep' };
    if (continuous) path.waypointTimes = [0, ...legs.flatMap(leg => leg.points.map((_, i) => leg.start - legs[0].start + (leg.end - leg.start) * (i + 1) / leg.points.length))];
    else path.timedSegments = timedSegments;
    doc.paths.push(path);
  };
  const camera = (positions, aims, fov, cuts = []) => {
    const first = positions[0][1], aim = aims[0][1];
    const cam = { type: 'camera', id: newId(doc), name: '机位1', visible: true,
      transform: { pos: first, rot: aimRotation(first, aim, 0), scale: [1, 1, 1] }, fov, roll: 0, lookAt: aim };
    doc.entities.push(cam);
    doc.scene.activeCameraId = doc.timeline.mainCameraId = cam.id;
    const moving = [positions[0]];
    let firstMotion = null;
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1], next = positions[i];
      if (next[1].some((v, k) => Math.abs(v - prev[1][k]) > 1e-6)) {
        firstMotion ??= prev[0];
        moving.push(next);
      }
    }
    if (firstMotion !== null) {
      const cutIndices = cuts.map(t => moving.findIndex(entry => entry[0] === t)).filter(i => i > 0 && i < moving.length - 1);
      const ends = [...cutIndices, moving.length - 1];
      const timedSegments = [];
      let from = 0;
      for (const to of ends) {
        timedSegments.push({ from, to, start: from ? moving[from][0] : firstMotion, end: moving[to][0] });
        from = to;
      }
      const path = { id: newId(doc), target: cam.id, points: moving.map(entry => entry[1]), closed: false,
        start: cuts.length ? 0 : firstMotion, duration: cuts.length ? doc.timeline.duration : moving.at(-1)[0] - firstMotion,
        speed: 'smooth', orient: 'keep' };
      if (cuts.length) path.timedSegments = timedSegments;
      else path.waypointTimes = moving.map((entry, i) => i ? entry[0] - firstMotion : 0);
      doc.paths.push(path);
    }
    const rot = positions.map(([t, pos], i) => [t, aimRotation(pos, aims[Math.min(i, aims.length - 1)][1], 0), 'smooth']);
    if (rot.length > 1) track(cam, 'rot', rot);
    return cam;
  };

  if (index === 0) {
    const a = cast('A', [-2.8, 0.8], { yaw: 75 }), b = cast('B', [0.9, -0.2], { body: 'female', yaw: 75 });
    prop('右侧花池', [3.8, -2.2], [2.1, 0.45, 0.8], '#536b5a');
    walk(a, [{ start: 0, end: 3, points: [[-2, 1.1], [-1.1, 0.6]] }, { start: 4.5, end: 8, points: [[-0.7, 0.9], [-0.2, 0.8]] }]);
    walk(b, [{ start: 6, end: 8, points: [[1, -0.35], [1.1, -0.5]] }]);
    face(b, 3.4, [-1.1, 0.6], 4.2); face(b, 8.1, [-0.2, 0.8], 9.2);
    camera([[0, [0, 1.55, 7.5]], [3, [0, 1.55, 7.5]], [10, [0.7, 1.55, 6.3]], [12, [0.7, 1.55, 6.3]]],
      [[0, [-0.8, 1.2, 0.3]], [3, [-0.8, 1.2, 0.3]], [10, [0.45, 1.2, 0.1]], [12, [0.45, 1.2, 0.1]]], 45);
  } else if (index === 1) {
    prop('长椅座面', [0, 0], [2.1, 0.45, 0.6], '#745a4a'); prop('长椅靠背', [0, -0.33], [2.1, 0.8, 0.16], '#745a4a');
    const a = cast('A', [-0.5, 0.22], { pose: 'sit', yaw: 0 }), b = cast('B', [0.9, 1], { body: 'female', yaw: -140 });
    walk(b, [{ start: 2, end: 6, points: [[1.7, 1.3], [2.8, 0.8]] }, { start: 8, end: 12, points: [[3.4, 0.1], [4, -0.8]] }]);
    face(b, 6.1, [-0.5, 0.2], 6.9); face(b, 8, [4, -0.8], 8.6); face(a, 12, [4, -0.8], 13);
    camera([[0, [4.8, 1.45, 6.5]], [8, [4.8, 1.45, 6.5]], [12, [4, 1.45, 6.1]], [14, [4, 1.45, 6.1]]],
      [[0, [1, 1, 0.5]], [8, [1, 1, 0.5]], [12, [0, 1, 0.2]], [14, [0, 1, 0.2]]], 48);
  } else if (index === 2) {
    prop('巷口障碍', [0, 0], [1.6, 1.9, 2], '#59616b');
    const a = cast('A', [-3, 2], { yaw: 75 }), b = cast('B', [-4.2, 3.5], { body: 'female', yaw: 110 });
    walk(a, [{ start: 0, end: 4, points: [[-1.7, 2.4], [0.8, 2.2]] }, { start: 4, end: 8, points: [[2.5, 0.5], [2.7, -1.6]] }, { start: 8, end: 10, points: [[4.2, -2.5]] }]);
    walk(b, [{ start: 0.6, end: 4, points: [[-2.4, 2.7], [-1.2, 1.9]] }, { start: 4, end: 8, points: [[1.4, 1.7], [2, -0.3]] }, { start: 8, end: 10.6, points: [[3.1, -1.8]] }]);
    face(a, 10.2, [3.1, -1.8], 11); face(b, 10.7, [4.2, -2.5], 11.5);
    camera([[0, [1.5, 2.1, 9]], [5, [5, 2, 6]], [10, [7, 1.8, 2.5]], [12, [7, 1.8, 2.5]]],
      [[0, [-2, 1.2, 2]], [5, [1, 1.2, 1]], [10, [3.6, 1.2, -2]], [12, [3.6, 1.2, -2]]], 52);
  } else if (index === 3) {
    const a = cast('A', [-3, 0.5], { yaw: 90 }), b = cast('B', [3, -0.5], { body: 'female', yaw: -90 });
    walk(a, [{ start: 0, end: 5.5, points: [[-0.6, 0.7], [1.1, 0.5]] }]);
    walk(b, [{ start: 0, end: 5, points: [[0.6, -0.7], [-1.1, -0.5]] }, { start: 5, end: 6.5, points: [[-1.6, -0.6]] }]);
    face(a, 6.5, [-1.6, -0.6], 8); face(b, 8, [1.1, 0.5], 9.5);
    camera([[0, [0, 1.6, 8]], [9.5, [0, 1.6, 8]], [12, [0, 1.6, 7.6]]],
      [[0, [0, 1, 0]], [9.5, [0, 1, 0]], [12, [0, 1, 0]]], 48);
  } else if (index === 4) {
    prop('左立柱', [-1.4, -0.8], [0.6, 2.9, 0.6]); prop('右立柱', [1.4, -0.8], [0.6, 2.9, 0.6]);
    const a = cast('A', [-1.6, -2.2], { yaw: 30 });
    walk(a, [{ start: 0, end: 2, points: [[-0.7, -1.3]] }, { start: 2, end: 5, points: [[-0.3, -0.4], [0, 0.8]] }]);
    face(a, 5, [0.2, 5.3], 6);
    camera([[0, [0.8, 1, 6.5]], [5, [0.5, 1, 7]], [8, [0.2, 1, 5.3]], [10, [0.2, 1, 5.3]]],
      [[0, [0, 1, 0]], [5, [0, 1, 0.3]], [8, [0, 1.4, 0.8]], [10, [0, 1.4, 0.8]]], 42, [5]);
  } else if (index === 5) {
    const a = cast('A', [0, 0], { body: 'female', yaw: 15 });
    walk(a, [{ start: 3, end: 6, points: [[0.18, 0.12], [0.35, 0.2]] }]);
    // Back-side → side → front-side, 110 degrees in nine seconds.
    const orbit = [[0, 4.5, -150], [2.25, 4.5, -122.5], [4.5, 4.5, -95], [6.75, 4.5, -67.5], [9, 4.5, -40], [10.5, 4, -40], [12, 4, -40]];
    const positions = orbit.map(([t, r, d]) => [t, [Math.sin(d * Math.PI / 180) * r, 1.5, Math.cos(d * Math.PI / 180) * r]]);
    const aims = orbit.map(([t]) => [t, [t < 3 ? 0 : 0.35, 1.2, t < 3 ? 0 : 0.2]]);
    camera(positions, aims, 42); face(a, 9, positions.at(-1)[1].filter((_, i) => i !== 1), 10.5);
  } else if (index === 6) {
    prop('会议桌', [0, 0], [2.4, 0.75, 1.2], '#5a514b');
    const a = cast('A', [0, 1.8], { yaw: 180 }), b = cast('B', [-0.7, -1.5], { body: 'female', yaw: 0 }), c = cast('C', [1, -1.6], { yaw: 0 });
    walk(a, [{ start: 3, end: 7, points: [[-1.7, 1.5], [-2, 0.3], [-1.8, -0.5]] }]);
    walk(b, [{ start: 7, end: 9, points: [[-0.6, -2]] }]);
    walk(c, [{ start: 7.5, end: 9, points: [[1.6, -1.5]] }]);
    face(a, 9, [-0.6, -2], 11); face(b, 7, [-1.8, -0.5], 8);
    camera([[0, [-5.5, 1.9, 6.5]], [3, [-5.5, 1.9, 6.5]], [9, [-5.2, 2.1, 4.8]], [11, [-4.2, 2.1, 4.3]], [14, [-4.2, 2.1, 4.3]]],
      [[0, [0, 1, 0]], [3, [0, 1, 0]], [9, [-0.4, 1, -0.3]], [11, [-0.6, 1, -0.5]], [14, [-0.6, 1, -0.5]]], 48);
  } else {
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
    camera([[0, [0, 1.65, 7.5]], [8, [0, 2.3, 11.5]], [9, [0, 2.3, 11.5]], [12, [0, 2.3, 11.5]]],
      [[0, [0, 1, -1]], [8, [0, 1, -0.3]], [9, [0, 1, -0.3]], [12, [0, 1, -0.3]]], 48);
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

import * as THREE from 'three';
import { el, toast } from '../util/dom.js';
import { tripleRow, sliderRow, colorRow, dropdownRow, infoTip, shotCard, toHex, numberRow, toggleRow } from './widgets.js';
import { PoseSliders } from './PoseSliders.js';
import { POSE_PRESETS } from '../entities/posePresets.js';
import { downloadURL } from '../app/ShotManager.js';
import { propState } from './timeline/animState.js';
import { toastError } from './timeline/Transport.js';
import { arcPoints, PATH_MODES } from '../app/PathTool.js';
import { pathLength, defaultDuration } from '../anim/pathGen.js';
import { popupMenu } from './timeline/keyDrag.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const FOV_TIP = '控制镜头视野范围。数值越小，画面越近、越聚焦；数值越大，画面越广、能看到更多环境。';
const PREVIEW_W = 248, PREVIEW_H = 140;
const RUN_SPEED = 2.6; // m/s：平均速度超过它标「跑」（步态 ≥ 2.6 纯跑）
const PACES = [[0.8, '慢走'], [1.3, '走'], [1.8, '快走'], [3.5, '跑']];

// 每种实体的标签页：[key, 文案]
const TABS = {
  character: [['attr', '属性'], ['pose', '姿势']],
  crowd: [['attr', '属性'], ['pose', '姿势']],
  camera: [['attr', '属性'], ['shots', '摄像机截图']],
};

// 右侧属性面板：道具 / 角色（属性+姿势）/ 群众组 / 摄像机（属性+摄像机截图）。
export class Inspector {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.tabs = { character: 'attr', crowd: 'attr', camera: 'attr' }; // 各类型记住上次的标签页
    this._reset();

    app.on('selection', (ent) => this.show(ent));
    app.on('transform', () => this._syncFn?.());
    // 时间轴：播放头移动 / 动画数据变化 / 进出 active 时刷新数值与关键帧菱形（每帧至多一次）
    app.playback.on('tick', () => this.scheduleAnimRefresh());
    app.timeline.on('change', () => { this._sectionsDirty = true; this.scheduleAnimRefresh(); });
    app.timeline.on('active', () => this.scheduleAnimRefresh());
    app.on('inspect', (req) => this.inspect(req));
    app.on('entities', () => this.refreshName());
    app.on('shots', () => { if (this.entity?.type === 'camera') this.show(this.entity); });
  }

  _reset() {
    this._syncFn = null;
    this._animRows = [];    // [{ ent, prop, row, dia }] 可打键的属性行
    this._activeHint = null;
    this._animHost = null;  // 路径段 / 约束段的容器（timeline 'change' 时重建）
    this._nameInput = null;
    this.poseSliders = null;
    this._previewEnt = null;
    this._previewCanvas = null;
    this._previewBadge = null;
  }

  show(entity) {
    this.entity = entity;
    this._reset();
    if (!entity) { this.container.replaceChildren(); return; }

    const root = el('div', { class: 'rp rp-pad' });
    this._activeHint = el('div', { class: 'tl-active-hint', text: '时间轴激活中：修改会写入当前时刻的关键帧', hidden: true });
    root.appendChild(this._activeHint);
    const title = { character: '角色', camera: '摄像机', crowd: `${entity.name} (${entity.children.length})` }[entity.type] || '道具';
    root.appendChild(el('h2', { text: title }));

    const tab = this._tabBar(root, entity);
    switch (entity.type) {
      case 'crowd':
        root.appendChild(el('div', { class: 'multi-note', text: `已选中 ${entity.members.length} 个角色，修改将同步应用到全部选中对象` }));
        root.appendChild(el('button', { class: 'minibtn', text: '⊟ 解组（拆为独立角色）', onclick: () => this.app.ungroupCrowd(entity.id) }));
        if (tab === 'attr') this._attr(root, entity); else this._pose(root, entity.members);
        break;
      case 'character':
        if (tab === 'attr') this._attr(root, entity); else this._pose(root, [entity]);
        break;
      case 'camera':
        if (tab === 'attr') this._cameraAttr(root, entity); else this._cameraShots(root);
        break;
      default:
        this._attr(root, entity);
    }

    this.container.replaceChildren(root);
    if (this._previewEnt) this.refreshPreview();
    this._refreshAnim();
  }

  // ---- 时间轴联动 ----
  scheduleAnimRefresh() {
    if (this._animPending) return;
    this._animPending = true;
    requestAnimationFrame(() => {
      this._animPending = false;
      if (!this.entity) return;
      if (this._sectionsDirty) { this._sectionsDirty = false; this._renderAnimSections(); }
      this._syncFn?.();
      this._refreshAnim();
    });
  }

  /** 打开某实体的属性页并定位到路径段 / 约束段（时间轴面板双击区间条）。 */
  inspect({ id, section }) {
    const ent = this.app.findEntity(id);
    if (!ent) return;
    if (ent.type in this.tabs) this.tabs[ent.type] = 'attr';
    if (this.app.selectedId !== id) this.app.select(id); else this.show(ent);
    const sec = this.container.querySelector(`[data-sec="${section}"]`);
    if (!sec) return;
    sec.scrollIntoView({ block: 'nearest' });
    sec.classList.remove('flash');
    void sec.offsetWidth; // 重新触发动画
    sec.classList.add('flash');
  }

  // ---- 路径段 / 约束段 ----
  _renderAnimSections() {
    const host = this._animHost, ent = this.entity;
    if (!host || !ent) return;
    const anim = this.app.timeline.toJSON();
    const nodes = [];
    const path = anim.paths.find((p) => p.target === ent.id);
    if (path) nodes.push(this._pathSection(path, ent));
    else if (this.app.pathTool.canDraw(ent)) nodes.push(this._pathEmpty());
    if (ent.type === 'camera') nodes.push(this._constraintSection(ent, anim.constraints.filter((c) => c.target === ent.id)));
    host.replaceChildren(...nodes);
  }

  /** 执行 timeline 写操作；失败 toast 字段路径并按文档重画（输入框回到文档值）。 */
  _tl(fn) {
    try { fn(this.app.timeline); } catch (err) { toastError(err); this._renderAnimSections(); }
  }

  /** 「新建路径 ▾」：五种绘制方式（与 Dock「路径」按钮等价）。 */
  _newPathBtn(label) {
    const tool = this.app.pathTool;
    return el('button', {
      class: 'sec-btn', text: label + ' ▾',
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        popupMenu(r.left, r.bottom + 4, PATH_MODES.map(([mode, text]) => ({ label: text, onClick: () => tool.request(mode) })));
      },
    });
  }

  /** 没有路径的角色 / 道具 / 组：只有段头与入口。 */
  _pathEmpty() {
    return el('div', { class: 'anim-sec', 'data-sec': 'path' }, [
      el('div', { class: 'sec-title' }, [el('span', { text: '路径' }), el('span', { class: 'sec-spacer' }), this._newPathBtn('新建路径')]),
      el('div', { class: 'anim-info', text: '未设置路径。新建后角色沿路径移动，播放时自动走 / 跑。' }),
    ]);
  }

  /**
   * 路径段：顶点数 / 总长 / 平均速度；start / duration / speed / orient / closed；环绕三参数；
   * 反向 / 起点对齐到当前位置 / 按步速重算时长 / 删除路径。所有写操作走 timeline API（一次撤销）。
   */
  _pathSection(p, ent) {
    const upd = (patch) => this._tl((tl) => tl.updatePath(p.id, patch));
    const len = pathLength(p.points, p.closed);
    const v = len / p.duration;
    const tool = this.app.pathTool;
    const pace = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      popupMenu(r.left, r.bottom + 4, PACES.map(([speed, name]) => ({
        label: `${name} ${speed} m/s`, onClick: () => upd({ duration: defaultDuration(p.points, { speed, closed: p.closed }) }),
      })));
    };
    return el('div', { class: 'anim-sec', 'data-sec': 'path' }, [
      el('div', { class: 'sec-title' }, [
        el('span', { text: '路径' }), el('span', { class: 'sec-tag path', text: `${p.points.length} 个点` }),
        el('span', { class: 'sec-spacer' }),
        tool.canDraw(ent) ? this._newPathBtn('重新绘制') : null,
      ]),
      el('div', { class: 'anim-info path-stats' }, [
        `顶点 ${p.points.length} · 总长 ${len.toFixed(2)} m · `,
        el('span', { class: 'path-speed', text: `平均 ${v.toFixed(2)} m/s` }),
        v > RUN_SPEED ? el('span', { class: 'path-run', text: '跑' }) : null,
      ]),
      el('div', { class: 'anim-pair' }, [
        numberRow({ label: '开始', value: p.start, step: 0.1, min: 0, unit: 's', onChange: (x) => upd({ start: x }) }).el,
        numberRow({ label: '时长', value: p.duration, step: 0.1, min: 0.01, unit: 's', onChange: (x) => upd({ duration: x }) }).el,
      ]),
      dropdownRow({
        label: '速度', value: p.speed,
        options: [{ value: 'linear', label: '匀速' }, { value: 'smooth', label: '缓入缓出' }],
        onChange: (x) => upd({ speed: x }),
      }).el,
      dropdownRow({
        label: '朝向', value: p.orient,
        options: [{ value: 'tangent', label: '沿路径方向' }, { value: 'keep', label: '保持手动朝向' }],
        onChange: (x) => upd({ orient: x }),
      }).el,
      toggleRow({ label: '闭合路径', checked: p.closed, onChange: (x) => upd({ closed: x }) }).el,
      ...this._arcRows(p),
      el('div', { class: 'anim-btns' }, [
        el('button', { class: 'minibtn', text: '反向', title: '顶点倒序（从终点走回起点）', onclick: () => upd({ points: p.points.slice().reverse() }) }),
        tool.canDraw(ent) ? el('button', {
          class: 'minibtn', text: '起点对齐当前位置', title: '把第一个顶点移到对象当前（手动）位置',
          onclick: () => upd({ points: [tool.startPoint(ent), ...p.points.slice(1)] }),
        }) : null,
        el('button', { class: 'minibtn', text: '按步速重算时长 ▾', onclick: pace }),
        el('button', { class: 'minibtn danger', text: '删除路径', onclick: () => this._tl((tl) => tl.removePath(p.id)) }),
      ]),
    ]);
  }

  /**
   * 环绕方式创建的路径：半径 / 起始角 / 扫过角度（会话态 app.pathMeta，不进文档）。
   * 只有 points 仍等于这组参数的生成结果时才显示（拖过顶点 / 重新加载后退化为普通点集）。改动即重算 points。
   */
  _arcRows(p) {
    const meta = this.app.pathMeta[p.id];
    if (meta?.kind !== 'arc') return [];
    const y = p.points[0][1];
    const gen = arcPoints(meta, y);
    if (gen.closed !== p.closed || JSON.stringify(gen.points) !== JSON.stringify(p.points)) return [];
    const set = (patch) => this._tl((tl) => {
      const next = { ...meta, ...patch };
      const r = arcPoints(next, y);
      tl.updatePath(p.id, { points: r.points, closed: r.closed });
      this.app.pathMeta[p.id] = next;
    });
    return [
      numberRow({ label: '环绕半径', value: meta.radius, step: 0.1, min: 0.1, unit: 'm', onChange: (v) => set({ radius: v }) }).el,
      el('div', { class: 'anim-pair' }, [
        numberRow({ label: '起始角', value: meta.startDeg, step: 5, unit: '°', onChange: (v) => set({ startDeg: v }) }).el,
        numberRow({ label: '扫过角度', value: meta.sweepDeg, step: 15, unit: '°', onChange: (v) => { if (v) set({ sweepDeg: v }); else this._renderAnimSections(); } }).el,
      ]),
    ];
  }

  /** 约束段（机位）：注视（无 / 实体 / 自定义点）、跟随（实体 + 偏移），各自生效区间。 */
  _constraintSection(cam, list) {
    const app = this.app;
    const look = list.find((c) => c.type === 'lookAt');
    const follow = list.find((c) => c.type === 'follow');
    const subjects = [];
    for (const e of app.entities) {
      if (e !== cam) subjects.push({ value: e.id, label: e.name });
      for (const m of e.children) subjects.push({ value: m.id, label: `${e.name} / ${m.name}` });
    }
    const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);
    const range = (c) => el('div', { class: 'anim-pair' }, [
      numberRow({ label: '开始', value: c.start, step: 0.1, min: 0, unit: 's', allowEmpty: true, placeholder: '开头', onChange: (v) => this._tl((tl) => tl.updateConstraint(c.id, { start: v })) }).el,
      numberRow({ label: '结束', value: c.end, step: 0.1, min: 0, unit: 's', allowEmpty: true, placeholder: '结尾', onChange: (v) => this._tl((tl) => tl.updateConstraint(c.id, { end: v })) }).el,
    ]);
    const vecRow = (label, arr, onCommit) => {
      const v = [...arr];
      return tripleRow({
        label, step: 0.05, onCommit: () => onCommit(r3(v)),
        axes: ['x', 'y', 'z'].map((k, i) => ({ key: k, get: () => v[i], set: (x) => { v[i] = x; } })),
      }).el;
    };

    const nodes = [el('div', { class: 'sec-title' }, [el('span', { text: '约束' }), el('span', { class: 'sec-tag cns', text: '播放时生效' })])];

    // 注视
    const lookVal = !look ? '' : Array.isArray(look.subject) ? '__point' : look.subject;
    nodes.push(dropdownRow({
      label: '注视', value: lookVal,
      options: [{ value: '', label: '无' }, ...subjects, { value: '__point', label: '自定义点' }],
      onChange: (v) => this._tl((tl) => {
        if (!v) { if (look) tl.removeConstraint(look.id); return; }
        const subject = v === '__point' ? (Array.isArray(look?.subject) ? look.subject : r3(cam.lookTarget.toArray())) : v;
        if (look) tl.updateConstraint(look.id, { subject });
        else tl.addConstraint({ type: 'lookAt', target: cam.id, subject });
      }),
    }).el);
    if (look && Array.isArray(look.subject)) nodes.push(vecRow('注视点', look.subject, (v) => this._tl((tl) => tl.updateConstraint(look.id, { subject: v }))));
    if (look) nodes.push(range(look));

    // 跟随
    nodes.push(dropdownRow({
      label: '跟随', value: follow?.subject ?? '',
      options: [{ value: '', label: '无' }, ...subjects],
      onChange: (v) => this._tl((tl) => {
        if (!v) { if (follow) tl.removeConstraint(follow.id); return; }
        if (follow) tl.updateConstraint(follow.id, { subject: v });
        else tl.addConstraint({ type: 'follow', target: cam.id, subject: v, offset: this._followOffset(cam, v) });
      }),
    }).el);
    if (follow) {
      nodes.push(vecRow('偏移', follow.offset, (v) => this._tl((tl) => tl.updateConstraint(follow.id, { offset: v }))));
      nodes.push(range(follow));
    }
    return el('div', { class: 'anim-sec', 'data-sec': 'constraint' }, nodes);
  }

  /** 新建跟随时的默认偏移：机位相对 subject 的当前位置（subject 的 yaw 坐标系），机位不会跳走。 */
  _followOffset(cam, subjectId) {
    const sub = this.app.findEntity(subjectId);
    if (!sub) return [0, 0, 0];
    const world = this.app.stage.world;
    world.updateMatrixWorld(true);
    const p = world.worldToLocal(sub.root.getWorldPosition(new THREE.Vector3()));
    const q = sub.root.getWorldQuaternion(new THREE.Quaternion());
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    const d = cam.root.position.clone().sub(p).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    return d.toArray().map((x) => Math.round(x * 1000) / 1000);
  }

  /** 关键帧菱形状态 + 被驱动属性灰字 + active 提示条。 */
  _refreshAnim() {
    const { app } = this;
    if (this._activeHint) this._activeHint.hidden = !app.timeline.active;
    if (!this._animRows.length) return;
    const anim = app.timeline.toJSON();
    const t = app.timeline.active ? app.playback.time : 0;
    for (const r of this._animRows) {
      const st = propState(app, anim, r.ent.id, r.prop, t);
      const state = st.key ? 'key' : st.track ? 'track' : 'none';
      r.dia.className = 'kf-dia ' + state;
      r.dia.disabled = st.forced === '路径';
      r.dia.title = st.forced === '路径' ? '由路径驱动，不能打键'
        : st.key ? '删除当前时刻的关键帧' : app.timeline.active ? '在当前时刻打关键帧' : '在 0 秒打关键帧（进入时间轴）';
      r.row.classList.toggle('driven', st.driven);
    }
  }

  /** 给属性行的标题加一颗关键帧菱形。 */
  _keyable(ent, pairs) {
    for (const [prop, row] of pairs) {
      const dia = el('button', { class: 'kf-dia none', onclick: (e) => { e.stopPropagation(); this._toggleKey(ent, prop); } });
      const label = row.querySelector('label');
      label.classList.add('kf-label');
      label.appendChild(dia);
      this._animRows.push({ ent, prop, row, dia });
    }
  }

  /**
   * 菱形点击：当前时刻无键 → 打键（无轨道先建）；有键 → 删键（轨道空了保留）。
   * 时间轴 idle 时 = 在 0 秒打键并 seek(0) 进入 active（"第一次打键"的入口）。
   */
  _toggleKey(ent, prop) {
    const { app } = this;
    const tl = app.timeline, pb = app.playback;
    const idle = !tl.active;
    const t = idle ? 0 : pb.time;
    const st = propState(app, tl.toJSON(), ent.id, prop, t);
    try {
      if (st.key) tl.removeKey(st.track.id, st.key.t);
      else {
        const value = tl.valueOf(ent, prop); // 此刻显示的值（idle = 手动值，active = 求值结果）
        const track = st.track || tl.addTrack({ target: ent.id, property: prop });
        tl.setKey(track.id, t, value);
      }
    } catch (err) { toastError(err); return; }
    if (idle) pb.seek(0);
  }

  /** 标签页头（无标签页的类型返回 null）。 */
  _tabBar(root, entity) {
    const items = TABS[entity.type];
    if (!items) return null;
    const cur = this.tabs[entity.type];
    root.appendChild(el('div', { class: 'ptabs' }, items.map(([key, label]) => el('button', {
      text: label, class: key === cur ? 'on' : '',
      onclick: () => { this.tabs[entity.type] = key; this.show(entity); },
    }))));
    return cur;
  }

  refreshName() {
    if (this._nameInput && this.entity) this._nameInput.value = this.entity.name;
  }

  _nameField(ent) {
    const input = el('input', { value: ent.name });
    input.addEventListener('change', () => this.app.rename(ent.id, input.value));
    this._nameInput = input;
    return el('div', { class: 'field' }, [el('label', { text: '名称' }), el('div', { class: 'namefld' }, [input])]);
  }

  // ---- 属性页（角色 / 道具 / 群众组通用）----
  _attr(root, ent) {
    const o = ent.root;
    const invalidate = () => this.app.stage.invalidate();
    const commit = (prop) => () => this.app.edited(ent, new Set([prop])); // 一次修改结束：按时间轴状态归属（3.3）
    root.appendChild(this._nameField(ent));

    // 显示 / 输入都是文档口径（与导出 JSON、关键帧值一致）：pos 减站立基准偏移，scale 除以素体自然尺寸（_docTransformOpts）
    const opts = () => ent._docTransformOpts();
    const pos = tripleRow({ label: '位置', step: 0.01, onCommit: commit('pos'), axes: ['x', 'y', 'z'].map((k, i) => ({ key: k, get: () => o.position[k] - opts().posOffset[i], set: (v) => { o.position[k] = v + opts().posOffset[i]; invalidate(); } })) });
    const rot = tripleRow({ label: '旋转', deg: true, onCommit: commit('rot'), axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.rotation[k] * R2D, set: (v) => { o.rotation[k] = v * D2R; invalidate(); } })) });
    const scl = tripleRow({ label: '缩放', step: 0.01, onCommit: commit('scale'), axes: ['x', 'y', 'z'].map((k, i) => ({ key: k, get: () => o.scale[k] / opts().scaleDiv[i], set: (v) => { o.scale[k] = Math.max(0.05, v) * opts().scaleDiv[i]; invalidate(); } })) });

    const girth = ent._girth || 1; // 体型横向围度（胖瘦）；统一缩放时按 Y 为基准、保留 X/Z 比例
    const uni = sliderRow({
      label: '统一缩放', min: 0.2, max: 3, step: 0.01, value: o.scale.y / ent.baseScale,
      format: (v) => v.toFixed(1),
      onInput: (v) => { const s = ent.baseScale * v; o.scale.set(s * girth, s, s * girth); scl.syncAll(); invalidate(); },
      onChange: commit('scale'),
    });
    const col = colorRow({ label: '颜色', hex: toHex(ent.color), onChange: (h) => { ent.setColor(h); this.app.edited(ent); invalidate(); } });

    root.append(pos.el, rot.el, scl.el, uni.el, col.el);
    this._keyable(ent, [['pos', pos.el], ['rot', rot.el], ['scale', scl.el]]);
    this._animHost = el('div');
    root.appendChild(this._animHost);
    this._renderAnimSections();
    this._syncFn = () => { pos.syncAll(); rot.syncAll(); scl.syncAll(); uni.set(o.scale.y / ent.baseScale); };
  }

  // ---- 摄像机：属性 ----
  _cameraAttr(root, ent) {
    const app = this.app;
    const o = ent.root;
    const changed = () => { ent.update(); app.stage.invalidate(); this.schedulePreview(); };
    const commit = (prop) => () => app.edited(ent, new Set([prop])); // 一次修改结束：按时间轴状态归属（3.3）

    root.appendChild(this._buildPreview(ent));
    root.appendChild(this._nameField(ent));

    const cams = app.cameras;
    if (cams.length > 1) {
      root.appendChild(dropdownRow({
        label: '切换机位', value: ent.id,
        options: cams.map((c) => ({ value: c.id, label: c.name })),
        onChange: (id) => app.setActiveCamera(id),
      }).el);
    }

    const pos = tripleRow({
      label: '位置', step: 0.01, onCommit: commit('pos'),
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.position[k], set: (v) => { o.position[k] = v; changed(); } })),
    });
    root.appendChild(pos.el);

    // 注视目标：选对象时一次性对准，之后仍是手动坐标
    const targets = app.entities.filter((e) => e.type === 'character' || e.type === 'prop');
    let lookRow;
    root.appendChild(dropdownRow({
      label: '注视目标', value: ent._aimRef || 'manual',
      options: [{ value: 'manual', label: '手动坐标' }, ...targets.map((t) => ({ value: t.id, label: t.name }))],
      onChange: (val) => {
        ent._aimRef = val;
        if (val === 'manual') return;
        if (app.aimCameraAtObject(ent.id, val)) { lookRow.syncAll(); pos.syncAll(); this.schedulePreview(); }
      },
    }).el);

    lookRow = tripleRow({
      label: '注视坐标', step: 0.05, onCommit: commit('rot'), // 注视坐标决定机位朝向：菱形 = 旋转关键帧
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => ent.lookTarget[k], set: (v) => { ent.lookTarget[k] = v; ent.aimAt(ent.lookTarget); changed(); } })),
    });
    root.appendChild(lookRow.el);

    const fovField = sliderRow({
      label: '视野角度', min: 20, max: 90, step: 1, value: ent.cam.fov,
      format: (v) => Math.round(v) + '°',
      onInput: (v) => { ent.setFov(v); this._previewBadge.textContent = 'FOV ' + Math.round(v) + '°'; changed(); },
      onChange: commit('fov'),
    });
    fovField.el.querySelector('label')?.appendChild(infoTip(FOV_TIP));
    root.appendChild(fovField.el);
    this._keyable(ent, [['pos', pos.el], ['rot', lookRow.el], ['fov', fovField.el]]);
    this._animHost = el('div');
    root.appendChild(this._animHost);
    this._renderAnimSections();

    const myShots = app.shots.shotsForCamera(ent.id);
    if (myShots.length) {
      root.appendChild(el('div', { class: 'sec-title', text: '相机截图', style: { marginTop: '6px' } }));
      root.appendChild(this._shotGrid(myShots, true));
    }

    this._syncFn = () => {
      pos.syncAll(); lookRow.syncAll();
      fovField.set(ent.cam.fov);
      this._previewBadge.textContent = 'FOV ' + Math.round(ent.cam.fov) + '°';
      this.schedulePreview();
    };
  }

  // ---- 摄像机：截图（按机位分组）----
  _cameraShots(root) {
    const shots = this.app.shots;
    if (!shots.list.length) {
      root.appendChild(el('div', { class: 'hint', text: '暂无截图。在机位视角或导演视角点击底部「截屏」即可。' }));
      return;
    }
    for (const cam of this.app.cameras) {
      const group = shots.shotsForCamera(cam.id);
      if (!group.length) continue;
      root.appendChild(el('div', { class: 'sec-title', text: cam.name + '截图', style: { marginTop: '8px' } }));
      root.appendChild(this._shotGrid(group));
    }

    const n = shots.selectedShotIds.size;
    root.appendChild(el('div', { class: 'shot-bar' }, [
      el('button', { class: 'shot-bar-clear', text: '全部清空', onclick: () => { if (confirm('确认清空全部截图？')) shots.clearShots(); } }),
      el('button', {
        class: 'shot-bar-send' + (n ? '' : ' disabled'), text: n ? `发送到画布(${n})` : '发送到画布',
        onclick: () => { if (!n) { toast('请先选择截图'); return; } shots.sendShotsToCanvas(); },
      }),
    ]));
  }

  _shotGrid(list, compact = false) {
    const shots = this.app.shots;
    return el('div', { class: 'shot-grid' }, list.map((shot) => shotCard({
      shot,
      compact,
      selected: shots.selectedShotIds.has(shot.id),
      onToggle: () => shots.toggleShotSelected(shot.id),
      onDelete: () => shots.removeShot(shot.id),
      onSend: () => shots.sendShotsToCanvas([shot.id]),
      onExpand: () => this._openShotModal(shot),
    })));
  }

  // ---- 相机预览框（主渲染器离屏出图，画进 canvas）----
  _buildPreview(ent) {
    const canvas = el('canvas', { width: PREVIEW_W, height: PREVIEW_H });
    const badge = el('div', { class: 'cam-fov-badge', text: 'FOV ' + Math.round(ent.cam.fov) + '°' });
    const expand = el('button', { class: 'cam-expand', title: '全屏扩大', text: '⤢', onclick: () => this._openPreviewModal(ent) });
    this._previewEnt = ent;
    this._previewCanvas = canvas;
    this._previewBadge = badge;
    return el('div', { class: 'field' }, [el('div', { class: 'cam-preview' }, [canvas, badge, expand])]);
  }

  /** 合并同帧多次预览请求。 */
  schedulePreview() {
    if (this._previewPending) return;
    this._previewPending = true;
    requestAnimationFrame(() => { this._previewPending = false; this.refreshPreview(); });
  }

  _renderPOV(ent, width, height) {
    return this.app.withCleanRender(() => this.app.stage.snapshot(ent.cam, { width, height }));
  }

  refreshPreview() {
    if (!this._previewEnt || !this._previewCanvas?.isConnected) return;
    const snap = this._renderPOV(this._previewEnt, PREVIEW_W, PREVIEW_H);
    const ctx = this._previewCanvas.getContext('2d');
    ctx.drawImage(snap, 0, 0, PREVIEW_W, PREVIEW_H);
  }

  // ---- 全屏 modal ----
  _modal(contentNodes) {
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.appendChild(el('div', { class: 'modal-box' }, [
      el('button', { class: 'modal-close', text: '×', onclick: close }),
      ...contentNodes,
    ]));
    document.body.appendChild(overlay);
  }

  _openShotModal(shot) {
    this._modal([
      el('img', { class: 'modal-img', src: shot.url, alt: shot.name }),
      el('div', { class: 'modal-bar' }, [
        el('span', { class: 'modal-title', text: shot.name }),
        el('button', { class: 'minibtn modal-dl', text: '下载', onclick: () => downloadURL(shot.url, shot.name + '.png') }),
        el('button', { class: 'minibtn', text: '发送到画布', onclick: () => this.app.shots.sendShotsToCanvas([shot.id]) }),
      ]),
    ]);
  }

  _openPreviewModal(ent) {
    const snap = this._renderPOV(ent, 1280, 720);
    snap.className = 'modal-img';
    this._modal([
      snap,
      el('div', { class: 'modal-bar' }, [el('span', { class: 'modal-title', text: ent.name + '：FOV ' + Math.round(ent.cam.fov) + '°' })]),
    ]);
  }

  // ---- 姿势页：members 为单个角色或群众全部成员；预设/滑条广播到全部 ----
  _pose(root, members) {
    const rep = members[0];
    if (!rep) return;
    const invalidate = () => { members.forEach((m) => this.app.edited(m)); this.app.stage.invalidate(); };

    const grid = el('div', { class: 'pose-grid' });
    const btns = new Map();
    const mark = (key) => btns.forEach((b, k) => b.classList.toggle('on', k === key));
    for (const p of POSE_PRESETS) {
      const b = el('button', {
        text: p.label, class: rep.currentPreset === p.key ? 'on' : '',
        onclick: () => { members.forEach((m) => m.applyPosePreset(p.key)); this.poseSliders?.syncFromValues(); mark(p.key); invalidate(); },
      });
      btns.set(p.key, b);
      grid.appendChild(b);
    }
    root.append(
      el('div', { class: 'sec-title', text: '姿势预设', style: { marginTop: '4px' } }),
      grid,
      el('button', {
        class: 'minibtn', text: members.length > 1 ? '⟲ 复位全部姿势' : '⟲ 复位姿势', style: { marginTop: '12px' },
        onclick: () => { members.forEach((m) => m.resetPose()); this.poseSliders?.syncFromValues(); mark(null); invalidate(); },
      }),
      el('div', { class: 'sec-title', text: '姿势调节', style: { marginTop: '16px' } }),
    );

    // 滑条驱动代表成员，onChange 把其 values 广播到其余成员
    const host = el('div', {});
    root.appendChild(host);
    this.poseSliders = new PoseSliders(host, rep, () => {
      mark(null); // 手动微调取消预设高亮
      for (const m of members) if (m !== rep) m.copyPoseFrom(rep);
      invalidate();
    });
  }
}

import { popupMenu } from '../popupMenu.js';
import { openPathMenu } from '../pathMenu.js';
import { el, toast, toastError } from '../../util/dom.js';
import { icon } from '../icons.js';
import { toggleKey, propState, hitTime } from './animState.js';
import { objectAnimationRange } from '../../anim/objectAnimation.js';
import { toggleStop } from '../../anim/pathGen.js';
import { aimPoint, constraintActive } from '../../anim/Constraint.js';

/** 轨道行名（词汇表 → 中文）。 */
export const PROP_LABEL = { pos: '位置', rot: '旋转', scale: '缩放', fov: '视角（FOV）' };
export const CAMERA_PROP_LABEL = { pos: '位置', rot: '焦点', fov: '视角' };
const CONSTRAINT_LABEL = { lookAt: '注视', follow: '跟随' };
const TYPE_ICON = { character: 'person', prop: 'cube', camera: 'video', group: 'group' };
const PROP_ORDER = ['pos', 'rot', 'scale', 'fov'];

/** 设置 CSS 自定义属性（el() 的 style 对象不支持 --var）。 */
const vars = (node, obj) => { for (const [k, v] of Object.entries(obj)) node.style.setProperty(k, v); return node; };

/** 选中键的标识：同一轨道同一时刻至多一键。 */
export const keyId = (trackId, t) => `${trackId}@${t}`;

/**
 * 按实体分组的轨道行：实体表头（名字 + 类型图标 + 删除全部动画）+ 轨道 / 路径 / 约束行。
 * 每次 timeline 'change' 都按只读 view() 重建（面板自己不留文档状态）；
 * 横向位置用 CSS 变量 --t × --pps，缩放时只改 --pps，不重建。
 */
export class TrackRows {
  /** @param {import('./TimelinePanel.js').TimelinePanel} panel */
  constructor(panel) {
    this.panel = panel;
    this.collapsedEnts = new Set();
    this.expandedEnts = new Set();
    this.groups = [];               // [{ ent, rows:[{ kind, data }] }]
  }

  /**
   * 当前文档 → 分组数据。所有实体都列一行，顺序同大纲（顶层实体，成员紧跟其组）；
   * 无动画角色支持展开属性描述；道具在有动画时才显示，不创建虚构轨道。
   */
  _collect() {
    const { app } = this.panel;
    const { timeline, paths, constraints } = app.timeline.view();
    const by = new Map();
    const bucket = (id) => { if (!by.has(id)) by.set(id, []); return by.get(id); };
    for (const t of timeline.tracks) bucket(t.target).push({ kind: 'track', data: t, order: 1 + PROP_ORDER.indexOf(t.property) });
    for (const p of paths) bucket(p.target).push({ kind: 'path', data: p, order: 0 });
    for (const c of constraints) bucket(c.target).push({ kind: 'constraint', data: c, order: c.type === 'lookAt' ? 10 : 11 });
    const groups = [];
    for (const e of app.entities) {
      for (const ent of [e, ...e.children]) {
        if (!['character', 'camera'].includes(ent.type) && !by.has(ent.id)) continue;
        // 机位的注视属于焦点属性，不再单列成延伸到场景末尾的约束色块。
        const rows = (by.get(ent.id) || []).filter(r => ent.type !== 'camera' || r.kind !== 'constraint');
        const supported = ent.type === 'camera' ? ['pos', 'rot', 'fov'] : ['pos', 'rot', 'scale'];
        for (const property of supported) {
          if (rows.some(r => r.data.property === property || (property === 'pos' && r.kind === 'path'))) continue;
          rows.push({ kind: 'property', data: { target: ent.id, property, keys: [] }, order: 1 + PROP_ORDER.indexOf(property) });
        }
        groups.push({ ent, rows: rows.sort((a, b) => a.order - b.order) });
      }
    }
    return groups;
  }

  /** 重建全部行，返回 DocumentFragment。 */
  build() {
    this.groups = this._collect();
    const frag = document.createDocumentFragment();
    if (!this.groups.length) {
      frag.appendChild(el('div', { class: 'tl-empty', text: '场景里还没有对象。在左侧 Dock 添加角色 / 道具 / 机位后，它们会列在这里。' }));
      return frag;
    }
    for (const g of this.groups) {
      frag.appendChild(this._headRow(g));
      if (this._folded(g.ent.id)) continue;
      g.rows.forEach((r, index) => { const row = this._row(g.ent, r); row.classList.toggle('last-child', index === g.rows.length - 1); frag.appendChild(row); });
    }
    return frag;
  }

  _folded(id) { return this.collapsedEnts.has(id) || (!this.expandedEnts.has(id)); }

  _headRow({ ent, rows }) {
    const folded = !rows.length || this._folded(ent.id);
    const caret = el('button', { class: 'tl-caret' + (folded ? ' folded' : ''), title: folded ? '展开此对象的动画属性' : '折叠此对象的动画属性', html: icon('chevron', 12, 2) });
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (folded) { this.collapsedEnts.delete(ent.id); this.expandedEnts.add(ent.id); } else { this.collapsedEnts.add(ent.id); this.expandedEnts.delete(ent.id); }
      this.panel.rebuild();
    });
    const pathRow = rows.find(r => r.kind === 'path');
    const objectBar = ent.type !== 'camera';
    const range = objectBar ? objectAnimationRange(this.panel.app.timeline.view(), ent.id) : null;
    const removePath = !objectBar && pathRow;
    const remove = el('button', {
      class: 'tl-row-delete', title: removePath ? '删除此机位的轨迹' : ent.type === 'character' ? '删除此角色的全部动画' : '删除此对象的全部动画',
      'aria-label': `删除${ent.name}的${removePath ? '轨迹' : '全部动画'}`, disabled: !(rows.some(r => r.kind !== 'property') || this.panel.app.timeline.constraints.some(c => c.target === ent.id)) || undefined,
      html: icon('trash', 13, 1.5), onclick: (e) => {
        e.stopPropagation();
        try {
          if (removePath) { this.panel.app.timeline.removePath(pathRow.data.id); toast('已删除机位轨迹', { action: { label: '撤销', onClick: () => this.panel.app.history.undo() } }); }
          else this.panel.removeAllAnimation(ent.id);
        } catch (err) { toastError(err); }
      },
    });
    const name = el('div', { class: 'tl-name' }, [
      caret,
      el('span', { class: 'tl-type', html: icon(TYPE_ICON[ent.type] || 'cube', 14) }),
      el('span', { class: 'tl-label', text: ent.name, title: ent.name }),
      ...(ent.id === this.panel.app.timeline.mainCameraId ? [el('span', { class: 'tl-main-badge', text: '主机位' })] : []),
      el('button', { class: 'tl-addkey', html: icon('path', 18, 1.5) + '<span>绘制轨迹</span>', title: '为此对象绘制路径', onclick: (e) => {
        e.stopPropagation();
        const app = this.panel.app;
        openPathMenu(app, e.currentTarget, ent.id);
      } }),
      remove,
    ]);
    // 表头的轨道区：所有键时刻的汇总（只读）
    const times = new Set();
    for (const r of rows) if (r.kind === 'track') for (const k of r.data.keys) times.add(k.t);
    const lane = el('div', { class: 'tl-lane' }, [...times].map((t) => vars(el('i', { class: 'tl-sum' }), { '--t': t })));
    if (objectBar) {
      if (range) {
        const bar = this._bar('object', ent.id, range.start, range.end, range.end === range.start
          ? `对象动画 · ${range.start.toFixed(2)} s（单点）` : `对象动画 · ${(range.end - range.start).toFixed(1)} s`);
        bar.classList.add('tl-path-clip');
        lane.append(bar);
      } else lane.append(el('span', { class: 'tl-path-status', text: '无动画' }));
    } else if (pathRow) {
      const p = pathRow.data;
      const bar = this._bar('path', p.id, p.start, p.start + p.duration, `位置路径 · ${p.duration.toFixed(1)} s`);
      bar.classList.add('tl-path-clip');
      lane.append(bar);
    } else lane.append(el('span', { class: 'tl-path-status', text: '无轨迹' }));
    return el('div', { class: 'tl-row tl-head' + ((objectBar ? range : pathRow) ? ' has-path' : ' no-path') + (ent.type === 'camera' ? ' camera' : ''), 'data-ent': ent.id, 'data-path': objectBar ? undefined : pathRow?.data.id }, [name, lane]);
  }

  _row(ent, { kind, data }) {
    let label, lane;
    const attrs = { 'data-ent': ent.id, 'data-property-row': data.property || kind };
    if (kind === 'track' || kind === 'property') {
      label = (ent.type === 'camera' ? CAMERA_PROP_LABEL : PROP_LABEL)[data.property];
      if (ent.type === 'camera' && data.property === 'rot') attrs['data-property-row'] = 'focus';
      if (data.id) attrs['data-track'] = data.id;
      lane = el('div', { class: 'tl-lane' }, data.keys.map((k) => vars(el('i', {
        class: 'tl-key ease-' + k.ease, tabindex: '0', role: 'button',
        onkeydown: e => {
          if (!['Enter', ' '].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const panel = this.panel, id = keyId(data.id, k.t);
          if (!e.shiftKey) panel.selKeys.clear();
          if (panel.selKeys.has(id)) panel.selKeys.delete(id); else panel.selKeys.add(id);
          panel.applySelection(); panel.syncMotionKey();
        },
        title: `关键帧 ${k.t.toFixed(2)} 秒 · ${{ linear: '匀速', smooth: '缓入缓出', step: '阶跃' }[k.ease] || k.ease}；拖动改时间，双击设置过渡`,
        'data-track': data.id, 'data-t': String(k.t),
      }), { '--t': k.t })));
      if (data.keys.length > 1) lane.prepend(vars(el('i', { class: 'tl-key-line' }), { '--t0': data.keys[0].t, '--t1': data.keys.at(-1).t }));
    } else if (kind === 'path') {
      label = '位置';
      attrs['data-path'] = data.id;
      lane = this._pathLane(ent, data);
    } else {
      label = data.type === 'lookAt' ? '焦点' : CONSTRAINT_LABEL[data.type];
      attrs['data-constraint'] = data.id;
      const full = data.start == null && data.end == null;
      const { duration } = this.panel.app.timeline;
      lane = el('div', { class: 'tl-lane' }, [this._bar('constraint', data.id, data.start ?? 0, data.end ?? duration, full ? '全程' : '', {
        openStart: data.start == null, openEnd: data.end == null,
      })]);
    }
    if (ent.type === 'camera') this._cameraPropertyLane(ent, kind === 'path' ? { property: 'pos', keys: [] } : data, lane);
    const empty = kind === 'track' && !data.keys.length;
    return el('div', { class: 'tl-row tl-track' + (empty ? ' is-empty' : ''), ...attrs }, [
      el('div', { class: 'tl-name' }, [el('span', { class: 'tl-label', text: label }), ...this._rowControls(ent, kind, data)]),
      lane,
    ]);
  }

  /** 恒定属性也显示运镜片段范围；端点是状态标记，不伪造可拖动的关键帧。 */
  _cameraPropertyLane(ent, data, lane) {
    const anim = this.panel.app.timeline.view();
    const range = objectAnimationRange(anim, ent.id);
    const constraints = anim.constraints.filter(c => c.target === ent.id && c.type === ({ rot: 'lookAt', pos: 'follow' })[data.property]);
    const spans = constraints.length ? constraints.map(c => ({
      start: Math.max(c.start ?? 0, range?.start ?? 0),
      end: Math.min(c.end ?? this.panel.app.timeline.duration, range?.end ?? this.panel.app.timeline.duration), constraint: c,
    })) : ['rot', 'fov'].includes(data.property) && !data.keys.length && range ? [range] : [];
    for (const { start, end, constraint } of spans) {
      if (end < start) continue;
      const label = CAMERA_PROP_LABEL[data.property];
      const title = `${label}状态 · ${start.toFixed(2)}–${end.toFixed(2)} 秒${constraint ? `；双击编辑${CONSTRAINT_LABEL[constraint.type]}` : ''}`;
      lane.append(vars(el('div', {
        class: 'tl-camera-span', title, 'data-constraint-span': constraint?.id,
        ondblclick: constraint ? () => this.panel.app.emit('inspect', { id: ent.id, section: 'constraint', constraintId: constraint.id }) : undefined,
      }), { '--t0': start, '--t1': end }));
      for (const t of new Set([start, end])) {
        if (hitTime(data.keys, t, this.panel.app.timeline.fps)) continue;
        lane.append(vars(el('button', {
          class: 'tl-state-node', title: `${label}状态 · ${t.toFixed(2)} 秒`, 'aria-label': `${label}状态，${t.toFixed(2)} 秒`,
          onclick: () => this.panel.seek(t),
        }), { '--t': t }));
      }
    }
  }

  _pathLane(ent, path) {
    const end = path.start + path.duration;
    const content = this._bar('path', path.id, path.start, end, null);
    content.ondblclick = () => this.panel.app.emit('inspect', { id: ent.id, section: 'path' });
    const model = this._pathModel(path, ent);
    const count = path.points.length + (path.closed ? 1 : 0);
    const nodes = Array.from({ length: count }, (_, i) => {
      const time = model.vertexTime(i);
      const index = i % path.points.length;
      const stop = path.stops?.includes(index) || path.timedSegments?.slice(0, -1).some(s => s.to === index);
      const select = () => {
        const app = this.panel.app;
        app.pathEditor.selectNode({ kind: 'path', sourceId: path.id, index, ...(i === path.points.length ? { arrival: 'end' } : {}) });
      };
      return vars(el('button', {
        class: 'tl-path-node' + (stop ? ' is-stop' : ''), 'data-time': time, 'data-node-index': i, 'data-node-path': path.id,
        title: `${i === count - 1 && path.closed ? '回到起点' : `路径节点 ${i + 1}`} · ${time.toFixed(2)} 秒${stop ? ' · 停顿' : ''}；点击定位，右键设置停顿`,
        'aria-label': `路径节点 ${i + 1}，${time.toFixed(2)} 秒`,
        onclick: select,
        ondblclick: () => { select(); this.panel.app.emit('inspect', { id: ent.id, section: 'path' }); },
        oncontextmenu: (e) => {
          e.preventDefault(); e.stopPropagation();
          popupMenu(e.clientX, e.clientY, [
            { label: '定位到此节点', onClick: select },
            { label: stop ? '取消停顿' : '在此节点停顿', disabled: index === 0 || (!path.closed && index === path.points.length - 1), onClick: () => {
              try { this.panel.app.timeline.updatePath(path.id, toggleStop(path, index, !stop)); } catch (err) { toastError(err); }
            } },
          ]);
        },
      }), { '--t': time });
    });
    return el('div', { class: 'tl-lane' }, [content, ...nodes]);
  }

  _rowControls(ent, kind, data) {
    if (data.property) return this._propertyControls(ent, data.property);
    if (kind === 'path') return [
      ...this._navigation(ent.id, 'path', data.id),
      el('span', { class: 'tl-value', 'data-value-ent': ent.id, 'data-property': 'pos' }),
    ];
    if (kind === 'constraint' && data.type === 'lookAt') {
      const subject = Array.isArray(data.subject)
        ? data.subject.map(v => v.toFixed(1)).join(', ')
        : this.panel.app.findEntity(data.subject)?.name || '目标';
      return [el('span', { class: 'tl-value', text: '注视：' + subject })];
    }
    return [];
  }

  _pathModel(path) {
    return this.panel.app.timeline.pathModel(path);
  }

  _points(path, ent) {
    const model = this._pathModel(path, ent);
    // 缓存节点时刻；播放 tick 不构建 Path 或逐节点反求弧长。
    if (!model.nodeTimes) model.nodeTimes = Array.from({ length: path.points.length + (path.closed ? 1 : 0) }, (_, index) => ({ t: model.vertexTime(index), ordinal: index, index: index % path.points.length }));
    return model.nodeTimes;
  }

  _navigation(entId, property, pathId = '') {
    const app = this.panel.app;
    const attrs = { 'data-nav-ent': entId, 'data-property': property, 'data-nav-path': pathId };
    const nav = direction => {
      const state = this._navState(entId, property, pathId);
      const target = direction < 0 ? state.previous : state.next;
      if (target) {
        if (property !== 'path' && property !== 'pos') this.panel.seek(target.t);
        if (property === 'pos') {
          const tr = app.timeline.tracks.find(t => t.target === entId && t.property === 'pos');
          app.pathEditor.selectNode({ kind: 'pos', sourceId: tr.id, keyTime: target.t });
        }
        if (property === 'path') {
          app.pathEditor.selectNode({ kind: 'path', sourceId: pathId, index: target.index, ...(target.ordinal === app.timeline.paths.find(p => p.id === pathId).points.length ? { arrival: 'end' } : {}) });
        }
      }
    };
    return [
      el('button', { class: 'tl-addkey', html: icon('prevFrame', 13), ...attrs, 'data-direction': '-1', onclick: () => nav(-1) }),
      el('button', { class: 'tl-addkey tl-key-toggle', html: icon('diamond', 14), ...attrs, 'data-direction': '0', onclick: () => {
        try {
          if (property === 'path') this._pathPoint(entId, pathId);
          else { const ent = app.findEntity(entId); if (ent) toggleKey(app, ent, property); }
        } catch (err) { toastError(err); }
      } }),
      el('button', { class: 'tl-addkey', html: icon('nextFrame', 13), ...attrs, 'data-direction': '1', onclick: () => nav(1) }),
    ];
  }

  _navState(entId, property, pathId) {
    const app = this.panel.app, tl = app.timeline, t = tl.active ? app.playback.time : 0;
    let items, current, disabled = false, reason = '';
    if (property === 'path') {
      const path = tl.paths.find(p => p.id === pathId && p.target === entId), ent = app.findEntity(entId);
      items = path && ent ? this._points(path, ent) : [];
      current = hitTime(items, t, tl.fps);
      disabled = !path || t < path.start || t > path.start + path.duration || this._pathModel(path, ent).length < 1e-6;
      reason = '在轨迹时间范围内插入控制点';
    } else {
      const st = propState(app, tl.view(), entId, property, t);
      items = st.track?.keys || []; current = st.key; disabled = !!st.forced;
      reason = st.forced === '路径' && property === 'rot' ? '请先关闭沿路径朝向' : `由${st.forced}驱动，不能打键`;
    }
    return { current, disabled, reason,
      previous: items.filter(k => k.t < (current?.t ?? t) - 1e-6).at(-1),
      next: items.find(k => k.t > (current?.t ?? t) + 1e-6),
    };
  }

  _pathPoint(entId, pathId) {
    const app = this.panel.app, tl = app.timeline;
    const t = tl.active ? app.playback.time : 0;
    app.playback.pause();
    if (tl.active) app.playback.seek(t);
    const path = tl.paths.find(p => p.id === pathId && p.target === entId), ent = app.findEntity(entId);
    if (!path || !ent || t < path.start || t > path.start + path.duration) return;
    const model = this._pathModel(path, ent);
    if (model.length < 1e-6) return;
    const hit = hitTime(this._points(path, ent), t, tl.fps);
    const result = hit ? { index: hit.index, inserted: false } : app.pathEditor.insertAt(pathId, model.distanceAt(t));
    if (!result) return;
    const next = tl.paths.find(p => p.id === pathId);
    app.pathEditor.selectNode({ kind: 'path', sourceId: next.id, index: result.index, ...(hit?.ordinal === next.points.length ? { arrival: 'end' } : {}) });
    if (result.inserted) toast('已插入控制点，已定位到节点');
    this.reflectValues();
  }

  _propertyControls(ent, property) {
    return [...this._navigation(ent.id, property), el('span', { class: 'tl-value', 'data-value-ent': ent.id, 'data-property': ent.type === 'camera' && property === 'rot' ? 'focus' : property })];
  }

  _focusValue(ent) {
    const app = this.panel.app, time = app.timeline.active ? app.playback.time : 0;
    const look = app.timeline.constraints.findLast(c => c.target === ent.id && c.type === 'lookAt' && constraintActive(c, time));
    const target = look && aimPoint(app, look.subject) || ent.lookTarget;
    // 沿实际镜头朝向取焦点，混合注视和旋转关键帧期间也与预览一致。
    const distance = ent.root.position.distanceTo(target) || 1;
    return target.clone().set(0, 0, -distance).applyQuaternion(ent.root.quaternion).add(ent.root.position).toArray();
  }

  reflectValues() {
    const app = this.panel.app;
    const pathHits = new Map();
    for (const node of this.panel.rows.querySelectorAll('.tl-path-node')) {
      const pathId = node.dataset.nodePath;
      if (!pathHits.has(pathId)) {
        const path = app.timeline.paths.find(p => p.id === pathId), ent = app.findEntity(path?.target);
        pathHits.set(pathId, path && ent ? hitTime(this._points(path, ent), app.timeline.active ? app.playback.time : 0, app.timeline.fps) : null);
      }
      const ref = app.pathOverlay.selection;
      node.classList.toggle('is-selected', ref?.kind === 'path' && ref.sourceId === pathId && (ref.arrival === 'end' ? +node.dataset.nodeIndex === app.timeline.paths.find(p => p.id === pathId)?.points.length : ref.index === +node.dataset.nodeIndex));
      node.classList.toggle('is-current', pathHits.get(pathId)?.ordinal === +node.dataset.nodeIndex);
    }
    for (const node of this.panel.rows.querySelectorAll('[data-value-ent]')) {
      const ent = app.findEntity(node.dataset.valueEnt);
      if (!ent) continue;
      const value = node.dataset.property === 'focus' ? this._focusValue(ent) : app.timeline.valueOf(ent, node.dataset.property);
      node.textContent = (Array.isArray(value) ? value : [value]).map((v) => ent.type === 'camera' ? String(+v.toFixed(2)) : v.toFixed(1)).join(', ');
    }
    const states = new Map();
    for (const node of this.panel.rows.querySelectorAll('[data-nav-ent]')) {
      const { navEnt, property, navPath, direction } = node.dataset;
      const id = `${navEnt}/${property}/${navPath}`;
      if (!states.has(id)) states.set(id, this._navState(navEnt, property, navPath));
      const st = states.get(id), noun = property === 'path' ? '路径控制点' : '关键帧';
      if (+direction === 0) {
        const filled = !!st.current;
        if (node.dataset.filled !== String(filled)) { node.innerHTML = icon(filled ? 'diamondFilled' : 'diamond', 14); node.dataset.filled = filled; }
        node.disabled = st.disabled;
        node.title = st.disabled ? st.reason : filled ? (property === 'path' ? '选中当前路径控制点' : '删除当前关键帧') : (property === 'path' ? '插入路径控制点' : '记录当前属性关键帧');
      } else {
        node.disabled = !(+direction < 0 ? st.previous : st.next);
        node.title = `${+direction < 0 ? '上' : '下'}一个${noun}`;
      }
      node.setAttribute('aria-label', node.title);
    }
  }

  /** 区间条：起止两颗菱形 + 中间填充。 */
  _bar(kind, id, t0, t1, text, { openStart = false, openEnd = false } = {}) {
    return vars(el('div', {
      class: `tl-bar tl-bar-${kind}` + (kind === 'object' && t0 === t1 ? ' tl-bar-point' : ''),
      tabindex: 0, 'data-kind': kind, 'data-id': id, title: kind === 'object' ? (t0 === t1 ? '对象动画单点：整体移动动画' : '对象动画总时长：拖中间整体移动动画，拖两端整体调整时长') : kind === 'path' ? '位置路径时长：拖动独立调整路径，双击打开路径编辑' : '约束生效范围：拖动调整注视或跟随的时间范围',
    }, [
      ...(kind === 'object' && t0 === t1 ? [] : [el('i', { class: 'tl-bar-end start' + (openStart ? ' open' : ''), 'data-edge': 'start', title: kind === 'object' ? '整体调整时长（固定结束）' : '拖动调整开始时间' })]),
      text == null ? null : el('span', { class: 'tl-bar-text', text }),
      ...(kind === 'object' && t0 === t1 ? [] : [el('i', { class: 'tl-bar-end end' + (openEnd ? ' open' : ''), 'data-edge': 'end', title: kind === 'object' ? '整体调整时长（固定开始）' : '拖动调整结束时间' })]),
    ]), { '--t0': t0, '--t1': t1 });
  }
}

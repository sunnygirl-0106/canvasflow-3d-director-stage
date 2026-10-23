import { popupMenu } from '../popupMenu.js';
import { openPathMenu } from '../pathMenu.js';
import { el, toast, toastError } from '../../util/dom.js';
import { icon } from '../icons.js';
import { toggleKey, propState, hitTime } from './animState.js';
import { toggleStop } from '../../anim/pathGen.js';

/** 轨道行名（词汇表 → 中文）。 */
export const PROP_LABEL = { pos: '位置', rot: '旋转', scale: '缩放', fov: '视角（FOV）' };
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
        const rows = by.get(ent.id) || [];
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
    const remove = el('button', {
      class: 'tl-row-delete', title: pathRow ? '删除轨迹' : '删除动画',
      'aria-label': `删除${ent.name}的${pathRow ? '轨迹' : '动画'}`, disabled: !rows.some(r => r.kind !== 'property') || undefined,
      html: icon('trash', 13, 1.5), onclick: (e) => {
        e.stopPropagation();
        try {
          if (pathRow) this.panel.app.timeline.removePath(pathRow.data.id);
          else this.panel.removeAllAnimation(ent.id);
        } catch (err) { toastError(err); }
      },
    });
    const name = el('div', { class: 'tl-name' }, [
      caret,
      el('span', { class: 'tl-type', html: icon(TYPE_ICON[ent.type] || 'cube', 14) }),
      el('span', { class: 'tl-label', text: ent.name, title: ent.name }),
      ...(ent.id === this.panel.app.timeline.mainCameraId ? [el('span', { class: 'tl-main-badge', text: '主机位' })] : []),
      el('button', { class: 'tl-addkey', html: icon('path', 14, 1.5) + '<span>绘制轨迹</span>', title: '为此对象绘制路径', onclick: (e) => {
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
    if (pathRow) {
      const p = pathRow.data;
      const bar = this._bar('path', p.id, p.start, p.start + p.duration, `轨迹 · ${p.duration.toFixed(1)} s`);
      bar.classList.add('tl-path-clip');
      lane.append(bar);
    } else lane.append(el('span', { class: 'tl-path-status', text: '无轨迹' }));
    return el('div', { class: 'tl-row tl-head' + (pathRow ? ' has-path' : ' no-path') + (ent.type === 'camera' ? ' camera' : ''), 'data-ent': ent.id, 'data-path': pathRow?.data.id }, [name, lane]);
  }

  _row(ent, { kind, data }) {
    let label, lane;
    const attrs = { 'data-ent': ent.id, 'data-property-row': data.property || kind };
    if (kind === 'track' || kind === 'property') {
      label = PROP_LABEL[data.property];
      if (data.id) attrs['data-track'] = data.id;
      lane = el('div', { class: 'tl-lane' }, data.keys.map((k) => vars(el('i', {
        class: 'tl-key ease-' + k.ease,
        title: `关键帧 ${k.t.toFixed(2)} 秒 · ${{ linear: '匀速', smooth: '缓入缓出', step: '阶跃' }[k.ease] || k.ease}；拖动改时间，双击设置过渡`,
        'data-track': data.id, 'data-t': String(k.t),
      }), { '--t': k.t })));
      if (data.keys.length > 1) lane.prepend(vars(el('i', { class: 'tl-key-line' }), { '--t0': data.keys[0].t, '--t1': data.keys.at(-1).t }));
    } else if (kind === 'path') {
      label = '位置 · 轨迹';
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
    const empty = kind === 'track' && !data.keys.length;
    return el('div', { class: 'tl-row tl-track' + (empty ? ' is-empty' : ''), ...attrs }, [
      el('div', { class: 'tl-name' }, [el('span', { class: 'tl-label', text: label }), ...this._rowControls(ent, kind, data)]),
      lane,
    ]);
  }

  _pathLane(ent, path) {
    const end = path.start + path.duration;
    const content = vars(el('button', {
        class: 'tl-path-line', title: '打开轨迹编辑与区间设置',
        onclick: () => this.panel.app.emit('inspect', { id: ent.id, section: 'path' }),
      }), { '--t0': path.start, '--t1': end });
    const model = this._pathModel(path, ent);
    const count = path.points.length + (path.closed ? 1 : 0);
    const nodes = Array.from({ length: count }, (_, i) => {
      const time = model.vertexTime(i);
      const index = i % path.points.length;
      const stop = path.stops?.includes(index);
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
    return [...this._navigation(ent.id, property), el('span', { class: 'tl-value', 'data-value-ent': ent.id, 'data-property': property })];
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
      const value = app.timeline.valueOf(ent, node.dataset.property);
      node.textContent = (Array.isArray(value) ? value : [value]).map((v) => v.toFixed(1)).join(', ');
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
      class: `tl-bar tl-bar-${kind}`,
      'data-kind': kind, 'data-id': id, title: kind === 'path' ? '路径动画：拖动条形调整开始时间，拖动两端调整起止时间' : '约束生效范围：拖动调整注视或跟随的时间范围',
    }, [
      el('i', { class: 'tl-bar-end start' + (openStart ? ' open' : ''), 'data-edge': 'start', title: '拖动调整开始时间' }),
      el('span', { class: 'tl-bar-text', text }),
      el('i', { class: 'tl-bar-end end' + (openEnd ? ' open' : ''), 'data-edge': 'end', title: '拖动调整结束时间' }),
    ]), { '--t0': t0, '--t1': t1 });
  }
}

import { el, toastError } from '../../util/dom.js';
import { icon } from '../icons.js';
import { toggleKey, propState } from './animState.js';

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
 * 每次 timeline 'change' 都按 toJSON() 全量重建（面板自己不留文档状态）；
 * 横向位置用 CSS 变量 --t × --pps，缩放时只改 --pps，不重建。
 */
export class TrackRows {
  /** @param {import('./TimelinePanel.js').TimelinePanel} panel */
  constructor(panel) {
    this.panel = panel;
    this.collapsedEnts = new Set();
    this.expandedEnts = new Set();
    this.pathEditors = new Set(); // 折叠的实体分组（会话态）
    this.groups = [];               // [{ ent, rows:[{ kind, data }] }]
  }

  /**
   * 当前文档 → 分组数据。所有实体都列一行，顺序同大纲（顶层实体，成员紧跟其组）；
   * 无动画角色只显示主行；道具在有动画时才显示，不创建虚构关键帧。
   */
  _collect() {
    const { app } = this.panel;
    const { timeline, paths, constraints } = app.timeline.toJSON();
    const by = new Map();
    const bucket = (id) => { if (!by.has(id)) by.set(id, []); return by.get(id); };
    for (const t of timeline.tracks) bucket(t.target).push({ kind: 'track', data: t, order: 1 + PROP_ORDER.indexOf(t.property) });
    for (const p of paths) bucket(p.target).push({ kind: 'path', data: p, order: 0 });
    for (const c of constraints) bucket(c.target).push({ kind: 'constraint', data: c, order: c.type === 'lookAt' ? 10 : 11 });
    const groups = [];
    for (const e of app.entities) {
      for (const ent of [e, ...e.children]) {
        if (!['character', 'camera'].includes(ent.type) && !by.has(ent.id)) continue;
        groups.push({ ent, rows: (by.get(ent.id) || []).sort((a, b) => a.order - b.order) });
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
      for (const r of g.rows) frag.appendChild(this._row(g.ent, r));
    }
    return frag;
  }

  _folded(id) { return this.collapsedEnts.has(id) || (!this.expandedEnts.has(id) && !this.panel.app.selectedIds.has(id)); }

  _headRow({ ent, rows }) {
    const folded = !rows.length || this._folded(ent.id);
    const caret = el('button', { class: 'tl-caret' + (folded ? ' folded' : ''), title: folded ? '展开此对象的动画属性' : '折叠此对象的动画属性', html: icon('chevron', 12, 2) });
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (folded) { this.collapsedEnts.delete(ent.id); this.expandedEnts.add(ent.id); } else { this.collapsedEnts.add(ent.id); this.expandedEnts.delete(ent.id); }
      this.panel.rebuild();
    });
    const delAll = el('button', { class: 'tl-op', title: '删除全部动画', html: icon('trash', 13) });
    delAll.addEventListener('click', (e) => { e.stopPropagation(); this.panel.removeAllAnimation(ent.id); });
    const name = el('div', { class: 'tl-name' }, [
      caret,
      el('span', { class: 'tl-type', html: icon(TYPE_ICON[ent.type] || 'cube', 14) }),
      el('span', { class: 'tl-label', text: (ent.id === this.panel.app.timeline.mainCameraId ? '主机位 · ' : '') + ent.name }),
      el('button', { class: 'tl-addkey', text: '绘制轨迹', title: '为此对象绘制路径', onclick: (e) => {
        e.stopPropagation();
        const app = this.panel.app;
        app.setCameraView(false); app.select(ent.id); app.pathTool.request('points');
      } }),
      delAll,
    ]);
    // 表头的轨道区：所有键时刻的汇总（只读）
    const times = new Set();
    for (const r of rows) if (r.kind === 'track') for (const k of r.data.keys) times.add(k.t);
    const lane = el('div', { class: 'tl-lane' }, [...times].map((t) => vars(el('i', { class: 'tl-sum' }), { '--t': t })));
    lane.prepend(el('div', { class: 'tl-presence', title: '场景持续存在范围（非动画片段）' }));
    return el('div', { class: 'tl-row tl-head' + (ent.type === 'camera' ? ' camera' : ''), 'data-ent': ent.id }, [name, lane]);
  }

  _row(ent, { kind, data }) {
    let label, lane;
    const attrs = { 'data-ent': ent.id };
    if (kind === 'track' || kind === 'property') {
      label = PROP_LABEL[data.property];
      if (data.id) attrs['data-track'] = data.id;
      lane = el('div', { class: 'tl-lane' }, data.keys.map((k) => vars(el('i', {
        class: 'tl-key ease-' + k.ease,
        title: `关键帧 ${k.t.toFixed(2)} 秒 · ${{ linear: '匀速', smooth: '缓入缓出', step: '阶跃' }[k.ease] || k.ease}；拖动改时间，双击设置过渡`,
        'data-track': data.id, 'data-t': String(k.t),
      }), { '--t': k.t })));
    } else if (kind === 'path') {
      label = '位置（路径驱动）';
      attrs['data-path'] = data.id;
      lane = el('div', { class: 'tl-lane' }, this.pathEditors.has(data.id) ? [this._bar('path', data.id, data.start, data.start + data.duration, '')] : [vars(el('button', { class: 'tl-path-line', title: '打开轨迹编辑与区间设置', onclick: () => this.panel.app.emit('inspect', { id: ent.id, section: 'path' }) }), { '--t0': data.start, '--t1': data.start + data.duration })]);
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
      el('div', { class: 'tl-name' }, [el('span', { class: 'tl-label', text: label }), ...(kind === 'path' ? [el('button', { class: 'tl-addkey tl-path-edit', title: '展开或收起路径区间编辑', html: icon('chevron', 14), onclick: () => { if (this.pathEditors.has(data.id)) this.pathEditors.delete(data.id); else this.pathEditors.add(data.id); this.panel.rebuild(); this.panel.app.emit('inspect', { id: ent.id, section: 'path' }); } })] : []), ...(data.property ? this._propertyControls(ent, data.property) : kind === 'constraint' && data.type === 'lookAt' ? [el('span', { class: 'tl-value', text: '注视：' + (Array.isArray(data.subject) ? data.subject.map(v => v.toFixed(1)).join(', ') : this.panel.app.findEntity(data.subject)?.name || '目标') })] : [])]),
      lane,
    ]);
  }

  _propertyControls(ent, property) {
    const app = this.panel.app;
    const nav = (direction) => {
      const keys = propState(app, app.timeline.view(), ent.id, property, app.playback.time).track?.keys || [];
      const candidates = keys.filter((k) => direction < 0 ? k.t < app.playback.time - 1e-6 : k.t > app.playback.time + 1e-6);
      const key = direction < 0 ? candidates.at(-1) : candidates[0];
      if (key) { app.playback.pause(); app.playback.seek(key.t); }
    };
    const value = el('span', { class: 'tl-value', 'data-value-ent': ent.id, 'data-property': property });
    const key = el('button', { class: 'tl-addkey tl-key-toggle', text: '◇', title: '关键帧：在当前时刻记录属性值；已有关键帧时再次点击删除', 'data-key-ent': ent.id, 'data-property': property, onclick: () => {
      try { app.select(ent.id); toggleKey(app, ent, property); } catch (err) { toastError(err); }
    } });
    return [
      el('button', { class: 'tl-addkey', text: '‹', title: '上一个关键帧', onclick: () => nav(-1) }),
      key,
      el('button', { class: 'tl-addkey', text: '›', title: '下一个关键帧', onclick: () => nav(1) }), value,
    ];
  }

  reflectValues() {
    const app = this.panel.app, anim = app.timeline.view();
    for (const node of this.panel.rows.querySelectorAll('[data-value-ent]')) {
      const ent = app.findEntity(node.dataset.valueEnt);
      if (!ent) continue;
      const value = app.timeline.valueOf(ent, node.dataset.property);
      node.textContent = (Array.isArray(value) ? value : [value]).map((v) => v.toFixed(1)).join(', ');
    }
    for (const node of this.panel.rows.querySelectorAll('[data-key-ent]')) {
      const st = propState(app, anim, node.dataset.keyEnt, node.dataset.property, app.playback.time);
      node.textContent = st.key ? '◆' : '◇';
      node.disabled = !!st.forced;
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

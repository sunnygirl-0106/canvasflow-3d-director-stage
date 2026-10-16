import { el } from '../../util/dom.js';
import { icon } from '../icons.js';

/** 轨道行名（词汇表 → 中文）。 */
export const PROP_LABEL = { pos: '位置', rot: '旋转', scale: '缩放', fov: '视野' };
const CONSTRAINT_LABEL = { lookAt: '注视', follow: '跟随' };
const TYPE_ICON = { character: 'person', prop: 'cube', camera: 'video', crowd: 'group' };
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
    this.collapsedEnts = new Set(); // 折叠的实体分组（会话态）
    this.groups = [];               // [{ ent, rows:[{ kind, data }] }]
  }

  /** 当前文档 → 分组数据。只列出有动画数据的实体，顺序同大纲（顶层实体，成员紧跟其组）。 */
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
        const rows = by.get(ent.id);
        if (rows) groups.push({ ent, rows: rows.sort((a, b) => a.order - b.order) });
      }
    }
    return groups;
  }

  /** 重建全部行，返回 DocumentFragment。 */
  build() {
    this.groups = this._collect();
    const frag = document.createDocumentFragment();
    if (!this.groups.length) {
      frag.appendChild(el('div', { class: 'tl-empty', text: '还没有动画。选中对象后，在右侧属性面板点「位置 / 旋转 / 缩放」旁的 ◇ 打第一个关键帧。' }));
      return frag;
    }
    for (const g of this.groups) {
      frag.appendChild(this._headRow(g));
      if (this.collapsedEnts.has(g.ent.id)) continue;
      for (const r of g.rows) frag.appendChild(this._row(g.ent, r));
    }
    return frag;
  }

  _headRow({ ent, rows }) {
    const folded = this.collapsedEnts.has(ent.id);
    const caret = el('span', { class: 'tl-caret' + (folded ? ' folded' : ''), html: icon('chevron', 12, 2) });
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (folded) this.collapsedEnts.delete(ent.id); else this.collapsedEnts.add(ent.id);
      this.panel.rebuild();
    });
    const delAll = el('button', { class: 'tl-op', title: '删除全部动画', html: icon('trash', 13) });
    delAll.addEventListener('click', (e) => { e.stopPropagation(); this.panel.removeAllAnimation(ent.id); });
    const name = el('div', { class: 'tl-name' }, [
      caret,
      el('span', { class: 'tl-type', html: icon(TYPE_ICON[ent.type] || 'cube', 14) }),
      el('span', { class: 'tl-label', text: ent.name }),
      delAll,
    ]);
    // 表头的轨道区：所有键时刻的汇总（只读）
    const times = new Set();
    for (const r of rows) if (r.kind === 'track') for (const k of r.data.keys) times.add(k.t);
    const lane = el('div', { class: 'tl-lane' }, [...times].map((t) => vars(el('i', { class: 'tl-sum' }), { '--t': t })));
    return el('div', { class: 'tl-row tl-head', 'data-ent': ent.id }, [name, lane]);
  }

  _row(ent, { kind, data }) {
    let label, lane;
    const attrs = { 'data-ent': ent.id };
    if (kind === 'track') {
      label = PROP_LABEL[data.property];
      attrs['data-track'] = data.id;
      lane = el('div', { class: 'tl-lane' }, data.keys.map((k) => vars(el('i', {
        class: 'tl-key ease-' + k.ease,
        title: `${k.t.toFixed(2)}s · ${k.ease}`,
        'data-track': data.id, 'data-t': String(k.t),
      }), { '--t': k.t })));
    } else if (kind === 'path') {
      label = '路径';
      attrs['data-path'] = data.id;
      lane = el('div', { class: 'tl-lane' }, [this._bar('path', data.id, data.start, data.start + data.duration, '')]);
    } else {
      label = CONSTRAINT_LABEL[data.type];
      attrs['data-constraint'] = data.id;
      const full = data.start == null && data.end == null;
      const { duration } = this.panel.app.timeline;
      lane = el('div', { class: 'tl-lane' }, [this._bar('constraint', data.id, data.start ?? 0, data.end ?? duration, full ? '全程' : '', {
        openStart: data.start == null, openEnd: data.end == null,
      })]);
    }
    const empty = kind === 'track' && !data.keys.length;
    return el('div', { class: 'tl-row tl-track' + (empty ? ' is-empty' : ''), ...attrs }, [
      el('div', { class: 'tl-name' }, [el('span', { class: 'tl-label', text: label })]),
      lane,
    ]);
  }

  /** 区间条：起止两颗菱形 + 中间填充。 */
  _bar(kind, id, t0, t1, text, { openStart = false, openEnd = false } = {}) {
    return vars(el('div', {
      class: `tl-bar tl-bar-${kind}`,
      'data-kind': kind, 'data-id': id,
    }, [
      el('i', { class: 'tl-bar-end start' + (openStart ? ' open' : ''), 'data-edge': 'start' }),
      el('span', { class: 'tl-bar-text', text }),
      el('i', { class: 'tl-bar-end end' + (openEnd ? ' open' : ''), 'data-edge': 'end' }),
    ]), { '--t0': t0, '--t1': t1 });
  }
}

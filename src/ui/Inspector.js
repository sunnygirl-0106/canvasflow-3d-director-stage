import { openPathMenu } from './pathMenu.js';
import { RATIO_OPTIONS } from '../config.js';
import { FOV_RANGE } from '../doc/schema.js';
import { el, toast, toastError } from '../util/dom.js';
import { icon } from './icons.js';
import { tripleRow, sliderRow, colorRow, dropdownRow, infoTip, shotCard, toHex, numberRow, toggleRow } from './widgets.js';
import { PoseSliders } from './PoseSliders.js';
import { POSE_PRESETS } from '../entities/posePresets.js';
import { downloadURL } from '../app/ShotManager.js';
import { propState, toggleKey } from './timeline/animState.js';
import { arcPoints, pathLength, paceFor, defaultDuration, stopsAfterReverse, toggleStop, WALK_PACE } from '../anim/pathGen.js';
import { rampFor } from '../anim/Path.js';
import { popupMenu } from './popupMenu.js';
import { cameraMoveSection, cameraConstraintSection } from './cameraMotionSections.js';
import { D2R, R2D } from '../util/math.js';

const FOV_TIP = '控制镜头视野范围。数值越小，画面越近、越聚焦；数值越大，画面越广、能看到更多环境。';
const PREVIEW_W = 248, PREVIEW_H = 140;
const PACES = [[0.8, '慢走'], [WALK_PACE, '走'], [1.8, '快走'], [3.5, '加速走']];
const fmtS = (x) => (Math.round(x * 10) / 10).toFixed(1);

// 每种实体的标签页：[key, 文案]
const TABS = {
  character: [['attr', '属性'], ['pose', '姿势'], ['motion', '运动轨迹']],
  group: [['attr', '属性'], ['pose', '姿势'], ['motion', '运动轨迹']],
  camera: [['attr', '属性'], ['motion', '运动轨迹'], ['shots', '截图']],
};

// 右侧属性面板：道具 / 角色（属性+姿势）/ 群众组 / 摄像机（属性+摄像机截图）。
export class Inspector {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.tabs = { character: 'attr', group: 'attr', camera: 'attr' }; // 各类型记住上次的标签页
    this._reset();

    app.on('selection', (ent) => this.show(ent));
    app.on('transform', () => this._syncFn?.());
    // 时间轴：播放头移动 / 动画数据变化 / 进出 active 时刷新数值与关键帧菱形（每帧至多一次）
    app.playback.on('tick', () => this.scheduleAnimRefresh());
    app.timeline.on('change', () => { this._sectionsDirty = true; this.scheduleAnimRefresh(); });
    app.timeline.on('active', () => this.scheduleAnimRefresh());
    app.on('inspect', (req) => this.inspect(req));
    app.on('pathVertex', () => { this._sectionsDirty = true; this.scheduleAnimRefresh(); });
    app.on('entities', () => this.refreshName());
    app.on('shots', () => { if (this.entity?.type === 'camera') this.show(this.entity); });
    // 播放中点进输入框 / 按下轴标签拖动：先暂停（同 gizmo），否则输入会被逐帧求值覆盖。失焦 / 回车后不自动恢复播放
    const pauseIfPlaying = () => { if (app.playback.playing) app.playback.pause(); };
    container.addEventListener('focusin', (e) => { if (e.target.matches('input:not([type=checkbox]):not([type=range]), textarea')) pauseIfPlaying(); });
    container.addEventListener('pointerdown', (e) => { if (e.target.closest('.ax, input, button')) pauseIfPlaying(); }, true);
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
    this.app.pathOverlay.setMovePreview(null); // 运镜预览只跟着机位的运镜段走
    if (!entity) { this.container.replaceChildren(); return; }

    const root = el('div', { class: 'rp rp-pad' });
    this._activeHint = el('div', { class: 'tl-active-hint', text: '当前时刻的修改将记录为关键帧', hidden: true });
    root.appendChild(this._activeHint);
    const title = { character: '角色', camera: '摄像机', group: `${entity.name} (${entity.children.length})` }[entity.type] || '道具';
    root.appendChild(el('h2', { text: title }));

    const tab = this._tabBar(root, entity);
    switch (entity.type) {
      case 'group':
        root.appendChild(el('div', { class: 'multi-note', text: `已选中 ${entity.members.length} 个角色，修改将同步应用到全部选中对象` }));
        root.appendChild(el('button', { class: 'minibtn', text: '⊟ 解组（拆为独立角色）', onclick: () => this.app.ungroupCrowd(entity.id) }));
        if (tab === 'motion') this._motion(root); else if (tab === 'attr') this._attr(root, entity); else this._pose(root, entity.members);
        break;
      case 'character':
        if (tab === 'motion') this._motion(root); else if (tab === 'attr') this._attr(root, entity); else this._pose(root, [entity]);
        break;
      case 'camera':
        if (tab === 'motion') this._motion(root); else if (tab === 'attr') this._cameraAttr(root, entity); else this._cameraShots(root);
        break;
      default:
        this._attr(root, entity);
    }

    this.container.replaceChildren(root);
    if (this._previewEnt) this.refreshPreview();
    this._refreshAnim();
  }

  _motion(root) {
    this._animHost = el('div');
    root.appendChild(this._animHost);
    this._renderAnimSections();
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
    if (ent.type in this.tabs) this.tabs[ent.type] = 'motion';
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
    if (ent.type === 'camera') nodes.push(cameraMoveSection(this.app, ent, () => this._renderAnimSections()));
    if (path) nodes.push(ent.type === 'character' ? this._characterPathSection(path, ent) : this._pathSection(path, ent));
    else if (this.app.pathTool.canDraw(ent)) nodes.push(this._pathEmpty(ent));
    if (ent.type === 'camera') nodes.push(cameraConstraintSection(this.app, ent, anim.constraints.filter((c) => c.target === ent.id), (fn) => this._tl(fn)));
    host.replaceChildren(...nodes);
  }

  /** 执行 timeline 写操作；失败 toast 字段路径并按文档重画（输入框回到文档值）。 */
  _tl(fn) {
    try { fn(this.app.timeline); } catch (err) { toastError(err); this._renderAnimSections(); }
  }

  /** 「新建路径 ▾」：五种绘制方式（与 Dock「路径」按钮等价）。 */
  _newPathBtn(label, ent) {
    return el('button', {
      class: 'sec-btn path-create',
      html: icon('path', 14, 1.5) + `<span>${label}</span>` + icon('chevron', 12, 1.5),
      onclick: (e) => {
        openPathMenu(this.app, e.currentTarget, ent.id);
      },
    });
  }

  /** 没有路径的角色 / 道具 / 组 / 机位：只有段头与入口。 */
  _pathEmpty(ent) {
    if (ent.type !== 'camera') return el('div', { class: 'anim-sec', 'data-sec': 'path' }, [this._newPathBtn('绘制轨迹', ent)]);
    const info = '未设置路径。绘制时保持机位高度与朝向；观察位置与机位同高时，在地面上定位轨迹。';
    return el('div', { class: 'anim-sec', 'data-sec': 'path' }, [
      el('div', { class: 'sec-title' }, [el('span', { text: '路径' }), el('span', { class: 'sec-spacer' }), this._newPathBtn('新建路径', ent)]),
      el('div', { class: 'anim-info', text: info }),
    ]);
  }

  _characterPathSection(p, ent) {
    const root = el('div', { class: 'anim-sec character-path', 'data-sec': 'path' });
    this._animRows = [];
    const duration = sliderRow({ label: '时长', min: 0.01, max: this.app.timeline.duration - p.start,
      step: 0.01, value: p.duration, editable: true,
      onChange: v => this._tl(tl => { if (tl.paths.some(path => path.id === p.id && path.target === ent.id)) tl.updatePath(p.id, { duration: v }); }),
    });
    root.append(duration.el);
    this._transformFields(root, ent, { motion: true });
    root.append(toggleRow({ label: '绑定对象沿路径朝向', checked: p.orient === 'tangent',
      onChange: on => this._tl(tl => tl.setPathOrientation(p.id, on ? 'tangent' : 'keep')),
    }).el);
    return root;
  }

  /**
   * 路径段：顶点数 / 总长 / 平均速度；start / duration / speed / orient / closed；环绕三参数；
   * 反向 / 起点对齐到当前位置 / 按步速重算时长 / 删除路径。所有写操作走 timeline API（一次撤销）。
   */
  _pathSection(p, ent) {
    const upd = (patch) => this._tl((tl) => tl.updatePath(p.id, patch));
    const len = pathLength(p.points, p.closed, p.stops, p.interpolation);
    const v = len / p.duration;
    const total = this.app.timeline.duration;
    const uniform = ['character', 'group'].includes(ent.type);
    const ramp = !uniform && p.speed === 'smooth' ? rampFor(ent.type) : 0;
    const natural = defaultDuration(p.points, { speed: paceFor(ent.type), closed: p.closed, interpolation: p.interpolation, ramp });
    const suggestedTotal = Math.ceil((p.start + natural) * 10 - 1e-9) / 10;
    const needsMoreTime = ['character', 'group'].includes(ent.type) && natural > total - p.start + 0.001;
    const tool = this.app.pathTool;
    const pace = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      popupMenu(r.left, r.bottom + 4, PACES.map(([speed, name]) => ({
        label: `${name} ${speed} m/s`, onClick: () => upd({ duration: defaultDuration(p.points, { speed, closed: p.closed, interpolation: p.interpolation, ramp }) }),
      })));
    };
    return el('div', { class: 'anim-sec', 'data-sec': 'path' }, [
      el('div', { class: 'sec-title' }, [
        el('span', { text: '路径' }), el('span', { class: 'sec-tag path', text: `${p.points.length} 个点` }),
        el('span', { class: 'sec-spacer' }),
        tool.canDraw(ent) ? this._newPathBtn('重新绘制', ent) : null,
      ]),
      el('div', { class: 'anim-info path-stats' }, [
        `顶点 ${p.points.length} · 总长 ${len.toFixed(2)} m · `,
        el('span', { class: 'path-speed', text: `${uniform && !p.stops?.length ? '匀速' : '平均'} ${v.toFixed(2)} m/s` }),
      ]),
      el('div', { class: 'anim-pair' }, [
        numberRow({ label: '开始', value: p.start, step: 0.1, min: 0, unit: 's', onChange: (x) => upd({ start: x }) }).el,
        numberRow({ label: '时长', value: p.duration, step: 0.1, min: 0.01, unit: 's', onChange: (x) => upd({ duration: x }) }).el,
      ]),
      el('div', { class: 'path-timing-hint' + (needsMoreTime ? ' fast' : '') }, [
        el('span', { text: `${fmtS(p.start)}–${fmtS(p.start + p.duration)} 秒 · 场景共 ${fmtS(total)} 秒` }),
        el('span', { text: needsMoreTime ? '当前时间不足以正常步行，已按所设时长加速。' : '轨迹在场景总时长内完成，提前到达后停留。' }),
        needsMoreTime ? el('button', {
          class: 'minibtn', text: `恢复正常步行 · 延长至 ${fmtS(suggestedTotal)} 秒`,
          onclick: () => this._tl((tl) => this.app.store.batch('按正常步速延长场景', () => {
            tl.setDuration(suggestedTotal);
            tl.updatePath(p.id, { duration: natural });
          })),
        }) : null,
      ]),
      uniform ? el('div', { class: 'anim-info', text: '从起步即匀速：按路径总长 ÷ 时长预先计算，途中保持一致。' }) : dropdownRow({
        label: '速度变化', value: p.speed,
        options: [{ value: 'linear', label: '匀速' }, { value: 'smooth', label: '缓入缓出' }],
        onChange: (x) => upd({ speed: x }),
      }).el,
      this._stopRow(p, upd),
      dropdownRow({
        label: '朝向', value: p.orient,
        options: [{ value: 'tangent', label: '沿路径方向' }, { value: 'keep', label: '保持手动朝向' }],
        onChange: (x) => upd({ orient: x }),
      }).el,
      toggleRow({ label: '闭合路径', checked: p.closed, onChange: (x) => upd({ closed: x }) }).el,
      ...this._arcRows(p),
      el('div', { class: 'anim-btns' }, [
        el('button', {
          class: 'minibtn', text: '反向', title: '顶点倒序（从终点走回起点）',
          onclick: () => upd({ points: p.points.slice().reverse(), ...stopsAfterReverse(p) }),
        }),
        tool.canDraw(ent) ? el('button', {
          class: 'minibtn', text: '起点对齐当前位置', title: '把第一个顶点移到对象当前（手动）位置',
          onclick: () => upd({ points: [tool.startPoint(ent), ...p.points.slice(1)] }),
        }) : null,
        el('button', { class: 'minibtn', text: '按步速调整 ▾', title: '自动计算所需时间；超过场景总时长时适配剩余时间', onclick: pace }),
        el('button', { class: 'minibtn danger', text: '删除路径', onclick: () => this._tl((tl) => tl.removePath(p.id)) }),
      ]),
    ]);
  }

  /**
   * 停顿（stops）：选中路径中间的顶点时显示「在顶点 N 处停顿」勾选；否则提示怎么设、列出已有停顿。
   * 有停顿时各段各自缓入缓出（停顿处速度 0），速度下拉只作用于没有停顿的路径。
   */
  _stopRow(p, upd) {
    const sv = this.app.pathOverlay.selVertex;
    const n = p.points.length;
    const last = p.closed ? n - 1 : n - 2;
    const idx = sv?.pathId === p.id ? sv.index : -1;
    const stops = p.stops || [];
    const list = stops.length
      ? `停顿 ${stops.length} 处：${stops.map((i, j) => `顶点 ${i + 1}${p.stopTimes ? ` @${fmtS(p.start + p.stopTimes[j])} s` : ''}`).join('、')}（各段缓入缓出）`
      : '';
    if (idx >= 1 && idx <= last) {
      return el('div', { 'data-row': 'stop' }, [
        toggleRow({ label: `在选中顶点（${idx + 1}）处停顿`, checked: stops.includes(idx), onChange: (x) => upd(toggleStop(p, idx, x)) }).el,
        list ? el('div', { class: 'anim-info', text: list }) : null,
      ]);
    }
    return el('div', { class: 'anim-info', 'data-row': 'stop', text: list || '点选路径中间的顶点，可设为停顿点（走到那里停一下再走）。' });
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

  /** 关键帧菱形状态 + 被驱动属性灰字 + active 提示条。 */
  _refreshAnim() {
    const { app } = this;
    if (this._activeHint) this._activeHint.hidden = !app.timeline.active || this.tabs[this.entity?.type] === 'motion';
    if (!this._animRows.length) return;
    const anim = app.timeline.view(); // 播放时每帧都会走到这里：只读视图，不深拷贝
    const t = app.timeline.active ? app.playback.time : 0;
    for (const r of this._animRows) {
      const st = propState(app, anim, r.ent.id, r.prop, t);
      const state = st.key ? 'key' : st.track ? 'track' : 'none';
      r.dia.className = 'kf-dia ' + state;
      r.dia.disabled = !!st.forced;
      r.dia.innerHTML = icon(st.key ? 'diamondFilled' : 'diamond', 14);
      r.dia.title = st.forced ? (r.prop === 'rot' && st.forced === '路径' ? '请先关闭沿路径朝向' : `由${st.forced}驱动，不能打键`)
        : st.key ? '删除当前时刻的关键帧' : app.timeline.active ? '在当前时刻打关键帧' : '在 0 秒打关键帧（进入时间轴）';
      r.row.classList.toggle('driven', st.driven);
    }
  }

  /** 给属性行的标题加一颗关键帧菱形。 */
  _keyable(ent, pairs) {
    for (const [prop, row] of pairs) {
      const dia = el('button', { class: 'kf-dia none', html: icon('diamond', 14), onclick: (e) => { e.stopPropagation(); this._toggleKey(ent, prop); } });
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
    try { toggleKey(this.app, ent, prop); } catch (err) { toastError(err); }
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
    root.appendChild(this._nameField(ent));
    this._transformFields(root, ent);
    root.appendChild(colorRow({ label: '颜色', hex: toHex(ent.color),
      onChange: h => { ent.setColor(h); this.app.stage.invalidate(); }, onCommit: () => this.app.edited(ent),
    }).el);
    if (ent.type === 'prop') this._motion(root);
  }

  /** 属性与运动页共享文档坐标、缩放换算和提交入口。输入始终绑定构建时的实体。 */
  _transformFields(root, ent, { motion = false } = {}) {
    const app = this.app, o = ent.root;
    const invalidate = () => app.stage.invalidate();
    const tangent = () => app.timeline.paths.some(p => p.target === ent.id && p.orient === 'tangent');
    const commit = prop => () => {
      if (app.findEntity(ent.id) !== ent) return;
      if (prop === 'rot' && tangent()) app.timeline.editPathTilt(ent);
      else app.edited(ent, new Set([prop]));
      this._syncFn?.();
    };
    const opts = () => ent.docTransformOpts();
    const pos = tripleRow({ label: '位置', step: 0.01, onCommit: commit('pos'), axes: ['x', 'y', 'z'].map((k, i) => ({ key: k, get: () => o.position[k] - opts().posOffset[i], set: v => { o.position[k] = v + opts().posOffset[i]; invalidate(); } })) });
    const rot = tripleRow({ label: '旋转', deg: true, onCommit: commit('rot'), axes: ['x', 'y', 'z'].map(k => ({ key: k, get: () => o.rotation[k] * R2D, set: v => { if (k === 'y' && tangent()) return; o.rotation[k] = v * D2R; invalidate(); } })) });
    let uni;
    const scl = tripleRow({ label: '缩放', step: 0.01, onCommit: commit('scale'), axes: ['x', 'y', 'z'].map((k, i) => ({ key: k, get: () => o.scale[k] / opts().scaleDiv[i], set: v => { o.scale[k] = Math.max(0.05, v) * opts().scaleDiv[i]; uni?.set(o.scale.y / ent.baseScale); invalidate(); } })) });
    const girth = ent.girth || 1;
    uni = sliderRow({ label: '统一缩放', min: 0.2, max: 3, step: 0.01, value: o.scale.y / ent.baseScale, editable: true,
      format: v => v.toFixed(2),
      onInput: v => { const scale = ent.baseScale * v; o.scale.set(scale * girth, scale, scale * girth); scl.syncAll(); invalidate(); },
      onChange: commit('scale'),
    });
    root.append(pos.el, rot.el, scl.el, uni.el);
    if (!motion) this._keyable(ent, [['pos', pos.el], ['rot', rot.el], ['scale', scl.el]]);
    const yaw = rot.el.querySelectorAll('input')[1];
    this._syncFn = () => {
      pos.syncAll(); rot.syncAll(); scl.syncAll(); uni.set(o.scale.y / ent.baseScale);
      yaw.disabled = tangent(); yaw.title = yaw.disabled ? '由路径朝向控制' : '';
    };
    this._syncFn();
  }

  // ---- 摄像机：属性 ----
  _cameraAttr(root, ent) {
    const app = this.app;
    const o = ent.root;
    const changed = () => { ent.update(); app.stage.invalidate(); this.schedulePreview(); };
    const commit = (prop) => () => app.edited(ent, new Set([prop])); // 一次修改结束：按时间轴状态归属（3.3）

    root.appendChild(this._buildPreview(ent));
    root.appendChild(dropdownRow({ label: '截图 / 导出画幅', value: app.ratio, options: RATIO_OPTIONS.map(([value, label]) => ({ value, label })), onChange: value => app.setRatio(value) }).el);
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
      label: '注视目标', value: ent.aimRef || 'manual',
      options: [{ value: 'manual', label: '手动坐标' }, ...targets.map((t) => ({ value: t.id, label: t.name }))],
      onChange: (val) => {
        ent.aimRef = val;
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
      label: '视野角度', min: FOV_RANGE[0], max: FOV_RANGE[1], step: 1, value: ent.cam.fov,
      format: (v) => Math.round(v) + '°',
      onInput: (v) => { ent.setFov(v); this._previewBadge.textContent = 'FOV ' + Math.round(v) + '°'; changed(); },
      onChange: commit('fov'),
    });
    fovField.el.querySelector('label')?.appendChild(infoTip(FOV_TIP));
    root.appendChild(fovField.el);
    this._keyable(ent, [['pos', pos.el], ['rot', lookRow.el], ['fov', fovField.el]]);


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
    const expand = el('button', { class: 'cam-expand', title: '放大机位画面', 'aria-label': '放大机位画面', html: icon('expand', 14), onclick: () => this._openPreviewModal(ent) });
    this._previewEnt = ent;
    this._previewCanvas = canvas;
    this._previewBadge = badge;
    return el('div', { class: 'field' }, [el('div', { class: 'cam-monitor' }, [
      el('div', { class: 'cam-monitor-head' }, [
        el('span', { class: 'cam-monitor-title', text: '机位监看' }), badge, expand,
      ]),
      el('div', { class: 'cam-preview' }, [canvas]),
    ])]);
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
    const invalidate = () => { this.app.store.batch('修改姿势', () => members.forEach((m) => this.app.edited(m))); this.app.stage.invalidate(); };

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
      this.app.stage.invalidate();
    }, invalidate);
  }
}

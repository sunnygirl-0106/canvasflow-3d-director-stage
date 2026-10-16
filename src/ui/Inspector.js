import { el, toast } from '../util/dom.js';
import { tripleRow, sliderRow, colorRow, dropdownRow, infoTip, shotCard, toHex } from './widgets.js';
import { PoseSliders } from './PoseSliders.js';
import { POSE_PRESETS } from '../entities/posePresets.js';
import { downloadURL } from '../app/ShotManager.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const FOV_TIP = '控制镜头视野范围。数值越小，画面越近、越聚焦；数值越大，画面越广、能看到更多环境。';
const PREVIEW_W = 248, PREVIEW_H = 140;

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
    app.on('entities', () => this.refreshName());
    app.on('shots', () => { if (this.entity?.type === 'camera') this.show(this.entity); });
  }

  _reset() {
    this._syncFn = null;
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
    const invalidate = () => { this.app.edited(ent); this.app.stage.invalidate(); };
    root.appendChild(this._nameField(ent));

    const pos = tripleRow({ label: '位置', step: 0.01, axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.position[k], set: (v) => { o.position[k] = v; invalidate(); } })) });
    const rot = tripleRow({ label: '旋转', deg: true, axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.rotation[k] * R2D, set: (v) => { o.rotation[k] = v * D2R; invalidate(); } })) });
    const scl = tripleRow({ label: '缩放', step: 0.01, axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.scale[k], set: (v) => { o.scale[k] = Math.max(0.05, v); invalidate(); } })) });

    const girth = ent._girth || 1; // 体型横向围度（胖瘦）；统一缩放时按 Y 为基准、保留 X/Z 比例
    const uni = sliderRow({
      label: '统一缩放', min: 0.2, max: 3, step: 0.01, value: o.scale.y / ent.baseScale,
      format: (v) => v.toFixed(1),
      onInput: (v) => { const s = ent.baseScale * v; o.scale.set(s * girth, s, s * girth); scl.syncAll(); invalidate(); },
    });
    const col = colorRow({ label: '颜色', hex: toHex(ent.color), onChange: (h) => { ent.setColor(h); invalidate(); } });

    root.append(pos.el, rot.el, scl.el, uni.el, col.el);
    this._syncFn = () => { pos.syncAll(); rot.syncAll(); scl.syncAll(); uni.set(o.scale.y / ent.baseScale); };
  }

  // ---- 摄像机：属性 ----
  _cameraAttr(root, ent) {
    const app = this.app;
    const o = ent.root;
    const changed = () => { app.edited(ent); ent.update(); app.stage.invalidate(); this.schedulePreview(); };

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
      label: '位置', step: 0.01,
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
      label: '注视坐标', step: 0.05,
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => ent.lookTarget[k], set: (v) => { ent.lookTarget[k] = v; ent.aimAt(ent.lookTarget); changed(); } })),
    });
    root.appendChild(lookRow.el);

    const fovField = sliderRow({
      label: '视野角度', min: 20, max: 90, step: 1, value: ent.cam.fov,
      format: (v) => Math.round(v) + '°',
      onInput: (v) => { ent.setFov(v); this._previewBadge.textContent = 'FOV ' + Math.round(v) + '°'; changed(); },
    });
    fovField.el.querySelector('label')?.appendChild(infoTip(FOV_TIP));
    root.appendChild(fovField.el);

    const myShots = app.shots.shotsForCamera(ent.id);
    if (myShots.length) {
      root.appendChild(el('div', { class: 'sec-title', text: '相机截图', style: { marginTop: '6px' } }));
      root.appendChild(this._shotGrid(myShots, true));
    }

    this._syncFn = () => { pos.syncAll(); lookRow.syncAll(); this.schedulePreview(); };
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

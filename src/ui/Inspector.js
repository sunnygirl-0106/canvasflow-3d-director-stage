import { el, toast } from '../util/dom.js';
import { tripleRow, sliderRow, colorRow, dropdownRow, infoTip, shotCard, toHex } from './widgets.js';
import { PoseSliders } from './PoseSliders.js';
import { POSE_PRESETS } from '../entities/posePresets.js';
import { renderCameraThumbnail } from '../util/cameraPreview.js';
import { downloadDataURL } from '../util/capture.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const FOV_TIP = '控制镜头视野范围。数值越小，画面越近、越聚焦；数值越大，画面越广、能看到更多环境。';

// 右侧属性面板：道具 / 角色（属性+姿势）/ 摄像机（属性+摄像机截图）。
export class Inspector {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.tab = 'attr';      // 角色：'attr' | 'pose'
    this.camTab = 'attr';   // 相机：'attr' | 'shots'
    this._syncFn = null;
    this.poseSliders = null;
    this._previewEnt = null;
    this._previewImg = null;
    this._previewBadge = null;
    this._previewPending = false;
  }

  show(entity) {
    this.entity = entity;
    this._syncFn = null;
    this.poseSliders = null;
    this._previewEnt = null;
    this._previewImg = null;
    const root = el('div', { class: 'rp rp-pad' });

    if (!entity) { this.container.innerHTML = ''; return; }

    const title = entity.type === 'character' ? '角色'
      : entity.type === 'camera' ? '摄像机'
      : entity.type === 'crowd' ? `${entity.name} (${entity.members.length})`
      : '道具';
    root.appendChild(el('h2', { text: title }));

    if (entity.type === 'crowd') {
      const tabs = el('div', { class: 'ptabs' });
      const a = el('button', { text: '属性', class: this.tab === 'attr' ? 'on' : '', onclick: () => { this.tab = 'attr'; this.show(entity); } });
      const p = el('button', { text: '姿势', class: this.tab === 'pose' ? 'on' : '', onclick: () => { this.tab = 'pose'; this.show(entity); } });
      tabs.append(a, p);
      root.appendChild(tabs);
      root.appendChild(el('div', { class: 'multi-note', text: `已选中 ${entity.members.length} 个角色，修改将同步应用到全部选中对象` }));
      root.appendChild(el('button', {
        class: 'minibtn', text: '⊟ 解组（拆为独立角色）',
        onclick: () => this.app.ungroupCrowd(entity.id),
      }));
      if (this.tab === 'attr') this._attr(root, entity);
      else this._crowdPose(root, entity);
    } else if (entity.type === 'character') {
      const tabs = el('div', { class: 'ptabs' });
      const a = el('button', { text: '属性', class: this.tab === 'attr' ? 'on' : '', onclick: () => { this.tab = 'attr'; this.show(entity); } });
      const p = el('button', { text: '姿势', class: this.tab === 'pose' ? 'on' : '', onclick: () => { this.tab = 'pose'; this.show(entity); } });
      tabs.append(a, p);
      root.appendChild(tabs);
      if (this.tab === 'attr') this._attr(root, entity);
      else this._pose(root, entity);
    } else if (entity.type === 'camera') {
      const tabs = el('div', { class: 'ptabs' });
      const a = el('button', { text: '属性', class: this.camTab === 'attr' ? 'on' : '', onclick: () => { this.camTab = 'attr'; this.show(entity); } });
      const s = el('button', { text: '摄像机截图', class: this.camTab === 'shots' ? 'on' : '', onclick: () => { this.camTab = 'shots'; this.show(entity); } });
      tabs.append(a, s);
      root.appendChild(tabs);
      if (this.camTab === 'attr') this._cameraAttr(root, entity);
      else this._cameraShots(root, entity);
    } else {
      this._attr(root, entity);
    }

    this.container.innerHTML = '';
    this.container.appendChild(root);
    if (this._previewEnt) this.refreshPreview();
  }

  refreshName() {
    if (this._nameInput && this.entity) this._nameInput.value = this.entity.name;
  }

  /** 截图增删后刷新（相机面板的截图区 / 截图 tab）。 */
  onShotsChanged() {
    if (this.entity && this.entity.type === 'camera') this.show(this.entity);
  }

  // ---- 属性页（角色/道具通用）----
  _attr(root, ent) {
    const o = ent.root;

    const nameInput = el('input', { value: ent.name });
    nameInput.addEventListener('change', () => this.app.rename(ent.id, nameInput.value));
    this._nameInput = nameInput;
    root.appendChild(el('div', { class: 'field' }, [el('label', { text: '名称' }), el('div', { class: 'namefld' }, [nameInput])]));

    const pos = tripleRow({ label: '位置', step: 0.01, axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.position[k], set: (v) => { o.position[k] = v; } })) });
    root.appendChild(pos.el);

    const rot = tripleRow({ label: '旋转', deg: true, axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.rotation[k] * R2D, set: (v) => { o.rotation[k] = v * D2R; } })) });
    root.appendChild(rot.el);

    const scl = tripleRow({ label: '缩放', step: 0.01, axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.scale[k], set: (v) => { o.scale[k] = Math.max(0.05, v); } })) });
    root.appendChild(scl.el);

    const girth = ent._girth || 1; // 体型横向围度（胖瘦）；统一缩放时按 Y 为基准、保留 X/Z 比例
    const uni = sliderRow({
      label: '统一缩放', min: 0.2, max: 3, step: 0.01, value: o.scale.y / ent.baseScale,
      format: (v) => v.toFixed(1),
      onInput: (v) => { const s = ent.baseScale * v; o.scale.set(s * girth, s, s * girth); scl.syncAll(); },
    });
    root.appendChild(uni.el);

    const col = colorRow({ label: '颜色', hex: toHex(ent.color), onChange: (h) => { ent.setColor(h); this.app.ui?.outliner?.refresh(); } });
    root.appendChild(col.el);

    this._syncFn = () => { pos.syncAll(); rot.syncAll(); scl.syncAll(); uni.set(o.scale.y / ent.baseScale); };
  }

  // ---- 摄像机：属性 tab（§B.3）----
  _cameraAttr(root, ent) {
    const app = this.app;
    const o = ent.root;

    // 1 相机预览框
    root.appendChild(this._buildPreview(ent));

    // 2 名称
    const nameInput = el('input', { value: ent.name });
    nameInput.addEventListener('change', () => app.rename(ent.id, nameInput.value));
    this._nameInput = nameInput;
    root.appendChild(el('div', { class: 'field' }, [el('label', { text: '名称' }), el('div', { class: 'namefld' }, [nameInput])]));

    // 3 切换机位
    const cams = app.cameras;
    if (cams.length > 1) {
      root.appendChild(dropdownRow({
        label: '切换机位', value: ent.id,
        options: cams.map((c) => ({ value: c.id, label: c.name })),
        onChange: (id) => app.setActiveCamera(id),
      }).el);
    }

    // 4 位置 X/Y/Z（scrubber）
    const pos = tripleRow({
      label: '位置', step: 0.01,
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.position[k], set: (v) => { o.position[k] = v; ent.update(); this.schedulePreview(); } })),
    });
    root.appendChild(pos.el);

    // 5 注视目标（下拉：手动坐标 / 各对象）
    const targets = app.entities.filter((e) => e.type === 'character' || e.type === 'prop');
    const aimOpts = [{ value: 'manual', label: '手动坐标' }, ...targets.map((t) => ({ value: t.id, label: t.name }))];
    let lookRow;
    root.appendChild(dropdownRow({
      label: '注视目标', value: ent._aimRef || 'manual', options: aimOpts,
      onChange: (val) => {
        if (val === 'manual') { ent._aimRef = 'manual'; return; }
        const center = app.aimCameraAtObject(ent.id, val);
        ent._aimRef = val; // 显示对象名，但模式回到手动坐标（澄清3）
        if (center) { lookRow?.syncAll(); pos.syncAll(); this.schedulePreview(); }
      },
    }).el);

    // 6 注视坐标 X/Y/Z（scrubber，手动模式）
    lookRow = tripleRow({
      label: '注视坐标', step: 0.05,
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => ent.lookTarget[k], set: (v) => { ent.lookTarget[k] = v; ent.aimAt(ent.lookTarget); this.schedulePreview(); } })),
    });
    root.appendChild(lookRow.el);

    // 7 视野角度 FOV + ⓘ
    const fovField = sliderRow({
      label: '视野角度', min: 20, max: 90, step: 1, value: ent.cam.fov,
      format: (v) => Math.round(v) + '°',
      onInput: (v) => { ent.setFov(v); this._updateFovBadge(v); this.schedulePreview(); },
    });
    fovField.el.querySelector('label')?.appendChild(infoTip(FOV_TIP));
    root.appendChild(fovField.el);

    // 8 相机截图区（条件显示）
    const myShots = app.shots.shotsForCamera(ent.id);
    if (myShots.length) {
      root.appendChild(el('div', { class: 'sec-title', text: '相机截图', style: { marginTop: '6px' } }));
      root.appendChild(this._shotGrid(myShots, true));
    }

    this._syncFn = () => { pos.syncAll(); lookRow.syncAll(); this.schedulePreview(); };
  }

  // ---- 摄像机：摄像机截图 tab（§B.3）----
  _cameraShots(root, ent) {
    const app = this.app;
    if (!app.shots.list.length) {
      root.appendChild(el('div', { class: 'hint', text: '暂无截图。在机位视角或导演视角点击底部「截屏」即可。' }));
      return;
    }
    // 按机位分组
    for (const cam of app.cameras) {
      const group = app.shots.shotsForCamera(cam.id);
      if (!group.length) continue;
      root.appendChild(el('div', { class: 'sec-title', text: cam.name + '截图', style: { marginTop: '8px' } }));
      root.appendChild(this._shotGrid(group));
    }

    // 底部固定栏：全部清空 / 发送到画布（发送已勾选）
    const hasSel = app.shots.selectedShotIds.size > 0;
    const bar = el('div', { class: 'shot-bar' }, [
      el('button', { class: 'shot-bar-clear', text: '全部清空', onclick: () => { if (confirm('确认清空全部截图？')) app.shots.clearShots(); } }),
      el('button', { class: 'shot-bar-send' + (hasSel ? '' : ' disabled'), text: hasSel ? `发送到画布(${app.shots.selectedShotIds.size})` : '发送到画布',
        onclick: () => { if (!hasSel) { toast('请先选择截图'); return; } app.shots.sendShotsToCanvas(); } }),
    ]);
    root.appendChild(bar);
  }

  _shotGrid(shots, compact = false) {
    const app = this.app;
    const grid = el('div', { class: 'shot-grid' });
    for (const shot of shots) {
      grid.appendChild(shotCard({
        shot,
        compact,
        selected: app.shots.selectedShotIds.has(shot.id),
        onToggle: () => app.shots.toggleShotSelected(shot.id),
        onDelete: () => app.shots.removeShot(shot.id),
        onSend: () => app.shots.sendShotsToCanvas([shot.id]),
        onExpand: () => this._openShotModal(shot),
      }));
    }
    return grid;
  }

  // ---- 相机预览框 ----
  _buildPreview(ent) {
    const box = el('div', { class: 'cam-preview' });
    const img = el('img', { alt: 'POV 预览' });
    const badge = el('div', { class: 'cam-fov-badge', text: 'FOV ' + Math.round(ent.cam.fov) + '°' });
    const expand = el('button', { class: 'cam-expand', title: '全屏扩大', text: '⤢', onclick: () => this._openPreviewModal(ent) });
    box.append(img, badge, expand);
    this._previewEnt = ent;
    this._previewImg = img;
    this._previewBadge = badge;
    return el('div', { class: 'field' }, [box]);
  }

  _updateFovBadge(v) { if (this._previewBadge) this._previewBadge.textContent = 'FOV ' + Math.round(v) + '°'; }

  /** 合并同帧多次预览请求。 */
  schedulePreview() {
    if (this._previewPending) return;
    this._previewPending = true;
    requestAnimationFrame(() => { this._previewPending = false; this.refreshPreview(); });
  }

  refreshPreview() {
    if (!this._previewEnt || !this._previewImg) return;
    const url = renderCameraThumbnail(this.app.stage, this._previewEnt.cam, 248, 140, {
      before: () => this.app._beginCleanRender(),
      after: () => this.app._endCleanRender(),
    });
    this._previewImg.src = url;
  }

  // ---- 全屏 modal ----
  _modal(contentNodes) {
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const box = el('div', { class: 'modal-box' }, [
      el('button', { class: 'modal-close', text: '×', onclick: close }),
      ...contentNodes,
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return { overlay, close };
  }

  _openShotModal(shot) {
    this._modal([
      el('img', { class: 'modal-img', src: shot.dataURL, alt: shot.name }),
      el('div', { class: 'modal-bar' }, [
        el('span', { class: 'modal-title', text: shot.name }),
        el('button', { class: 'minibtn modal-dl', text: '下载', onclick: () => downloadDataURL(shot.dataURL, shot.name + '.png') }),
        el('button', { class: 'minibtn', text: '发送到画布', onclick: () => this.app.shots.sendShotsToCanvas([shot.id]) }),
      ]),
    ]);
  }

  _openPreviewModal(ent) {
    const url = renderCameraThumbnail(this.app.stage, ent.cam, 1280, 720, {
      before: () => this.app._beginCleanRender(),
      after: () => this.app._endCleanRender(),
    });
    this._modal([
      el('img', { class: 'modal-img', src: url, alt: ent.name + ' POV' }),
      el('div', { class: 'modal-bar' }, [el('span', { class: 'modal-title', text: ent.name + '：FOV ' + Math.round(ent.cam.fov) + '°' })]),
    ]);
  }

  // ---- 姿势页（角色）----
  _pose(root, ent) {
    // 1) 姿势预设
    root.appendChild(el('div', { class: 'sec-title', text: '姿势预设', style: { marginTop: '4px' } }));
    const grid = el('div', { class: 'pose-grid' });
    const btns = {};
    const mark = (key) => Object.entries(btns).forEach(([k, b]) => b.classList.toggle('on', k === key));
    for (const p of POSE_PRESETS) {
      const b = el('button', {
        text: p.label,
        class: ent.currentPreset === p.key ? 'on' : '',
        onclick: () => { ent.applyPosePreset(p.key); this.poseSliders?.syncFromValues(); mark(p.key); },
      });
      btns[p.key] = b;
      grid.appendChild(b);
    }
    root.appendChild(grid);

    root.appendChild(el('button', { class: 'minibtn', text: '⟲ 复位姿势', style: { marginTop: '12px' },
      onclick: () => { ent.resetPose(); ent.currentPreset = null; this.poseSliders?.syncFromValues(); mark(null); } }));

    // 2) 姿势调节（滑条）
    root.appendChild(el('div', { class: 'sec-title', text: '姿势调节', style: { marginTop: '16px' } }));
    const host = el('div', {});
    root.appendChild(host);
    this.poseSliders = new PoseSliders(host, ent);
  }

  // ---- 群众组：姿势页（预设/滑条广播到全部成员）----
  _crowdPose(root, crowd) {
    const rep = crowd.members[0];
    if (!rep) return;
    root.appendChild(el('button', {
      class: 'minibtn', text: '⟲ 复位全部姿势', style: { marginTop: '4px' },
      onclick: () => { crowd.members.forEach((m) => { m.resetPose(); m.currentPreset = null; }); this.poseSliders?.syncFromValues(); mark(null); },
    }));

    // 姿势预设：点击广播到全部成员
    root.appendChild(el('div', { class: 'sec-title', text: '姿势预设', style: { marginTop: '4px' } }));
    const grid = el('div', { class: 'pose-grid' });
    const btns = {};
    const mark = (key) => Object.entries(btns).forEach(([k, b]) => b.classList.toggle('on', k === key));
    for (const p of POSE_PRESETS) {
      const b = el('button', {
        text: p.label,
        class: rep.currentPreset === p.key ? 'on' : '',
        onclick: () => { crowd.members.forEach((m) => m.applyPosePreset(p.key)); this.poseSliders?.syncFromValues(); mark(p.key); },
      });
      btns[p.key] = b;
      grid.appendChild(b);
    }
    root.appendChild(grid);

    root.appendChild(el('div', { class: 'sec-title', text: '姿势调节', style: { marginTop: '16px' } }));
    const host = el('div', {});
    root.appendChild(host);
    // 滑条驱动代表成员，onChange 把其 values 广播到其余成员
    this.poseSliders = new PoseSliders(host, rep, () => {
      mark(null); // 手动微调取消预设高亮
      for (const m of crowd.members) {
        if (m === rep) continue;
        Object.assign(m.values, rep.values);
        m.currentPreset = null;
        m.enterManual();
        m.applyPose();
      }
    });
  }

  /** gizmo 拖动后回写数值。 */
  syncFromObject() { if (this._syncFn) this._syncFn(); }
}

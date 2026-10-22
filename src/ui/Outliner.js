import { el, clear } from '../util/dom.js';
import { icon } from './icons.js';
import { onKey, KEY_PRIORITY } from '../util/keys.js';

const ICON = {
  camera: icon('video', 16, 1.8),
  person: icon('person', 16, 1.8),
  cube: icon('cube', 16, 1.8),
  group: icon('group', 16, 1.8),
  caret: icon('chevron', 12, 2.2),
  eye: icon('eye', 15, 1.8),
  eyeOff: icon('eyeOff', 15, 1.8),
  trash: icon('trash', 15, 1.8),
  ctxGroup: icon('groupFrame', 16, 1.6),
  ctxEye: icon('eye', 16, 1.6),
  ctxCopy: icon('copy', 16, 1.6),
  ctxTrash: icon('trash', 16, 1.6),
};

// 左侧场景清单：机位 + 角色/道具 + 群众组（可折叠）。选择 / 改名 / 显隐 / 删除。
export class Outliner {
  constructor(container, app, searchInput) {
    this.app = app;
    this.container = container;
    this.query = '';
    this.collapsed = new Set(); // 折叠的群众组 id
    if (searchInput) {
      searchInput.addEventListener('input', (e) => { this.query = (e.target.value || '').trim(); this.refresh(); });
    }
    app.on('entities', () => this.scheduleRefresh());
    app.on('selection', () => this.scheduleRefresh());
    this.refresh();
  }

  /** 同一轮同步操作里的多次变化合并为一次重建。 */
  scheduleRefresh() {
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => { this._pending = false; this.refresh(); });
  }

  _matches(name) { return !this.query || name.includes(this.query); }

  // 通用操作按钮组（显隐 / 重命名 / 删除）
  _ops(ent, extra = []) {
    const app = this.app;
    return el('div', { class: 'ops' }, [
      ...extra,
      el('button', { class: 'op', title: ent.visible ? '隐藏' : '显示', html: ent.visible ? ICON.eye : ICON.eyeOff, onclick: (e) => { e.stopPropagation(); app.toggleVisible(ent.id); } }),
      el('button', { class: 'op', title: '删除', html: ICON.trash, onclick: (e) => { e.stopPropagation(); app.remove(ent.id); } }),
    ]);
  }

  refresh() {
    const app = this.app;
    clear(this.container);
    const tree = el('div', { class: 'tree' });

    for (const ent of [...app.entities].sort((a, b) => Number(b.type === 'camera') - Number(a.type === 'camera'))) {
      if (ent.type === 'group') { this._renderCrowd(tree, ent); continue; }
      if (!this._matches(ent.name)) continue;

      const sel = app.selectedIds.has(ent.id);
      const node = el('div', { class: 'node' + (sel ? ' sel' : '') });
      const icon = ent.type === 'character' ? ICON.person : ent.type === 'camera' ? ICON.camera : ICON.cube;
      node.append(
        el('span', { class: 'ic-type', html: icon }),
        el('span', { class: 'nm', text: ent.name }),
        this._ops(ent),
      );
      node.addEventListener('click', (e) => {
        // Shift 点击角色/道具 → 多选切换
        if (e.shiftKey && (ent.type === 'character' || ent.type === 'prop')) { app.toggleSelect(ent.id); return; }
        if (ent.type === 'camera') {
          // 导演视角下点机位 → 仅选中（出属性面板 + 三色 gizmo），不切换 POV；
          // 已在机位视角时点机位 → 切换当前 POV 相机
          if (app.cameraView) app.setActiveCamera(ent.id);
          else app.select(ent.id);
        } else {
          app.select(ent.id);
        }
      });
      // 右键菜单（角色/道具）：打组 / 显示隐藏 / 创建副本 / 删除
      if (ent.type === 'character' || ent.type === 'prop') {
        node.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (!app.selectedIds.has(ent.id)) app.select(ent.id); // 右键未选中项 → 先单选它
          this._showContextMenu(e.clientX, e.clientY);
        });
      }
      node.querySelector('.nm').addEventListener('dblclick', (e) => { e.stopPropagation(); const n = prompt('重命名', ent.name); if (n != null) app.rename(ent.id, n); });
      tree.appendChild(node);
    }

    if (!app.entities.length) tree.appendChild(el('div', { class: 'empty', text: '场景为空 · 用底部「＋」添加角色或模型' }));
    this.container.appendChild(tree);
  }

  // ---- 右键上下文菜单（多选批量操作）----
  _showContextMenu(x, y) {
    this._closeContextMenu();
    const app = this.app;
    const ids = [...app.selectedIds];
    // 打组仅对「≥2 个角色」可用，否则置灰
    const charCount = ids.map((id) => app.entities.find((e) => e.id === id)).filter((e) => e && e.type === 'character').length;
    const canGroup = charCount >= 2;

    const mk = (iconKey, label, onClick, disabled = false) => el('div', {
      class: 'ctx-item' + (disabled ? ' disabled' : ''),
      onclick: (e) => { e.stopPropagation(); if (disabled) return; this._closeContextMenu(); onClick(); },
    }, [
      el('span', { class: 'ctx-ic', html: ICON[iconKey] }),
      el('span', { class: 'ctx-label', text: label }),
    ]);
    const menu = el('div', { class: 'ctxmenu' }, [
      mk('ctxGroup', '打组', () => app.groupCharacters(ids), !canGroup),
      mk('ctxEye', '显示 / 隐藏', () => app.toggleVisibleMany(ids)),
      mk('ctxCopy', '创建副本', () => app.duplicateMany(ids)),
      el('div', { class: 'ctx-sep' }),
      mk('ctxTrash', '删除', () => app.removeMany(ids), false),
    ]);
    document.body.appendChild(menu);
    // 约束在视口内
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
    this._ctxMenu = menu;

    this._ctxClose = (ev) => { if (!menu.contains(ev.target)) this._closeContextMenu(); };
    this._ctxOffKey = onKey((ev) => { if (ev.key === 'Escape') this._closeContextMenu(); }, { priority: KEY_PRIORITY.menu, phase: 'bubble' });
    // 延迟到下一拍再绑定，避免本次右键事件立即触发关闭；关得比这一拍还早时清掉定时器
    const close = this._ctxClose;
    this._ctxTimer = setTimeout(() => {
      window.addEventListener('pointerdown', close, true);
      window.addEventListener('contextmenu', close, true);
      window.addEventListener('blur', close);
    }, 0);
  }

  _closeContextMenu() {
    if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; }
    if (this._ctxClose) {
      window.removeEventListener('pointerdown', this._ctxClose, true);
      window.removeEventListener('contextmenu', this._ctxClose, true);
      window.removeEventListener('blur', this._ctxClose);
      this._ctxClose = null;
    }
    clearTimeout(this._ctxTimer);
    if (this._ctxOffKey) { this._ctxOffKey(); this._ctxOffKey = null; }
  }

  // ---- 群众组（父节点 + 成员子项）----
  _renderCrowd(tree, crowd) {
    const app = this.app;
    const open = !this.collapsed.has(crowd.id);
    const members = crowd.members.filter((m) => this._matches(m.name));
    // 搜索时：组名或任一成员命中才显示该组
    if (this.query && !this._matches(crowd.name) && !members.length) return;

    const sel = app.selectedIds.has(crowd.id);
    const node = el('div', { class: 'node group' + (sel ? ' sel' : '') });
    const caret = el('span', { class: 'caret' + (open ? ' open' : ''), html: ICON.caret });
    caret.addEventListener('click', (e) => { e.stopPropagation(); if (open) this.collapsed.add(crowd.id); else this.collapsed.delete(crowd.id); this.refresh(); });
    node.append(
      caret,
      el('span', { class: 'ic-type', html: ICON.group }),
      el('span', { class: 'nm', text: crowd.name }),
      this._ops(crowd, [el('button', { class: 'op', title: '解组', text: '⊟', onclick: (e) => { e.stopPropagation(); app.ungroupCrowd(crowd.id); } })]),
    );
    node.addEventListener('click', () => app.select(crowd.id));
    tree.appendChild(node);

    if (!open) return;
    const list = this.query ? members : crowd.members;
    for (const m of list) {
      const msel = m.id === app.selectedId;
      const child = el('div', { class: 'node child' + (msel ? ' sel' : '') }, [
        el('span', { class: 'ic-type', html: ICON.person }),
        el('span', { class: 'nm', text: m.name }),
      ]);
      child.addEventListener('click', () => app.select(m.id));
      tree.appendChild(child);
    }
  }
}

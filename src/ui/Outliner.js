import { el, clear } from '../util/dom.js';

const ICON = {
  camera: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="6" r="2.5"/><path d="M12 8.5c-2.2 0-3.6 1.5-3.6 3.6V15M12 8.5c2.2 0 3.6 1.5 3.6 3.6V15M9.2 21v-5M14.8 21v-5"/></svg>',
  cube: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/></svg>',
  group: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="7" cy="7" r="2.1"/><circle cx="17" cy="7" r="2.1"/><circle cx="7" cy="17" r="2.1"/><circle cx="17" cy="17" r="2.1"/></svg>',
  caret: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.1 6.1C3.5 7.7 2 12 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4-0.9M3 3l18 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>',
  // 右键菜单图标（描边风格，对齐参考组件）
  ctxGroup: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="9" y="9" width="6" height="6" rx="1.2"/></svg>',
  ctxEye: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  ctxCopy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="8.5" width="11" height="12" rx="2"/><path d="M8.5 8.5V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2.5"/><path d="M19.2 13.6l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z"/></svg>',
  ctxTrash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>',
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
    this.refresh();
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

    for (const ent of app.entities) {
      if (ent.type === 'crowd') { this._renderCrowd(tree, ent); continue; }
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

    const mk = (icon, label, onClick, disabled = false) => el('div', {
      class: 'ctx-item' + (disabled ? ' disabled' : ''),
      onclick: (e) => { e.stopPropagation(); if (disabled) return; this._closeContextMenu(); onClick(); },
    }, [
      el('span', { class: 'ctx-ic', html: ICON[icon] }),
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
    this._ctxKey = (ev) => { if (ev.key === 'Escape') this._closeContextMenu(); };
    // 延迟到下一拍再绑定，避免本次右键事件立即触发关闭
    setTimeout(() => {
      window.addEventListener('pointerdown', this._ctxClose, true);
      window.addEventListener('contextmenu', this._ctxClose, true);
      window.addEventListener('keydown', this._ctxKey);
      window.addEventListener('blur', this._ctxClose);
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
    if (this._ctxKey) { window.removeEventListener('keydown', this._ctxKey); this._ctxKey = null; }
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

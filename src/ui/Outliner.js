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

      const sel = ent.id === app.selectedId;
      const node = el('div', { class: 'node' + (sel ? ' sel' : '') });
      const icon = ent.type === 'character' ? ICON.person : ent.type === 'camera' ? ICON.camera : ICON.cube;
      node.append(
        el('span', { class: 'ic-type', html: icon }),
        el('span', { class: 'nm', text: ent.name }),
        this._ops(ent),
      );
      node.addEventListener('click', () => {
        if (ent.type === 'camera') {
          // 点击机位 → 切到「机位视角」并激活该机位（已在机位视角则直接切换激活机位）
          app.select(ent.id);
          if (!app.cameraView) app.setCameraView(true);
          else app.setActiveCamera(ent.id);
        } else {
          app.select(ent.id);
        }
      });
      node.querySelector('.nm').addEventListener('dblclick', (e) => { e.stopPropagation(); const n = prompt('重命名', ent.name); if (n != null) app.rename(ent.id, n); });
      tree.appendChild(node);
    }

    if (!app.entities.length) tree.appendChild(el('div', { class: 'empty', text: '场景为空 · 用底部「＋」添加角色或模型' }));
    this.container.appendChild(tree);
  }

  // ---- 群众组（父节点 + 成员子项）----
  _renderCrowd(tree, crowd) {
    const app = this.app;
    const open = !this.collapsed.has(crowd.id);
    const members = crowd.members.filter((m) => this._matches(m.name));
    // 搜索时：组名或任一成员命中才显示该组
    if (this.query && !this._matches(crowd.name) && !members.length) return;

    const sel = crowd.id === app.selectedId;
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

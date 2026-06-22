import { el, clear } from '../util/dom.js';

const ICON = {
  camera: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="6" r="2.5"/><path d="M12 8.5c-2.2 0-3.6 1.5-3.6 3.6V15M12 8.5c2.2 0 3.6 1.5 3.6 3.6V15M9.2 21v-5M14.8 21v-5"/></svg>',
  cube: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/></svg>',
};

// 左侧场景清单：机位 + 角色/道具。选择 / 改名 / 显隐 / 删除。
export class Outliner {
  constructor(container, app, searchInput) {
    this.app = app;
    this.container = container;
    this.query = '';
    if (searchInput) {
      searchInput.addEventListener('input', (e) => { this.query = (e.target.value || '').trim(); this.refresh(); });
    }
    this.refresh();
  }

  refresh() {
    const app = this.app;
    clear(this.container);
    const tree = el('div', { class: 'tree' });

    // 机位1（固定项）：点选切到机位视角
    const cam = el('div', { class: 'node' }, [
      el('span', { class: 'ic-type', html: ICON.camera }),
      el('span', { class: 'nm', text: '机位1' }),
    ]);
    cam.addEventListener('click', () => app.setCameraView(true));
    if (!this.query || '机位1'.includes(this.query)) tree.appendChild(cam);

    for (const ent of app.entities) {
      if (this.query && !ent.name.includes(this.query)) continue;
      const sel = ent.id === app.selectedId;
      const node = el('div', { class: 'node' + (sel ? ' sel' : '') });
      node.append(
        el('span', { class: 'ic-type', html: ent.type === 'character' ? ICON.person : ICON.cube }),
        el('span', { class: 'nm', text: ent.name }),
        el('div', { class: 'ops' }, [
          el('button', { class: 'op', title: '显隐', text: ent.visible ? '◉' : '○', onclick: (e) => { e.stopPropagation(); app.toggleVisible(ent.id); } }),
          el('button', { class: 'op', title: '重命名', text: '✎', onclick: (e) => { e.stopPropagation(); const n = prompt('重命名', ent.name); if (n != null) app.rename(ent.id, n); } }),
          el('button', { class: 'op', title: '删除', text: '✕', onclick: (e) => { e.stopPropagation(); app.remove(ent.id); } }),
        ]),
      );
      node.addEventListener('click', () => app.select(ent.id));
      node.querySelector('.nm').addEventListener('dblclick', (e) => { e.stopPropagation(); const n = prompt('重命名', ent.name); if (n != null) app.rename(ent.id, n); });
      tree.appendChild(node);
    }

    if (!app.entities.length) tree.appendChild(el('div', { class: 'empty', text: '场景为空 · 用底部「＋」添加角色或模型' }));
    this.container.appendChild(tree);
  }
}

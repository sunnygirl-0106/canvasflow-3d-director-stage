import { el } from '../util/dom.js';

// 全屏「历史记录」弹层（对齐画布历史记录设计稿）：
// 左侧分类（图片 / 视频 / 音频）+ 右侧按日期分组的资产网格 + 缩放 / 排序 / 分页。
// 当前仅「图片历史」接入真实数据（预设全景资产）；视频 / 音频为占位空态。

const IC = {
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-4 4-2-2-7 7"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3"/>',
  audio: '<path d="M5 10v4M9 6v12M13 8v8M17 5v14M21 10v4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  sort: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const svg = (name, w = 18) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${IC[name]}</svg>`;

const TABS = [
  ['image', '图片历史'],
  ['video', '视频历史'],
  ['audio', '音频历史'],
];
const PAGE_SIZE = 14;        // 每页项数（约 2 行 × 7 列）
const ZOOM_STEPS = [60, 80, 100, 130, 160];

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export class HistoryModal {
  /**
   * @param {{onPick:(asset)=>void, getAssets:()=>Array, isEligible?:(asset)=>boolean, ineligibleReason?:(asset)=>string}} opts
   */
  constructor({ onPick, getAssets, isEligible, ineligibleReason }) {
    this.onPick = onPick;
    this.getAssets = getAssets;
    this.isEligible = isEligible || (() => true);
    this.ineligibleReason = ineligibleReason || (() => '不可用');
    this.tab = 'image';
    this.descending = true;     // 时间倒序
    this.zoom = 100;
    this.page = 1;
    this.overlay = null;
  }

  open() {
    this.tab = 'image';
    this.page = 1;
    this._build();
    document.body.appendChild(this.overlay);
    this._renderMain();
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
  }

  _build() {
    const close = () => this.close();
    this.sideEl = el('div', { class: 'hm-side' }, TABS.map(([key, label]) => {
      const t = el('div', { class: 'hm-tab' + (key === this.tab ? ' on' : ''), onclick: () => this._setTab(key) }, [
        el('span', { class: 'hm-tab-ic', html: svg(key, 17) }),
        el('span', { text: label }),
      ]);
      t.dataset.key = key;
      return t;
    }));

    this.mainEl = el('div', { class: 'hm-main' });

    const box = el('div', { class: 'hm-box' }, [
      el('div', { class: 'hm-head' }, [
        el('div', { class: 'hm-title', text: '历史记录' }),
        el('button', { class: 'hm-close', html: svg('close', 20), onclick: close }),
      ]),
      el('div', { class: 'hm-body' }, [this.sideEl, this.mainEl]),
    ]);

    this.overlay = el('div', { class: 'hm-overlay' }, [box]);
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) close(); });
  }

  _setTab(key) {
    this.tab = key;
    this.page = 1;
    for (const t of this.sideEl.children) t.classList.toggle('on', t.dataset.key === key);
    this._renderMain();
  }

  _setZoom(dir) {
    const i = ZOOM_STEPS.indexOf(this.zoom);
    const ni = Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir));
    if (ni === i) return;
    this.zoom = ZOOM_STEPS[ni];
    this._renderMain();
  }

  _renderMain() {
    const main = this.mainEl;
    main.innerHTML = '';

    const LABEL = { image: '图片历史记录', video: '视频历史记录', audio: '音频历史记录' };
    // 按当前分类（图片/视频/音频）过滤资产
    const assets = (this.getAssets() || [])
      .filter((a) => (a.type || 'image') === this.tab)
      .sort((a, b) => this.descending ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
    const total = assets.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    this.page = Math.min(this.page, pages);
    const start = (this.page - 1) * PAGE_SIZE;
    const pageItems = assets.slice(start, start + PAGE_SIZE);

    // 顶部工具条
    main.appendChild(el('div', { class: 'hm-toolbar' }, [
      el('div', { class: 'hm-count' }, [
        el('b', { text: LABEL[this.tab] || '历史记录' }),
        el('span', { class: 'hm-num', text: `共 ${total} 项` }),
      ]),
      el('div', { class: 'hm-tools' }, [
        el('button', { class: 'hm-pill', html: svg('grid', 15) + '<span>批量选择</span>' }),
        el('div', { class: 'hm-pill hm-zoom' }, [
          el('button', { class: 'hm-step', text: '−', onclick: () => this._setZoom(-1) }),
          el('span', { class: 'hm-zval', text: this.zoom + '%' }),
          el('button', { class: 'hm-step', text: '+', onclick: () => this._setZoom(1) }),
        ]),
        el('button', {
          class: 'hm-pill',
          html: svg('sort', 15) + `<span>${this.descending ? '时间倒序' : '时间正序'}</span>`,
          onclick: () => { this.descending = !this.descending; this._renderMain(); },
        }),
      ]),
    ]));

    // 资产区（按日期分组）
    const scroll = el('div', { class: 'hm-scroll' });
    let curDate = null, gridEl = null;
    const cellW = Math.round(150 * this.zoom / 100);
    for (const a of pageItems) {
      const dk = fmtDate(a.createdAt);
      if (dk !== curDate) {
        curDate = dk;
        scroll.appendChild(el('div', { class: 'hm-date', text: dk }));
        gridEl = el('div', { class: 'hm-grid' });
        gridEl.style.gridTemplateColumns = `repeat(auto-fill, ${cellW}px)`;
        scroll.appendChild(gridEl);
      }
      const eligible = this.isEligible(a);
      const reason = eligible ? '' : this.ineligibleReason(a);
      const cell = el('div', { class: 'hm-cell' + (eligible ? '' : ' disabled'), title: eligible ? a.title : `${a.title} · ${reason}` });
      const img = el('div', { class: 'hm-thumb' });
      img.style.backgroundImage = `url(${a.thumb || a.url})`;
      if (a.ratioLabel) img.appendChild(el('span', { class: 'hm-badge', text: a.ratioLabel }));
      if (!eligible) img.appendChild(el('span', { class: 'hm-lock', text: reason }));
      cell.append(img, el('div', { class: 'hm-cap', text: a.title }));
      if (eligible) cell.addEventListener('click', () => { this.onPick(a); this.close(); });
      gridEl.appendChild(cell);
    }
    if (!pageItems.length) scroll.appendChild(el('div', { class: 'hm-emptywrap', text: '暂无历史记录' }));
    main.appendChild(scroll);

    // 分页
    main.appendChild(el('div', { class: 'hm-pager' }, [
      el('button', { class: 'hm-pgbtn', text: '上一页', disabled: this.page <= 1 ? '' : null, onclick: () => { if (this.page > 1) { this.page--; this._renderMain(); } } }),
      el('span', { class: 'hm-pgnum', text: `第 ${this.page} 页` }),
      el('button', { class: 'hm-pgbtn', text: '下一页', disabled: this.page >= pages ? '' : null, onclick: () => { if (this.page < pages) { this.page++; this._renderMain(); } } }),
    ]));
  }
}

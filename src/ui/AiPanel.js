import { el, clear, toast, confirmToast } from '../util/dom.js';
import { icon } from './icons.js';
import { MODES, MODE_LABEL } from '../ai/ops.js';
import { OpenAICompatProvider, loadSettings, saveSettings } from '../ai/provider.js';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 识图：原图 ≤ 2 MB
const IMAGE_EDGE = 1024;                 // 压到长边 1024 px（JPEG）
const MODE_HINT = {
  generate: '描述一个完整场景：人物、站位、姿势、机位运镜、时长…（会先清空当前场景）',
  modify: '说要改什么：「让男的走到女的旁边」「机位改成推」「加一个方块当桌子」…',
  image: '附一张站位参考图，可补充说明（只识别人数、站位、朝向和机位方向）',
};

/** 图片文件 → 压到长边 IMAGE_EDGE 的 JPEG data URL。 */
export async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('无法读取图片'));
      im.src = url;
    });
    const k = Math.min(1, IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.naturalWidth * k));
    cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * AI 抽屉（阶段 H）：视口右侧，Dock「AI」按钮开合。
 * - 模式：生成新场景（发送前确认清空）/ 修改当前场景（默认；场景为空时自动切生成）/ 识图导入（附图）。
 * - 对话流：每轮显示输入、各次尝试的错误、模型 note、「已应用 n 项」/ 失败原因；每轮应用是一步撤销，
 *   「撤销这一轮」= history.undo（只在这一轮之后没有别的改动时可用）。
 * - 设置：baseURL / apiKey / model（只存本机 localStorage）、测试连接。
 * 不持有场景状态；对话记录在 app.ai.turns（会话态）。
 */
export class AiPanel {
  constructor(viewport, app) {
    this.app = app;
    this.agent = app.ai;
    this.open = false;
    this.mode = 'modify';
    this.image = null;      // 识图：压缩后的 data URL
    this.showSettings = false;
    this.settings = loadSettings();
    this.testState = null;  // 测试连接结果文案
    this.root = el('div', { class: 'ai-drawer', hidden: true });
    this.root.addEventListener('keydown', (e) => e.stopPropagation()); // 抽屉内按键不触发全局快捷键（Del / V / R / S…）
    viewport.appendChild(this.root);
    this.agent.on('turn', () => this.renderFlow());
    this.agent.on('update', () => { this.renderFlow(); this.renderInput(); });
    this.agent.on('busy', () => this.renderInput());
    app.on('entities', () => { if (this.open) this.renderInput(); });
    app.on('document', () => { if (this.open) this.renderInput(); });
    app.history.on('change', () => { if (this.open) this.renderFlow(); });
    this.render();
  }

  toggle(v = !this.open) {
    this.open = v;
    this.root.hidden = !v;
    this.root.parentElement.classList.toggle('ai-open', v); // 视口：Dock 让出抽屉的位置
    // 自动取景（frameSubjects）避开抽屉：被遮住的宽度 = 视口右边 − 抽屉左边；关了恢复 0
    this.app.frameInsetRight = v ? Math.max(0, this.root.parentElement.getBoundingClientRect().right - this.root.getBoundingClientRect().left) : 0;
    if (v) { this.render(); this.textarea?.focus(); }
    this.onToggle?.(v);
  }

  /** 实际生效的模式：修改模式遇空场景自动切生成。 */
  get effectiveMode() { return this.mode === 'modify' && !this.app.entities.length ? 'generate' : this.mode; }

  render() {
    clear(this.root);
    const head = el('div', { class: 'ai-head' }, [
      el('span', { class: 'ai-title', html: icon('sparkle', 17) + '<span>AI 导演</span>' }),
      el('button', {
        class: 'ai-icbtn' + (this.showSettings ? ' on' : ''), title: '设置（模型接口）', html: icon('gear', 17),
        onclick: () => { this.showSettings = !this.showSettings; this.render(); },
      }),
      el('button', { class: 'ai-icbtn', title: '关闭', html: icon('close', 17), onclick: () => this.toggle(false) }),
    ]);
    this.settingsEl = el('div', { class: 'ai-settings', hidden: this.showSettings ? undefined : true });
    this.flowEl = el('div', { class: 'ai-flow' });
    this.inputEl = el('div', { class: 'ai-input' });
    this.root.append(head, this.settingsEl, this.flowEl, this.inputEl);
    this.renderSettings();
    this.renderFlow();
    this.renderInput();
  }

  // ---- 设置 ----
  renderSettings() {
    const s = this.settings;
    clear(this.settingsEl);
    const field = (label, key, type = 'text', placeholder = '') => {
      const inp = el('input', { class: 'ai-field', type, value: s[key] || '', placeholder, spellcheck: 'false', autocomplete: 'off' });
      inp.dataset.name = key;
      inp.addEventListener('input', () => { s[key] = inp.value.trim(); });
      return el('label', { class: 'ai-frow' }, [el('span', { text: label }), inp]);
    };
    this.settingsEl.append(...[
      field('Base URL', 'baseURL', 'text', 'https://api.openai.com/v1'),
      field('API Key', 'apiKey', 'password', 'sk-…'),
      field('Model', 'model', 'text', 'gpt-4o-mini'),
      el('div', { class: 'ai-frow-btns' }, [
        el('button', { class: 'minibtn primary', text: '保存', onclick: () => this._saveSettings() }),
        el('button', { class: 'minibtn', text: '测试连接', onclick: () => this._testConnection() }),
      ]),
      this.testState ? el('div', { class: 'ai-test ' + (this.testState.ok ? 'ok' : 'err'), text: this.testState.text }) : null,
      el('div', { class: 'ai-privacy', text: 'OpenAI 兼容接口（/chat/completions）。设置只保存在本机浏览器（localStorage），不写进场景文件、不上传；识图会把图片发给该接口。' }),
    ].filter(Boolean));
  }

  _provider() { return new OpenAICompatProvider(this.settings); }

  _saveSettings() {
    saveSettings(this.settings);
    this.agent.setProvider(this._provider());
    this.testState = null;
    toast('已保存 AI 设置（仅本机）');
    this.renderSettings();
    this.renderInput();
  }

  async _testConnection() {
    this.testState = { ok: true, text: '测试中…' };
    this.renderSettings();
    const r = await this._provider().test();
    this.testState = r.ok ? { ok: true, text: `连接正常（${r.ms} ms）` } : { ok: false, text: `连接失败：${r.error || '回复不符合预期：' + r.reply}` };
    this.renderSettings();
  }

  // ---- 对话流 ----
  renderFlow() {
    if (!this.flowEl) return;
    const turns = this.agent.turns;
    clear(this.flowEl);
    if (!turns.length) {
      this.flowEl.appendChild(el('div', { class: 'ai-empty' }, [
        el('div', { text: '用一句话描述场景，AI 会摆好人物、机位和运镜。' }),
        el('div', { class: 'ai-eg', text: '例：两个人在广场对话，一个女的站着挥手，一个男的坐着，一个机位半环绕拍他们，5 秒' }),
      ]));
      return;
    }
    for (const t of turns) this.flowEl.appendChild(this._turn(t));
    this.flowEl.scrollTop = this.flowEl.scrollHeight;
  }

  _turn(t) {
    const nodes = [el('div', { class: 'ai-user' }, [
      el('span', { class: 'ai-mode-tag ' + t.mode, text: MODE_LABEL[t.mode] }),
      t.image ? el('img', { class: 'ai-thumb', src: t.image, alt: '参考图' }) : null,
      el('div', { class: 'ai-user-text', text: t.input || '（无文字说明）' }),
    ])];
    // 失败的尝试：错误原文（被喂回模型的就是这些）
    const failed = t.attempts.filter((a) => a.errors.length);
    failed.forEach((a, i) => {
      const n = t.attempts.indexOf(a) + 1;
      const det = el('details', { class: 'ai-attempt' }, [
        el('summary', { text: `第 ${n} 次尝试未通过校验（${a.errors.length} 处）${t.status === 'running' || i < failed.length - 1 || t.status === 'ok' ? '，已让模型修正' : ''}` }),
        el('ul', {}, a.errors.slice(0, 8).map((e) => el('li', { text: e }))),
      ]);
      if (t.status === 'failed' && i === failed.length - 1) det.open = true;
      nodes.push(det);
    });
    const reply = [];
    if (t.status === 'running') reply.push(el('div', { class: 'ai-status run', text: `生成中 · 第 ${t.attempts.length} 次尝试…` }));
    if (t.note && t.status === 'ok') reply.push(el('div', { class: 'ai-note', text: t.note })); // 失败轮的 note 描述的是没生效的输出，不显示
    if (t.status === 'ok') {
      const r = t.result;
      const renames = Object.entries(r.renames || {}).map(([a, b]) => `「${a}」重名，改为「${b}」`);
      reply.push(el('div', { class: 'ai-status ok', text: `✓ 已应用 ${r.applied} 项${t.attempts.length > 1 ? `（第 ${t.attempts.length} 次尝试）` : ''}` }));
      for (const w of [...renames, ...(r.warnings || [])]) reply.push(el('div', { class: 'ai-warn', text: w }));
      const latest = this.app.history.index === t.historyIndex && !t.undone;
      reply.push(el('button', {
        class: 'minibtn ai-undo', text: t.undone ? '已撤销' : '撤销这一轮', disabled: !latest || undefined,
        title: latest ? '撤销这一轮的全部改动（= ⌘Z 一次）' : '之后还有别的改动，请用 ⌘Z 逐步撤销',
        onclick: async () => { t.undone = true; await this.app.history.undo(); this.renderFlow(); },
      }));
    } else if (t.status === 'failed') {
      reply.push(el('div', { class: 'ai-status err', text: `✕ 尝试 ${t.attempts.length} 次都没通过校验，场景未改动` }));
    } else if (t.status === 'error') {
      reply.push(el('div', { class: 'ai-status err', text: `✕ ${t.error}` }));
    } else if (t.status === 'cancelled') {
      reply.push(el('div', { class: 'ai-status', text: '已取消，场景未改动' }));
    }
    nodes.push(el('div', { class: 'ai-reply' }, reply));
    return el('div', { class: 'ai-turn', 'data-status': t.status }, nodes);
  }

  // ---- 输入 ----
  renderInput() {
    if (!this.inputEl) return;
    const busy = this.agent.busy;
    const mode = this.effectiveMode;
    const draft = this.textarea?.value ?? '';
    clear(this.inputEl);
    const seg = el('div', { class: 'ai-modes' }, MODES.map((m) => el('button', {
      class: 'ai-mode' + (m === mode ? ' on' : ''), text: MODE_LABEL[m], 'data-mode': m, disabled: busy || undefined,
      title: m === 'modify' && !this.app.entities.length ? '场景为空，将按「生成新场景」处理' : '',
      onclick: () => { this.mode = m; if (m !== 'image') this.image = null; this.renderInput(); },
    })));
    this.inputEl.appendChild(seg);

    if (mode === 'image') {
      const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
      file.addEventListener('change', () => this._pickImage(file.files?.[0]));
      this.inputEl.appendChild(el('div', { class: 'ai-imgrow' }, [
        file,
        this.image
          ? el('div', { class: 'ai-imgprev' }, [
            el('img', { src: this.image, alt: '参考图' }),
            el('button', { class: 'ai-icbtn', title: '移除图片', html: icon('close', 14), onclick: () => { this.image = null; this.renderInput(); } }),
          ])
          : el('button', { class: 'minibtn ai-attach', html: icon('image', 15) + '<span>附参考图（≤ 2 MB）</span>', disabled: busy || undefined, onclick: () => file.click() }),
      ]));
    }

    const configured = this.agent.provider?.configured;
    this.textarea = el('textarea', {
      class: 'ai-text', rows: 3, disabled: busy || undefined,
      placeholder: configured ? MODE_HINT[mode] + '\n（Enter 发送，⇧Enter 换行）' : '还没配置模型接口：点右上角 ⚙ 填写 baseURL / apiKey / model',
    });
    this.textarea.value = draft;
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
    });
    this.inputEl.appendChild(this.textarea);

    const running = this.agent.turns[this.agent.turns.length - 1];
    this.inputEl.appendChild(el('div', { class: 'ai-sendrow' }, [
      el('span', { class: 'ai-busy', text: busy ? `生成中 · 第 ${running?.attempts.length || 1} 次尝试` : '' }),
      busy
        ? el('button', { class: 'minibtn', text: '取消', onclick: () => this.agent.cancel() })
        : el('button', { class: 'minibtn primary ai-send', text: '发送', onclick: () => this.send() }),
    ]));
  }

  async _pickImage(f) {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('请选择图片文件'); return; }
    if (f.size > MAX_IMAGE_BYTES) { toast(`图片过大（${(f.size / 1048576).toFixed(1)} MB），请小于 2 MB`); return; }
    try { this.image = await compressImage(f); }
    catch (err) { toast(err.message || String(err)); return; }
    this.renderInput();
  }

  /** 发送：生成模式且场景非空先确认清空；识图模式必须有图。 */
  send() {
    if (this.agent.busy) return;
    const input = this.textarea.value.trim();
    const mode = this.effectiveMode;
    if (!this.agent.provider?.configured) { this.showSettings = true; this.render(); toast('请先在设置里填写模型接口'); return; }
    if (mode === 'image' && !this.image) { toast('请先附一张参考图'); return; }
    if (mode !== 'image' && !input) { this.textarea.focus(); return; }
    const go = () => this._run({ input, mode, image: mode === 'image' ? this.image : null });
    if (mode === 'generate' && this.app.entities.length) confirmToast('生成新场景将清空当前场景（可 ⌘Z 撤销）', '清空并生成', go);
    else go();
  }

  async _run(req) {
    this.textarea.value = '';
    const turn = await this.agent.run(req);
    if (turn.status === 'ok') turn.historyIndex = this.app.history.index;
    else if (turn.status !== 'cancelled' && !this.textarea.value) this.textarea.value = req.input; // 失败：输入放回去方便改
    if (turn.status === 'ok' && req.mode === 'image') this.image = null;
    this.renderFlow();
    this.renderInput();
  }
}

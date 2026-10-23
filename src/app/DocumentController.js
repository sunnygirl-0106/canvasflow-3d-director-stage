import { checkRequestState } from '../util/requestGuard.js';
import { DocumentStore, updateDraft } from '../doc/Store.js';
import { createEmptyDocument, APP_ID } from '../doc/schema.js';
import { clone, xyz } from '../util/math.js';
import { PROP_LABEL } from '../config.js';
import { parseCharName } from '../doc/edit.js';
import { exportCamera } from './exportSpec.js';
import { loadDocument, APP_VERSION } from '../doc/serialize.js';

/** 文档与 Three 场景之间的边界。普通事务只同步改动的实体；资源加载走 prepare/commit。 */
export class DocumentController {
  constructor(app) {
    this.app = app;
    const doc = createEmptyDocument();
    doc.meta.app = `${APP_ID}@${APP_VERSION}`;
    this.store = new DocumentStore(doc);
    this.store.project = (next, prev) => this.project(next, prev);
    this.chain = Promise.resolve();
  }

  export({ view = true } = {}) {
    const doc = clone(this.store.document);
    doc.meta.updatedAt = new Date().toISOString();
    doc.meta.editorView = view ? { pos: xyz(this.app.stage.camera.position), target: xyz(this.app.rig.controls.target), fov: this.app.stage.camera.fov } : null;
    return doc;
  }

  /** 提交明确指定的实体预览；播放中由 Timeline 提供手动值，绝不扫描整份场景。 */
  commitEntities(entities, label = '修改实体') {
    const app = this.app;
    const json = entities.filter((ent) => app.findEntity(ent.id) === ent).map((ent) => {
      const old = this.store.document.entities.find((e) => e.id === ent.id);
      return ent.toJSON({ parent: old?.parent ?? null, base: app.timeline.baseOf(ent) });
    });
    return this.store.transact(label, (doc) => {
      for (const value of json) {
        const old = doc.entities.find((e) => e.id === value.id);
        if (old) updateDraft(old, value);
      }
    });
  }

  project(next, prev) {
    const a = this.app;
    const old = new Map(prev.entities.map((e) => [e.id, e]));
    const byId = new Map(next.entities.map((e) => [e.id, e]));
    const ctx = { app: a, entity: (id) => byId.get(id), assets: next.assets };
    const changed = next.entities.filter((e) => old.get(e.id) !== e);
    // 结构性新建由动作预先准备；同步事务不能触发资源加载。
    for (const json of changed) {
      if (!a.findEntity(json.id)) throw new Error('实体尚未准备：' + json.id);
    }
    const removed = a.entities.filter((e) => !byId.has(e.id));
    if (removed.some((ent) => ent.id === a.selectedId)) {
      a.gizmo.detach();
      a.selection.highlight(null);
    }
    for (const ent of removed) {
      a.stage.remove(ent.root); a.labels.detach(ent); ent.dispose();
    }
    a.entities = a.entities.filter((e) => byId.has(e.id));
    for (const group of a.entities.filter((e) => e.type === 'group')) {
      for (const member of [...group.members]) if (!byId.has(member.id)) {
        group.removeMember(member); a.labels.detach(member); member.dispose();
      }
    }
    // 先恢复手动值，再建立新的 base。未修改实体的运行时对象不动。
    for (const json of changed) {
      const ent = a.findEntity(json.id);
      ent.applyJSON(json, ctx);
      a.timeline.invalidateBase(ent);
      a.labels.rename(ent);
    }
    if (next.scene !== prev.scene) this.applyScene(next.scene);
    if (next.timeline !== prev.timeline || next.paths !== prev.paths || next.constraints !== prev.constraints || changed.length || removed.length) {
      a.timeline.documentChanged();
    }
    if (changed.length || removed.length) {
      a.emit('entities');
      if (!a.findEntity(a.selectedId)) a.select(null);
      else { a.gizmo.setVisible(a.gizmoShouldShow()); a.selection.highlight(a.selected); }
      a.emit('transform');
    }
    a.stage.invalidate();
  }

  applyScene(s) {
    const a = this.app;
    a.stage.setWorldScale(s.scale);
    a.stage.setWorldPos(...s.pos);
    a.stage.setWorldRot(...s.rot.map((v) => v * Math.PI / 180));
    a.stage.setSkyColor(s.sky);
    a.labels.setVisible(s.labels);
    a.stage.setGroundVisible(s.ground.visible);
    a.stage.setGroundOpacity(s.ground.opacity);
    a.stage.setGroundHeight(s.ground.height);
    a._applyFrame();
    if (s.panorama) {
      a.panorama.setRotation(s.panorama.rotation, { silent: true });
      a.panorama.setRadius(s.panorama.radius, { silent: true });
    } else if (a.panorama.active) a.panorama.clear({ silent: true });
    a._syncPov();
  }

  /** 清空场景专用路径：不经 remove()，因此不连带删截图、不切视角、不 toast。keep 里的实体只摘下、不销毁（加载文档时复用）。 */
  _clearEntities(keep = new Set()) {
    this.app.selectedId = null;
    this.app.selectedIds = new Set();
    this.app.gizmo.detach();
    this.app.selection.highlight(null);
    for (const ent of this.app.entities) {
      this.app.stage.remove(ent.root);
      this.app.labels.detach(ent);
      if (!keep.has(ent)) ent.dispose();
    }
    this.app.entities = [];
  }

  /**
   * 由 serialize.loadDocument 调用：实体与全景都已就绪，同步替换（中间不会渲染出半个场景）。
   * entities 里可能有当前场景复用的实体，apply 把文档值写进它们。
   */
  commitRuntime(doc, entities, panoHandle, { applyView = false, pruneShots = false, apply = [] } = {}) {
    const preview = this.app.preview;
    this.app.endPreview();
    this.app._scenePreview = null;
    this.app.gizmo.cancel();
    const prevSel = this.app.selectedId;
    const transformEditing = this.app.transformEditing;
    this._clearEntities(new Set(entities));
    for (const fn of apply) fn();
    for (const ent of entities) {
      this.app.stage.add(ent.root);
      if (ent.type === 'camera') ent.attachScene(this.app.stage.scene);
      ent.setHelpersVisible(!this.app.cameraView);
      this.app.labels.attach(ent);
      this.app.entities.push(ent);
    }

    const s = doc.scene;
    this.app.documents.applyScene(s);
    this.app.panorama.commit(panoHandle, s.panorama || undefined);
    if (this.app.cameraView && !this.app.findCamera(this.app.activeCameraId)) this.app.setCameraView(false);
    if (applyView) this._applyEditorView(doc.meta.editorView);
    this.app.timeline.documentChanged({ reset: true });
    if (pruneShots) this.app.shots.pruneOrphans();
    this._bumpNameCounters();

    this.app.emit('entities');
    this.app.emit('scene');
    this.app.select(this.app.findEntity(prevSel) ? prevSel : null, { activateTransform: transformEditing }); // id 稳定：撤销后仍选中同一对象
    if (preview && exportCamera(this.app)) this.app.startPreview({ play: false, returnView: preview.cameraView });
    this.app.emit('document', doc);
  }

  /** 应用导演相机视角；文档没存视角时自动取景。 */
  _applyEditorView(view) {
    const { app } = this;
    app.defaultCameraId = null;
    app.directorDetached = true;
    app.stage.camera.fov = view?.fov ?? 40; // 缺字段的旧文件保持旧投影。
    app.stage.camera.updateProjectionMatrix();
    if (!view) { app.frameSubjects(); return; }
    app.rig.applyView(app.stage.camera.position.clone().fromArray(view.pos), app.rig.controls.target.clone().fromArray(view.target), view.fov ?? 40);
    app.restoreDirectorSync(view);
    this.app.rig.saveHome(); // 「重置视角」回到存档时的视角
  }

  /** 起名计数器按已有名字推进（只增不减），避免导入后新建出重名的「角色A」「机位1」。 */
  _bumpNameCounters() {
    const all = this.app.entities.flatMap((e) => [e, ...e.children]);
    const propKind = Object.fromEntries(Object.entries(PROP_LABEL).map(([k, v]) => [v, k]));
    for (const { name } of all) {
      let m;
      const ci = parseCharName(name);
      if (ci >= 0) this.app.charSeq = Math.max(this.app.charSeq, ci + 1);
      else if ((m = /^机位(\d+)$/.exec(name))) this.app._camCount = Math.max(this.app._camCount, +m[1]);
      else if ((m = /^组(\d+)$/.exec(name))) this.app._groupCount = Math.max(this.app._groupCount, +m[1]);
      else if ((m = /^(\D+?)(\d+)$/.exec(name)) && propKind[m[1]]) {
        const k = propKind[m[1]];
        this.app._propCount[k] = Math.max(this.app._propCount[k] || 0, +m[2]);
      }
    }
  }

  load(input, opts = {}) {
    checkRequestState(this.store, opts);
    if (opts.history !== false) this.app.history?.capture();
    // 调用时取得请求副本，调用方随后修改自己的对象不会改变排队任务。
    const snapshot = clone(input);
    const run = async () => {
      this.app.loadingDocument = true;
      try { return await loadDocument(this.app, snapshot, opts); }
      finally { this.app.loadingDocument = false; }
    };
    const pending = this.chain.then(run, run);
    this.chain = pending.catch(() => {});
    return pending;
  }
}

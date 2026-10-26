import * as THREE from 'three';
import { Character } from '../entities/Character.js';
import { Prop } from '../entities/Prop.js';
import { CameraEntity } from '../entities/Camera.js';
import { Crowd } from '../entities/Crowd.js';
import { CAMERA_PRESETS } from '../core/cameraPresets.js';
import { BODY_TYPES, PROP_LABEL, CAMERA_FOV } from '../config.js';
import { worldBox } from '../util/measure.js';
import { toast } from '../util/dom.js';
import { xyz, round6, clone } from '../util/math.js';
import * as edit from '../doc/edit.js';

/** 实体创建、复制及父子结构变更。先准备资源，再提交文档。 */
export class EntityActions {
  constructor(app) { this.app = app; }

  // ---- 新增 ----
  /** A…Z，之后 A2…Z2，依此类推（不会溢出成标点符号）。 */
  _nextCharName() { return edit.charName(this.app.charSeq++); }

  /** 加载一个角色（不入场）。所有角色都经此创建，保证 spec 完整、可复制。 */
  _loadCharacter(spec) { return Character.load(this._nextCharName(), spec); }

  /** 骨骼兼容性校验：缺关节时 console.warn 列出并返回提示文案；完整兼容返回 null。 */
  _rigWarning(c) {
    const miss = c.missingJoints || [];
    if (!miss.length) return null;
    console.warn(`[rig] ${c.profile?.id || '?'}（${c.spec.url}）缺少 ${miss.length} 个关节：`, miss.join(', '));
    return `该模型缺少 ${miss.length} 个关节，相关姿势滑条已禁用`;
  }

  /** 默认落点（edit.spawnPoint）：只改水平位置，y 保留站立基准偏移。入场时按当时的实体数算（并发添加不重叠）。 */
  _placeNew(root) {
    const [x, , z] = edit.spawnPoint(this.app.entities.length);
    root.position.x = x;
    root.position.z = z;
  }

  /** 入场登记：（可选）放置 → 加入场景 → 名牌 → 入列 → 选中 → 提示。 */
  _registerEntity(ent, { place = true, msg } = {}) {
    if (place) this._placeNew(ent.root);
    const change = this.app.store.prepare('添加实体', (doc) => {
      doc.entities.push(ent.toJSON());
      for (const member of ent.children) doc.entities.push(member.toJSON({ parent: ent.id }));
    });
    this.app.stage.add(ent.root);
    this.app.labels.attach(ent);
    this.app.entities.push(ent);
    this.app.store.commit(change);
    this.app.emit('entities');
    this.app.select(ent.id);
    if (msg) toast(msg);
  }

  /** 新建角色：数据由 edit.addCharacter 生成（与 AI 同一份），再按条目建场景对象。 */
  async addCharacter(key) {
    if (!BODY_TYPES[key]) { toast('未知素体：' + key); return null; }
    toast('加载中：' + BODY_TYPES[key].label + ' …');
    const json = edit.addCharacter(this.app.exportDocument({ view: false }), { name: this._nextCharName(), body: key });
    let c;
    try { c = await Character.fromJSON(json); }
    catch (err) { console.error(err); toast('角色加载失败：' + (err?.message || err)); return null; }
    this._registerEntity(c, { msg: this._rigWarning(c) || '已添加：' + c.name });
    return c;
  }

  addProp(kind) {
    this.app._propCount[kind] = (this.app._propCount[kind] || 0) + 1;
    const prop = new Prop(kind, PROP_LABEL[kind] + this.app._propCount[kind]);
    this._registerEntity(prop, { msg: '已添加：' + prop.name });
    return prop;
  }

  // ---- 群众阵列（组）----
  /**
   * 行×列网格生成 N 个男性素体（并行加载，模板只下载一次），挂在一个轴心组下。
   * 数据（夹取 / 网格 / 配色 / 起名）由 edit.addCrowd 生成（与 AI 同一份），再按条目建场景对象。
   */
  async addCrowd(rows = 3, cols = 3, spacing = edit.CROWD_SPACING) {
    const doc = clone(this.app.store.document);
    const res = edit.addCrowd(doc, { rows, cols, spacing, memberName: () => this._nextCharName() });
    toast(`加载群众阵列 ${res.rows}×${res.cols} …`);
    const byId = new Map(doc.entities.map((e) => [e.id, e]));
    let crowd;
    try { crowd = await Crowd.fromJSON(res.group, { app: this.app, assets: {}, entity: (id) => byId.get(id) }); }
    catch (err) { console.error(err); toast('群众加载失败'); return null; }
    Object.assign(crowd, { rows: res.rows, cols: res.cols }); // 阵列规格（会话态，文档里不存）
    this._registerEntity(crowd, { msg: this._rigWarning(crowd.members[0]) || `已添加群众阵列（共 ${crowd.members.length} 人）` });
    return crowd;
  }

  /** 把若干已选角色打成一个组，保留各自世界位姿。 */
  groupCharacters(ids) {
    const members = [...new Set(ids || [])]
      .map((id) => this.app.entities.find((e) => e.id === id))
      .filter((e) => e && e.type === 'character');
    if (members.length < 2) { toast('请至少选择 2 个角色再打组'); return null; }

    this.app.timeline.release(members.map((m) => m.id)); // 先写回手动值，再改父节点
    // 轴心 = 成员 root 的世界中心换算到场景根坐标（场景被整体变换时也能对齐；含素体站立基准偏移，与以往一致）
    const centroid = new THREE.Vector3();
    for (const m of members) centroid.add(m.root.getWorldPosition(new THREE.Vector3()));
    centroid.divideScalar(members.length);
    this.app.stage.world.updateMatrixWorld(true);
    const pivot = xyz(this.app.stage.world.worldToLocal(centroid));
    // 数据（组条目 / 成员相对轴心的 transform）由 edit.groupCharacters 生成（与 AI 同一份），再按条目改父子关系
    const doc = clone(this.app.store.document);
    const res = edit.groupCharacters(doc, members.map((m) => m.id), { name: '组' + (++this.app._groupCount), pivot });
    const change = this._prepareStructure(() => this.app.store.prepareReplacement('打组', doc));
    const group = new THREE.Group();
    const crowd = new Crowd(res.group.name, group, members, {}, res.group.id);
    crowd.applyTransform(res.group.transform);
    this.app.stage.add(group);
    members.forEach((m, i) => { group.add(m.root); m.applyTransform(res.members[i].transform); });
    this.app.entities = this.app.entities.filter((e) => !members.includes(e));
    this.app.entities.push(crowd);
    this.app.labels.attach(crowd);
    this.app.store.commit(change);
    this.app.select(crowd.id);
    toast(`已打组：${members.length} 个角色 → ${crowd.name}`);
    return crowd;
  }

  /** 结构准备失败时恢复 release 暂时移除的动画预览。 */
  _prepareStructure(prepare) {
    try { return prepare(); }
    catch (err) {
      if (this.app.timeline.active) this.app.timeline.evaluate(this.app.timeline.time);
      throw err;
    }
  }

  /** 解组：把群众拆为独立角色（保留各自世界位姿），轴心组移除。 */
  ungroupCrowd(id) {
    const crowd = this.app.entities.find((e) => e.id === id && e.type === 'group');
    if (!crowd) return;
    this.app.timeline.release([crowd.id, ...crowd.members.map((m) => m.id)]); // 先写回手动值，再改父节点
    // 先在独立变换上计算解组后的条目并校验，不能在校验失败前改动父子树。
    const members = crowd.members.map((m) => {
      m.root.updateWorldMatrix(true, false);
      const matrix = new THREE.Matrix4().copy(this.app.stage.world.matrixWorld).invert().multiply(m.root.matrixWorld);
      const root = new THREE.Object3D();
      matrix.decompose(root.position, root.quaternion, root.scale);
      return { ...m.toJSON(), transform: m.transformJSON(root) };
    });
    const change = this._prepareStructure(() => this.app.store.prepare('解组', (doc) => {
      doc.entities = doc.entities.filter((e) => e.id !== crowd.id && !crowd.members.some((m) => m.id === e.id));
      doc.entities.push(...members);
      const anim = edit.pruneAnim({ tracks: doc.timeline.tracks, paths: doc.paths, constraints: doc.constraints }, [crowd.id]);
      const dropped = edit.dropTransformAnim(anim, crowd.members.map((m) => m.id));
      doc.timeline.tracks = dropped.tracks; doc.paths = dropped.paths; doc.constraints = anim.constraints;
    }));
    for (const m of crowd.release()) {
      this.app.stage.world.attach(m.root);
      this.app.entities.push(m);
    }
    this.app.stage.remove(crowd.root);
    this.app.entities.splice(this.app.entities.indexOf(crowd), 1);
    this.app.store.commit(change);
    this.app.emit('entities');
    this.app.select(null);
    toast(`已解组：${crowd.members.length} 个角色已独立`);
  }

  // ---- 机位 ----
  /** 主体取景上下文：选中角色用骨骼包围盒量真实中心/高度，否则取场景中心。 */
  _cameraContext(subject) {
    const center = new THREE.Vector3(0, 0.85, 0);
    let height = 1.7;
    if (subject) {
      const box = worldBox(subject.root, { useBones: true });
      if (!box.isEmpty()) { box.getCenter(center); height = box.getSize(new THREE.Vector3()).y || 1.7; }
    }
    return {
      subjectCenter: center,
      subjectHeight: height,
      directorCamera: this.app.stage.camera,
      directorTarget: this.app.rig.controls.target.clone(),
    };
  }

  addCamera(presetKey) {
    const preset = CAMERA_PRESETS.find((p) => p.key === presetKey) || CAMERA_PRESETS[0];
    const subject = this.app.selected?.type === 'character' ? this.app.selected : null;
    const out = preset.build(this._cameraContext(subject));
    const fov = out.fov || preset.fov || CAMERA_FOV;

    const c = new CameraEntity('机位' + (++this.app._camCount), { fov, aspect: this.app.viewportAspect(), scene: this.app.stage.scene });
    c.root.position.copy(out.position);
    c.rollRad = out.roll || 0;
    c.aimAt(out.target); // 相机约定看向 -Z，叠加荷兰角
    c.setHelpersVisible(!this.app.cameraView); // 机位视角下不应看到相机可视化
    this._registerEntity(c, { place: false, msg: '已添加机位：' + c.name + '（' + preset.label + '）' });
    return c;
  }

  /** 创建副本：角色重新克隆并拷贝位姿/颜色/姿势；道具重建；位置略偏移避免重叠。 */
  async duplicateMany(ids) {
    const sources = (ids || []).map((id) => this.app.findEntity(id)).filter((e) => e && ['character', 'prop'].includes(e.type));
    const json = sources.map((ent) => {
      const value = clone(this.app.store.document.entities.find((e) => e.id === ent.id));
      // 复制当前可见的变换；组成员换算到场景根坐标，不修改源实体。
      ent.root.updateWorldMatrix(true, false);
      const matrix = new THREE.Matrix4().copy(this.app.stage.world.matrixWorld).invert().multiply(ent.root.matrixWorld);
      const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scale = new THREE.Vector3();
      matrix.decompose(pos, rot, scale);
      const opts = ent.docTransformOpts();
      value.transform = { pos: xyz(pos).map((v, i) => round6(v - opts.posOffset[i] + (i === 1 ? 0 : 0.6))), rot: xyz(new THREE.Euler().setFromQuaternion(rot), 180 / Math.PI), scale: xyz(scale).map((v, i) => round6(v / opts.scaleDiv[i])) };
      value.id = edit.newId(this.app.store.document);
      value.name = ent.type === 'character' ? this._nextCharName() : ent.name + '副本';
      if (value.type === 'character') value.parent = null;
      return value;
    });
    json.forEach((value, i) => {
      if (value.type === 'character') value.trailColor = edit.nextTrailColor({ entities: [...this.app.store.document.entities, ...json.slice(0, i)] });
    });
    const revision = this.app.store.revision;
    const results = await Promise.allSettled(json.map((j) => j.type === 'character' ? Character.fromJSON(j) : Prop.fromJSON(j)));
    const copies = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (results.some((r) => r.status === 'rejected') || revision !== this.app.store.revision) {
      copies.forEach((e) => e.dispose());
      toast('复制未完成：场景已改变或模型加载失败，请重试'); return;
    }
    let change;
    try { change = this.app.store.prepare('复制实体', (doc) => { doc.entities.push(...json); }); }
    catch (err) { copies.forEach((e) => e.dispose()); throw err; }
    for (const ent of copies) { this.app.stage.add(ent.root); this.app.labels.attach(ent); this.app.entities.push(ent); }
    this.app.store.commit(change);
    if (copies.length) this.app.select(copies.at(-1).id);
  }

}

import { Playback } from '../src/anim/Playback.js';
// 单测共用：一个不需要浏览器的最小 App 替身 —— 真实的 Prop / CameraEntity 实体（node 里可直接构造）+ Timeline。
import { Prop } from '../src/entities/Prop.js';
import { CameraEntity } from '../src/entities/Camera.js';
import { Timeline } from '../src/anim/Timeline.js';
import { DocumentStore } from '../src/doc/Store.js';

export function fakeApp() {
  const app = {
    entities: [],
    stage: null,
    history: { scheduled: 0, schedule() { this.scheduled++; } },
    findEntity(id) {
      for (const e of app.entities) {
        if (e.id === id) return e;
        for (const m of e.children) if (m.id === id) return m;
      }
      return null;
    },
    exportDocument() { return structuredClone(app.store.document); },
  };
  app.store = new DocumentStore();
  app.timeline = new Timeline(app);
  app.store.project = () => app.timeline.documentChanged();
  app.store.on('change', () => app.history.schedule());
  return app;
}

export function addProp(app, kind = 'box', pos = [0, 0, 0]) {
  const p = new Prop(kind, kind);
  p.applyTransform({ pos, rot: [0, 0, 0], scale: [1, 1, 1] });
  app.entities.push(p);
  app.store.transact('添加道具', (d) => { d.entities.push(p.toJSON()); });
  app.history.scheduled = 0;
  return p;
}

export function addCamera(app, pos = [0, 1.6, 5]) {
  const c = new CameraEntity('机位', {});
  c.applyTransform({ pos, rot: [0, 0, 0], scale: [1, 1, 1] });
  app.entities.push(c);
  app.store.transact('添加机位', (d) => { d.entities.push(c.toJSON()); });
  app.history.scheduled = 0;
  return c;
}

export const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
export const closeVec = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => close(v, b[i], eps));



export function animatedPropFixture() {
  const app = fakeApp(), ent = addProp(app);
  app.playback = new Playback(app.timeline);
  app.store.project = () => {
    const json = app.store.document.entities.find(e => e.id === ent.id);
    ent.applyTransform(json.transform); app.timeline.invalidateBase(ent); app.timeline.documentChanged();
  };
  return {app, ent};
}

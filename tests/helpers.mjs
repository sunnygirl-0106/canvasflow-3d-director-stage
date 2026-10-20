// 单测共用：一个不需要浏览器的最小 App 替身 —— 真实的 Prop / CameraEntity 实体（node 里可直接构造）+ Timeline。
import { Prop } from '../src/entities/Prop.js';
import { CameraEntity } from '../src/entities/Camera.js';
import { Timeline } from '../src/anim/Timeline.js';
import { createEmptyDocument } from '../src/doc/schema.js';

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
    toDocument() {
      const doc = createEmptyDocument();
      doc.entities = app.entities.map((e) => e.toJSON());
      return doc;
    },
  };
  app.timeline = new Timeline(app);
  return app;
}

export function addProp(app, kind = 'box', pos = [0, 0, 0]) {
  const p = new Prop(kind, kind);
  p.applyTransform({ pos, rot: [0, 0, 0], scale: [1, 1, 1] });
  app.entities.push(p);
  return p;
}

export function addCamera(app, pos = [0, 1.6, 5]) {
  const c = new CameraEntity('机位', {});
  c.applyTransform({ pos, rot: [0, 0, 0], scale: [1, 1, 1] });
  app.entities.push(c);
  return c;
}

export const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
export const closeVec = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => close(v, b[i], eps));

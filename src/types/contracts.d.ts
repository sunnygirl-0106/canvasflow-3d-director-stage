import type { Body, PropKind, PosePreset, CameraMove, Ratio } from './vocab.js';
export type Vec3 = [number, number, number];
export type Ease = 'linear' | 'smooth' | 'step';
export interface Transform { pos: Vec3; rot: Vec3; scale: Vec3 }
interface EntityBase { id: string; name: string; visible: boolean; transform: Transform }
export interface CharacterDocument extends EntityBase {
  type: 'character'; body: Body; color: string; parent: string | null;
  pose: { preset: PosePreset | null; values: Record<string, number> };
}
export interface PropDocument extends EntityBase { type: 'prop'; kind: PropKind; color: string }
export interface CameraDocument extends EntityBase { type: 'camera'; fov: number; roll: number; lookAt: Vec3 }
export interface GroupDocument extends EntityBase { type: 'group'; members: string[] }
export type EntityDocument = CharacterDocument | PropDocument | CameraDocument | GroupDocument;
export type Track = { id: string; target: string } & (
  { property: 'fov'; keys: { t: number; value: number; ease: Ease }[] } |
  { property: 'pos' | 'rot' | 'scale'; keys: { t: number; value: Vec3; ease: Ease }[] }
);
export interface PathDocument {
  id: string; target: string; points: Vec3[]; closed: boolean;
  interpolation?: 'centripetal' | 'polyline'; start: number; duration: number;
  waypointTimes?: number[]; timedSegments?: {from:number,to:number,start:number,end:number}[];
  speed: 'linear' | 'smooth'; orient: 'tangent' | 'keep'; stops?: number[]; stopTimes?: number[];
}
export interface ConstraintDocument {
  id: string; type: 'lookAt' | 'follow'; target: string; subject: string | Vec3;
  offset: Vec3; start: number | null; end: number | null;
}
export interface SceneDocument {
  schema: 'director-stage/0.1';
  meta: { name: string; createdAt: string; updatedAt: string; app: string;
    editorView: { pos: Vec3; target: Vec3; fov?: number } | null };
  scene: { scale: number; pos: Vec3; rot: Vec3; sky: string; labels: boolean;
    ground: { visible: boolean; opacity: number; height: number }; ratio: Ratio;
    activeCameraId: string | null; panorama: { assetId: string; rotation: number; radius: number } | null };
  assets: Record<string, { type: 'image'; name: string; url?: string; dataURL?: string }>;
  entities: EntityDocument[]; paths: PathDocument[]; constraints: ConstraintDocument[];
  timeline: { duration: number; fps: number; mainCameraId: string | null; tracks: Track[] };
}
export interface RecoverySnapshot {
  id: string; sessionId: string; sequence: number; storageVersion: 1; savedAt: string; text: string;
}
export interface RecoveryRepository {
  readRecovery(): Promise<RecoverySnapshot[]>;
  writeSnapshot(snapshot: RecoverySnapshot): Promise<RecoverySnapshot>;
  clearRecovery(id: string, expected: Pick<RecoverySnapshot, 'sequence' | 'savedAt'>): Promise<boolean>;
}
export type PathOp = { kind: 'points'; points: Vec3[]; stops?: number[] } |
  { kind: 'line'; to: string | Vec3 } | { kind: 'arc'; center: string | Vec3; sweep?: number; dir?: 'cw' | 'ccw' } |
  { kind: 'toward'; target: string; stop?: number };
export type Op =
  | { op: 'clear' }
  | { op: 'scene'; sky?: string; ground?: { visible?: boolean; height?: number }; ratio?: Ratio; panorama?: 'none' }
  | { op: 'add_character'; name: string; body: Body; pos: Vec3; yaw?: number; pose?: PosePreset; color?: string }
  | { op: 'add_prop'; name: string; kind: PropKind; pos: Vec3; yaw?: number; scale?: number | Vec3; color?: string }
  | { op: 'add_camera'; name: string; pos: Vec3; lookAt: string | Vec3; fov?: number }
  | { op: 'add_group'; name: string; members: string[] }
  | { op: 'add_crowd'; name: string; rows: number; cols: number; spacing?: number; pos: Vec3; yaw?: number; body?: Body }
  | { op: 'remove' | 'clear_path' | 'clear_moves'; target: string }
  | { op: 'move'; target: string; pos?: Vec3; yaw?: number; scale?: number | Vec3 }
  | { op: 'set_pose'; target: string; preset: PosePreset }
  | { op: 'set_path'; target: string; path: PathOp; start?: number; duration?: number; speed?: 'linear' | 'smooth'; orient?: 'tangent' | 'keep' }
  | { op: 'camera_move'; target: string; preset: CameraMove; subject?: string | Vec3; amount?: number; dir?: string; sweep?: number; duration?: number; append?: boolean }
  | { op: 'look_at'; target: string; subject: string | Vec3; start?: number; end?: number }
  | { op: 'follow'; target: string; subject: string; offset?: Vec3; start?: number; end?: number }
  | ({ op: 'keyframe'; target: string; t: number; ease?: Ease } & (
      { property: 'fov'; value: number } | { property: 'pos' | 'rot' | 'scale'; value: Vec3 }))
  | { op: 'timeline'; duration?: number; fps?: number; mainCamera?: string | null };
export type MessageContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } })[];
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: MessageContent }
export interface ChatOptions { signal?: AbortSignal }
export interface ProviderSettings { baseURL: string; apiKey: string; model: string; local?: boolean }
export interface ChatBody { model: string; messages: ChatMessage[]; temperature: number; response_format?: { type: 'json_object' } }
export interface ChatProvider { readonly configured: boolean; chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> }
export interface MockFixture {
  match: string | RegExp | ((input: string, messages: ChatMessage[]) => boolean);
  reply: string | Record<string, unknown> | unknown[] | ((messages: ChatMessage[], n: number) => unknown);
}
export interface ExportCameraSource<T extends { type: string }> {
  timeline: { mainCameraId: string | null }; activeCameraId: string | null; selected: T | null;
  cameras: T[]; findCamera(id: string | null): T | null | undefined;
}

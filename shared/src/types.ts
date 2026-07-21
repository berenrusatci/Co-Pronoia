export type NodeType = 'task' | 'idea' | 'feature' | 'milestone';
export type NodeStatus = 'planned' | 'in_progress' | 'done';

export interface PlanNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  nodeType: NodeType;
  status: NodeStatus;
  x: number | null;
  y: number | null;
  /** Aynı gruptaki bir alt kanvasın id'si; hedef silinirse sarkan bağlantı UI'da "erişilemiyor" olur. */
  linkedCanvasId: string | null;
  /** Serbest uzun not (markdown); başlığa/description'a sığmayan ayrıntı buraya. */
  notes: string;
  /** Düğüme iliştirilen harici bağlantı (yalnız http/https). Boş = yok. */
  url: string;
  /** url'i en son ayarlayan kullanıcının id'si; önizleme yalnız bu kişiye otomatik açılır
   * (başkaları için "Gör"e basmak gerekir). Güvenlik sınırı değil, bir kolaylık sinyalidir —
   * asıl koruma önizlemenin sandbox'lı iframe'de açılmasıdır. */
  urlBy: string | null;
  /** Serbest anahtar-değer özel alanlar (ör. tahmin, sahip). Op JSON'unda kanonik (sıralı anahtar) tutulur. */
  data: Record<string, string>;
  createdCommit: number;
  updatedCommit: number;
}

export type EdgeKind = 'flow' | 'loop' | 'dependency' | 'relation';
export type EdgeDirection = 'directed' | 'bidirectional';

export interface PlanEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  direction: EdgeDirection;
  label: string;
  createdCommit: number;
}

/** Mutable node fields an update_node op may touch. */
export interface NodeFields {
  parentId: string | null;
  title: string;
  description: string;
  nodeType: NodeType;
  status: NodeStatus;
  linkedCanvasId: string | null;
  notes: string;
  url: string;
  urlBy: string | null;
  /** Çakışma tespitinde tek alan sayılır (anahtar başına değil). */
  data: Record<string, string>;
}

export type Op =
  | { op: 'add_node'; node: PlanNode }
  | { op: 'update_node'; id: string; before: Partial<NodeFields>; after: Partial<NodeFields> }
  | { op: 'delete_node'; node: PlanNode }
  | { op: 'move_node'; id: string; before: { x: number | null; y: number | null }; after: { x: number; y: number } }
  | { op: 'add_edge'; edge: PlanEdge }
  | { op: 'delete_edge'; edge: PlanEdge };

/** Client-side intent: the server expands these into full Ops (fills before-fields, cascades). */
export type OpInput =
  | { op: 'add_node'; id?: string; parentId?: string | null; title: string; description?: string; nodeType?: NodeType; status?: NodeStatus; x?: number | null; y?: number | null; linkedCanvasId?: string | null; notes?: string; url?: string; urlBy?: string | null; data?: Record<string, string> }
  | { op: 'update_node'; id: string; fields: Partial<NodeFields> }
  | { op: 'delete_node'; id: string }
  | { op: 'move_node'; id: string; x: number; y: number }
  | { op: 'add_edge'; id?: string; sourceId: string; targetId: string; label?: string; kind?: EdgeKind; direction?: EdgeDirection }
  | { op: 'delete_edge'; id: string };

export interface Commit {
  seq: number;
  message: string;
  createdAt: string;
  ops: Op[];
  author: string | null;
  branchId?: string | null;
}

export interface CommitSummary {
  seq: number;
  message: string;
  createdAt: string;
  opSummary: string;
  author: string | null;
}

/** owner: tek kişi, her şeyi yapar · editor: grafiği düzenler · viewer: salt okunur */
export type CanvasRole = 'owner' | 'editor' | 'viewer';

/** 'plan': normal kanvas · 'co-pronoia': MCP ajanlarının öneri/süpervizör akışıyla planladığı kanvas. */
export type CanvasType = 'plan' | 'co-pronoia';
/** Co-pronoia kanvası yalnızca co-pronoia türündeki bir grupta oluşturulabilir. */
export type GroupType = 'plan' | 'co-pronoia';

export interface CanvasInfo {
  id: string;
  name: string;
  owner: string;
  role: CanvasRole;
  memberCount: number;
  headSeq: number;
  createdAt: string;
  groupId: string | null;
  groupName: string | null;
  type: CanvasType;
}

/** admin: onaylar + davet gönderir · member: yetkileri atanmış özel rolünden (GroupRoleDefInfo) gelir */
export type GroupRole = 'admin' | 'member';
export type GroupMemberStatus = 'pending' | 'approved';
/** Rolün bir grup kanvasına erişim düzeyi. */
export type CanvasAccess = 'none' | 'view' | 'edit';

/** Grup kurucusunun/yetkilinin tanımladığı özel rol ve yetkileri. */
export interface GroupRoleDefInfo {
  id: string;
  name: string;
  canManageMembers: boolean;
  canManageRoles: boolean;
  canCreateCanvas: boolean;
  defaultCanvasAccess: CanvasAccess;
}

export interface GroupInfo {
  id: string;
  name: string;
  type: GroupType;
  myRole: GroupRole;
  myStatus: GroupMemberStatus;
  /** Bu üye bu grupta kanvas oluşturabilir mi (admin ya da rolünün canCreateCanvas yetkisi). */
  canCreateCanvas: boolean;
  memberCount: number;
  pendingCount: number;
  canvasCount: number;
  createdAt: string;
}

export interface GroupMemberInfo {
  userId: string;
  username: string;
  role: GroupRole;
  status: GroupMemberStatus;
  jobTitle: string | null;
  roleDefId: string | null;
  roleDefName: string | null;
  requestedAt: string;
}

export interface MemberInfo {
  userId: string;
  username: string;
  role: CanvasRole;
  joinedAt: string;
}

/** Owner-defined rectangle: only its members (and the owner) may change nodes inside it.
 * memberIds, doğrudan atanan kullanıcılar ile bölgeye erişimli rollerin üyelerinin
 * birleşimi olarak server tarafında genişletilmiş gelir — regionGuard yalnızca bunu okur. */
export interface RegionInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** Owner-written note about the region; the AI agent uses it as context for work inside the region. */
  description: string;
  /** When false, the built-in AI agent may not touch nodes inside this region (independent of user membership). */
  aiAllowed: boolean;
  memberIds: string[];
  memberNames: string[];
  /** Yalnızca doğrudan atanan kullanıcılar (yönetim UI'ının checkbox durumu; memberIds bunun üst kümesi). */
  directMemberIds: string[];
  /** Bölgeye erişimi olan grup rolü id'leri (yönetim UI'ı için; enforcement memberIds üzerinden). */
  roleIds: string[];
}

/**
 * Kanvasın brifing dokümanı ("kanvasın CLAUDE.md'si"): üyelerin ve ajanların uyduğu serbest
 * çalışma notu. Bölgeler gibi kanvas ayarıdır — commit geçmişine girmez, kendi revizyon
 * geçmişini tutar. Editor+ üyeler ve MCP ajanları (update_brief) günceller.
 */
export interface CanvasBriefInfo {
  content: string;
  /** Son revizyonu yazan (kullanıcı adı ya da "ajanEtiketi/rolAdı"); hiç revizyon yoksa null. */
  authorLabel: string | null;
  updatedAt: string | null;
  revisionCount: number;
}

export interface CanvasBriefRevisionInfo {
  id: number;
  content: string;
  authorLabel: string;
  createdAt: string;
}

export interface GraphState {
  nodes: PlanNode[];
  edges: PlanEdge[];
  headSeq: number;
}

/**
 * `sinceSeq`'ten head'e kadarki değişimin farkı (MCP token verimliliği): tüm durumu tekrar
 * çekmek yerine yalnız değişen/eklenen düğüm-kenarlar + silinen id'ler. `sinceSeq >= headSeq`
 * ise tüm listeler boştur (değişiklik yok).
 */
export interface GraphDelta {
  headSeq: number;
  sinceSeq: number;
  changedNodes: PlanNode[];
  deletedNodeIds: string[];
  changedEdges: PlanEdge[];
  deletedEdgeIds: string[];
}

/** Bağlı-kanvas kartındaki mini harita için hafif önizleme (`GET /api/canvases/:id/preview`). */
export interface CanvasPreview {
  id: string;
  name: string;
  nodeCount: number;
  doneCount: number;
  /** Yalnızca konumu olan düğümler (mini harita noktaları). */
  nodes: { x: number; y: number; status: NodeStatus }[];
  /** `nodes` dizisindeki index çiftleri. */
  edges: [number, number][];
}

// ---------- Co-Pronoia: MCP ajan rolleri, anahtarları ve plan önerileri ----------

/** Ajan rol tanımı: site şablonu (scope 'site', admin yönetir) ya da gruba özel (scope 'group'). */
export interface AgentRoleInfo {
  id: string;
  name: string;
  /** Bağlanan ajana get_brief aracıyla brifing olarak servis edilen persona/görev metni. */
  persona: string;
  /** Süpervizör rolü: önerileri onaylar/reddeder; onaysız hiçbir öneri main'e inmez. */
  isSupervisor: boolean;
  scope: 'site' | 'group';
  createdAt: string;
}

/** Kanvas + role bağlı MCP erişim anahtarı (ham değer yalnızca oluşturma yanıtında döner). */
export interface AgentTokenInfo {
  id: string;
  label: string;
  roleId: string;
  roleName: string;
  isSupervisor: boolean;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export type ProposalStatus = 'submitted' | 'changes_requested' | 'withdrawn' | 'rejected' | 'applied';

/** Bir ajanın plan önerisi; intents içeriği yalnızca detay uçlarında/araçlarında döner. */
export interface PlanProposalInfo {
  id: string;
  agentLabel: string;
  roleName: string;
  title: string;
  summary: string;
  intentCount: number;
  baseSeq: number;
  status: ProposalStatus;
  supervisorNote: string;
  decidedByLabel: string | null;
  appliedCommitSeq: number | null;
  branchName: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- Site yönetim paneli (yalnızca isAdmin kullanıcılar) ----------

export interface AdminStats {
  userCount: number;
  canvasCount: number;
  groupCount: number;
  commitCount: number;
  /** expiresAt > şimdi olan oturum sayısı. */
  activeSessionCount: number;
  /** Son 7 günde kayıt olan kullanıcı sayısı. */
  newUsers7d: number;
}

export interface AdminUserInfo {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  createdAt: string;
  ownedCanvasCount: number;
  membershipCount: number;
  groupCount: number;
  sessionCount: number;
  lastCommitAt: string | null;
}

export interface AdminCanvasInfo {
  id: string;
  name: string;
  ownerId: string;
  owner: string;
  memberCount: number;
  commitCount: number;
  groupId: string | null;
  groupName: string | null;
  createdAt: string;
}

export interface AdminGroupInfo {
  id: string;
  name: string;
  memberCount: number;
  pendingCount: number;
  canvasCount: number;
  createdAt: string;
}

/**
 * Giriş ekranının adminden yönetilen görünümü. Oturum açmadan da okunur (`/api/site/appearance`),
 * bu yüzden içinde yalnızca herkese açık olması amaçlanan alanlar bulunur.
 */
export interface SiteAppearance {
  /** Giriş ekranındaki önizleme görselinin adresi; null ise paketle gelen örnek gösterilir. */
  loginPreview: string | null;
}

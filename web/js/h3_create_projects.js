export const H3_CREATE_PROJECT_STORE_VERSION = 1;

export function cloneH3ProjectValue(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function projectId(value) {
  return String(value || "").trim().replace(/[^0-9A-Za-z_-]+/g, "_")
    .slice(0, 80).replace(/^_+|_+$/g, "");
}

function nextProjectId(store, makeId) {
  const used = new Set((store.projects || []).map((project) => project.id));
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = projectId(typeof makeId === "function" ? makeId() : "");
    if (id && !used.has(id)) return id;
  }
  let suffix = Date.now().toString(36);
  let id = "h3_" + suffix;
  while (used.has(id)) id = "h3_" + suffix + "_" + Math.random().toString(36).slice(2, 8);
  return id;
}

function nextUntitledName(store) {
  const used = new Set((store.projects || []).map((project) => String(project.name || "")));
  let index = 1;
  while (used.has("未命名成片" + index)) index++;
  return "未命名成片" + index;
}

function normalizeState(value, fallback) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  const normalized = cloneH3ProjectValue(state && typeof state === "object" ? state : {}) || {};
  if (!Array.isArray(normalized.segments) || !normalized.segments.length) {
    const fallbackSegments = fallback && Array.isArray(fallback.segments) ? fallback.segments : [];
    normalized.segments = cloneH3ProjectValue(fallbackSegments) || [];
  }
  return normalized;
}

function makeProject(id, name, state, now, selectedSegment = 0) {
  return {
    id,
    name: String(name || "").trim(),
    created_at: Number(now) || Date.now(),
    updated_at: Number(now) || Date.now(),
    selected_segment: Math.max(0, Math.round(Number(selectedSegment) || 0)),
    state: normalizeState(state, state),
    clear_backup: null,
  };
}

export function getH3Project(store, id) {
  if (!store || !Array.isArray(store.projects)) return null;
  return store.projects.find((project) => project && project.id === id) || null;
}

export function createH3ProjectStore(raw, requestedActiveId, legacyId, legacyState, makeId, now = Date.now()) {
  const store = { version: H3_CREATE_PROJECT_STORE_VERSION, projects: [] };
  const used = new Set();
  const rawProjects = raw && Array.isArray(raw.projects) ? raw.projects : [];
  for (const source of rawProjects) {
    if (!source || typeof source !== "object") continue;
    let id = projectId(source.id);
    if (!id || used.has(id)) id = nextProjectId(store, makeId);
    used.add(id);
    const project = makeProject(
      id,
      source.name || "未命名成片" + (store.projects.length + 1),
      source.state,
      Number(source.created_at) || now,
      source.selected_segment,
    );
    project.updated_at = Number(source.updated_at) || project.created_at;
    if (source.clear_backup && typeof source.clear_backup === "object") {
      project.clear_backup = {
        state: normalizeState(source.clear_backup.state, project.state),
        selected_segment: Math.max(0, Math.round(Number(source.clear_backup.selected_segment) || 0)),
        created_at: Number(source.clear_backup.created_at) || project.updated_at,
      };
    }
    store.projects.push(project);
  }

  const migrated = store.projects.length === 0;
  if (migrated) {
    let id = projectId(legacyId);
    if (!id) id = nextProjectId(store, makeId);
    store.projects.push(makeProject(id, "未命名成片1", legacyState, now));
  }

  const requested = projectId(requestedActiveId);
  const legacy = projectId(legacyId);
  const active = getH3Project(store, requested) || getH3Project(store, legacy) || store.projects[0];
  return { store, activeId: active.id, migrated };
}

export function saveH3Project(store, id, state, selectedSegment, now = Date.now()) {
  const project = getH3Project(store, id);
  if (!project) return store;
  project.state = normalizeState(state, project.state);
  project.selected_segment = Math.max(0, Math.round(Number(selectedSegment) || 0));
  project.updated_at = Number(now) || Date.now();
  return store;
}

export function addH3Project(store, name, state, makeId, now = Date.now()) {
  const id = nextProjectId(store, makeId);
  const project = makeProject(id, String(name || "").trim() || nextUntitledName(store), state, now);
  store.projects.push(project);
  return { store, project };
}

export function duplicateH3Project(store, id, makeId, now = Date.now()) {
  const source = getH3Project(store, id);
  if (!source) return { store, project: null };
  const state = normalizeState(source.state, source.state);
  state.timeline_videos = [];
  const project = makeProject(nextProjectId(store, makeId), source.name + " 副本", state, now, source.selected_segment);
  store.projects.push(project);
  return { store, project };
}

export function renameH3Project(store, id, name, now = Date.now()) {
  const project = getH3Project(store, id);
  if (!project) return store;
  project.name = String(name || "").trim() || nextUntitledName(store);
  project.updated_at = Number(now) || Date.now();
  return store;
}

export function deleteH3Project(store, id, _fallbackState, _makeId, _now = Date.now()) {
  if (!store || !Array.isArray(store.projects) || store.projects.length <= 1) {
    return { store, activeId: store && store.projects && store.projects[0] ? store.projects[0].id : "", deleted: false };
  }
  const index = store.projects.findIndex((project) => project.id === id);
  if (index < 0) return { store, activeId: store.projects[0].id, deleted: false };
  store.projects.splice(index, 1);
  const next = store.projects[Math.min(index, store.projects.length - 1)];
  return { store, activeId: next.id, deleted: true };
}

export function backupH3Project(store, id, state, selectedSegment, now = Date.now()) {
  const project = getH3Project(store, id);
  if (!project) return store;
  project.clear_backup = {
    state: normalizeState(state, project.state),
    selected_segment: Math.max(0, Math.round(Number(selectedSegment) || 0)),
    created_at: Number(now) || Date.now(),
  };
  project.updated_at = Number(now) || Date.now();
  return store;
}

export function restoreH3ProjectBackup(store, id, now = Date.now()) {
  const project = getH3Project(store, id);
  if (!project || !project.clear_backup) {
    return { store, state: null, selectedSegment: 0, restored: false };
  }
  const state = normalizeState(project.clear_backup.state, project.state);
  const selectedSegment = Math.max(0, Math.round(Number(project.clear_backup.selected_segment) || 0));
  project.state = normalizeState(state, project.state);
  project.selected_segment = selectedSegment;
  project.clear_backup = null;
  project.updated_at = Number(now) || Date.now();
  return { store, state, selectedSegment, restored: true };
}

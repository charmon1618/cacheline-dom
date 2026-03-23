/**
 * Node Pool — flat array backing for all DOM nodes.
 *
 * Every Node in the DOM lives in this pool. Tree links are Int32Array columns.
 * Generational handles detect use-after-remove: removing a node bumps its
 * generation, so any outstanding reference to that slot becomes stale.
 *
 * Handle layout: [gen:8 | index:24] packed into a uint32.
 * - 16M nodes max (24-bit index)
 * - 256 generations before wrap (8-bit counter)
 */

const INITIAL_CAPACITY = 8192;
const MAX_CAPACITY = 524288;  // 512K slots

// Index 0 reserved as null sentinel. Zero-filled Int32Array = no link.
export const NONE = 0;
export const HANDLE_INVALID = 0xFFFFFFFF;
const INDEX_MASK = 0x00FFFFFF;
const GEN_SHIFT = 24;

// Node types (W3C DOM spec values)
export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;
export const DOCUMENT_FRAGMENT_NODE = 11;

export interface NodePool {
  // Proxy cache for node identity
  _proxyCache: Map<number, any>;

  // Tree structure (Int32Array — indices, not pointers)
  parent: Int32Array;
  firstChild: Int32Array;
  lastChild: Int32Array;
  nextSibling: Int32Array;
  prevSibling: Int32Array;

  // Generational handles
  generation: Uint8Array;

  // Node data
  nodeType: Uint8Array;
  nodeName: (string | null)[];     // tagName for elements, '#text' for text, etc.
  nodeValue: (string | null)[];    // text content for Text/Comment, null for Element
  namespaceURI: (string | null)[];

  // Element-specific
  attributes: (Map<string, string> | null)[];  // attr name → value
  className: (string | null)[];

  // Bookkeeping
  count: number;
  capacity: number;
  freeHead: number;
  freeList: Int32Array;
}

export function createPool(initialCapacity: number = INITIAL_CAPACITY): NodePool {
  const cap = Math.max(initialCapacity, 64);
  return {
    _proxyCache: new Map(),
    parent: new Int32Array(cap),
    firstChild: new Int32Array(cap),
    lastChild: new Int32Array(cap),
    nextSibling: new Int32Array(cap),
    prevSibling: new Int32Array(cap),
    generation: new Uint8Array(cap),
    nodeType: new Uint8Array(cap),
    nodeName: new Array(cap).fill(null),
    nodeValue: new Array(cap).fill(null),
    namespaceURI: new Array(cap).fill(null),
    attributes: new Array(cap).fill(null),
    className: new Array(cap).fill(null),
    count: 1, // slot 0 reserved
    capacity: cap,
    freeHead: NONE,
    freeList: new Int32Array(cap),
  };
}

// ── Handle ops ─────────────────────────────────────────────

export function packHandle(gen: number, index: number): number {
  return (((gen & 0xFF) << GEN_SHIFT) | (index & INDEX_MASK)) >>> 0;
}

export function handleIndex(handle: number): number {
  return handle & INDEX_MASK;
}

export function handleGen(handle: number): number {
  return (handle >>> GEN_SHIFT) & 0xFF;
}

export function validateHandle(pool: NodePool, handle: number): number {
  if (handle === HANDLE_INVALID) return NONE;
  const index = handle & INDEX_MASK;
  const gen = (handle >>> GEN_SHIFT) & 0xFF;
  if (index === NONE || index >= pool.count) return NONE;
  if (pool.generation[index] !== gen) return NONE; // stale
  return index;
}

// ── Alloc / Free ───────────────────────────────────────────

export function alloc(pool: NodePool): number {
  let idx: number;
  if (pool.freeHead !== NONE) {
    idx = pool.freeHead;
    pool.freeHead = pool.freeList[idx];
  } else {
    if (pool.count >= pool.capacity) grow(pool);
    idx = pool.count++;
  }
  // Reset tree links (all zero = NONE, already correct for fresh slots)
  pool.parent[idx] = NONE;
  pool.firstChild[idx] = NONE;
  pool.lastChild[idx] = NONE;
  pool.nextSibling[idx] = NONE;
  pool.prevSibling[idx] = NONE;
  return idx;
}

export function freeSlot(pool: NodePool, idx: number): void {
  // Bump generation — stale handles detect this
  pool.generation[idx] = (pool.generation[idx] + 1) & 0xFF;
  // Null out GC refs
  pool.nodeName[idx] = null;
  pool.nodeValue[idx] = null;
  pool.namespaceURI[idx] = null;
  pool.attributes[idx] = null;
  pool.className[idx] = null;
  // Push to free list
  pool.freeList[idx] = pool.freeHead;
  pool.freeHead = idx;
}

function grow(pool: NodePool): void {
  if (pool.capacity >= MAX_CAPACITY) throw new Error('NodePool at max capacity');
  const newCap = Math.min(pool.capacity * 2, MAX_CAPACITY);
  const g = <T extends Int32Array | Uint8Array>(old: T): T => {
    const arr = new (old.constructor as new (n: number) => T)(newCap);
    arr.set(old);
    return arr;
  };
  pool.parent = g(pool.parent);
  pool.firstChild = g(pool.firstChild);
  pool.lastChild = g(pool.lastChild);
  pool.nextSibling = g(pool.nextSibling);
  pool.prevSibling = g(pool.prevSibling);
  pool.generation = g(pool.generation);
  pool.nodeType = g(pool.nodeType);
  pool.freeList = g(pool.freeList);
  const r = <T>(old: T[]): T[] => {
    const arr = new Array<T>(newCap).fill(null as T);
    for (let i = 0; i < pool.capacity; i++) arr[i] = old[i];
    return arr;
  };
  pool.nodeName = r(pool.nodeName);
  pool.nodeValue = r(pool.nodeValue);
  pool.namespaceURI = r(pool.namespaceURI);
  pool.attributes = r(pool.attributes);
  pool.className = r(pool.className);
  pool.capacity = newCap;
}

// ── Tree ops (same as cacheline-react node-store) ──────────

export function appendChild(pool: NodePool, parentIdx: number, childIdx: number): void {
  detach(pool, childIdx);
  pool.parent[childIdx] = parentIdx;
  pool.nextSibling[childIdx] = NONE;
  const last = pool.lastChild[parentIdx];
  if (last === NONE) {
    pool.firstChild[parentIdx] = childIdx;
    pool.prevSibling[childIdx] = NONE;
  } else {
    pool.nextSibling[last] = childIdx;
    pool.prevSibling[childIdx] = last;
  }
  pool.lastChild[parentIdx] = childIdx;
}

export function insertBefore(pool: NodePool, parentIdx: number, childIdx: number, refIdx: number): void {
  if (childIdx === refIdx) return;
  detach(pool, childIdx);
  pool.parent[childIdx] = parentIdx;
  const prev = pool.prevSibling[refIdx];
  pool.prevSibling[childIdx] = prev;
  pool.nextSibling[childIdx] = refIdx;
  pool.prevSibling[refIdx] = childIdx;
  if (prev === NONE) pool.firstChild[parentIdx] = childIdx;
  else pool.nextSibling[prev] = childIdx;
}

export function removeChild(pool: NodePool, parentIdx: number, childIdx: number): void {
  detach(pool, childIdx);
  // Free the entire subtree
  freeSubtree(pool, childIdx);
}

export function detach(pool: NodePool, idx: number): void {
  const par = pool.parent[idx];
  if (par === NONE) return;
  const prev = pool.prevSibling[idx];
  const next = pool.nextSibling[idx];
  if (prev === NONE) pool.firstChild[par] = next;
  else pool.nextSibling[prev] = next;
  if (next === NONE) pool.lastChild[par] = prev;
  else pool.prevSibling[next] = prev;
  pool.parent[idx] = NONE;
  pool.prevSibling[idx] = NONE;
  pool.nextSibling[idx] = NONE;
}

function freeSubtree(pool: NodePool, root: number): void {
  let cur = root;
  while (true) {
    const child = pool.firstChild[cur];
    if (child !== NONE) { cur = child; continue; }
    while (true) {
      const next = pool.nextSibling[cur];
      const par = pool.parent[cur];
      freeSlot(pool, cur);
      if (cur === root) return;
      if (next !== NONE) { cur = next; break; }
      cur = par;
    }
  }
}

export function replaceChild(pool: NodePool, parentIdx: number, newIdx: number, oldIdx: number): void {
  insertBefore(pool, parentIdx, newIdx, oldIdx);
  removeChild(pool, parentIdx, oldIdx);
}

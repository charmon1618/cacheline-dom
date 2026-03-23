/**
 * W3C DOM Node proxies — thin wrappers around pool handles.
 *
 * Every CLNode holds a [gen:8|index:24] handle. Property access validates
 * the handle against the pool's generation array. Stale handles return null
 * for traversal props and throw for mutations — same as accessing a removed
 * DOM node in a real browser.
 */

import {
  type NodePool,
  NONE, HANDLE_INVALID,
  ELEMENT_NODE, TEXT_NODE, COMMENT_NODE, DOCUMENT_NODE, DOCUMENT_FRAGMENT_NODE,
  packHandle, handleIndex, validateHandle,
  alloc, appendChild as poolAppendChild, insertBefore as poolInsertBefore,
  removeChild as poolRemoveChild, replaceChild as poolReplaceChild, detach,
} from './pool.js';

function getOrCreateProxy(pool: NodePool, idx: number): CLNode {
  if (idx === NONE) return null as any;
  const existing = pool._proxyCache[idx];
  if (existing) {
    existing._handle = packHandle(pool.generation[idx], idx);
    return existing;
  }
  const handle = packHandle(pool.generation[idx], idx);
  let node: CLNode;
  switch (pool.nodeType[idx]) {
    case ELEMENT_NODE: node = new CLElement(pool, handle); break;
    case TEXT_NODE: node = new CLText(pool, handle); break;
    case COMMENT_NODE: node = new CLComment(pool, handle); break;
    case DOCUMENT_NODE: node = new CLDocument(pool, handle); break;
    case DOCUMENT_FRAGMENT_NODE: node = new CLDocumentFragment(pool, handle); break;
    default: node = new CLNode(pool, handle); break;
  }
  pool._proxyCache[idx] = node;
  return node;
}

export function clearProxyCache(pool: NodePool, idx: number): void {
  pool._proxyCache[idx] = null;
}

/** Sync cached proxy pointers for a node and its neighbors after tree mutation. */
function syncProxyLinks(pool: NodePool, idx: number): void {
  const proxy = pool._proxyCache[idx] as CLNode | null;
  if (!proxy) return;
  const par = pool.parent[idx];
  proxy._parentProxy = par !== NONE ? (pool._proxyCache[par] || getOrCreateProxy(pool, par)) : null;
  const ns = pool.nextSibling[idx];
  proxy._nextSibProxy = ns !== NONE ? (pool._proxyCache[ns] || getOrCreateProxy(pool, ns)) : null;
  const ps = pool.prevSibling[idx];
  proxy._prevSibProxy = ps !== NONE ? (pool._proxyCache[ps] || getOrCreateProxy(pool, ps)) : null;
}

function syncParentChildLinks(pool: NodePool, parentIdx: number): void {
  const parentProxy = pool._proxyCache[parentIdx] as CLNode | null;
  if (!parentProxy) return;
  const fc = pool.firstChild[parentIdx];
  parentProxy._firstChildProxy = fc !== NONE ? (pool._proxyCache[fc] || getOrCreateProxy(pool, fc)) : null;
  const lc = pool.lastChild[parentIdx];
  parentProxy._lastChildProxy = lc !== NONE ? (pool._proxyCache[lc] || getOrCreateProxy(pool, lc)) : null;
}

// ── CLNode (base) ──────────────────────────────────────────

export class CLNode {
  readonly _pool: NodePool;
  readonly _idx: number;
  _handle: number;
  // Cached traversal pointers — updated by tree mutations, read with zero overhead
  _parentProxy: CLNode | null = null;
  _firstChildProxy: CLNode | null = null;
  _lastChildProxy: CLNode | null = null;
  _nextSibProxy: CLNode | null = null;
  _prevSibProxy: CLNode | null = null;

  constructor(pool: NodePool, handle: number) {
    this._pool = pool;
    this._handle = handle;
    this._idx = handle & 0x00FFFFFF;
  }

  /** Validate handle for mutations (throws if stale). */
  private _mutIdx(): number {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) throw new DOMException('Node is no longer in the document', 'InvalidStateError');
    return idx;
  }

  get nodeType(): number { return this._pool.nodeType[this._idx]; }
  get nodeName(): string { return this._pool.nodeName[this._idx] || ''; }

  get nodeValue(): string | null {
    return this._pool.nodeValue[this._idx];
  }
  set nodeValue(v: string | null) {
    this._mutIdx();
    this._pool.nodeValue[this._idx] = v;
  }

  get textContent(): string | null {
    const idx = this._idx;
    const pool = this._pool;
    if (pool.nodeType[idx] === TEXT_NODE || pool.nodeType[idx] === COMMENT_NODE) {
      return pool.nodeValue[idx];
    }
    // For elements: concatenate all descendant text
    let result = '';
    const collectText = (i: number) => {
      let child = pool.firstChild[i];
      while (child !== NONE) {
        if (pool.nodeType[child] === TEXT_NODE) result += pool.nodeValue[child] || '';
        else collectText(child);
        child = pool.nextSibling[child];
      }
    };
    collectText(idx);
    return result;
  }
  set textContent(v: string | null) {
    this._mutIdx();
    const pool = this._pool;
    if (pool.nodeType[this._idx] === TEXT_NODE || pool.nodeType[this._idx] === COMMENT_NODE) {
      pool.nodeValue[this._idx] = v;
      return;
    }
    // Remove all children via proxy-aware removeChild
    // Read from pool directly (not cached proxy) to ensure we see current state
    while (pool.firstChild[this._idx] !== NONE) {
      const childIdx = pool.firstChild[this._idx];
      const childProxy = pool._proxyCache[childIdx] || getOrCreateProxy(pool, childIdx);
      this.removeChild(childProxy);
    }
    if (v) {
      // Create text node and append via proxy-aware appendChild
      const doc = this.ownerDocument;
      if (doc) {
        this.appendChild(doc.createTextNode(v));
      } else {
        // Fallback: direct pool ops + sync
        const textIdx = alloc(pool);
        pool.nodeType[textIdx] = TEXT_NODE;
        pool.nodeName[textIdx] = '#text';
        pool.nodeValue[textIdx] = v;
        poolAppendChild(pool, this._idx, textIdx);
        syncParentChildLinks(pool, this._idx);
        syncProxyLinks(pool, textIdx);
      }
    }
  }

  get parentNode(): CLNode | null { return this._parentProxy; }

  get parentElement(): CLElement | null {
    const p = this._parentProxy;
    return (p && p.nodeType === ELEMENT_NODE) ? p as CLElement : null;
  }

  get firstChild(): CLNode | null { return this._firstChildProxy; }
  get lastChild(): CLNode | null { return this._lastChildProxy;
    return getOrCreateProxy(this._pool, child);
  }

  get nextSibling(): CLNode | null { return this._nextSibProxy; }
  get previousSibling(): CLNode | null { return this._prevSibProxy; }

  get childNodes(): CLNode[] {
    const idx = this._idx;
    if (idx === NONE) return [];
    const result: CLNode[] = [];
    let child = this._pool.firstChild[idx];
    while (child !== NONE) {
      result.push(getOrCreateProxy(this._pool, child));
      child = this._pool.nextSibling[child];
    }
    return result;
  }

  get ownerDocument(): CLDocument | null {
    // Walk up to root
    let idx = this._idx;
    if (idx === NONE) return null;
    while (this._pool.parent[idx] !== NONE) idx = this._pool.parent[idx];
    if (this._pool.nodeType[idx] === DOCUMENT_NODE) return getOrCreateProxy(this._pool, idx) as CLDocument;
    return null;
  }

  get isConnected(): boolean {
    let idx = this._idx;
    if (idx === NONE) return false;
    while (this._pool.parent[idx] !== NONE) idx = this._pool.parent[idx];
    return this._pool.nodeType[idx] === DOCUMENT_NODE;
  }

  hasChildNodes(): boolean {
    const idx = this._idx;
    return idx !== NONE && this._pool.firstChild[idx] !== NONE;
  }

  appendChild(child: CLNode): CLNode {
    const parentIdx = this._mutIdx();
    const childIdx = child._idx;
    const pool = this._pool;
    // Track old neighbors for sync
    const oldPrev = pool.prevSibling[childIdx];
    const oldNext = pool.nextSibling[childIdx];
    const oldParent = pool.parent[childIdx];
    const oldLast = pool.lastChild[parentIdx];

    poolAppendChild(pool, parentIdx, childIdx);

    // Sync proxy caches
    syncProxyLinks(pool, childIdx);
    if (oldPrev) syncProxyLinks(pool, oldPrev);
    if (oldNext) syncProxyLinks(pool, oldNext);
    if (oldLast) syncProxyLinks(pool, oldLast);
    if (oldParent && oldParent !== parentIdx) syncParentChildLinks(pool, oldParent);
    syncParentChildLinks(pool, parentIdx);
    return child;
  }

  insertBefore(newNode: CLNode, refNode: CLNode | null): CLNode {
    const parentIdx = this._mutIdx();
    const pool = this._pool;
    const newIdx = newNode._idx;
    if (!refNode) {
      return this.appendChild(newNode);
    }
    const refIdx = refNode._idx;
    const oldPrev = pool.prevSibling[newIdx];
    const oldNext = pool.nextSibling[newIdx];
    const oldParent = pool.parent[newIdx];

    poolInsertBefore(pool, parentIdx, newIdx, refIdx);

    syncProxyLinks(pool, newIdx);
    syncProxyLinks(pool, refIdx);
    if (oldPrev) syncProxyLinks(pool, oldPrev);
    if (oldNext) syncProxyLinks(pool, oldNext);
    if (oldParent && oldParent !== parentIdx) syncParentChildLinks(pool, oldParent);
    syncParentChildLinks(pool, parentIdx);
    return newNode;
  }

  removeChild(child: CLNode): CLNode {
    this._mutIdx();
    const pool = this._pool;
    const childIdx = child._idx;
    const parentIdx = pool.parent[childIdx];
    const prevSib = pool.prevSibling[childIdx];
    const nextSib = pool.nextSibling[childIdx];

    detach(pool, childIdx);

    // Sync
    child._parentProxy = null;
    child._nextSibProxy = null;
    child._prevSibProxy = null;
    if (prevSib) syncProxyLinks(pool, prevSib);
    if (nextSib) syncProxyLinks(pool, nextSib);
    if (parentIdx) syncParentChildLinks(pool, parentIdx);
    return child;
  }

  replaceChild(newChild: CLNode, oldChild: CLNode): CLNode {
    const parentIdx = this._mutIdx();
    this.insertBefore(newChild, oldChild);
    this.removeChild(oldChild);
    return oldChild;
  }

  cloneNode(deep: boolean = false): CLNode {
    const idx = this._mutIdx();
    const pool = this._pool;
    const newIdx = alloc(pool);
    pool.nodeType[newIdx] = pool.nodeType[idx];
    pool.nodeName[newIdx] = pool.nodeName[idx];
    pool.nodeValue[newIdx] = pool.nodeValue[idx];
    pool.namespaceURI[newIdx] = pool.namespaceURI[idx];
    pool.className[newIdx] = pool.className[idx];
    if (pool.attributes[idx]) {
      pool.attributes[newIdx] = new Map(pool.attributes[idx]!);
    }
    if (deep) {
      let child = pool.firstChild[idx];
      while (child !== NONE) {
        const childProxy = getOrCreateProxy(pool, child);
        const cloned = childProxy.cloneNode(true);
        poolAppendChild(pool, newIdx, (cloned as any)._idx);
        child = pool.nextSibling[child];
      }
    }
    return getOrCreateProxy(pool, newIdx);
  }

  contains(other: CLNode | null): boolean {
    if (!other) return false;
    let idx = other._idx;
    const myIdx = this._idx;
    if (idx === NONE || myIdx === NONE) return false;
    while (idx !== NONE) {
      if (idx === myIdx) return true;
      idx = this._pool.parent[idx];
    }
    return false;
  }

  isSameNode(other: CLNode | null): boolean {
    if (!other) return false;
    return this._handle === other._handle;
  }
}

// ── CLElement ──────────────────────────────────────────────

export class CLElement extends CLNode {
  get tagName(): string { return (this._pool.nodeName[validateHandle(this._pool, this._handle)] || '').toUpperCase(); }
  get localName(): string { return this._pool.nodeName[validateHandle(this._pool, this._handle)] || ''; }

  get id(): string { return this.getAttribute('id') || ''; }
  set id(v: string) { this.setAttribute('id', v); }

  get className(): string {
    return this._pool.className[validateHandle(this._pool, this._handle)] || '';
  }
  set className(v: string) {
    this._pool.className[validateHandle(this._pool, this._handle)] = v;
  }

  get innerHTML(): string {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return '';
    return serializeChildren(this._pool, idx);
  }
  set innerHTML(html: string) {
    // Minimal: just set text content for now
    this.textContent = html; // TODO: parse HTML
  }

  get outerHTML(): string {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return '';
    return serializeNode(this._pool, idx);
  }

  get children(): CLElement[] {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return [];
    const result: CLElement[] = [];
    let child = this._pool.firstChild[idx];
    while (child !== NONE) {
      if (this._pool.nodeType[child] === ELEMENT_NODE) {
        result.push(getOrCreateProxy(this._pool, child) as CLElement);
      }
      child = this._pool.nextSibling[child];
    }
    return result;
  }

  get childElementCount(): number { return this.children.length; }

  get firstElementChild(): CLElement | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    let child = this._pool.firstChild[idx];
    while (child !== NONE) {
      if (this._pool.nodeType[child] === ELEMENT_NODE) return getOrCreateProxy(this._pool, child) as CLElement;
      child = this._pool.nextSibling[child];
    }
    return null;
  }

  get lastElementChild(): CLElement | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    let child = this._pool.lastChild[idx];
    while (child !== NONE) {
      if (this._pool.nodeType[child] === ELEMENT_NODE) return getOrCreateProxy(this._pool, child) as CLElement;
      child = this._pool.prevSibling[child];
    }
    return null;
  }

  get nextElementSibling(): CLElement | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    let sib = this._pool.nextSibling[idx];
    while (sib !== NONE) {
      if (this._pool.nodeType[sib] === ELEMENT_NODE) return getOrCreateProxy(this._pool, sib) as CLElement;
      sib = this._pool.nextSibling[sib];
    }
    return null;
  }

  get previousElementSibling(): CLElement | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    let sib = this._pool.prevSibling[idx];
    while (sib !== NONE) {
      if (this._pool.nodeType[sib] === ELEMENT_NODE) return getOrCreateProxy(this._pool, sib) as CLElement;
      sib = this._pool.prevSibling[sib];
    }
    return null;
  }

  getAttribute(name: string): string | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    const attrs = this._pool.attributes[idx];
    return attrs?.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return;
    if (!this._pool.attributes[idx]) this._pool.attributes[idx] = new Map();
    this._pool.attributes[idx]!.set(name, value);
    if (name === 'class') this._pool.className[idx] = value;
  }

  removeAttribute(name: string): void {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return;
    this._pool.attributes[idx]?.delete(name);
    if (name === 'class') this._pool.className[idx] = null;
  }

  hasAttribute(name: string): boolean {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return false;
    return this._pool.attributes[idx]?.has(name) ?? false;
  }

  hasAttributes(): boolean {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return false;
    const attrs = this._pool.attributes[idx];
    return attrs !== null && attrs.size > 0;
  }

  getAttributeNames(): string[] {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return [];
    return Array.from(this._pool.attributes[idx]?.keys() ?? []);
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    if (force !== undefined) {
      if (force) { this.setAttribute(name, ''); return true; }
      else { this.removeAttribute(name); return false; }
    }
    if (this.hasAttribute(name)) { this.removeAttribute(name); return false; }
    this.setAttribute(name, ''); return true;
  }

  matches(selector: string): boolean {
    // Minimal: support tag, #id, .class
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.localName === selector.toLowerCase();
  }

  querySelector(selector: string): CLElement | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    return queryFirst(this._pool, idx, selector);
  }

  querySelectorAll(selector: string): CLElement[] {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return [];
    const result: CLElement[] = [];
    queryAll(this._pool, idx, selector, result);
    return result;
  }

  getElementsByTagName(tag: string): CLElement[] {
    return this.querySelectorAll(tag);
  }

  getElementsByClassName(cls: string): CLElement[] {
    return this.querySelectorAll(`.${cls}`);
  }

  // Event stubs (would need full EventTarget impl)
  addEventListener(_type: string, _listener: any, _options?: any): void {}
  removeEventListener(_type: string, _listener: any, _options?: any): void {}
  dispatchEvent(_event: any): boolean { return true; }
}

// ── CLText ─────────────────────────────────────────────────

export class CLText extends CLNode {
  get data(): string { return this._pool.nodeValue[validateHandle(this._pool, this._handle)] || ''; }
  set data(v: string) { this._pool.nodeValue[validateHandle(this._pool, this._handle)] = v; }
  get length(): number { return this.data.length; }
  get wholeText(): string { return this.data; }
}

// ── CLComment ──────────────────────────────────────────────

export class CLComment extends CLNode {
  get data(): string { return this._pool.nodeValue[validateHandle(this._pool, this._handle)] || ''; }
  set data(v: string) { this._pool.nodeValue[validateHandle(this._pool, this._handle)] = v; }
}

// ── CLDocumentFragment ─────────────────────────────────────

export class CLDocumentFragment extends CLNode {}

// ── CLDocument ─────────────────────────────────────────────

export class CLDocument extends CLNode {
  createElement(tagName: string): CLElement {
    const pool = this._pool;
    const idx = alloc(pool);
    pool.nodeType[idx] = ELEMENT_NODE;
    pool.nodeName[idx] = tagName.toLowerCase();
    pool.attributes[idx] = new Map();
    return getOrCreateProxy(pool, idx) as CLElement;
  }

  createTextNode(data: string): CLText {
    const pool = this._pool;
    const idx = alloc(pool);
    pool.nodeType[idx] = TEXT_NODE;
    pool.nodeName[idx] = '#text';
    pool.nodeValue[idx] = data;
    return getOrCreateProxy(pool, idx) as CLText;
  }

  createComment(data: string): CLComment {
    const pool = this._pool;
    const idx = alloc(pool);
    pool.nodeType[idx] = COMMENT_NODE;
    pool.nodeName[idx] = '#comment';
    pool.nodeValue[idx] = data;
    return getOrCreateProxy(pool, idx) as CLComment;
  }

  createDocumentFragment(): CLDocumentFragment {
    const pool = this._pool;
    const idx = alloc(pool);
    pool.nodeType[idx] = DOCUMENT_FRAGMENT_NODE;
    pool.nodeName[idx] = '#document-fragment';
    return getOrCreateProxy(pool, idx) as CLDocumentFragment;
  }

  get documentElement(): CLElement | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    let child = this._pool.firstChild[idx];
    while (child !== NONE) {
      if (this._pool.nodeType[child] === ELEMENT_NODE) return getOrCreateProxy(this._pool, child) as CLElement;
      child = this._pool.nextSibling[child];
    }
    return null;
  }

  getElementById(id: string): CLElement | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    return queryFirst(this._pool, idx, `#${id}`);
  }

  querySelector(selector: string): CLElement | null {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return null;
    return queryFirst(this._pool, idx, selector);
  }

  querySelectorAll(selector: string): CLElement[] {
    const idx = validateHandle(this._pool, this._handle);
    if (idx === NONE) return [];
    const result: CLElement[] = [];
    queryAll(this._pool, idx, selector, result);
    return result;
  }
}

// ── Query helpers ──────────────────────────────────────────

function matchesSelector(pool: NodePool, idx: number, selector: string): boolean {
  if (pool.nodeType[idx] !== ELEMENT_NODE) return false;
  if (selector.startsWith('#')) {
    return pool.attributes[idx]?.get('id') === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    const cls = pool.className[idx] || '';
    return cls.split(' ').includes(selector.slice(1));
  }
  return pool.nodeName[idx] === selector.toLowerCase();
}

function queryFirst(pool: NodePool, rootIdx: number, selector: string): CLElement | null {
  let child = pool.firstChild[rootIdx];
  while (child !== NONE) {
    if (matchesSelector(pool, child, selector)) return getOrCreateProxy(pool, child) as CLElement;
    const found = queryFirst(pool, child, selector);
    if (found) return found;
    child = pool.nextSibling[child];
  }
  return null;
}

function queryAll(pool: NodePool, rootIdx: number, selector: string, result: CLElement[]): void {
  let child = pool.firstChild[rootIdx];
  while (child !== NONE) {
    if (matchesSelector(pool, child, selector)) result.push(getOrCreateProxy(pool, child) as CLElement);
    queryAll(pool, child, selector, result);
    child = pool.nextSibling[child];
  }
}

// ── Serialization ──────────────────────────────────────────

const VOID_ELEMENTS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const ESC: Record<string, string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'};
function esc(s: string): string { return s.replace(/[&<>"']/g, c => ESC[c]); }

function serializeNode(pool: NodePool, idx: number): string {
  if (pool.nodeType[idx] === TEXT_NODE) return esc(pool.nodeValue[idx] || '');
  if (pool.nodeType[idx] === COMMENT_NODE) return `<!--${pool.nodeValue[idx] || ''}-->`;
  if (pool.nodeType[idx] !== ELEMENT_NODE) return serializeChildren(pool, idx);
  const tag = pool.nodeName[idx]!;
  let html = `<${tag}`;
  const attrs = pool.attributes[idx];
  if (attrs) for (const [k, v] of attrs) html += ` ${k}="${esc(v)}"`;
  if (VOID_ELEMENTS.has(tag)) return html + ' />';
  return html + '>' + serializeChildren(pool, idx) + `</${tag}>`;
}

function serializeChildren(pool: NodePool, idx: number): string {
  let html = '';
  let child = pool.firstChild[idx];
  while (child !== NONE) {
    html += serializeNode(pool, child);
    child = pool.nextSibling[child];
  }
  return html;
}

// ── Factory ────────────────────────────────────────────────

export function createDocument(pool?: NodePool): CLDocument {
  const p = pool || createPoolDefault();
  const idx = alloc(p);
  p.nodeType[idx] = DOCUMENT_NODE;
  p.nodeName[idx] = '#document';
  const doc = getOrCreateProxy(p, idx) as CLDocument;
  return doc;
}

function createPoolDefault(): NodePool {
  return {
    _proxyCache: new Array(8192).fill(null),
    parent: new Int32Array(8192), firstChild: new Int32Array(8192), lastChild: new Int32Array(8192),
    nextSibling: new Int32Array(8192), prevSibling: new Int32Array(8192),
    generation: new Uint8Array(8192), nodeType: new Uint8Array(8192),
    freeList: new Int32Array(8192),
    nodeName: new Array(8192).fill(null), nodeValue: new Array(8192).fill(null),
    namespaceURI: new Array(8192).fill(null), attributes: new Array(8192).fill(null),
    className: new Array(8192).fill(null),
    count: 1, capacity: 8192, freeHead: 0,
  };
}

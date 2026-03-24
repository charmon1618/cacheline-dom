# @cacheline/dom

W3C-compatible DOM implementation backed by flat array pool with generational handles.

**10-42x faster** than jsdom on mutations. Same API. Drop-in replacement for testing, SSR, and headless rendering.

## Why

Every browser DOM node is a heap-allocated C++ object linked by 5 pointers (parent, firstChild, lastChild, nextSibling, prevSibling). Traversal = pointer chasing = cache misses = slow.

`@cacheline/dom` replaces the heap with a flat `Int32Array` pool. Tree links are array indices, not pointers. Allocation is bump + free list. Generational handles detect stale references.

Same W3C API. Array-backed internals.

## Usage

```typescript
import { createDocument } from '@cacheline/dom';

const doc = createDocument();
const div = doc.createElement('div');
div.setAttribute('id', 'app');
div.className = 'container';
div.appendChild(doc.createTextNode('Hello world'));
doc.appendChild(div);

console.log(div.outerHTML);
// <div id="app" class="container">Hello world</div>

console.log(div.parentNode === doc);  // true (identity-preserving proxies)
console.log(doc.querySelector('#app') === div);  // true
```

## API Coverage

| Category | Methods |
|----------|---------|
| **Document** | `createElement`, `createTextNode`, `createComment`, `createDocumentFragment`, `getElementById`, `querySelector`, `querySelectorAll`, `documentElement` |
| **Element** | `getAttribute`, `setAttribute`, `removeAttribute`, `hasAttribute`, `toggleAttribute`, `getAttributeNames`, `className`, `id`, `tagName`, `matches`, `querySelector`, `querySelectorAll`, `children`, `innerHTML`, `outerHTML` |
| **Node** | `parentNode`, `firstChild`, `lastChild`, `nextSibling`, `previousSibling`, `childNodes`, `appendChild`, `insertBefore`, `removeChild`, `replaceChild`, `cloneNode`, `contains`, `textContent`, `nodeType`, `nodeName`, `ownerDocument`, `isConnected` |
| **Text** | `data`, `length`, `wholeText` |
| **Comment** | `data` |

## Benchmark vs jsdom

Same W3C DOM API. Pure tree manipulation, no rendering.

| Operation | 100 nodes | 1000 nodes | 5000 nodes |
|-----------|-----------|------------|------------|
| **Create + appendChild** | 9.7x faster | 19.3x faster | 15.7x faster |
| **setAttribute + getAttribute** | 12.1x faster | 11.6x faster | 41.6x faster |
| **querySelector ×100** | 7.3x faster | 8.6x faster | 12.0x faster |
| **Remove all children** | 15.8x faster | 16.0x faster | 16.6x faster |
| **innerHTML read** | 1.7x faster | 1.7x faster | 1.1x faster |
| **Traverse siblings** | 0.68x | 0.82x | 0.83x |

Mutations are 10-42x faster. Traversal is 17-32% slower (proxy overhead vs jsdom's direct pointers). Net win for any mutation-heavy workload (frameworks, SSR, testing).

## How It Works

```
document.createElement('div')
  → alloc index from Int32Array pool (bump or free list, zero heap alloc)
  → return CLElement proxy holding [gen:8|index:24] handle

div.appendChild(span)
  → 4 Int32Array writes (parent, nextSibling, prevSibling, lastChild)
  → update cached proxy pointers on affected nodes

div.removeChild(span)
  → unlink from doubly-linked list (Int32Array writes)
  → bump generation (stale handles return null)

staleRef.parentNode
  → generation mismatch → null (not garbage data)
```

## Install

```bash
npm install @cacheline/dom
```

## Build & Test

```bash
npm install
npm test       # 41 tests, <300ms
npm run build  # → dist/index.js + dist/index.d.ts
```

## Zero Dependencies

No runtime dependencies. Pure TypeScript operating on TypedArrays. Works in Node, Bun, Deno, browsers.

## Part of CacheLine

This is part of the [CacheLine](https://github.com/nicholasgasior/cacheline) project — replacing heap pointer soup with flat array backings across every layer of the stack.

- **@cacheline/dom** — W3C DOM on array pool (this package)
- **@cacheline/reconciler** — React-alternative framework, 3-17x faster
- **@cacheline/soa** — SoA collections for TypeScript (SoADict, SoAList, etc.)

## License

MIT

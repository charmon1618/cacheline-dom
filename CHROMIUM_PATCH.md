# Chromium DOM Patch: Pool-Indexed Tree Links

Replace Blink's per-node `Member<Node>` GC-traced pointers with `uint32_t` indices
into a per-Document node pool. Same API. 20 bytes fewer per node. Zero GC tracing
on tree links.

## Current State (Chromium HEAD)

### Node (node.h) — 3 pointer fields
```cpp
// third_party/blink/renderer/core/dom/node.h
TaggedParentOrShadowHostNode parent_or_shadow_host_node_;  // ~8 bytes, GC-traced
Member<Node> previous_;                                     // 8 bytes, GC-traced
Member<Node> next_;                                         // 8 bytes, GC-traced
```

### ContainerNode (container_node.h) — 1 pointer field
```cpp
// third_party/blink/renderer/core/dom/container_node.h
Member<Node> first_child_;  // 8 bytes, GC-traced
// (lastChild is computed by walking to end, or cached separately)
```

**Total: 4 GC-traced pointers = 32 bytes of heap pointers per node.**
Oilpan must trace each one during garbage collection.

## Proposed Change

### 1. NodePool (new file: node_pool.h)

```cpp
// third_party/blink/renderer/core/dom/node_pool.h

#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

// Per-Document pool. All Nodes in this document live here.
// Oilpan manages the pool as ONE object. No per-node GC tracing.
class NodePool final : public GarbageCollected<NodePool> {
 public:
  static constexpr uint32_t kNone = 0;  // null sentinel (slot 0 reserved)
  static constexpr uint32_t kInvalidHandle = 0xFFFFFFFF;

  NodePool() : count_(1) {}  // slot 0 reserved

  uint32_t Alloc() {
    if (free_head_ != kNone) {
      uint32_t idx = free_head_;
      free_head_ = free_list_[idx];
      return idx;
    }
    if (count_ >= capacity_) Grow();
    return count_++;
  }

  void Free(uint32_t idx) {
    generation_[idx]++;  // stale handles detect this
    free_list_[idx] = free_head_;
    free_head_ = idx;
  }

  // Tree link arrays (contiguous, cache-friendly)
  Vector<uint32_t> parent_;          // parent index (kNone = no parent)
  Vector<uint32_t> first_child_;     // first child index
  Vector<uint32_t> last_child_;      // last child index
  Vector<uint32_t> next_sibling_;    // next sibling index
  Vector<uint32_t> prev_sibling_;    // previous sibling index

  // Generational handles
  Vector<uint8_t> generation_;

  // Node object storage (the actual Node* still exists — just pooled)
  Vector<Node*> nodes_;  // nodes_[idx] = the Node object at this slot

  void Trace(Visitor* visitor) const {
    // Trace the node objects (NOT the tree links — those are just uint32_t)
    for (Node* node : nodes_) {
      visitor->Trace(node);
    }
  }

 private:
  void Grow();
  uint32_t count_ = 1;
  uint32_t capacity_ = 8192;
  uint32_t free_head_ = kNone;
  Vector<uint32_t> free_list_;
};

}  // namespace blink
```

### 2. Node.h changes

```diff
 // third_party/blink/renderer/core/dom/node.h

 class Node : public EventTarget {
+ private:
+  // Pool index — this node's slot in the owning Document's NodePool
+  uint32_t pool_index_ = NodePool::kNone;
+
+  // Back-reference to pool (set at construction, never changes)
+  Member<NodePool> pool_;

  public:
-  Node* previousSibling() const { return previous_; }
-  Node* nextSibling() const { return next_.Get(); }
+  Node* previousSibling() const {
+    uint32_t idx = pool_->prev_sibling_[pool_index_];
+    return idx != NodePool::kNone ? pool_->nodes_[idx] : nullptr;
+  }
+  Node* nextSibling() const {
+    uint32_t idx = pool_->next_sibling_[pool_index_];
+    return idx != NodePool::kNone ? pool_->nodes_[idx] : nullptr;
+  }
+  ContainerNode* parentNode() const {
+    uint32_t idx = pool_->parent_[pool_index_];
+    return idx != NodePool::kNone
+      ? static_cast<ContainerNode*>(pool_->nodes_[idx]) : nullptr;
+  }

- private:
-  TaggedParentOrShadowHostNode parent_or_shadow_host_node_;
-  Member<Node> previous_;
-  Member<Node> next_;
+  // parent_, previous_, next_ now live in pool_ arrays
+  // Setters update pool arrays:
+  void SetPreviousSibling(Node* prev) {
+    pool_->prev_sibling_[pool_index_] =
+      prev ? prev->pool_index_ : NodePool::kNone;
+  }
+  void SetNextSibling(Node* next) {
+    pool_->next_sibling_[pool_index_] =
+      next ? next->pool_index_ : NodePool::kNone;
+  }
 };
```

### 3. ContainerNode.h changes

```diff
 // third_party/blink/renderer/core/dom/container_node.h

 class ContainerNode : public Node {
  public:
-  Node* firstChild() const { return first_child_.Get(); }
+  Node* firstChild() const {
+    uint32_t idx = pool_->first_child_[pool_index_];
+    return idx != NodePool::kNone ? pool_->nodes_[idx] : nullptr;
+  }
+  Node* lastChild() const {
+    uint32_t idx = pool_->last_child_[pool_index_];
+    return idx != NodePool::kNone ? pool_->nodes_[idx] : nullptr;
+  }

- private:
-  Member<Node> first_child_;
+  // first_child_ now in pool_ arrays
 };
```

### 4. Document.h changes

```diff
 // third_party/blink/renderer/core/dom/document.h

 class Document : public ContainerNode {
+ public:
+  NodePool* GetNodePool() { return node_pool_.Get(); }
+
+ private:
+  Member<NodePool> node_pool_;
+
+  // In constructor:
+  // node_pool_ = MakeGarbageCollected<NodePool>();
 };
```

### 5. Node constructor changes

```diff
 // third_party/blink/renderer/core/dom/node.cc

-Node::Node(TreeScope* tree_scope, ConstructionType type)
-    : ... {
+Node::Node(TreeScope* tree_scope, ConstructionType type)
+    : ... {
+  // Get pool from owning document
+  pool_ = tree_scope->GetDocument().GetNodePool();
+  pool_index_ = pool_->Alloc();
+  pool_->nodes_[pool_index_] = this;
 }
```

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| **node_pool.h** (NEW) | Pool class with arrays + alloc/free | ~80 |
| **node.h** | Remove 3 Member<> fields, add pool_index_ + pool_, update accessors | ~30 |
| **node.cc** | Constructor gets pool + alloc, destructor frees | ~10 |
| **container_node.h** | Remove first_child_ Member<>, update firstChild()/lastChild() | ~15 |
| **container_node.cc** | Update appendChild/insertBefore/removeChild to use pool indices | ~40 |
| **document.h** | Add NodePool member | ~5 |
| **document.cc** | Create NodePool in constructor | ~3 |
| **node.h (Trace)** | Remove tree pointer tracing (pool handles it) | ~5 |
| **Total** | | **~190 lines** |

## What Doesn't Change

- **Every file that calls `node->firstChild()`, `node->nextSibling()`, etc.** — returns `Node*`, same as before
- **Every file that calls `appendChild()`, `insertBefore()`, `removeChild()`** — same API
- **Layout, paint, style, editing, accessibility, devtools** — all use the same `Node*` API
- **JavaScript bindings** — V8 sees the same `Node` objects

## What Improves

| Metric | Before | After |
|--------|--------|-------|
| **Tree link bytes per node** | 32 (4 × 8-byte pointers) | 20 (5 × 4-byte indices) |
| **GC trace work per node** | 4 pointer traces | 0 (pool traces node objects, not links) |
| **Allocation** | Oilpan bump + 4-byte header | Pool bump (same speed, no header for links) |
| **Cache behavior** | Pointers scatter across heap pages | Indices into contiguous arrays |
| **Memory per 1000 nodes** | 32KB tree links | 20KB tree links (37% less) |

## Oilpan Integration

Oilpan manages the `NodePool` as a single `GarbageCollected` object. When the Document dies,
the pool dies, all nodes die. The pool's `Trace()` method traces the `nodes_[]` vector
(which holds actual `Node*` pointers that Oilpan needs to see). But the tree LINK arrays
(`parent_`, `first_child_`, etc.) are just `Vector<uint32_t>` — invisible to GC, zero tracing cost.

This is strictly less GC work than today, where Oilpan traces 4 `Member<Node>` per node.

## Risk Assessment

- **Low risk**: API unchanged, consumers unchanged, behavior unchanged
- **Medium risk**: Shadow DOM parent handling needs care (TaggedParentOrShadowHostNode stores either parent OR shadow host — pool needs to handle this union)
- **Medium risk**: Document fragments / adopted nodes that move between documents need pool migration
- **Low risk**: Performance — pool indexed read (`pool_->nodes_[idx]`) is one extra indirection vs current direct pointer, but tree link arrays are more cache-friendly

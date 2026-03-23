/**
 * Benchmark: cacheline-dom (SoA pool) vs jsdom (heap objects)
 * Same W3C DOM API operations. Measures pure tree manipulation speed.
 */
import { JSDOM } from 'jsdom';
import { createPool } from '../src/pool.js';
import { createDocument } from '../src/nodes.js';

function timed(fn: () => void, iters: number): number {
  for (let i = 0; i < 3; i++) fn();
  const s = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return (performance.now() - s) / iters;
}

function benchSuite(label: string, N: number, iters: number) {
  console.log(`\n=== ${label} (${N} nodes, ${iters} iters) ===`);

  // ── cacheline-dom ──
  const clPool = createPool();
  const clDoc = createDocument(clPool);

  // ── jsdom ──
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const jsDoc = dom.window.document;

  // 1. Create N elements + append to parent
  const clCreate = timed(() => {
    const parent = clDoc.createElement('div');
    for (let i = 0; i < N; i++) {
      const el = clDoc.createElement('span');
      el.setAttribute('id', `n${i}`);
      el.setAttribute('class', `c${i % 10}`);
      parent.appendChild(el);
    }
    // Clean up for next iter
    while (parent.firstChild) parent.removeChild(parent.firstChild);
  }, iters);

  const jsCreate = timed(() => {
    const parent = jsDoc.createElement('div');
    for (let i = 0; i < N; i++) {
      const el = jsDoc.createElement('span');
      el.setAttribute('id', `n${i}`);
      el.setAttribute('class', `c${i % 10}`);
      parent.appendChild(el);
    }
    while (parent.firstChild) parent.removeChild(parent.firstChild);
  }, iters);

  console.log(`  Create+append ${N}: CL ${clCreate.toFixed(3)}ms  jsdom ${jsCreate.toFixed(3)}ms  ${(jsCreate/clCreate).toFixed(2)}x`);

  // 2. Build tree then traverse (read parentNode, firstChild, nextSibling, textContent)
  const clParent = clDoc.createElement('div');
  for (let i = 0; i < N; i++) {
    const el = clDoc.createElement('span');
    el.textContent = `item ${i}`;
    clParent.appendChild(el);
  }

  const jsParent = jsDoc.createElement('div');
  for (let i = 0; i < N; i++) {
    const el = jsDoc.createElement('span');
    el.textContent = `item ${i}`;
    jsParent.appendChild(el);
  }

  const clTraverse = timed(() => {
    let count = 0;
    let node = clParent.firstChild;
    while (node) {
      const _t = node.textContent;
      const _p = node.parentNode;
      count++;
      node = node.nextSibling;
    }
    if (count !== N) throw new Error('bad traverse');
  }, iters);

  const jsTraverse = timed(() => {
    let count = 0;
    let node = jsParent.firstChild;
    while (node) {
      const _t = node.textContent;
      const _p = node.parentNode;
      count++;
      node = node.nextSibling;
    }
    if (count !== N) throw new Error('bad traverse');
  }, iters);

  console.log(`  Traverse ${N}:      CL ${clTraverse.toFixed(3)}ms  jsdom ${jsTraverse.toFixed(3)}ms  ${(jsTraverse/clTraverse).toFixed(2)}x`);

  // 3. setAttribute + getAttribute loop
  const clSetGet = timed(() => {
    let node = clParent.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        (node as any).setAttribute('data-v', 'x');
        (node as any).getAttribute('data-v');
      }
      node = node.nextSibling;
    }
  }, iters);

  const jsSetGet = timed(() => {
    let node: any = jsParent.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        node.setAttribute('data-v', 'x');
        node.getAttribute('data-v');
      }
      node = node.nextSibling;
    }
  }, iters);

  console.log(`  set/getAttribute:  CL ${clSetGet.toFixed(3)}ms  jsdom ${jsSetGet.toFixed(3)}ms  ${(jsSetGet/clSetGet).toFixed(2)}x`);

  // 4. querySelector
  // Add IDs for query
  const clQ = timed(() => {
    for (let i = 0; i < 100; i++) {
      clParent.querySelector(`#n${i % N}`);
    }
  }, iters);

  const jsQ = timed(() => {
    for (let i = 0; i < 100; i++) {
      jsParent.querySelector(`#n${i % N}`);
    }
  }, iters);

  console.log(`  querySelector ×100: CL ${clQ.toFixed(3)}ms  jsdom ${jsQ.toFixed(3)}ms  ${(jsQ/clQ).toFixed(2)}x`);

  // 5. Remove all children
  // Rebuild first
  while (clParent.firstChild) clParent.removeChild(clParent.firstChild);
  for (let i = 0; i < N; i++) { const el = clDoc.createElement('span'); clParent.appendChild(el); }
  while (jsParent.firstChild) jsParent.removeChild(jsParent.firstChild);
  for (let i = 0; i < N; i++) { const el = jsDoc.createElement('span'); jsParent.appendChild(el); }

  const clRemove = timed(() => {
    // Rebuild
    for (let i = 0; i < N; i++) { const el = clDoc.createElement('span'); clParent.appendChild(el); }
    // Remove all
    while (clParent.firstChild) clParent.removeChild(clParent.firstChild);
  }, iters);

  const jsRemove = timed(() => {
    for (let i = 0; i < N; i++) { const el = jsDoc.createElement('span'); jsParent.appendChild(el); }
    while (jsParent.firstChild) jsParent.removeChild(jsParent.firstChild);
  }, iters);

  console.log(`  Remove all ${N}:    CL ${clRemove.toFixed(3)}ms  jsdom ${jsRemove.toFixed(3)}ms  ${(jsRemove/clRemove).toFixed(2)}x`);

  // 6. innerHTML (serialization)
  // Rebuild
  for (let i = 0; i < N; i++) {
    const el = clDoc.createElement('span');
    el.textContent = `item ${i}`;
    clParent.appendChild(el);
  }
  for (let i = 0; i < N; i++) {
    const el = jsDoc.createElement('span');
    el.textContent = `item ${i}`;
    jsParent.appendChild(el);
  }

  const clSerial = timed(() => { const _h = clParent.innerHTML; }, iters);
  const jsSerial = timed(() => { const _h = jsParent.innerHTML; }, iters);

  console.log(`  innerHTML read:    CL ${clSerial.toFixed(3)}ms  jsdom ${jsSerial.toFixed(3)}ms  ${(jsSerial/clSerial).toFixed(2)}x`);
}

console.log('cacheline-dom (SoA pool) vs jsdom (heap objects)');
console.log('Same W3C DOM API. Measuring pure tree manipulation.\n');

benchSuite('Small', 100, 500);
benchSuite('Medium', 1000, 50);
benchSuite('Large', 5000, 10);

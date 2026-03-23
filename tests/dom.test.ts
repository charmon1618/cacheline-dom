import { describe, it, expect } from 'vitest';
import { createPool, createDocument, CLElement, CLText, CLComment, CLDocument, CLDocumentFragment, ELEMENT_NODE, TEXT_NODE, COMMENT_NODE, DOCUMENT_NODE, DOCUMENT_FRAGMENT_NODE, validateHandle, HANDLE_INVALID } from '../src/index.js';

function makeDoc() {
  const pool = createPool();
  return createDocument(pool);
}

// ══════════════════════════════════════════════════════════
// 1. Document factory methods
// ══════════════════════════════════════════════════════════

describe('Document: factory', () => {
  it('createElement returns CLElement with correct type', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    expect(div).toBeInstanceOf(CLElement);
    expect(div.nodeType).toBe(ELEMENT_NODE);
    expect(div.tagName).toBe('DIV');
    expect(div.localName).toBe('div');
  });

  it('createTextNode returns CLText', () => {
    const doc = makeDoc();
    const t = doc.createTextNode('hello');
    expect(t).toBeInstanceOf(CLText);
    expect(t.nodeType).toBe(TEXT_NODE);
    expect(t.data).toBe('hello');
    expect(t.nodeValue).toBe('hello');
  });

  it('createComment returns CLComment', () => {
    const doc = makeDoc();
    const c = doc.createComment('test');
    expect(c).toBeInstanceOf(CLComment);
    expect(c.nodeType).toBe(COMMENT_NODE);
    expect(c.data).toBe('test');
  });

  it('createDocumentFragment returns CLDocumentFragment', () => {
    const doc = makeDoc();
    const f = doc.createDocumentFragment();
    expect(f).toBeInstanceOf(CLDocumentFragment);
    expect(f.nodeType).toBe(DOCUMENT_FRAGMENT_NODE);
  });
});

// ══════════════════════════════════════════════════════════
// 2. Tree structure (W3C Node API)
// ══════════════════════════════════════════════════════════

describe('Node: tree traversal', () => {
  it('appendChild and parentNode', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    doc.appendChild(div);
    const pn = div.parentNode;
    expect(div.parentNode).toBe(doc);
    expect(doc.firstChild).toBe(div);
  });

  it('firstChild, lastChild, nextSibling, previousSibling', () => {
    const doc = makeDoc();
    const a = doc.createElement('a');
    const b = doc.createElement('b');
    const c = doc.createElement('c');
    const parent = doc.createElement('div');
    parent.appendChild(a);
    parent.appendChild(b);
    parent.appendChild(c);
    expect(parent.firstChild).toBe(a);
    expect(parent.lastChild).toBe(c);
    expect(a.nextSibling).toBe(b);
    expect(b.nextSibling).toBe(c);
    expect(c.nextSibling).toBeNull();
    expect(c.previousSibling).toBe(b);
    expect(b.previousSibling).toBe(a);
    expect(a.previousSibling).toBeNull();
  });

  it('childNodes returns all children', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.appendChild(doc.createElement('a'));
    div.appendChild(doc.createTextNode('text'));
    div.appendChild(doc.createElement('b'));
    expect(div.childNodes).toHaveLength(3);
  });

  it('hasChildNodes', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    expect(div.hasChildNodes()).toBe(false);
    div.appendChild(doc.createElement('span'));
    expect(div.hasChildNodes()).toBe(true);
  });

  it('insertBefore', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    const a = doc.createElement('a');
    const b = doc.createElement('b');
    div.appendChild(b);
    div.insertBefore(a, b);
    expect(div.firstChild).toBe(a);
    expect(a.nextSibling).toBe(b);
  });

  it('removeChild', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    const a = doc.createElement('a');
    const b = doc.createElement('b');
    div.appendChild(a);
    div.appendChild(b);
    div.removeChild(a);
    expect(div.firstChild).toBe(b);
    expect(a.parentNode).toBeNull();
  });

  it('replaceChild', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    const old = doc.createElement('old');
    const replacement = doc.createElement('new');
    div.appendChild(old);
    div.replaceChild(replacement, old);
    expect(div.firstChild).toBe(replacement);
    expect(old.parentNode).toBeNull();
  });

  it('contains', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    const span = doc.createElement('span');
    div.appendChild(span);
    expect(div.contains(span)).toBe(true);
    expect(span.contains(div)).toBe(false);
    expect(div.contains(div)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// 3. Element API
// ══════════════════════════════════════════════════════════

describe('Element: attributes', () => {
  it('setAttribute / getAttribute', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.setAttribute('id', 'main');
    expect(div.getAttribute('id')).toBe('main');
    expect(div.id).toBe('main');
  });

  it('removeAttribute', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.setAttribute('id', 'x');
    div.removeAttribute('id');
    expect(div.getAttribute('id')).toBeNull();
    expect(div.hasAttribute('id')).toBe(false);
  });

  it('hasAttribute / hasAttributes', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    expect(div.hasAttributes()).toBe(false);
    div.setAttribute('class', 'foo');
    expect(div.hasAttributes()).toBe(true);
    expect(div.hasAttribute('class')).toBe(true);
    expect(div.hasAttribute('id')).toBe(false);
  });

  it('className', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.className = 'foo bar';
    expect(div.className).toBe('foo bar');
  });

  it('toggleAttribute', () => {
    const doc = makeDoc();
    const input = doc.createElement('input');
    expect(input.toggleAttribute('disabled')).toBe(true);
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(input.toggleAttribute('disabled')).toBe(false);
    expect(input.hasAttribute('disabled')).toBe(false);
  });

  it('getAttributeNames', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.setAttribute('id', 'x');
    div.setAttribute('class', 'y');
    expect(div.getAttributeNames().sort()).toEqual(['class', 'id']);
  });
});

describe('Element: traversal', () => {
  it('children (elements only)', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.appendChild(doc.createElement('span'));
    div.appendChild(doc.createTextNode('text'));
    div.appendChild(doc.createElement('p'));
    expect(div.children).toHaveLength(2);
    expect(div.childElementCount).toBe(2);
  });

  it('firstElementChild / lastElementChild', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.appendChild(doc.createTextNode('t1'));
    const span = doc.createElement('span');
    div.appendChild(span);
    div.appendChild(doc.createTextNode('t2'));
    const p = doc.createElement('p');
    div.appendChild(p);
    div.appendChild(doc.createTextNode('t3'));
    expect(div.firstElementChild).toBe(span);
    expect(div.lastElementChild).toBe(p);
  });

  it('nextElementSibling / previousElementSibling', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    const a = doc.createElement('a');
    const b = doc.createElement('b');
    div.appendChild(a);
    div.appendChild(doc.createTextNode('between'));
    div.appendChild(b);
    expect(a.nextElementSibling).toBe(b);
    expect(b.previousElementSibling).toBe(a);
  });
});

describe('Element: query', () => {
  it('querySelector by tag', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    const span = doc.createElement('span');
    div.appendChild(span);
    doc.appendChild(div);
    expect(doc.querySelector('span')).toBe(span);
  });

  it('querySelector by id', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.setAttribute('id', 'main');
    doc.appendChild(div);
    expect(doc.getElementById('main')).toBe(div);
  });

  it('querySelector by class', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.className = 'active';
    doc.appendChild(div);
    expect(doc.querySelector('.active')).toBe(div);
  });

  it('querySelectorAll', () => {
    const doc = makeDoc();
    const parent = doc.createElement('div');
    parent.appendChild(doc.createElement('span'));
    parent.appendChild(doc.createElement('span'));
    parent.appendChild(doc.createElement('p'));
    doc.appendChild(parent);
    expect(doc.querySelectorAll('span')).toHaveLength(2);
  });

  it('matches', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.setAttribute('id', 'x');
    div.className = 'foo';
    expect(div.matches('div')).toBe(true);
    expect(div.matches('#x')).toBe(true);
    expect(div.matches('.foo')).toBe(true);
    expect(div.matches('span')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// 4. Text content
// ══════════════════════════════════════════════════════════

describe('Node: textContent', () => {
  it('get textContent from text node', () => {
    const doc = makeDoc();
    const t = doc.createTextNode('hello');
    expect(t.textContent).toBe('hello');
  });

  it('get textContent from element (concatenates descendants)', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.appendChild(doc.createTextNode('hello '));
    const span = doc.createElement('span');
    span.appendChild(doc.createTextNode('world'));
    div.appendChild(span);
    expect(div.textContent).toBe('hello world');
  });

  it('set textContent replaces all children', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.appendChild(doc.createElement('span'));
    div.appendChild(doc.createElement('p'));
    div.textContent = 'replaced';
    expect(div.childNodes).toHaveLength(1);
    expect(div.firstChild!.nodeType).toBe(TEXT_NODE);
    expect(div.textContent).toBe('replaced');
  });
});

// ══════════════════════════════════════════════════════════
// 5. Serialization
// ══════════════════════════════════════════════════════════

describe('Element: serialization', () => {
  it('outerHTML', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.setAttribute('id', 'x');
    div.appendChild(doc.createTextNode('hello'));
    expect(div.outerHTML).toBe('<div id="x">hello</div>');
  });

  it('innerHTML', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.appendChild(doc.createElement('span'));
    div.appendChild(doc.createTextNode('text'));
    expect(div.innerHTML).toBe('<span></span>text');
  });

  it('escapes text in outerHTML', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.appendChild(doc.createTextNode('<script>'));
    expect(div.outerHTML).toBe('<div>&lt;script&gt;</div>');
  });

  it('void elements self-close', () => {
    const doc = makeDoc();
    const br = doc.createElement('br');
    expect(br.outerHTML).toBe('<br />');
  });
});

// ══════════════════════════════════════════════════════════
// 6. Generational handles — stale reference detection
// ══════════════════════════════════════════════════════════

describe('Generational handles', () => {
  it('removed node has null parentNode', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    const span = doc.createElement('span');
    div.appendChild(span);
    div.removeChild(span);
    expect(span.parentNode).toBeNull();
  });

  it('cloneNode creates independent copy', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.setAttribute('id', 'original');
    div.appendChild(doc.createTextNode('text'));
    const clone = div.cloneNode(true) as CLElement;
    expect(clone.getAttribute('id')).toBe('original');
    expect(clone.textContent).toBe('text');
    // Independent — changing clone doesn't affect original
    clone.setAttribute('id', 'cloned');
    expect(div.getAttribute('id')).toBe('original');
  });

  it('isSameNode', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    expect(div.isSameNode(div)).toBe(true);
    const div2 = doc.createElement('div');
    expect(div.isSameNode(div2)).toBe(false);
  });

  it('removed nodes are still accessible (W3C behavior)', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    div.setAttribute('id', 'x');
    div.appendChild(doc.createTextNode('hello'));
    doc.appendChild(div);
    doc.removeChild(div);
    // W3C: removed nodes stay valid, just disconnected
    expect(div.getAttribute('id')).toBe('x');
    expect(div.textContent).toBe('hello');
    expect(div.parentNode).toBeNull();
    expect(div.isConnected).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// 7. Document-level queries
// ══════════════════════════════════════════════════════════

describe('Document: queries', () => {
  it('documentElement', () => {
    const doc = makeDoc();
    const html = doc.createElement('html');
    doc.appendChild(html);
    expect(doc.documentElement).toBe(html);
  });

  it('getElementById deep', () => {
    const doc = makeDoc();
    const html = doc.createElement('html');
    const body = doc.createElement('body');
    const div = doc.createElement('div');
    div.setAttribute('id', 'target');
    body.appendChild(div);
    html.appendChild(body);
    doc.appendChild(html);
    expect(doc.getElementById('target')).toBe(div);
  });

  it('ownerDocument', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    doc.appendChild(div);
    expect(div.ownerDocument).toBe(doc);
  });

  it('isConnected', () => {
    const doc = makeDoc();
    const div = doc.createElement('div');
    expect(div.isConnected).toBe(false);
    doc.appendChild(div);
    expect(div.isConnected).toBe(true);
  });
});

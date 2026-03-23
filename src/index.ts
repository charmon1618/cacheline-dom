export { createPool, type NodePool, NONE, HANDLE_INVALID, ELEMENT_NODE, TEXT_NODE, COMMENT_NODE, DOCUMENT_NODE, DOCUMENT_FRAGMENT_NODE, packHandle, handleIndex, validateHandle, alloc, freeSlot, appendChild, insertBefore, removeChild, detach, replaceChild } from './pool.js';
export { CLNode, CLElement, CLText, CLComment, CLDocument, CLDocumentFragment, createDocument } from './nodes.js';

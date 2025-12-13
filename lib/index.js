/* global document window */

import emptyStack from '@iter-tools/imm-stack';
import classNames from 'classnames';
import { streamParse } from 'bablr';

import { CloseNodeTag, LiteralTag, OpenNodeTag, ReferenceTag } from '@bablr/agast-helpers/symbols';
import { printSelfClosingNodeTag } from '@bablr/agast-helpers/print';
import { buildOpenNodeTag, nodeFlags, tokenFlags } from '@bablr/agast-helpers/builders';
import {
  buildTreeNodeMatcher,
  buildNodeFlags,
  buildTreeNodeMatcherOpen,
  buildPropertyMatcher,
} from '@bablr/helpers/builders';
import { buildEmbeddedMatcher } from '@bablr/agast-vm-helpers/builders';
import { getComputedFlags } from '@bablr/agast-helpers/path';

function* siblingsFor(range) {
  let { 0: left, 1: right } = range;
  let el = left || right;

  if (!el) return;

  let backwards = left.compareDocumentPosition(right) === 2;

  do {
    yield el;
    let nextSibling = backwards ? el.previousElementSibling : el.nextElementSibling;
    if (!right || el === right || !nextSibling) break;
    el = nextSibling;
  } while (true);
}

const getCommonParentSiblings = (a, b) => {
  if (!a && !b) return [];
  if (!a) return [b, b];
  if (!b) return [a, a];

  let anode = a;
  let bnode = b;
  let rootNode = anode;
  do {
    let position = rootNode.compareDocumentPosition(b);
    if (!position || position & 0x10) {
      break;
    }
    anode = rootNode;
  } while ((rootNode = rootNode.parentNode));

  rootNode = bnode;
  do {
    let position = rootNode.compareDocumentPosition(a);
    if (!position || position & 0x10) {
      break;
    }
    bnode = rootNode;
  } while ((rootNode = rootNode.parentNode));

  return [anode, bnode];
};

const countIndents = (root) => {
  let el = root;
  let indents = 0;
  while (el) {
    if (el.classList.contains('trivia')) {
      let leftOffset = el.firstElementChild;

      if (leftOffset?.getAttribute('type') !== 'LeftOffset') return Infinity;

      el = leftOffset.firstElementChild;

      while (el && el.getAttribute('type') === 'Indent') {
        indents++;
        el = el.nextElementSibling;
      }
      return indents;
    } else {
      el =
        el.previousElementSibling ||
        (el.parentElement.tagName === 'NODE' ? el.parentElement : null);
    }
  }

  return Infinity;
};

let callbacks = {};

const addDocumentEventListener = (type, cb) => {
  if (!Object.hasOwn(callbacks, type)) {
    callbacks[type] = {
      listener: (e) => {
        for (let cb of callbacks[type].callbacks) {
          cb(e);
        }
      },
      callbacks: new Set(),
    };
    document.addEventListener(type, callbacks[type].listener);
  }
  callbacks[type].callbacks.add(cb);
};

export const removeDocumentListeners = () => {
  for (let { 0: key, 1: value } of Object.entries(callbacks)) {
    document.removeEventListener(key, value.listener);
  }
};

export const highlightCode = (el, language, matcher = language.defaultMatcher) => {
  let tags = streamParse(language, matcher, el.innerText, null, { holdShiftedNodes: true })[
    Symbol.iterator
  ]();

  let open;
  let referenceTag = null;
  let range = document.createRange();
  range.selectNodeContents(el.lastChild);
  let stack = emptyStack;

  let bindingTag;

  let step = tags.next();

  while (!step.done) {
    let tag = step.value;

    if (tag.type === OpenNodeTag) {
      range = range.cloneRange();
      range.setStart(el.lastChild, 0);
      range.setEnd(el.lastChild, 0);

      open = tag;

      if (tag.value.literalValue) {
        range.setEnd(range.startContainer, range.startOffset + tag.value.literalValue.length);
      }

      stack = stack.push({
        open,
        range,
        referenceTag,
        // langs: stack.value.langs.concat(bindingTag?.value.segments ?? []),
      });
    }

    if (tag.type === ReferenceTag) {
      referenceTag = tag;
    }

    if (tag.type === LiteralTag) {
      let { value } = tag;
      range.setEnd(range.startContainer, range.startOffset + value.length);
    }

    if (tag.type === CloseNodeTag || (tag.type === OpenNodeTag && tag.value.selfClosing)) {
      if (stack.size > 1) {
        // if (doneFrame.langs.size) {

        let doneRange = range;

        let node = document.createElement('node');
        let names = classNames({
          escape: referenceTag.value.type === '@',
          token: open.value.flags.token,
          trivia: referenceTag.value.type === '#',
          intrinsic: getComputedFlags(referenceTag.value).intrinsic,
          hasGap: open.value.flags.hasGap,
        });
        if (open.value.type) {
          node.setAttribute('type', open.value.type?.description);
        }
        if (names) {
          node.setAttribute('class', names);
        }

        range.surroundContents(node);
        // } else {
        //   let el = document.createElement(doneFrame.type.description);

        //   doneFrame.range.surroundContents(el);
        // }

        stack = stack.pop();
        ({ open, range, referenceTag } = stack.value);

        // range.setStart(doneRange.startContainer, doneRange.startOffset);
        range.setEnd(doneRange.endContainer, doneRange.endOffset);
      } else {
        break;
      }
    }

    step = tags.next();
  }

  const store = {};

  Object.defineProperty(store, 'selectedRange', {
    set(value) {
      let { 0: start, 1: end } = value;

      let newValue = value;

      if (start && !end) {
        end = store._selectedRange?.[1];
        newValue = [start, end];
      }

      let siblingRange = getCommonParentSiblings(start, end);

      let { 0: leftBound, 1: rightBound } = siblingRange;
      let commonParent =
        leftBound === rightBound || !rightBound
          ? leftBound
          : leftBound?.parentNode || rightBound?.parentNode;

      // are any selected nodes intrinsic

      if (store._selectedSiblingRange) {
        for (let prevEl of siblingsFor(store._selectedSiblingRange)) {
          prevEl.classList.remove('selected');
          let indentClass = [...prevEl.classList.values()].find((val) =>
            val.startsWith('indent-depth-'),
          );
          prevEl.classList.remove(indentClass);

          let prevAnchor = prevEl.childNodes[0];
          if (prevAnchor?.tagName === 'A') {
            prevAnchor.remove();
          }
        }
      } else {
        document.getSelection().empty();
      }

      store._selectedRange = newValue;
      store._selectedSiblingRange = siblingRange;
      store._selectedRangeCommonParent = commonParent;

      if (commonParent) {
        let intrinsicSelection = false;

        let indentDepth = Infinity;

        for (let siblingNode of siblingsFor(siblingRange)) {
          intrinsicSelection =
            siblingNode.classList.contains('intrinsic') &&
            !siblingNode.classList.contains('trivia');
          indentDepth = Math.min(indentDepth, countIndents(siblingNode));
          if (intrinsicSelection) break;
        }

        if (intrinsicSelection) {
          store._selectedSiblingRange = [commonParent, commonParent];
        }

        if (!leftBound || !rightBound || intrinsicSelection) {
          commonParent.classList.add('selected');
          commonParent.classList.add('indent-depth-' + countIndents(commonParent));

          let parentRange = document.createRange();

          parentRange.selectNode(commonParent);

          document.getSelection().empty();
          document.getSelection().addRange(parentRange);

          let anchor;
          if (commonParent.childNodes[0]?.tagName === 'A') {
            anchor = commonParent.childNodes[0];
          } else {
            anchor = document.createElement('a');
            anchor.style = 'display: inline-block; position: relative; vertical-align: top';
            commonParent.prepend(anchor);
          }

          let tooltip = document.createElement('span');
          tooltip.classList.add('tooltip');
          tooltip.prepend(
            printSelfClosingNodeTag(
              buildOpenNodeTag(
                commonParent.classList.contains('token') ? tokenFlags : nodeFlags,
                commonParent.getAttribute('type'),
              ),
            ),
          );
          tooltip.style = `position: absolute; top: -20px`;

          anchor.prepend(tooltip);
        } else {
          for (let siblingNode of siblingsFor(siblingRange)) {
            siblingNode.classList.add('selected');
            siblingNode.classList.add('indent-depth-' + indentDepth);
          }

          let range = document.createRange();

          if (leftBound.compareDocumentPosition(rightBound) === 2) {
            range.setStartBefore(rightBound);
            range.setEndAfter(leftBound);
          } else {
            range.setStartBefore(leftBound);
            range.setEndAfter(rightBound);
          }

          // select siblings
          document.getSelection().empty();
          document.getSelection().addRange(range);
        }
      }
    },

    get() {
      return store._selectedRange;
    },
  });

  Object.defineProperty(store, 'hoverTarget', {
    set(value) {
      let el = value;

      if (store._hoverTarget) {
        let prevEl = store._hoverTarget;
        let anchor = prevEl.childNodes[0];
        if (anchor.tagName === 'A') prevEl.removeChild(anchor);
      }

      store._hoverTarget = value;

      if (el && !el.classList.contains('selected')) {
        let hover = document.createElement('span');
        hover.classList.add('hover');
        hover.style = `position: absolute; top: 0px`;

        let anchor;
        if (el.childNodes[0]?.tagName === 'A') {
          anchor = el.childNodes[0];
        } else {
          anchor = document.createElement('a');
          anchor.style = 'display: inline-block; position: relative; vertical-align: top';
          el.prepend(anchor);
        }

        anchor.prepend(hover);
      }
    },

    get() {
      return store._hoverTarget;
    },
  });

  el.addEventListener('mousedown', (e) => {
    // let tokenNode = nodeBindings.get(e.target);

    if (e.target.tagName === 'NODE') {
      store.selectedRange = [e.target, e.target];
    } else {
      store.selectedRange = [null, null];
      document.getSelection().empty();
    }
    store.selectionState = 'selecting';

    if (!store.touchTimeout) {
      e.preventDefault();
    }
  });

  el.addEventListener('mouseover', (e) => {
    if (store.selectionState === 'selecting') {
      let selected = store.selectedRange;

      if (e.fromElement?.tagName !== 'NODE') {
        if (e.toElement?.tagName === 'NODE') {
          let startTokenNode = selected[0];

          if (startTokenNode) {
            range = [startTokenNode, e.toElement];
          } else {
            range = [e.toElement, e.toElement];
          }

          store.selectedRange = range;
        } else {
          store.selectedRange = [selected[0], null];
        }
      }
    }

    if (e.toElement?.tagName === 'NODE') {
      store.hoverTarget = e.toElement;
    } else {
      store.hoverTarget = null;
    }
  });

  el.addEventListener('mouseout', (e) => {
    if (store.selectionState === 'selecting') {
      let selected = store.selectedRange;

      if (e.toElement?.tagName === 'NODE') {
        let range;

        let startTokenNode = selected[0];

        if (startTokenNode) {
          range = [startTokenNode, e.toElement];
        } else {
          range = [e.toElement, null];
        }

        store.selectedRange = range;
      } else {
        if (e.toElement?.tagName === 'NODE') {
          store.selectedRange = [store.selectedRange[0], store.selectedRange[0]];
        } else {
          store.selectedRange = [store.selectedRange[0], null];
        }
      }
    }
  });

  addDocumentEventListener('mouseout', (e) => {
    let { target } = e;

    if (store.hoverTarget) {
      let position = target.compareDocumentPosition(el);
      if (!position || position & 0x10) {
        store.hoverTarget = null;
      }
    }
  });

  // addDocumentEventListener('selectionchange', (e) => {
  //   let selection = document.getSelection();

  //   store.hoverTarget = selection.anchorNode;

  //   if (selection.isCollapsed) {
  //     if (!selection.anchorNode || !(selection.anchorNode.compareDocumentPosition(el) & 0x10)) {
  //       store.selectedRange = [null, null];
  //     }
  //   }
  // });

  addDocumentEventListener('mouseup', (e) => {
    store.selectionState = store.selectedRange ? 'selected' : 'none';
    if (e.target.compareDocumentPosition(el) & 0x10) {
      store.selectedRange = [null, null];
      document.getSelection().empty();
      store.selectionState = 'none';
    }
  });

  addDocumentEventListener('mousedown', (e) => {
    if (e.target.compareDocumentPosition(el) & 0x10) {
      store.selectedRange = [null, null];
      store.selectionState = 'none';
    }
  });
};

export const highlightAll = (languages) => {
  let codeBlocks = document.querySelectorAll('code');

  for (let block of codeBlocks) {
    let canonicalURL = block.getAttribute('bablr-lang');
    let language = languages.get(canonicalURL);
    // let flagsStr = block.getAttribute('bablr-prod-flags');

    let type = block.getAttribute('bablr-prod');

    if (!language) continue;
    if (!type && !language.defaultMatcher) continue;

    try {
      highlightCode(
        block,
        language,
        type
          ? buildEmbeddedMatcher(
              buildPropertyMatcher(
                null,
                null,
                buildTreeNodeMatcher(buildTreeNodeMatcherOpen(buildNodeFlags(), type)),
              ),
            )
          : language.defaultMatcher,
      );
    } catch (e) {
      console.warn(e);
    }
  }
};

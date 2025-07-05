/* global document window */

import { spam as m } from '@bablr/boot';
import emptyStack from '@iter-tools/imm-stack';
import classNames from 'classnames';
import * as cstml from '@bablr/language-en-cstml';
import { streamParse } from 'bablr';

import { CloseNodeTag, LiteralTag, OpenNodeTag, ReferenceTag } from '@bablr/agast-helpers/symbols';
import { printSelfClosingNodeTag } from '@bablr/agast-helpers/print';
import { buildOpenNodeTag, nodeFlags, tokenFlags } from '@bablr/agast-helpers/builders';

const getCommonParent = (a, b) => {
  if (!a) return b;
  if (!b) return a;

  let node = a;
  do {
    let position = node.compareDocumentPosition(b);
    if (!position || position & 0x10) {
      return node;
    }
  } while ((node = node.parentNode));

  return null;
};

const countIndents = (root) => {
  let el = root;
  let indents = 0;
  while (el) {
    if (el.getAttribute('type') === 'LeftOffset') {
      el = el.lastElementChild;

      while (el) {
        indents++;
        el = el.previousElementSibling;
      }
      return indents + 1;
    } else {
      el =
        el.previousElementSibling ||
        (el.parentElement.tagName === 'NODE' ? el.parentElement : null);
    }
  }

  return 0;
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

export const highlightCode = (el) => {
  let tags = streamParse(cstml, m`<Document />`, el.innerText)[Symbol.iterator]();

  let open;
  let referenceTag = null;
  let range = document.createRange();
  range.selectNodeContents(el.childNodes[0].lastChild);
  let stack = emptyStack;

  let bindingTag;

  let step = tags.next();

  outer: while (!step.done) {
    let tag = step.value;

    switch (tag.type) {
      case OpenNodeTag: {
        range = range.cloneRange();
        range.setStart(el.childNodes[0].lastChild, 0);
        range.setEnd(el.childNodes[0].lastChild, 0);

        open = tag;

        stack = stack.push({
          open,
          range,
          referenceTag,
          // langs: stack.value.langs.concat(bindingTag?.value.languagePath ?? []),
        });
        break;
      }

      case ReferenceTag: {
        referenceTag = tag;
        break;
      }

      case LiteralTag: {
        let { value } = tag;
        range.setEnd(range.startContainer, range.startOffset + value.length);
        break;
      }

      case CloseNodeTag: {
        if (stack.size > 1) {
          // if (doneFrame.langs.size) {

          let doneRange = range;

          let node = document.createElement('node');
          let names = classNames({
            escape: referenceTag.value.type === '@',
            token: open.value.flags.token,
            trivia: referenceTag.value.type === '#',
            hasGap: open.value.flags.hasGap,
          });
          node.setAttribute('type', open.value.type.description);
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
          break outer;
        }
        break;
      }
    }

    step = tags.next();
  }

  const store = {};

  Object.defineProperty(store, 'selectedRange', {
    set(value) {
      let { 0: start, 1: end } = value;

      let commonParent = getCommonParent(start, end);

      if (store._selectedRange) {
        let prevParent = store._selectedRangeCommonParent;
        if (prevParent) {
          prevParent.classList.remove('selected');
          let indentClass = [...prevParent.classList.values()].find((val) =>
            val.startsWith('indent-depth-'),
          );
          prevParent.classList.remove(indentClass);

          let prevAnchor = prevParent.childNodes[0];
          let child = [...prevAnchor.childNodes].find((child) =>
            child.classList.contains('tooltip'),
          );
          if (child) prevAnchor.removeChild(child);
        }
      }
      store._selectedRange = value;
      store._selectedRangeCommonParent = commonParent;

      if (commonParent) {
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
        let prevEl = store._hoverTarget.childNodes[0];
        let child = [...prevEl.childNodes].find((child) => child.classList.contains('hover'));
        if (child) prevEl.removeChild(child);
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

      if (e.fromElement?.tagName !== 'NODE' && store.outTimeout) {
        if (e.toElement?.tagName === 'NODE') {
          window.clearTimeout(store.outTimeout);
          store.outTimeout = null;

          let startTokenNode = selected[0];

          if (startTokenNode) {
            range = [startTokenNode, e.toElement];
          } else {
            range = [e.toElement, e.toElement];
          }

          store.selectedRange = range;
        } else {
          store.selectedRange = [selected[0], selected[0]];
        }
      }
    } else {
      if (e.toElement?.tagName === 'NODE') {
        store.hoverTarget = e.toElement;
      } else {
        store.hoverTarget = null;
      }
    }
  });

  el.addEventListener('mouseout', (e) => {
    if (store.selectionState === 'selecting') {
      let selected = store.selectedRange;
      if (store.outTimeout) {
        window.clearTimeout(store.outTimeout);
        store.outTimeout = null;
      }

      if (e.toElement.tagName === 'NODE') {
        let range;

        if (e.target.tagName === 'NODE') {
          window.clearTimeout(store.outTimeout);
          store.outTimeout = null;
        }

        let startTokenNode = selected[0];

        if (startTokenNode) {
          range = [startTokenNode, e.toElement];
        } else {
          range = [e.toElement, e.toElement];
        }

        store.selectedRange = range;
      } else {
        // with tall line-height there are little gaps between lines where the event lands on `el`
        // suppress strobe-like flashing that occurs while dragging a selection over these gaps
        store.outTimeout = window.setTimeout(() => {
          if (e.toElement.tagName === 'NODE') {
            store.selectedRange = [store.selectedRange[0], store.selectedRange[0]];
          } else {
            store.selectedRange = [store.selectedRange[0], null];
          }
        }, 65);
      }
    }
  });

  el.addEventListener('mouseup', (e) => {
    store.selectionState = store.selectedRange ? 'selected' : 'none';
  });

  addDocumentEventListener('selectionchanged', (e) => {
    let selection = document.getSelection();

    if (selection.isCollapsed) {
      if (!selection.anchorNode || !(selection.anchorNode.compareDocumentPosition(el) & 0x10)) {
        store.selectedRange = [null, null];
      }
    }
  });

  addDocumentEventListener('mouseup', (e) => {
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

export const highlightAll = () => {
  let codeBlocks = document.querySelectorAll('code');

  for (let block of codeBlocks) {
    highlightCode(block);
  }
};

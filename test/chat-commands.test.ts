// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane, type CommandOutcome } from '../components/ChatPane';
import type { Conversation } from '../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout, so scrolling is a no-op here.
Element.prototype.scrollTo = function scrollTo() {};

const branch: Conversation = {
  id: 'b1',
  title: 'Blueprint',
  parentId: 'root',
  messages: [
    { id: 'm1', role: 'user', content: 'When do apps close?' },
    { id: 'm2', role: 'assistant', content: 'September 11.' },
  ],
  insights: [],
  pinnedTier: null,
  archived: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderAndSubmit(text: string, outcome: CommandOutcome) {
  const onCommand = vi.fn(async () => outcome);
  const onSend = vi.fn(async () => true);
  const noop = async () => {};
  await act(async () => {
    root.render(
      createElement(ChatPane, {
        conversation: branch,
        onSend,
        onBranch: () => {},
        onSelectMode: () => {},
        onMerge: () => {},
        onRegenerate: async () => true,
        onEditMessage: async () => true,
        onRename: noop,
        onArchive: noop,
        onOpenBranch: () => {},
        branchTitles: {},
        mode: null,
        sending: false,
        streamingText: null,
        branching: false,
        merging: false,
        highlightInsightId: null,
        onCommand,
      }),
    );
  });
  const box = container.querySelector('textarea[aria-label="Message this branch"]') as HTMLTextAreaElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  return { box, onCommand, onSend };
}

describe('ChatPane typed commands', () => {
  it('clears the composer when the command ran', async () => {
    const { box, onCommand, onSend } = await renderAndSubmit('merge that', 'done');
    expect(onCommand).toHaveBeenCalledWith({ kind: 'merge' }, expect.any(Object));
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe('');
  });

  it('puts the text back when the command failed', async () => {
    const { box, onSend } = await renderAndSubmit('never mind', 'failed');
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe('never mind');
  });

  it('sends the text as a message when the command does not apply here', async () => {
    const { onSend } = await renderAndSubmit('merge that', 'unhandled');
    expect(onSend).toHaveBeenCalledWith('merge that');
  });

  it('never treats an ordinary question as a command', async () => {
    const { onCommand, onSend } = await renderAndSubmit('Can I ask about the deadline?', 'done');
    expect(onCommand).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith('Can I ask about the deadline?');
  });
});

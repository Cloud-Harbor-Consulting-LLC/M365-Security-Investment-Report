// @vitest-environment jsdom
/**
 * The keyboard behaviour, tested by actually pressing keys.
 *
 * A focus trap cannot be verified by reading it. These tests mount a real panel in a real
 * document, press Tab and Escape, and assert where focus ended up, which is the only way
 * to know that a keyboard user is not being dropped out of a dialog or stranded behind one.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useDialog, focusableWithin } from './a11y';

function Panel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useDialog(open, onClose);
  if (!open) return null;
  return (
    <aside ref={ref} role="dialog" aria-modal="true" aria-label="Test">
      <button id="a">A</button>
      <button id="b">B</button>
      <button id="c" disabled>
        C
      </button>
    </aside>
  );
}

const host = () => document.getElementById('host')!;

/**
 * Renders and flushes effects.
 *
 * Preact runs useEffect after paint, so a bare render() returns before the dialog has
 * done anything at all, so every assertion here would be checking the state before the
 * behaviour under test ran.
 */
const show = (open: boolean, onClose: () => void = () => {}) => {
  act(() => {
    render(<Panel open={open} onClose={onClose} />, host());
  });
};

const press = (key: string, shiftKey = false) =>
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '<button id="trigger">Open</button><div id="host"></div>';
  // jsdom reports offsetParent as null for everything, which would make the focusable
  // scan return nothing. Give elements a layout box so the visibility filter behaves the
  // way it does in a browser.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.closest('[hidden]') ? null : document.body;
    },
  });
});

describe('a dialog keeps the keyboard inside it', () => {
  it('moves focus into the panel when it opens', () => {
    show(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('wraps forwards from the last control to the first', () => {
    show(true);
    document.getElementById('b')!.focus();
    press('Tab');
    expect(document.activeElement?.id).toBe('a');
  });

  it('wraps backwards from the first control to the last', () => {
    // The case most often missed: without it, Shift+Tab walks out of the dialog and into
    // the page it is covering, which is worse than having no trap at all.
    show(true);
    document.getElementById('a')!.focus();
    press('Tab', true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('never lands on a disabled control', () => {
    show(true);
    const ids = focusableWithin(host().firstElementChild as HTMLElement).map((e) => e.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    show(true, onClose);
    press('Escape');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('gives focus back to whatever opened it', () => {
    // Without this a keyboard user who closes a panel is returned to the top of the
    // document and has to travel back through the entire report.
    const trigger = document.getElementById('trigger') as HTMLButtonElement;
    trigger.focus();

    show(true);
    expect(document.activeElement?.id).toBe('a');

    show(false);
    expect(document.activeElement?.id).toBe('trigger');
  });

  it('does nothing at all while closed', () => {
    const onClose = vi.fn();
    const trigger = document.getElementById('trigger') as HTMLButtonElement;
    trigger.focus();
    show(false, onClose);
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('trigger');
  });
});

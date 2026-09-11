/**
 * Keyboard and screen-reader behaviour that the browser does not give us for free.
 *
 * This report gets projected in meeting rooms and driven from a keyboard while someone
 * talks over it. It is also a security tool, which makes an inaccessible one a poor
 * advertisement for taking care.
 *
 * Everything here is deliberately small and dependency-free. The behaviours a dialog
 * needs (close on Escape, keep focus inside, give focus back when it closes) are a few
 * dozen lines, and a library would be more code than the thing it replaces.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Elements a keyboard can reach. `:not([disabled])` matters because a disabled control
 * still matches the tag selectors, and trapping focus onto one strands the user.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Can this element actually take focus?
 *
 * checkVisibility is the browser's own answer, and it is the only one that accounts for
 * `visibility: hidden`, which is what the closed overlays use, and which offsetParent
 * does not report. Relying on offsetParent alone had this returning controls the browser
 * then silently refused to focus, which would strand the trap on a dead element.
 */
function canTakeFocus(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
  }
  // jsdom and older engines: offsetParent still catches display:none, and a fixed-position
  // element legitimately reports none.
  return el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
}

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(canTakeFocus);
}

/**
 * Makes a panel behave like a modal dialog.
 *
 * Escape closes it, Tab cycles within it rather than escaping into the page behind, and
 * when it closes the focus goes back to whatever opened it. That last part is the one
 * most often missed: without it a keyboard user who closes a panel is returned to the
 * top of the document and has to travel back through the whole report.
 */
export function useDialog(
  open: boolean,
  onClose: () => void,
): RefObject<HTMLElement> {
  const panel = useRef<HTMLElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  /**
   * The close handler is held in a ref, and the effect depends only on `open`.
   *
   * Callers pass an inline arrow, `onClose={() => setOpen(false)}`, which is a new
   * function on every render. Depending on it directly would tear the effect down and
   * rebuild it on every render of the parent: focus pulled into the panel, handed back
   * to the trigger by the cleanup, then pulled in again, with the Escape listener
   * detached in between. Every price keystroke re-renders this parent, so that is a
   * render loop the panel sits inside, not a rare case.
   */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;

    // Remember the trigger before moving focus, not after.
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const node = panel.current;
    if (node) {
      const first = focusableWithin(node)[0];
      if (first) first.focus();
      else {
        // An empty panel still has to receive focus, or the screen reader stays in the
        // page behind and reads nothing of what just opened.
        node.setAttribute('tabindex', '-1');
        node.focus();
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }

      if (e.key !== 'Tab' || !panel.current) return;

      const items = focusableWithin(panel.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      // Wrap at both ends. Without the backwards case, Shift+Tab from the first control
      // walks out of the dialog and into the page it is covering.
      if (e.shiftKey && (active === first || !panel.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Only take focus back if it is still inside the panel being closed. If something
      // else has claimed it in the meantime, stealing it would be the more surprising
      // behaviour.
      const target = restoreTo.current;
      const activeWasInside =
        panel.current && document.activeElement && panel.current.contains(document.activeElement);
      if (target && (activeWasInside || document.activeElement === document.body)) {
        target.focus();
      }
    };
  }, [open]);

  return panel;
}

/**
 * Announces something to a screen reader without moving focus or showing anything.
 *
 * Used when the view changes: sighted users see the panel swap, and without this a
 * screen-reader user gets no indication that pressing a navigation button did anything
 * at all. Politely, so it waits for a pause rather than interrupting.
 */
export function useAnnounce(message: string): void {
  useEffect(() => {
    if (!message) return;
    const id = 'chsi-announcer';
    let region = document.getElementById(id);
    if (!region) {
      region = document.createElement('div');
      region.id = id;
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.className = 'visually-hidden';
      document.body.appendChild(region);
    }
    // Cleared first: setting the same text twice is not a change, and a live region
    // announces changes. Without this, moving away and back is silent.
    region.textContent = '';
    const t = setTimeout(() => {
      region!.textContent = message;
    }, 60);
    return () => clearTimeout(t);
  }, [message]);
}

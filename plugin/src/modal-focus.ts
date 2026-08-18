import type { Modal } from "obsidian";

/**
 * Marks the modal as an accessible modal dialog and keeps Tab focus cycling
 * inside it, so keyboard users on short or narrow hosts can always reach the
 * dialog controls (Save/Cancel) instead of escaping to the background.
 */
export function containModalFocus(modal: Modal): void {
  modal.modalEl.setAttr("role", "dialog");
  modal.modalEl.setAttr("aria-modal", "true");
  modal.modalEl.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      modal.modalEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = activeDocument.activeElement;
    if (event.shiftKey && (active === first || !modal.modalEl.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modal.modalEl.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
}

/**
 * Move the focus to the control behind an error summary link.
 *
 * The target is a field wrapper or a section (applicant data, consent). The
 * control that takes the focus is, in this order: an invalid control, the
 * checked or else the first option of a radio group, the first control a
 * person can reach.
 * Hidden helper inputs of choice groups carry aria-hidden and are skipped.
 */
const FOCUSABLE_SELECTOR = [
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'button',
    'a[href]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[tabindex]'
].join(', ');

function canTakeFocus(element: HTMLElement): boolean {
    if (element.hasAttribute('disabled')) return false;
    // Reka radio groups give every option tabindex -1 until one is checked
    // (roving focus); an option still takes focus by script.
    if (element.getAttribute('tabindex') === '-1' && element.getAttribute('role') !== 'radio') return false;
    if (element.closest('[aria-hidden="true"]')) return false;
    return true;
}

export function focusFormTarget(targetId: string, root: Document = document): boolean {
    const target = root.getElementById(targetId);
    if (!target) return false;

    const candidates = [target, ...target.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter(element => element.matches(FOCUSABLE_SELECTOR) && canTakeFocus(element));
    const radios = candidates.filter(element => element.getAttribute('role') === 'radio');
    const control = candidates.find(element => element.getAttribute('aria-invalid') === 'true')
      ?? radios.find(element => element.getAttribute('aria-checked') === 'true')
      ?? radios[0]
      ?? candidates[0];
    if (!control) return false;

    control.scrollIntoView?.({ block: 'center' });
    control.focus();
    return true;
}

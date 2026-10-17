// Categories that were turned off are hidden from the pickers. Editing an old record that still
// uses one must keep showing it, so that one option is switched back on while the dialog is open.
export function showCurrentCategory(select: HTMLSelectElement, current: string): void {
  select.querySelectorAll<HTMLOptionElement>('option[data-inactive]').forEach((option) => {
    const keep = option.value === current;
    option.disabled = !keep;
    option.hidden = !keep;
  });
}

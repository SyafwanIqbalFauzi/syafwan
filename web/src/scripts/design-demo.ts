// /agent/design: the buttons that open the real dialog and toast, so the catalog shows them as they behave.
import { askConfirm, askNotice, askText } from './dialog';
import { toast } from './toast';

export {};

document.querySelector('[data-demo="confirm"]')?.addEventListener('click', () => {
  void askConfirm({ title: 'Delete this sample?', message: 'Nothing is deleted. This is the confirm dialog.', confirm: 'Delete', danger: true });
});
document.querySelector('[data-demo="text"]')?.addEventListener('click', () => {
  void askText({ title: 'Rename sample', label: 'Name', value: 'Sample', confirm: 'Save' });
});
document.querySelector('[data-demo="notice"]')?.addEventListener('click', () => {
  void askNotice({ title: 'Heads up', message: 'A dialog with one button.', confirm: 'OK' });
});
for (const kind of ['success', 'error'] as const) {
  document.querySelector(`[data-demo="toast-${kind}"]`)?.addEventListener('click', () => toast(kind === 'success' ? 'Saved (sample).' : 'Could not save (sample).', kind));
}

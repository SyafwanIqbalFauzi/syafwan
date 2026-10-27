// "Mark as checked" on /sejarahpersib: tells the server the owner looked at a result, then reloads so
// the tag, the banner and the badge in the sidebar all agree.
import { flash, toast } from './toast';

export {};

document.querySelectorAll<HTMLButtonElement>('[data-check-run]').forEach((button) => {
  button.addEventListener('click', async () => {
    const id = button.dataset.checkRun;
    if (!id || !/^\d+$/.test(id)) return;
    button.disabled = true;
    try {
      const res = await fetch(`/api/sejarahpersib/runs/${id}/check`, { method: 'POST', credentials: 'same-origin' });
      if (res.status === 401) {
        location.href = '/agent/login?next=/sejarahpersib';
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      flash('Marked as checked.');
      location.reload();
    } catch (error) {
      button.disabled = false;
      toast(error instanceof Error ? error.message : 'Could not mark it as checked', 'error');
    }
  });
});

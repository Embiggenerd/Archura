// Shown when a free-plan boundary is hit (site cap, trial time limit, …): offers
// to start the Basic plan rather than surfacing a raw error. Self-contained
// (inline styles, its own escaping) so any surface — dashboard, editor, funnel —
// can call it without pulling in shared CSS.

type UpgradeOrganization = {
  id?: string;
  billing?: { can_manage_billing?: boolean } | null;
} | null | undefined;

const escapeText = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c] as string
  ));

export function showUpgradeModal(organization: UpgradeOrganization, message?: string): void {
  if (document.querySelector('[data-upgrade-modal]')) return; // never stack
  const orgId = organization?.id;
  const canManage = organization?.billing?.can_manage_billing;
  const overlay = document.createElement('div');
  overlay.dataset.upgradeModal = '';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;z-index:2147483000;padding:16px;font-family:Helvetica,Arial,sans-serif';
  const ghost = 'background:white;border:1px solid #d1d5db;color:#111827;padding:8px 14px;border-radius:8px;font-weight:600;cursor:pointer';
  const primary = 'background:#4f46e5;border:none;color:white;padding:8px 14px;border-radius:8px;font-weight:600;cursor:pointer';
  overlay.innerHTML = `
    <div style="background:white;color:#111827;border-radius:16px;padding:26px;width:min(420px,92vw);box-shadow:0 20px 40px rgba(0,0,0,.25)">
      <h2 style="margin:0 0 6px;font-size:1.15rem">You've reached your plan's limit</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:.9rem">${escapeText(message || "This plan's limit is reached.")} Start the Basic plan — 3 subdomains and 10 designs, free for 14 days, then $5/month.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button data-close style="${ghost}">Not now</button>
        ${orgId && canManage ? `<button data-upgrade style="${primary}">Start Basic trial</button>` : ''}
      </div>
      <p data-err style="color:#dc2626;font-size:.85rem;min-height:1em;margin:8px 0 0"></p>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]')?.addEventListener('click', close);
  overlay.querySelector('[data-upgrade]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    const response = await fetch(`/api/organizations/${encodeURIComponent(orgId as string)}/billing/checkout`, {
      method: 'POST',
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (response?.ok && body?.url) {
      location.href = body.url;
      return;
    }
    button.disabled = false;
    const err = overlay.querySelector('[data-err]');
    if (err) err.textContent = body?.error?.message ?? body?.error ?? 'Could not start checkout.';
  });
  document.body.appendChild(overlay);
}

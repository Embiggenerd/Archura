// Shown when a free-plan boundary is hit (site cap, trial time limit, …): a short
// nudge that sends the user to the plans page rather than surfacing a raw error.
// Self-contained (inline styles, its own escaping) so any surface — dashboard,
// editor, funnel — can call it without pulling in shared CSS.

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
  // Carry the org so the plans page can offer the right upgrade in context.
  const plansHref = orgId ? `/pricing/?organization=${encodeURIComponent(orgId)}` : '/pricing/';
  const overlay = document.createElement('div');
  overlay.dataset.upgradeModal = '';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;z-index:2147483000;padding:16px;font-family:Helvetica,Arial,sans-serif';
  const ghost = 'background:white;border:1px solid #d1d5db;color:#111827;padding:8px 14px;border-radius:8px;font-weight:600;cursor:pointer;text-decoration:none';
  const primary = 'background:#4f46e5;border:none;color:white;padding:8px 14px;border-radius:8px;font-weight:600;cursor:pointer;text-decoration:none';
  overlay.innerHTML = `
    <div style="background:white;color:#111827;border-radius:16px;padding:26px;width:min(420px,92vw);box-shadow:0 20px 40px rgba(0,0,0,.25)">
      <h2 style="margin:0 0 6px;font-size:1.15rem">You've reached your plan's limit</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:.9rem">${escapeText(message || "This plan's limit is reached.")} Upgrade to keep building — compare plans and pick the one that fits.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
        <button data-close style="${ghost}">Not now</button>
        <a data-upgrade href="${plansHref}" style="${primary}">Upgrade plan</a>
      </div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]')?.addEventListener('click', close);
  document.body.appendChild(overlay);
}

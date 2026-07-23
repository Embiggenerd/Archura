// Funnel chrome shared by the pages that host the editor (edit page, front
// page): deploy + sign-in modals over the anonymous <archura-editor>. Injects
// its own styles so any host page can import it without CSS coordination.
import { defaultComponents } from '../src/components/index.ts';
import { buildEmbedModules } from '../src/component-data/embed.ts';

const STYLE_ID = 'archura-funnel-ui-style';
const CSS = `
.overlay {
  position: fixed; inset: 0; background: rgba(17, 24, 39, 0.45);
  display: grid; place-items: center; z-index: 50;
}
.modal { background: white; color: #111827; border-radius: 16px; padding: 28px; width: min(440px, 92vw); }
.modal h2 { margin: 0 0 4px; font-size: 1.2rem; }
.modal p { margin: 0 0 16px; color: #6b7280; font-size: 0.9rem; }
.modal a { color: #4f46e5; }
.modal form { display: flex; flex-direction: column; gap: 10px; }
.modal input {
  padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.95rem;
  background: white; color: #111827;
}
.modal button {
  padding: 10px 18px; border: none; border-radius: 8px;
  background: #111827; color: white; font-weight: 600; cursor: pointer; font-size: 0.95rem;
}
.modal .error { color: #dc2626; font-size: 0.85rem; min-height: 1.2em; margin: 0; }
.modal .spin {
  width: 32px; height: 32px; margin: 8px auto; border: 3px solid #e5e7eb;
  border-top-color: #4f46e5; border-radius: 50%; animation: archura-spin 0.8s linear infinite;
}
@keyframes archura-spin { to { transform: rotate(360deg); } }
`;

/** Injects the overlay/modal styles. Host pages that build their own
 *  `.overlay` elements (the claim screen) must call this up front. */
export function ensureFunnelStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
const ensureStyles = ensureFunnelStyles;

export function showOverlay(innerHtml) {
  ensureStyles();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal">${innerHtml}</div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  return overlay;
}

// The dev mailbox is a local-testing convenience and does not exist in
// production; only surface it when the page is actually served from localhost.
export function isLocalDev() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

export function checkEmailHtml(email) {
  return `
    <h2>Check your email</h2>
    <div class="spin"></div>
    <p>We sent a confirmation link to <strong>${email}</strong>.
       Click it to publish your component — your work is safe until then.</p>
    ${isLocalDev() ? '<p><a href="/dev-mail/">Running locally? Open the dev mailbox.</a></p>' : ''}`;
}

// Debounced live availability hint for a site-name input: says taken/reserved
// before the user submits. Quiet while typing or on transient errors — the
// submit path's 409 remains the authoritative, race-proof check.
export function attachSiteAvailability(input, hint) {
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    hint.textContent = '';
    const site = input.value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(site)) return;
    timer = setTimeout(async () => {
      const res = await fetch(`/api/site-availability?site=${encodeURIComponent(site)}`).catch(() => null);
      const body = res?.ok ? await res.json().catch(() => null) : null;
      if (!body || input.value.trim().toLowerCase() !== site) return; // stale or unknown
      if (body.available) {
        hint.style.color = '#16a34a';
        hint.textContent = `${site}.archura.ai is available`;
      } else if (body.reason === 'reserved') {
        hint.style.color = '#dc2626';
        hint.textContent = `“${site}” is reserved — pick another name`;
      } else if (body.reason === 'taken') {
        hint.style.color = '#dc2626';
        hint.textContent = `${site}.archura.ai is taken — pick another name`;
      }
    }, 400);
  });
}

export function showRegisterModal() {
  const overlay = showOverlay(`
    <h2>Sign in or register</h2>
    <p>Enter your email and we'll send you a sign-in link — new emails get
       an account automatically.</p>
    <form><input name="email" type="email" placeholder="you@example.com" required />
    <button type="submit">Send link</button></form>
    <p class="error"></p>`);
  overlay.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = overlay.querySelector('input').value.trim();
    const errorEl = overlay.querySelector('.error');
    const button = overlay.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Sending…';
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    if (!res || !res.ok) {
      button.disabled = false;
      button.textContent = 'Send link';
      errorEl.textContent =
        res?.status === 429 ? 'Too many attempts — wait a bit and try again.' :
        res?.status === 503 ? 'Registration is unavailable (core not running).' :
        'Could not send the link.';
      return;
    }
    overlay.querySelector('.modal').innerHTML = checkEmailHtml(email);
  });
}

/** Deploy the editor's current state (funnel flow 2). `components` is the
 *  host page's definition list when it overrides module URLs (built app). */
export function showDeployModal(editorEl, components) {
  const componentPath = editorEl.componentPath ?? [];
  const overlay = showOverlay(`
    <h2>Publish your component</h2>
    <p>Pick a name and enter your email — we'll send a link with its hosted preview and embed code.</p>
    <form>
      <div style="display:flex;align-items:center;gap:8px">
        <input name="site" placeholder="my-site" autocomplete="off"
               pattern="[a-z0-9][a-z0-9\\-]{1,38}[a-z0-9]" required style="flex:1;min-width:0" />
        <span style="color:#6b7280;white-space:nowrap">.archura.ai</span>
      </div>
      <p class="site-hint" style="margin:4px 0 0;font-size:.85rem;min-height:1.1em"></p>
      <input name="email" type="email" placeholder="you@example.com" required />
      <button type="submit">Publish component</button>
    </form>
    <p class="error"></p>`);
  attachSiteAvailability(overlay.querySelector('input[name="site"]'), overlay.querySelector('.site-hint'));
  overlay.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const site = overlay.querySelector('input[name="site"]').value.trim().toLowerCase();
    const email = overlay.querySelector('input[name="email"]').value.trim();
    const errorEl = overlay.querySelector('.error');
    const button = overlay.querySelector('button[type="submit"]');
    if (button.disabled) return;
    // Immediate feedback: the save + module build + upload below take a
    // moment, and a silent dead modal reads as a hang.
    button.disabled = true;
    button.textContent = 'Publishing…';
    errorEl.textContent = '';
    const controller = editorEl.getController();
    if (!controller) { button.disabled = false; button.textContent = 'Publish component'; return; }
    const [artifact] = await controller.save();
    const modules = buildEmbedModules(artifact, components ?? defaultComponents, location.href);
    const targetName = `${componentPath.at(-1)}.js`;
    const targetModule = modules.find((module) => module.name === targetName);
    const res = await fetch('/api/deploys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site,
        email,
        artifact,
        targetEmbed: targetModule ? { name: targetModule.name, tag: targetModule.tag } : null,
        embeds: Object.fromEntries(modules.map((m) => [m.name, m.source])),
      }),
    }).catch(() => null);
    if (!res || !res.ok) {
      button.disabled = false;
      button.textContent = 'Publish component';
      errorEl.textContent =
        res?.status === 409 ? 'That site name is already claimed — pick another.' :
        res?.status === 403 ? 'Deploys are currently restricted.' :
        res?.status === 429 ? 'Too many attempts — wait a bit and try again.' :
        res?.status === 503 ? 'Deploys are unavailable (core not running).' :
        'Deploy failed — try again.';
      return;
    }
    overlay.querySelector('.modal').innerHTML = checkEmailHtml(email);
  });
}

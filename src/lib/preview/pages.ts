/**
 * The few pages the gateway renders itself (access screen, unavailable, not found). Plain HTML with
 * inline CSS and no scripts: they must work without the portfolio's layout, i18n, analytics or CSP.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only same-site absolute paths may be a post-login destination (no open redirect). */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || value.length > 2000) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) {
    return "/";
  }
  if (value.startsWith("/__preview")) return "/";
  return value;
}

/** Content-Security-Policy for the gateway's own pages only (never applied to the proxied site). */
export const GATEWAY_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const STYLES = `
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0a0e1b;
background-image:radial-gradient(circle at 85% 0%,rgba(111,95,240,.28),transparent 55%);color:#f4f1ec;
display:flex;align-items:center;justify-content:center;padding:24px;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:26rem}
.mark{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:14px;
border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);font-weight:600;letter-spacing:-.02em}
.eyebrow{margin:28px 0 0;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:#8f80f8;font-weight:600}
h1{margin:10px 0 0;font-size:1.75rem;line-height:1.15;letter-spacing:-.03em;font-weight:600}
p{color:#a6abbf;line-height:1.55;margin:12px 0 0}
form{margin-top:28px}
label{display:block;font-size:.85rem;font-weight:500;margin-bottom:8px}
input{width:100%;height:48px;border-radius:12px;border:1px solid rgba(255,255,255,.14);
background:rgba(255,255,255,.05);color:#f4f1ec;padding:0 16px;font:inherit;letter-spacing:.04em}
input:focus{outline:2px solid #8f80f8;outline-offset:2px;border-color:transparent}
button{margin-top:14px;width:100%;height:48px;border:0;border-radius:999px;background:#6f5ff0;color:#fff;
font:inherit;font-weight:600;cursor:pointer}
button:hover{background:#7d6ff3}button:focus-visible{outline:2px solid #dcd7ff;outline-offset:3px}
.error{margin-top:14px;padding:10px 14px;border-radius:12px;border:1px solid rgba(242,135,127,.45);color:#f2877f;font-size:.9rem}
footer{margin-top:36px;font-size:.78rem;color:#737991}
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="nl-BE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="same-origin">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<span class="mark" aria-hidden="true">IV</span>
${body}
<footer>ianverlinden.com</footer>
</main>
</body>
</html>`;
}

export type AccessPageOptions = { error?: "invalid" | "limited"; next?: string };

export function accessPage({ error, next = "/" }: AccessPageOptions = {}): string {
  const message =
    error === "invalid"
      ? "Ongeldige toegangscode."
      : error === "limited"
        ? "Te veel pogingen. Probeer het later opnieuw."
        : "";
  return layout(
    "Privé preview — Ian Verlinden",
    `<p class="eyebrow">Client preview</p>
<h1>Private project preview</h1>
<p>Deze preview is alleen beschikbaar voor genodigden.</p>
<form method="post" action="/__preview/login" autocomplete="off">
<input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}">
<label for="code">Toegangscode</label>
<input id="code" name="code" type="password" required autofocus autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="200"${message ? ' aria-invalid="true" aria-describedby="err"' : ""}>
${message ? `<div class="error" id="err" role="alert">${escapeHtml(message)}</div>` : ""}
<button type="submit">Preview bekijken</button>
</form>`,
  );
}

export function unavailablePage(): string {
  return layout(
    "Preview niet beschikbaar — Ian Verlinden",
    `<p class="eyebrow">Client preview</p>
<h1>Preview niet beschikbaar</h1>
<p>Deze preview is momenteel niet beschikbaar.</p>`,
  );
}

export function notFoundPage(): string {
  return layout(
    "Pagina niet gevonden — Ian Verlinden",
    `<p class="eyebrow">404</p>
<h1>Pagina niet gevonden</h1>
<p>Dit adres bestaat niet.</p>`,
  );
}

export function targetUnavailablePage(): string {
  return layout(
    "Preview tijdelijk niet beschikbaar — Ian Verlinden",
    `<p class="eyebrow">Client preview</p>
<h1>Tijdelijk niet beschikbaar</h1>
<p>Preview tijdelijk niet beschikbaar. Probeer het over enkele ogenblikken opnieuw.</p>`,
  );
}

export const ROBOTS_DISALLOW_ALL = "User-agent: *\nDisallow: /\n";

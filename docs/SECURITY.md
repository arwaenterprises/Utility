# Security checks - record

Public page for users: `Utility App/security.html`. This file keeps the dated results of the independent checks.
Results are point-in-time snapshots; re-run after big changes and add a new dated row. Not an audit.

| Date | Tool | Result |
|---|---|---|
| 2026-10-01 | Google Safe Browsing site status | "No unsafe content found" |
| 2026-10-01 | urlscan.io (private scan) | "No classification"; Google Safe Browsing: no classification |
| 2026-10-01 | Qualys SSL Labs | A+ on all 4 servers |
| 2026-10-01 | Mozilla HTTP Observatory (before hardening) | B 70/100, 10/12 passed. Failed: CSP only report-only (-25), no SRI (-5) |
| 2026-10-01 | VirusTotal | https://www.virustotal.com/gui/url/814c82e68de336176d5d69ebda4b300a7452b60d6384977f09ba84b938c4aa3d (result to be noted by the owner) |

## Hardening done 2026-10-01 (v38)
- CSP is now enforced (not report-only); script-src is `'self' 'unsafe-inline'` only.
- All five libraries are self-hosted in `Utility App/vendor/` (versions in `vendor/README.txt`), so no external scripts and no SRI needed.
- `/.well-known/security.txt` added. Re-run Observatory after deploy and add the new grade here.
- Still open: `'unsafe-inline'` for scripts (inline onclick handlers) and styles keeps Observatory below A+; GitHub Dependabot / secret scanning to enable in repo settings; Google OAuth consent-screen verification.

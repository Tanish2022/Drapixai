# Approved brand source files

The owner supplied these files on 31 October 2026 as the new logo and favicon:

| Repository source | Owner's filename | SHA-256 |
| --- | --- | --- |
| `logo.png` | `Logo new.png` | `1987d1f9e8b7235789a85563072f79e2c68a48b6b18df53431277592a7e13e4d` |
| `favicon.png` | `Favicon new.png` | `5db55addd7635e2aaa445238b307ed111b97d9378444d062527a3a875a19ce5f` |

These copies preserve the supplied bytes. The logo is 2172 × 724 with an opaque background; the favicon is 1254 × 1254 with alpha. Do not infer missing creator/licence/release records from this source designation.

From the repository root, intentionally regenerate derivatives with:

```text
node apps/web/scripts/prepare-brand-assets.mjs
node apps/web/scripts/render-social-preview.mjs
```

The first command uses existing Sharp tooling for resizing/encoding. The second requires Playwright/Chrome (`DRAPIXAI_PLAYWRIGHT_MODULE` can point to its installed location) and exports the local HTML/CSS card with network requests blocked. The deployed application serves static assets and needs neither tool at runtime. Review exports visually and update cache versions when changing the source identity.

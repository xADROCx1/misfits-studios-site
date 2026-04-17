# Misfits Studios — Storefront

The web hub for every Misfits Studios digital product: Rust plugins, desktop apps, and software. Checkout is handled by **Lemon Squeezy**; the site is a static frontend deployed on **Cloudflare Pages**.

## How it works

- **Single source of truth:** [`products.json`](products.json) — every product on the site.
- **Dynamic rendering:** [`assets/store.js`](assets/store.js) fetches the manifest and renders product cards into any `<div id="product-grid" data-category="plugin|app|all">` on the page.
- **Checkout:** BUY buttons open the Lemon Squeezy overlay in-page (no redirect). Script: `https://app.lemonsqueezy.com/js/lemon.js`.
- **Auto-sync:** [`.github/workflows/sync.yml`](.github/workflows/sync.yml) runs every 6 hours, pulls fresh product data from Lemon Squeezy via API, and commits any changes. Cloudflare Pages redeploys on push.

## Layout

```
.
├── index.html, plugins.html, apps.html, about.html, support.html, terms.html
├── products.json           ← products catalog
├── assets/
│   └── store.js            ← dynamic product renderer
├── scripts/
│   ├── sync-from-lemonsqueezy.js   ← LS API → products.json
│   └── .env.example
├── .github/workflows/sync.yml      ← scheduled auto-sync
├── DEPLOY.md               ← full setup & deployment guide
└── README.md               ← this file
```

## Local development

Just open `index.html` in a browser. No build step.

## Sync products manually

```bash
cp scripts/.env.example scripts/.env
# edit scripts/.env and paste your Lemon Squeezy API key
node scripts/sync-from-lemonsqueezy.js
```

## Deploying

See [DEPLOY.md](DEPLOY.md) for the full walkthrough (Lemon Squeezy setup, Cloudflare Pages, GitHub Actions secrets, custom domain).

## Product catalog

48 products at catalog value of $417.53. See [products.json](products.json) for the full list.

---

Built by [xADROCx1](https://github.com/xADROCx1). No rules. Ship it.

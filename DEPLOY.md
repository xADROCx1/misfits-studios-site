# MISFITS STUDIOS — Deploy & Automation Guide

The store supports **two** payment backends, both wired up:

| Feature | Lemon Squeezy | Paddle |
|---|---|---|
| Create Product via API | ❌ (dashboard only) | ✅ (`scripts/bulk-create-paddle-products.js`) |
| Sync prices/URLs via API | ✅ | ✅ |
| Merchant of record (handles VAT) | ✅ | ✅ |
| License key auto-generation | ✅ | ❌ (roll your own via webhook) |
| File hosting + delivery | ✅ | ❌ (deliver via your own webhook) |
| Overlay checkout JS | ✅ (`lemon.js`) | ✅ (`paddle.js`) |

**Recommended:** Lemon Squeezy for simplicity (less infrastructure work), Paddle for full automation. Your `products.json` can hold both sets of IDs — `store.js` will prefer Paddle if both are present.

**Domain:** `https://misfits-studios.com` (Cloudflare Registrar, auto-renews $10.46/yr).

---

## ⚡ One-command Paddle go-live

If you're using Paddle (verified and ready), the entire pipeline is:

```bash
# 1. Put your two Paddle tokens into scripts/.env:
#    PADDLE_API_KEY=pdl_live_apikey_...                (from vendors.paddle.com/authentication)
#    PADDLE_SANDBOX_API_KEY=pdl_sdbx_apikey_...        (optional, for sandbox testing)
#    PADDLE_CLIENT_TOKEN=live_...                      (browser-side token, same page)
cp scripts/.env.example scripts/.env
${EDITOR:-notepad} scripts/.env

# 2. Preview what will happen (no API calls, no commits)
node scripts/go-live-paddle.js --sandbox --dry-run

# 3. Run it in SANDBOX first (safe — creates products in your Paddle sandbox only)
node scripts/go-live-paddle.js --sandbox

# 4. When satisfied, run it LIVE (will prompt for "yes, go live" confirmation)
node scripts/go-live-paddle.js
```

Each `go-live-paddle` invocation runs 5 phases automatically:
1. Pre-flight checks (keys present, products.json valid)
2. Bulk-creates all 48 products + prices + checkout URLs in Paddle via API
3. Syncs the new Paddle IDs + URLs back into `products.json`
4. Injects the client-side token into every HTML `<head>` (so Paddle.js overlays work)
5. `git add + commit + push` → Cloudflare auto-redeploys (~30s)

Flags:
- `--sandbox` — use sandbox API key (recommended first run)
- `--dry-run` — preview without any API calls or file changes
- `--no-commit` — skip phase 5 (inspect changes before pushing yourself)
- `--only=bulk` / `--only=sync` / `--only=inject` / `--only=commit` — run one phase only
- `--yes` — skip the "yes, go live" prompt (for CI/automation)

---

## Architecture at a glance

```
  ┌──────────────────────────┐
  │  Lemon Squeezy dashboard │  ← you edit products here
  │  (prices, files, VAT)    │
  └───────────┬──────────────┘
              │ REST API (Bearer token)
              ▼
  ┌──────────────────────────┐
  │  scripts/sync-from-      │  ← syncs prices + buy URLs into products.json
  │  lemonsqueezy.js         │
  └───────────┬──────────────┘
              │ writes
              ▼
  ┌──────────────────────────┐
  │  products.json           │  ← single source of truth for the site
  └───────────┬──────────────┘
              │ fetched at page load
              ▼
  ┌──────────────────────────┐
  │  index.html / plugins.html / apps.html │
  │  + assets/store.js       │  ← renders cards dynamically
  │  + lemon.js overlay      │  ← checkout opens in-page modal
  └──────────────────────────┘
```

Single source of truth = **Lemon Squeezy**. Products.json is derived. The HTML is a thin shell that reads the manifest.

---

## STEP 1 — Create a Lemon Squeezy API key

1. Go to **https://app.lemonsqueezy.com/settings/api**
2. Click **Create API key**
3. Name it `misfits-storefront-sync`
4. Copy the key (shown once — if you lose it, create a new one)

## STEP 2 — Drop the key into the sync script

1. Copy `scripts/.env.example` → `scripts/.env`
2. Paste your API key into `LEMONSQUEEZY_API_KEY=...`
3. (Optional) If you have multiple LS stores, get the store ID from the LS dashboard URL and paste into `LEMONSQUEEZY_STORE_ID=`

The `.env` file is git-ignored — it will never be committed.

## STEP 3 — Create your products in Lemon Squeezy

Lemon Squeezy does **not** support programmatic product creation (no API endpoint, no bulk CSV import — we verified). Products must be created one-by-one in the dashboard.

**To make that fast, use the paste-sheet helper** — open these two URLs side-by-side in your browser:

1. https://misfits-studios.com/admin/ls-paste-sheet.html — 48 products, each with one-click COPY buttons for name/price/description, and a "✓ Done" checkbox that greys the card out so you can track progress
2. https://app.lemonsqueezy.com/products/new — the LS "New Product" panel

Workflow per product:

1. Click **+ NEW PRODUCT** on the paste sheet (opens LS in new tab)
2. In LS: paste the **name**, upload the `.cs` file (paste sheet shows the exact path), paste the **price in cents** (LS wants cents), paste the **description**
3. Turn on **Generate license keys** for paid plugins (auto-creates per-buyer keys)
4. **Publish**
5. Back on paste sheet: check the **✓ Done** box — its state persists in localStorage so you can leave and resume

After all 48 are in LS, run the sync (Step 4) — that pulls `buy_now_url` and `variant_id` down into `products.json` and commits.

**Naming must match:** The product names in LS must match (case-insensitive or slug-match) the entries in `products.json`. If you change a name in LS, update `products.json` to match, or the sync will append it as a new "unsorted" entry.
5. **Licensing** — turn on **License keys** for paid plugins. LS auto-generates one per buyer.
6. **Publish**.

For `MisfitsUI`, set it to **free** / `$0` — it's a dependency, not a revenue product.

## STEP 4 — Run the sync

```bash
cd "Website store"
node scripts/sync-from-lemonsqueezy.js
```

You should see:

```
→ Loading local products.json…
→ Fetching products from Lemon Squeezy…
  found 3 product(s) in LS
  ✓ matched "Dev2Discord" → dev2discord
  ✓ matched "MisfitsUI" → misfitsui
  ✓ matched "MisfitsCommands" → misfitscommands
✓ Done. Updated 3 local product(s), appended 0 new one(s).
```

Open `products.json` — `buy_url` and `variant_id` should now be filled in. Open `index.html` in a browser; the cards render and BUY buttons open the LS overlay checkout.

## STEP 5 — Deploy to Cloudflare Pages (free, fast, custom domain)

1. **Create a GitHub repo**
   - Sign in at https://github.com, click **New repository**, name it `misfits-studios-store`, set **Public** (or **Private** — both work on Cloudflare Pages)
   - Locally in the `Website store/` folder:
     ```bash
     git init
     git add .
     git commit -m "initial storefront"
     git branch -M main
     git remote add origin https://github.com/YOUR_USERNAME/misfits-studios-store.git
     git push -u origin main
     ```

2. **Connect Cloudflare Pages**
   - Create a free account at https://cloudflare.com
   - **Workers & Pages → Create application → Pages → Connect to Git**
   - Pick the `misfits-studios-store` repo
   - Build settings: leave **Build command** empty, **Output directory** = `/` (or leave blank)
   - Save and deploy. You'll get a free URL like `misfits-studios-store.pages.dev`

3. **Wire your custom domain** (optional but nice)
   - Buy a domain (~$10/yr at **Porkbun** or **Namecheap**) — e.g. `misfitsstudios.com`
   - In Cloudflare Pages: **Custom domains → Set up a custom domain**
   - Follow the DNS prompts (Cloudflare usually auto-configures if the domain is on Cloudflare DNS)

Site is live. Any `git push` = auto-deploy in ~30 seconds.

## STEP 6 — Automate the product sync (two options)

### Option A: Manual (simplest)

After editing a product in LS:
```bash
node scripts/sync-from-lemonsqueezy.js
git add products.json
git commit -m "sync: updated pricing"
git push
```

Or if using Paddle:
```bash
# First time: bulk-create all 48 products from products.json
node scripts/bulk-create-paddle-products.js --sandbox --dry-run   # preview
node scripts/bulk-create-paddle-products.js --sandbox             # sandbox for testing
node scripts/bulk-create-paddle-products.js                       # live

# Ongoing: sync prices/URLs from Paddle → products.json
node scripts/sync-from-paddle.js
git add products.json && git commit -m "sync: Paddle prices" && git push
```

### Option B: GitHub Action (fully automated)

Create `.github/workflows/sync.yml`:

```yaml
name: Sync Lemon Squeezy → products.json
on:
  schedule:
    - cron: '0 */6 * * *'   # every 6 hours
  workflow_dispatch:         # run manually anytime
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node scripts/sync-from-lemonsqueezy.js
        working-directory: Website store
        env:
          LEMONSQUEEZY_API_KEY: ${{ secrets.LEMONSQUEEZY_API_KEY }}
      - run: |
          git config user.name github-actions
          git config user.email actions@github.com
          git add "Website store/products.json"
          git diff --staged --quiet || git commit -m "sync: LS products"
          git push
```

Then in **GitHub repo → Settings → Secrets and variables → Actions → New repository secret** add `LEMONSQUEEZY_API_KEY`.

Every 6 hours (or on manual trigger), the action pulls fresh data from LS and commits any changes. Cloudflare Pages auto-deploys. Zero manual work.

### Option C: Webhook-driven (instant)

LS can fire a webhook on product change. Point it at a Cloudflare Worker that triggers a GitHub Action `workflow_dispatch`. Ping me when you want this — it's a ~20-line Worker.

---

## Adding a new plugin — the workflow from here on

1. Build the plugin in `plugins/<Name>/`
2. Add a product in Lemon Squeezy (upload the `.cs` or zip)
3. Add an entry to `products.json` with name/category/features/tagline (or let the sync auto-append it and edit after)
4. Commit + push. Live in 30 seconds.

---

## Troubleshooting

**Cards don't render on the site:**
- Open browser DevTools → Network tab → check `products.json` loaded (200 OK)
- Check the Console for JS errors
- The HTML page must have a `<div id="product-grid" data-category="plugin"></div>` (or `"app"` or `"all"`) somewhere for cards to render into. If you want the old hand-coded cards back instead, ignore store.js.

**BUY button redirects instead of opening overlay:**
- Check `lemon.js` script tag is on the page
- Check the anchor has `class="lemonsqueezy-button"` (store.js adds this when `overlay_enabled: true` in the manifest)
- Try opening DevTools Console and running `window.createLemonSqueezy()` manually

**Sync says "401 Unauthorized":**
- API key is wrong or expired. Create a new one in LS dashboard.

**Sync says "no products found":**
- You haven't published any LS products yet, OR the store ID filter is wrong.

---

*Built different. No rules. Ship it.*

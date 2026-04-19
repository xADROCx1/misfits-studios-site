#!/usr/bin/env node
/**
 * go-live-paddle.js  —  Misfits Studios one-command Paddle launcher
 *
 * Reads the two Paddle tokens from scripts/.env (or prompts for them),
 * then runs the full pipeline in order:
 *
 *   1. Pre-flight checks (keys present, products.json valid, git clean-ish)
 *   2. bulk-create-paddle-products.js    (creates 48 products + prices + checkout URLs)
 *   3. sync-from-paddle.js               (pulls IDs and URLs back into products.json)
 *   4. inject-paddle-token.js            (puts client-side token into every HTML page)
 *   5. git add + commit + push           (triggers Cloudflare redeploy)
 *
 * Flags:
 *   --sandbox      Use PADDLE_SANDBOX_API_KEY instead of live key (recommended first run)
 *   --dry-run      Preview steps 2 & 3 without hitting Paddle or mutating products.json
 *   --no-commit    Skip step 5 (leaves changes staged but not pushed)
 *   --only=<step>  Run a single phase (bulk|sync|inject|commit)
 *   --yes          Skip the "are you sure?" confirmation before live creation
 *
 * Usage:
 *   cp scripts/.env.example scripts/.env       # if not already done
 *   # then edit scripts/.env and paste:
 *   #   PADDLE_API_KEY=pdl_live_apikey_...
 *   #   PADDLE_SANDBOX_API_KEY=pdl_sdbx_apikey_...  (optional)
 *   #   PADDLE_CLIENT_TOKEN=live_...
 *   node scripts/go-live-paddle.js --sandbox --dry-run     # preview
 *   node scripts/go-live-paddle.js --sandbox               # test in sandbox
 *   node scripts/go-live-paddle.js                          # go LIVE (prompts confirm)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = __dirname;

// ---- arg parsing ----
const args = process.argv.slice(2);
const IS_SANDBOX = args.includes('--sandbox');
const IS_DRY_RUN = args.includes('--dry-run');
const NO_COMMIT = args.includes('--no-commit');
const ASSUME_YES = args.includes('--yes') || args.includes('-y');
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;

// ---- env loader ----
function loadEnv() {
  const envPath = path.join(SCRIPTS, '.env');
  if (!fs.existsSync(envPath)) return false;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
  return true;
}
const envFound = loadEnv();

// ---- color helpers (no deps) ----
const c = {
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim:  s => `\x1b[2m${s}\x1b[0m`,
  red:  s => `\x1b[31m${s}\x1b[0m`,
  green:s => `\x1b[32m${s}\x1b[0m`,
  yel:  s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
};

function header(s) { console.log('\n' + c.bold(c.cyan('━━━  ' + s + '  ━━━')) + '\n'); }
function ok(s) { console.log(c.green('✓ ') + s); }
function info(s) { console.log(c.dim('  ' + s)); }
function warn(s) { console.log(c.yel('! ') + s); }
function err(s) { console.log(c.red('✗ ') + s); }

// ---- prompt helper ----
function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// ---- run helper ----
function run(scriptName, extraArgs = []) {
  const scriptPath = path.join(SCRIPTS, scriptName);
  info(`→ node ${scriptName} ${extraArgs.join(' ')}`);
  const res = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  if (res.status !== 0) throw new Error(`${scriptName} exited with code ${res.status}`);
}

function runGit(args) {
  info(`→ git ${args.join(' ')}`);
  const res = spawnSync('git', args, {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  return res.status;
}

// ---- main ----
(async () => {
  header('MISFITS · PADDLE GO-LIVE');
  console.log(c.dim(`  mode: ${IS_SANDBOX ? 'SANDBOX' : c.red('LIVE')}${IS_DRY_RUN ? '  |  ' + c.yel('DRY RUN') : ''}`));
  console.log(c.dim(`  cwd:  ${ROOT}\n`));

  // ---- pre-flight ----
  header('1. Pre-flight');

  if (!envFound) {
    err('scripts/.env not found. Copy from scripts/.env.example and fill in:');
    info('  PADDLE_API_KEY=pdl_live_apikey_...');
    info('  PADDLE_SANDBOX_API_KEY=pdl_sdbx_apikey_...  (optional)');
    info('  PADDLE_CLIENT_TOKEN=live_...');
    process.exit(1);
  }
  ok('scripts/.env loaded');

  const apiKey = IS_SANDBOX ? process.env.PADDLE_SANDBOX_API_KEY : process.env.PADDLE_API_KEY;
  const clientToken = process.env.PADDLE_CLIENT_TOKEN;

  if (!apiKey) {
    err(`${IS_SANDBOX ? 'PADDLE_SANDBOX_API_KEY' : 'PADDLE_API_KEY'} is not set in scripts/.env`);
    info('  Get one at https://' + (IS_SANDBOX ? 'sandbox-' : '') + 'vendors.paddle.com/authentication');
    process.exit(1);
  }
  ok(`${IS_SANDBOX ? 'sandbox' : 'live'} API key present  (${apiKey.slice(0, 18)}...)`);

  if (!clientToken) {
    warn('PADDLE_CLIENT_TOKEN not set — step 4 (token inject) will be skipped.');
    info('  Get one at https://' + (IS_SANDBOX ? 'sandbox-' : '') + 'vendors.paddle.com/authentication (Client-side tokens section)');
  } else {
    ok(`client-side token present     (${clientToken.slice(0, 14)}...)`);
  }

  const productsPath = path.join(ROOT, 'products.json');
  if (!fs.existsSync(productsPath)) {
    err('products.json not found at repo root'); process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  const live = (manifest.products || []).filter(p => p.status === 'live');
  ok(`products.json valid  (${live.length} live products)`);

  // ---- confirm for LIVE ----
  if (!IS_SANDBOX && !IS_DRY_RUN && !ASSUME_YES && !onlyArg) {
    console.log();
    warn(c.red(c.bold(`About to create ${live.length} LIVE products in your Paddle catalog. This cannot be undone without manual deletion.`)));
    info('Run with --sandbox first to test without real products.');
    const ans = await prompt(c.bold('  Type "yes, go live" to continue: '));
    if (ans.toLowerCase() !== 'yes, go live') {
      err('Aborted.');
      process.exit(0);
    }
  }

  const extraFlags = [];
  if (IS_SANDBOX) extraFlags.push('--sandbox');
  if (IS_DRY_RUN) extraFlags.push('--dry-run');

  // ---- phase: bulk create ----
  if (!onlyArg || onlyArg === 'bulk') {
    header('2. Bulk-create products in Paddle');
    try {
      run('bulk-create-paddle-products.js', extraFlags);
      ok('bulk-create complete');
    } catch (e) {
      err(`bulk-create failed: ${e.message}`);
      process.exit(1);
    }
  }

  // ---- phase: sync ----
  if (!onlyArg || onlyArg === 'sync') {
    header('3. Sync Paddle → products.json');
    if (IS_DRY_RUN) {
      info('skipped (dry run)');
    } else {
      try {
        run('sync-from-paddle.js', IS_SANDBOX ? ['--sandbox'] : []);
        ok('sync complete');
      } catch (e) {
        err(`sync failed: ${e.message}`);
        process.exit(1);
      }
    }
  }

  // ---- phase: inject client token ----
  if ((!onlyArg || onlyArg === 'inject') && clientToken && !IS_DRY_RUN) {
    header('4. Inject client-side token into HTML');
    try {
      run('inject-paddle-token.js', [clientToken]);
      ok('token injection complete');
    } catch (e) {
      err(`token injection failed: ${e.message}`);
    }
  }

  // ---- phase: commit + push ----
  if (!onlyArg || onlyArg === 'commit') {
    if (IS_DRY_RUN || NO_COMMIT) {
      header('5. Commit + push');
      info(IS_DRY_RUN ? 'skipped (dry run)' : 'skipped (--no-commit)');
    } else {
      header('5. Commit + push');
      const status = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
      if (!status.stdout.trim()) {
        info('Nothing to commit.');
      } else {
        runGit(['add', 'products.json', 'index.html', 'plugins.html', 'apps.html', 'about.html', 'support.html', 'terms.html', 'privacy.html', 'refund.html', 'changelog.html', '404.html', 'products']);
        const msg = IS_SANDBOX
          ? 'chore(paddle): sync sandbox products + inject client token'
          : 'feat(paddle): live products synced + client token injected';
        const rc = runGit(['-c', 'user.name=Misfits Studios', '-c', 'user.email=misfits@local', 'commit', '-m', msg]);
        if (rc !== 0) {
          warn('commit failed (maybe pre-commit hook?) — left staged');
        } else {
          runGit(['push', 'origin', 'main']);
          ok('pushed to origin/main — Cloudflare redeploying');
        }
      }
    }
  }

  header('DONE');
  ok(`Paddle ${IS_SANDBOX ? 'sandbox' : 'live'} pipeline complete.`);
  console.log();
  info('Next steps:');
  info('  • Verify the live site at https://misfits-studios.com after ~30s of deploy');
  info('  • Click BUY on any product card to confirm the Paddle overlay opens');
  info('  • ' + (IS_SANDBOX ? 'Use test card 4242 4242 4242 4242 to complete a sandbox purchase' : 'You are LIVE — your first real sale is now possible'));
  console.log();
})().catch(e => {
  err('FATAL: ' + e.message);
  process.exit(1);
});

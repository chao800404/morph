# Browser tests

These drive a real Chromium against a running dev server. They are not part of
`pnpm test`, which stays in jsdom and stays fast.

## Running them

```bash
E2E_EMAIL=you@example.com E2E_PASSWORD=... \
E2E_EDITOR_PATH='/store/<storefrontId>/themes/<themeId>/editor?template=index&viewport=desktop' \
pnpm test:e2e
```

Without those variables every test skips, so the command is safe to run
anywhere. Credentials are read from the environment and never committed; the
saved session lands in `e2e/.auth/`, which is ignored by git.

A dev server on port 3000 is reused if one is already running.

## Other browsers

Chromium always runs. Firefox and WebKit are opt-in, because each needs system
libraries this host may not have:

```bash
E2E_BROWSERS=firefox pnpm test:e2e
E2E_BROWSERS=firefox,webkit pnpm test:e2e
```

They are off by default so a missing browser never fails a suite that is
testing something else. Installing their libraries needs root:

```bash
sudo apt-get install -y libx11-xcb1          # Firefox
sudo npx playwright install-deps webkit      # WebKit: GTK + GStreamer, ~80 packages
```

## The publish loop

`e2e/publish.spec.ts` is skipped unless `E2E_ALLOW_PUBLISH=1`. It is not a read:
it builds the theme, creates a release and moves the storefront's production
pointer to it — and in any environment holding Cloudflare credentials it also
uploads and deploys that build. Run it only when you know what your environment
is wired to.

```bash
E2E_ALLOW_PUBLISH=1 pnpm test:e2e
```

Whether a publish reaches Cloudflare is decided by
`createServerThemeWorkerDeployer()`: with `MORPH_LOCAL_THEME_ORIGIN` set and no
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, it forwards to a locally
started Theme Worker and uploads nothing. Adding those credentials changes what
the same button does.

## What these tests change

They edit the theme they run against — a colour, a section order — and put it
back through the editor's own undo. A run that fails partway can leave an edit
behind; the last assertion in each test is the restoration, so a failure there
is telling you the workspace still needs a look.

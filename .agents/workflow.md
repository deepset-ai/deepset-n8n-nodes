# Workflow

## How to work on this project
When asked to build or update a node in this project, follow these steps:

1. Clarify the requirements. Ask for (if not already provided):
   - Which resources and operations the node needs to have
   - The authentication method (API key, OAuth2, etc)
   - Example use case or sample payloads, if available
   Do this **only** if there are multiple options **after** gathering
   information and you are not sure which to pick
2. Decide on the node style (declarative vs programmatic):
   - Prefer declarative-style nodes when:
     - The integration is mostly simple HTTP/REST requests and responses
     - You can express this behavior by mapping parameters to
       URL/query/body/headers
   - Use programmatic-style nodes only when you have at least one of:
     - Multiple dependent API calls are needed per execution
     - Complex control flow or aggregation
     - Responses require heavy transformation that can't be described
       declaratively
   - If you choose programmatic-style, briefly explain **why**
     declarative-style won't work for this particular node
3. Plan before coding:
   - Outline what description the node will have, its resources and
     operations
   - Which credentials the node will use and their properties
   - Confirm the plan, if you are not given one and are generating it
   - **Never start coding without a plan**
4. Implement. Create or update:
   - The node files (`nodes/<n>/<n>.node.ts`)
   - The credentials files (`credentials/<n>.credentials.ts`)
   - Other files with helpers and extracted functions/classes
   - `package.json` (`n8n.nodes` and `n8n.credentials` entries)
5. Quality checks:
   - Build the project to ensure it actually builds
   - Run the linter to make sure that there aren't any warnings or
     errors
   - Ensure UX follows the [n8n UX guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/)
   - Ensure the credentials are secure (sensitive values **are marked as
     `password`**, **no secrets logged** and **there aren't any
     hardcoded secrets**)
   - Run the project, so that the user can manually verify that it works.
     Ask the user on how to run it, and if something goes wrong tell
     them to run it themselves
6. Iterate on the code, if needed, going through the process again:
   - Plan
   - Implement
   - Verify

## Development guidelines
- Use the `n8n-node` CLI tool **whenever possible**, so for stuff like building
  a node, using dev mode with hot-reload linting, etc. Using this tool is the
  best way to make sure the code is of high quality and complies with n8n's
  standards
- **Always** make sure to address any lint/typecheck errors/warnings, unless
  there is a **very specific reason** to ignore/disable it. Linter is your best
  friend to make sure the code is of high quality and complies with n8n's
  standards
- Before making any changes to the code, make sure you've gathered all required
  context and **planned out** what you're going to do. If the plan looks good,
  make sure to stick to it to ensure the code you produce is doing what the
  user expects
- After making changes verify that there are no lint/typecheck issues. Also
  allow the user to manually test the node in n8n to verify that it does what
  is expected
- Make sure to use **proper types whenever possible**
- If you are updating the npm package version, make sure to **update
  CHANGELOG.md** in the root of the repository

## CLI
This project uses n8n's CLI tool for developing community nodes: `n8n-node`. It
is available as a dev dependency and `package.json` has some aliases for common
commands. Short overview of the commands:
- `n8n-node dev` - run n8n with your node in development mode with hot reload.
  This command starts up n8n on `http://localhost:5678` so that the user can
  manually test the node. It also links it to n8n's custom nodes directory
  (`~/.n8n-node-cli/.n8n/custom` by default), so it's available within n8n.
  `--external-n8n` makes it not launch n8n and `--custom-user-folder <path>`
  can be used to specify the folder where user-specific data is stored
  (`~/.n8n-node-cli` is the default)
- `n8n-node build` - compile your node and prepare it for distribution.
- `n8n-node lint` - lint the node in the current directory.
  Use `--fix` flag to automatically fix fixable issues.
- `n8n-node cloud-support` - manage n8n Cloud eligibility.
  If invoked without arguments, show current cloud support status. Invoke
  `n8n-node cloud-support enable` to enable strict mode + default ESLint config
  or `n8n-node cloud-support disable` to allow custom ESLint config (disables
  cloud eligibility)
- `n8n-node release` - publish your community node package to npm.
  This command handles the complete release process using `release-it`:
  - Builds the node
  - Runs linting checks
  - Updates changelog
  - Creates git tags
  - Creates GitHub releases
  - Publishes to npm

## Known issues

### Neither package uses `n8n-node lint` directly — both call `eslint` themselves
`n8n-node lint` always runs `eslint .` (hardcoded, no path-scoping flag — see
`node_modules/@n8n/node-cli/dist/commands/lint.js`), so with `test/` living
inside each package's directory, it would lint test files too. n8n's
cloud-eligible ruleset flags any `import` of `vitest` and use of `setImmediate`
there as n8n Cloud violations, even though `test/` is never part of
`"files": ["dist"]` and can't affect real cloud eligibility — confirmed by the
fact that `npm run cloud-scan` in `packages/haystack-enterprise` (which scans
the actual packed tarball via `@n8n/scan-community-package`, the authoritative
check — see that script's own header comment) passes clean regardless.

`packages/haystack-enterprise` has `n8n.strict: true`, so it hits this: its
ruleset (pulled in via `eslint.config.mjs`) includes the cloud-only rules, and
`n8n.strict: true` also makes `n8n-node lint` verify `eslint.config.mjs` is
byte-identical to n8n's default template (checked as part of `n8n-node
release` too) — so that file **cannot** be edited to add a `test/**` ignore
without breaking strict-mode verification. Instead, its `lint`/`lint:fix`
scripts run two `eslint` passes: `nodes credentials package.json` under the
default (cloud-eligible) `eslint.config.mjs`, then `test` under a second,
untracked-by-strict-mode config file, `eslint.test.config.mjs`, which just
re-exports `configWithoutCloudSupport` — the same non-cloud ruleset
`haystack-enterprise-mcp` uses everywhere.

`packages/haystack-enterprise-mcp` has `n8n.strict: false` — it isn't
cloud-eligible, so its own `eslint.config.mjs` already uses
`configWithoutCloudSupport`, which never enables the rules that flag test
imports in the first place. So its `lint`/`lint:fix` scripts can cover `nodes
credentials package.json test` in a single `eslint` pass, no second config
file needed.

Both packages' scripts call `eslint` directly (not the `n8n-node lint`
wrapper) purely so the paths passed to it can differ per package/config —
`n8n-node lint`'s hardcoded `eslint .` can't be scoped either way.

### `npm run dev` fails with `Error: Command "start" not found`
Bare `n8n-node dev` (no flags) spawns `npx n8n@latest` with no arguments. As of
n8n 2.28.7 this reliably fails with:
```
Error: Command "start" not found
```
This is **not a bug in this package**. n8n's command loader resolves the
default command like this:
```js
this.commandName = process.argv[2] ?? 'start';
try {
    await import(`./commands/${this.commandName}.js`);
} catch { /* swallowed */ }
const commandEntry = this.commandMetadata.get(this.commandName);
if (!commandEntry) {
    this.logger.error(`Error: Command "${this.commandName}" not found`);
```
`dist/commands/start.js` exists, but importing it throws
`ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './utils/uuid' is not defined
by "exports" in .../@langchain/core/package.json` — a transitive dependency
(observed: `@getzep/zep-cloud`, which wants `@langchain/core@~0.1.29`) does a
deep import that only exists in old `@langchain/core` 0.x, but npm's resolver
hoists everything to a newer breaking `@langchain/core` version because it
can't satisfy the conflicting peer ranges. n8n's loader swallows that import
error, so instead of the real stack trace you just get the misleading
"command not found". Confirm by running the failing import directly from the
npx cache:
```
node -e "require('<npx-cache>/node_modules/n8n/dist/commands/start.js')"
```

**Workaround:** don't let `n8n-node dev` manage its own n8n process. Run it
with `--external-n8n` (builds and symlinks the package into the custom nodes
folder without spawning n8n), then point your own n8n instance (Docker,
global install, whatever you already use) at the same user folder with dev
reload enabled:
```
npm run dev -- --external-n8n
# in another terminal / your own n8n instance:
N8N_DEV_RELOAD=true N8N_USER_FOLDER=~/.n8n-node-cli n8n start
```
Do not re-diagnose this from scratch — it's an upstream dependency-resolution
issue in n8n's bundled AI/langchain nodes, not something fixable in this
repo.

### Testing against a local n8n Docker container
If you're testing this node against a local n8n instance running in a Docker
container — as opposed to `n8n-node dev`'s own built-in instance, or
`--external-n8n` pointed at a global/npx install (see the "Local testing"
section of each package's README) — the commands below use `<container>` as a
placeholder for whatever you've named your own container (`docker ps` to find
it). They also assume the common setup of mounting only `~/.n8n` on the host
into `/home/node/.n8n` in the container; check your own container's actual
mounts/env with `docker inspect <container>` if something doesn't line up.

**Fundamental fact about `~/.n8n/custom` (read this first):** n8n's
`CustomDirectoryLoader` (the thing that scans `~/.n8n/custom/node_modules/*`)
hardcodes `packageName = 'CUSTOM'` for everything it loads — see
`n8n-core/dist/nodes-loader/constants.js`
(`CUSTOM_NODES_PACKAGE_NAME = 'CUSTOM'`) and `custom-directory-loader.js`. This
is **completely independent of your package's actual name** in `package.json`.
So once deployed there, this node's real, internal type string is
`CUSTOM.haystackEnterpriseAi` — **not**
`n8n-nodes-haystack-enterprise.haystackEnterpriseAi`. Any workflow JSON built
by hand or exported from a "real" install must have its node `type` field
changed to the `CUSTOM.` prefix before it will work against this container.
The example workflows under each package's `test/examples/` (see each
package's README, "Example workflows" section) already use the `CUSTOM.`
prefix for this reason — **that's a property of this local dev setup, not of
the node itself.** Once this package is genuinely installed as a real Community
Node (published, and installed via Settings → Community Nodes, or manually
placed in `~/.n8n/nodes/node_modules/<pkg>` — a different loader — the type
reverts to the real package-qualified `n8n-nodes-haystack-enterprise.<name>`).
Dragging the node fresh from the node panel in the editor always produces the
currently-correct type automatically — only hand-written/previously-exported
workflow JSON can have a stale/wrong prefix.

If a saved workflow in the instance was built before this was understood and
references the wrong (real-package-name) type, its type string can be fixed
directly in the DB (read-only fields matter here — this is a plain string
replace within the `nodes` JSON blob column, not a schema/relational change,
so it's safe to do directly):
```
docker exec <container> node -e "
const sqlite3 = require('node:sqlite');
const db = new sqlite3.DatabaseSync('/home/node/.n8n/database.sqlite', { readonly: false });
const row = db.prepare('SELECT nodes FROM workflow_entity WHERE id = ?').get('<workflow-id>');
const fixed = row.nodes.split('n8n-nodes-haystack-enterprise.haystackEnterpriseAi').join('CUSTOM.haystackEnterpriseAi');
db.prepare('UPDATE workflow_entity SET nodes = ? WHERE id = ?').run(fixed, '<workflow-id>');
"
```
Find the workflow ID first with a read-only `SELECT id, name FROM
workflow_entity WHERE nodes LIKE '%haystack%'` query. Never write to
`installed_packages`/`installed_nodes` or other relational tables by hand —
those have real schema/relational shape you'd have to get exactly right; a
plain string replace inside one JSON text column is a fundamentally different,
much lower-risk operation.

**How to verify the node actually loads, definitively, without needing the
editor or an authenticated session at all** — construct and run n8n's real
`CustomDirectoryLoader` directly:
```
docker exec <container> node -e "
const { CustomDirectoryLoader } = require('/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-core@<hash>/node_modules/n8n-core/dist/nodes-loader/custom-directory-loader.js');
(async () => {
  const loader = new CustomDirectoryLoader('/home/node/.n8n/custom');
  await loader.loadAll();
  console.log('packageName:', loader.packageName);
  console.log('nodes:', Object.keys(loader.nodeTypes));
  console.log('credentials:', Object.keys(loader.credentialTypes));
})();
"
```
This is far more reliable than reading boot logs for crashes — it directly
answers "is my node registered, and under what type string" in one shot, and
this is exactly how this whole `CUSTOM` namespace fact was discovered: the
node loaded here with zero errors, but the editor still logged
`Unrecognized node type: n8n-nodes-haystack-enterprise.haystackEnterpriseAi`
because that log line came from a saved workflow using the wrong (real
package name) prefix — not from the loader failing.

**Another `CUSTOM`-loader-specific divergence: the inline `codex` in the
`.node.ts` file is ignored.** `directory-loader.js`'s `addCodex()` does
`if (!isCustom) { codex = node.description.codex }` — for `CUSTOM`-namespaced
packages (`isCustom` is true), it **skips the inline `codex` object entirely**
and instead reads the separate external `<NodeClassName>.node.json` file
sitting next to the `.node.ts` file, then appends `'Custom Nodes'` to
whatever categories that file declares. This means the `codex.subcategories`
field (used to group AI-agent-usable nodes under the "Tools" subcategory when
browsing/searching node categories in the editor) will silently not apply
while testing via `~/.n8n/custom`, even though it's correctly set in the
`.node.ts` description — unless the same `subcategories` are *also* added to
the `.node.json` file. Keep the two in sync (the `.node.json` file is a
superset/duplicate of the relevant parts of the inline `codex`) — for a real
installed package (`isCustom` false), the inline `codex` wins instead and the
`.node.json` file is only consulted as a fallback if `codex` is undefined, so
this asymmetry only matters for local `CUSTOM`-loader testing. Verify with
the same `CustomDirectoryLoader` snippet above, reading
`loader.nodeTypes['<nodeType>'].type.description.codex`.

There is a stale symlink at
`~/.n8n/custom/node_modules/n8n-nodes-haystack-enterprise` pointing at this
repo's absolute host path. **That symlink is dead inside the container** —
the repo directory itself is never mounted in, only `~/.n8n` is — so n8n
silently skips it at boot. Don't rely on it and don't bother trying to fix it
by restarting; a symlink to an unmounted host path cannot resolve inside the
container no matter what.

To get a rebuilt node into the container, copy the build output directly into
the container, replacing that dead symlink with real files, **and** symlink
in `n8n-workflow` (see gotcha below) — then restart:
```
npm run build
docker exec <container> rm -rf /home/node/.n8n/custom/node_modules/n8n-nodes-haystack-enterprise
docker exec <container> mkdir -p /home/node/.n8n/custom/node_modules/n8n-nodes-haystack-enterprise
docker cp package.json <container>:/home/node/.n8n/custom/node_modules/n8n-nodes-haystack-enterprise/package.json
docker cp dist <container>:/home/node/.n8n/custom/node_modules/n8n-nodes-haystack-enterprise/dist
docker exec <container> mkdir -p /home/node/.n8n/custom/node_modules/n8n-nodes-haystack-enterprise/node_modules
docker exec <container> sh -c 'ln -sfn "$(node -e "console.log(require.resolve(\"n8n-workflow\", {paths: [\"/usr/local/lib/node_modules/n8n\"]}).replace(/\/dist\/.*/, \"\"))")" /home/node/.n8n/custom/node_modules/n8n-nodes-haystack-enterprise/node_modules/n8n-workflow'
docker restart <container>
```
**Gotcha 1:** on subsequent rebuilds, always `docker exec ... rm -rf .../dist`
**before** `docker cp dist ...` again. `docker cp` copies a source directory
*into* an existing destination directory of the same name instead of
replacing it — copying `dist` onto an existing `dist` silently produces a
nested `dist/dist` that n8n never looks at, so it keeps loading the old code
with no error at all. Always remove the old `dist` first. (This only affects
`dist/` — don't `rm -rf` the whole package directory, or you'll also delete
the `node_modules/n8n-workflow` symlink from gotcha 2 and have to redo it.)

**Gotcha 2 (the big one):** our package declares `n8n-workflow` only as a
**peer dependency** (correctly — it must share n8n's own instance, not bundle
its own copy). A real Community Nodes install satisfies that automatically,
because npm 7+ auto-installs peer dependencies, so `n8n-workflow` ends up
physically present alongside the package. Manually `docker cp`-ing our `dist/`
into `~/.n8n/custom/node_modules/n8n-nodes-haystack-enterprise` **skips that
npm step entirely** — nothing ever installs `n8n-workflow` there. The result
is not a crash, just a silent, misleading failure: the compiled node's
`require('n8n-workflow')` throws `MODULE_NOT_FOUND`, n8n's custom-directory
loader swallows that per-file and simply never registers the type, so the
editor logs `Unrecognized node type: n8n-nodes-haystack-enterprise.<name>`
with **no crash and no obvious error pointing at the cause**. This looks
identical to "the deploy didn't take" even when the files are 100% correct
and up to date.

Fix: symlink `n8n-workflow` from n8n's own installation into our package's
`node_modules` (commands above do this — resolve the path dynamically via
`node -e "require.resolve(...)"` rather than hardcoding it, since it lives
under a pnpm content-hash directory, e.g.
`n8n-workflow@file+packages+workflow_zod@3.25.67`, that changes across n8n
versions).

**Deploying `packages/haystack-enterprise-mcp` specifically:** the same
`docker cp` dist + package.json, symlink peer deps, restart procedure above
applies per-package under `~/.n8n/custom/node_modules/<real-npm-name>/`
(swap in `n8n-nodes-haystack-enterprise-mcp` for the package name), but this
package has some extra wrinkles the simpler `haystack-enterprise` case above
doesn't:

- **It has real (non-peer) runtime dependencies** — `@langchain/core`,
  `@modelcontextprotocol/sdk`, `zod` — unlike `n8n-workflow`/`n8n-core` (peer
  deps, symlinked to n8n's own copy, see below), these need to actually be
  *present*, since nothing does a real `npm install` for a `docker cp`-deployed
  custom node. Don't hand-copy them from the monorepo's hoisted root
  `node_modules` — it's polluted with huge unrelated devDependency trees
  (`@n8n/node-cli`'s own langchain/AI-node scaffolding) and hoisting order
  isn't guaranteed to match what the package actually needs. Instead, do a
  clean isolated install: write a scratch `package.json` containing only this
  package's `"dependencies"` block (not `peerDependencies` — that would try to
  install a *separate* `n8n-workflow`/`n8n-core` from the registry instead of
  sharing n8n's instance), `npm install --omit=dev` in that scratch dir, then
  copy the resulting `node_modules` wholesale into
  `.../n8n-nodes-haystack-enterprise-mcp/node_modules/`.

- **Critical gotcha — crashes the whole container on boot:** `n8n-core`'s
  `CustomDirectoryLoader.loadAll()` does `fast-glob('**/*.node.js', { cwd:
  '/home/node/.n8n/custom' })` with **no `node_modules` exclusion at all**,
  then blindly `require()`s and instantiates every match as if it were an n8n
  node class. `pkce-challenge` (a transitive dep of
  `@modelcontextprotocol/sdk`, used only for its OAuth/PKCE
  authorization-flow helpers, which this node never uses) ships
  `dist/index.node.js` as its Node-platform build — an incidental naming
  collision with n8n's own `*.node.js` node-file convention, nothing to do
  with n8n. The loader tries `new (require('.../pkce-challenge/dist/index.node.js').index)()`,
  throws `TypeError: require(...).index is not a constructor`, and n8n exits
  the whole process (`Exiting due to an error` — not a per-node skip). This is
  a general risk of dumping arbitrary npm dependency trees under
  `~/.n8n/custom`: any package anywhere in the tree with a `*.node.js`-named
  file will do this. **Fix:** delete that one file
  (`node_modules/pkce-challenge/dist/index.node.js`) after each fresh scratch
  install, before copying into the container. Re-check for new collisions with
  `find node_modules -name '*.node.js'` if the dependency set ever changes.

- **`n8n-core` is also a peer dependency for this package, needing the same
  symlink treatment as `n8n-workflow` above.** This node's `supplyData()` must
  wrap its LangChain tools in `new StructuredToolkit(tools)` (a class from
  `n8n-core`) rather than returning a bare array, because n8n's own
  `getConnectedTools()`/`ToolExecutor`/`extendResponseMetadata()` all check for
  a single `Tool`/`StructuredTool` or an `n8n-core` `StructuredToolkit`
  instance specifically. A bare array happens to work for a live Agent run (an
  incidental side effect), but breaks the canvas's "Execute step" test button
  with `Cannot read properties of undefined (reading 'replaceAll')`. Like
  `n8n-workflow`, `n8n-core` must be the *exact same module instance* n8n's own
  runtime uses, or `instanceof StructuredToolkit` checks silently return
  `false` (a classic dual-package hazard) — so symlink it in (resolved
  dynamically the same way as the `n8n-workflow` symlink above), don't let a
  separate copy get installed via `npm install`.

- **Diagnosing a crash when the container won't stay up long enough for
  `docker exec`:** `docker cp <container>:<path> -` works on a *stopped*
  container's filesystem (no need to start it), and `docker commit <container>
  <tmp-image>` + `docker run --rm --entrypoint sh <tmp-image> -c "..."` gives a
  full shell into the crashed image's filesystem without racing the
  crash-then-exit cycle. Note that any `n8n-core` `src/*.ts` paths shown in
  stack traces are sourcemap-only — the file doesn't physically exist; read
  the equivalent `dist/*.js` file instead (same directory, `.js` not `.ts`).
  If your container has no restart policy, a boot crash just leaves it
  exited (not stuck retrying) — a fresh `docker start` after fixing the cause
  is enough.

To verify a deploy actually loads — **without needing an authenticated
session or waiting on the editor** — replicate n8n's own loader directly:
```
docker exec <container> node -e "
const { loadClassInIsolation } = require('/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-core@<hash>/node_modules/n8n-core/dist/nodes-loader/load-class-in-isolation.js');
const instance = loadClassInIsolation('/home/node/.n8n/custom/node_modules/<real-npm-name>/dist/nodes/<NodeDir>/<ClassFile>.node.js', '<ClassName>');
console.log(instance.description.name);
"
```
(e.g. `<real-npm-name>` = `n8n-nodes-haystack-enterprise`, `<NodeDir>` = `HaystackEnterprise`, for that package)
(find the current n8n-core pnpm hash with
`docker exec <container> find /usr/local/lib/node_modules/n8n/node_modules/.pnpm -maxdepth 1 -iname 'n8n-core@*'`).
This throws the exact same error the real server would hit — a plain
`node -e "require(...)"` on the file directly is **not** equivalent and gives
a false negative (it doesn't replicate n8n's `require` context), so don't
rely on that.

There is also a separate location where a "normal" Community Nodes UI install
would live: `~/.n8n/nodes/node_modules/n8n-nodes-haystack-enterprise` (a
frozen tarball snapshot, unrelated to the custom-folder copy above). If you've
ever installed this package (or an earlier prototype of it) that way, it won't
reflect local changes either — uninstall it first if you want a clean slate,
so its registered type/credential names don't clash with the custom-folder
copy. Note also that the Community Nodes install flow
(`POST /rest/community-packages`) strictly validates the package name/version
against the real npm registry — it **cannot** be used to sideload this
unpublished local build; the `docker cp` + symlink procedure above is the only
way to test local changes.

After redeploying, always check `docker logs <container> --tail 30` for a
clean `Editor is now accessible via` line with no crash trace before telling
the user it's ready to test — a broken custom node crashes the whole n8n
process on boot (see the class-name-must-match-filename gotcha in
`.agents/nodes.md`), so the container can come back up in a crash loop that
looks superficially "running" via `docker ps` while n8n itself never
finishes booting. A crash trace means a fatal error (e.g. class/filename
mismatch); a clean boot with the node still not appearing/working means check
for `Unrecognized node type` further down the log — that's gotcha 2 above.

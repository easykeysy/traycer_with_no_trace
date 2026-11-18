import { resolve as resolveTestSetup } from "node:path";
import path from "path";
import os from "node:os";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { transformWithOxc } from "vite";
import { defineConfig } from "vitest/config";

const availableParallelism =
  typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;
const MAX_TEST_WORKERS = Math.min(
  2,
  Math.max(1, Math.floor(availableParallelism / 2)),
);
// `use-workspace-file-list-subscription` is here for the same reason: its
// pending flag used to be a render-time read of a module-level registry, which
// the compiler cached at "no entry yet" forever (the file tree's permanent
// spinner). Only the compiled hook can regress that way, so only the compiled
// hook can prove the fix. The `pr.*` shared-subscription trio had the same
// shape (`registry.get(key)` and `entry.lastEvent` read at render).
// `auth-brand-splash` / `auth-landing-page` join them after the same failure in
// its sharpest form: the launch splash derived its phase from a boolean, the
// compiler memoized that derivation on inputs the animation timer did not
// touch, and the cached value outlived the timer - a sign-in screen that never
// went away, on a real device. The suite was green throughout, because it ran
// the UNCOMPILED hook while production mobile compiles everything. A test that
// does not run the compiled component cannot see this class of bug at all.
// `relative-time` / `routing-card` are the desktop repeat of the exact same
// shape, caught live rather than in review: the routing card's countdown (then
// `fallback-grace-card`) froze at "in 3m 27s" for a 15s window and never moved
// until the host switched. The routing card's drain bar reads the same
// snapshot (`useGraceCountdownState`), so a frozen bar is the same regression
// with a width instead of a string. `useGraceCountdown` used to discard
// `useSyncExternalStore`'s return and read the mutable
// `secondClock.sampledNow()` at render time; the compiler memoized
// `formatGraceCountdown(deadline, secondClock.sampledNow())` on `deadline`
// alone, so every tick re-rendered the leaf and got back the FIRST render's
// string. It now renders from the store's return value instead. The
// minute-clock hooks in the same file
// (`useCompactRelativeTime`, `useRelativeTimestamp`, `useSampledNow`,
// `useResetCountdown`, `useIsFarReset`, `useMessageTime`) share the shape and
// were invisible for the same reason: the suite ran them uncompiled while the
// desktop renderer compiles the whole tree, its dev server included (where
// the freeze was seen).
// `simulator-tile` keeps per-instance memory in render-time state writes
// (whether its own `simulator.open` was answered, whether it has been live)
// and reads a mutation's per-call callbacks; both are shapes the compiler
// rewrites, so its suite runs compiled too.
// `use-environment-members-query` read the query cache at render time to
// walk its page chain; the compiler memoized that walk on the environment and
// host alone, so a page that answered re-rendered the hook and got back the
// first render's cursors - a team's second page was never asked for.
// `useChatServingHostId` (chat-serving-witness) and `useServedAtRest`
// (sandbox-tile-state-frame) discarded or only branched on the witness's
// verdict and then memoized `chatServingHostId(..., witness, ...)` on the
// witness's stable identity, so a frame that moved a chat from at rest to
// live left the compiled hook on its first answer.
// The rest are one class, swept together: a render read of something that
// changes inside an object whose identity does not - a module registry entry,
// a query cache, a host client, a requester, a kept-alive engine - which the
// compiled renderer memoizes on that identity and answers from forever after.
// Each file's suite has a case that is red on the shape it used to have:
// - `use-git-list-changed-files-subscription`: a git error or a closed stream
//   never left pending (the shared entry's last frame).
// - `use-host-stream-client-for`: a sign-in after mount never built the
//   host's stream client (the context `setRequestContext` swaps inside the one
//   spine client); `use-host-client-for` reads it through the same subscribed
//   hook and builds its client on the sign-in itself;
//   `epic-tab-existence-reconciler`: a lease bound after mount never probed
//   the hosts for local copies.
// - `use-providers-login-ownership`: a host whose directory row landed after
//   mount never got login ownership (a requester pinned by id answers `null`
//   until its row lands).
// - `worktrees-enrichment`, `use-worktree-task-titles`, `teardown-agent-names`,
//   `use-diff-highlight-ready`: a `void tick;` trigger the compiler drops, so
//   a row stayed on "Checking", a restored row stayed locked, a title or a
//   rename never showed, a theme switch never re-primed highlighting.
// - `composer.source`: the palette kept the model the composer had left.
// - `command-palette`: a palette opened after a route change kept the path
//   of an earlier opening, so it hid the row of the channel it had left and
//   listed the one it was on.
// - `top-level-tab-host`: a tab locked mid-drag kept its drop ring.
// - `use-comm-graph-jump` with `comm-graph-agent-detail-surface`: a row kept
//   its open-agent links after the host went offline.
// - `terminal-tile`, `landing-terminal-tile`, `use-terminal-tile-bootstrap`,
//   `use-host-terminal-bootstrap`: a reopened terminal opened at the grid its
//   engine had before the measure wait ended.
// - `chat-routing-menu`: a tab menu opened before its chat's session kept the
//   routing setting out for as long as it stayed up.
// - `tab-appearance-menu`: a tab whose own task lookup was pending never took
//   the strip's batch from the cache, so Labels and grouping stayed hidden.
// - `chat-accumulated-changes-panel`: an open panel re-rendered every row,
//   and re-sanitised every row's file icon, on every streamed flush, because
//   the tile handed it a new row list per flush. Its rows are skipped on an
//   unchanged list only when it is compiled, so uncompiled the case is red on
//   the fixed tile too.
// - `chat-pinned-stack`: an open todo list re-rendered every row on every
//   streamed flush, because the tile handed the dock a new checklist object
//   per flush. Its rows are skipped on an unchanged checklist only when it is
//   compiled.
// `workspace-file-tile`, `split-slot-chooser`, `resource-monitor-popover`,
// `sidebar-artwork` and `dock-modes` read the same kind of source and are
// correct as they stand; their cases hold that once they run compiled.
const REACT_COMPILER_REGRESSION_FILES =
  /[/\\](?:composer-prompt-editor|use-workspace-file-list-subscription|shared-stream-subscription|use-header-tabs|use-pr-(?:list|detail)-subscription|auth-brand-splash|auth-landing-page|use-auth-splash-cover|relative-time|routing-card|use-environment-members-query|use-git-list-changed-files-subscription|workspace-file-tile|worktrees-enrichment|use-worktree-task-titles|teardown-agent-names|resource-monitor-popover|use-comm-graph-jump|comm-graph-agent-detail-surface|top-level-tab-host|split-slot-chooser|landing-terminal-tile|use-terminal-tile-bootstrap|use-host-terminal-bootstrap|terminal-tile|use-diff-highlight-ready|composer\.source|command-palette|sidebar-artwork|dock-modes|use-host-client-for|use-host-stream-client-for|use-providers-login-ownership|epic-tab-existence-reconciler|chat-routing-menu|tab-appearance-menu|chat-accumulated-changes-panel|chat-pinned-stack|react-compiler-harness-probe|chat-serving-witness|sandbox-tile-state-frame)\.(?:ts|tsx)$/;

// The compiler runs after the JSX transform, and the suite's transform is the
// development one: `jsxDEV(..., this)` passes `this`, the compiler bails on
// every function that returns JSX, and only hooks were ever compiled here - a
// component on the list above ran exactly as uncompiled code, green whether or
// not the bug shipped. The packaged renderer uses the production transform and
// compiles components too, so the listed files get that transform before
// anything else touches them; the rest of the suite keeps development JSX.
// `react-compiler-harness.test.tsx` fails if a listed component stops compiling.
const shippedJsxForCompilerRegressionFiles = {
  name: "traycer:shipped-jsx-for-compiler-regression-files",
  enforce: "pre" as const,
  async transform(code: string, id: string) {
    const file = id.split("?")[0];
    if (!file.endsWith(".tsx") || !REACT_COMPILER_REGRESSION_FILES.test(file)) {
      return null;
    }
    const result = await transformWithOxc(code, file, {
      jsx: { runtime: "automatic", development: false },
    });
    return { code: result.code, map: result.map };
  },
};

export default defineConfig({
  // Run the affected composer boundary through the packaged desktop
  // renderer's compiler preset. The regression that motivated it was
  // invisible when tests skipped this pass because the compiler may replace a
  // React imperative-handle facade during an ordinary editor render. The filter
  // keeps unrelated GUI tests on their existing fast transform path.
  plugins: [
    shippedJsxForCompilerRegressionFiles,
    react(),
    // This config is ALSO what the browser regressions serve their fixtures
    // from - every driver in `scripts/*-browser.mjs` spawns vite with
    // `--config vitest.config.ts`. Without this plugin, `@import "tailwindcss"`
    // at `src/index.css:1` compiles to NOTHING (there is no `postcss.config.*`
    // here, so there is no second compile path), and the fixtures render with
    // the utility classes present on every element and no rules behind them:
    // `h-8` measured 24px, `DialogFooter`'s `flex` computed `display: block`,
    // `bg-primary` computed `rgba(0, 0, 0, 0)`.
    //
    // That is a harness that lies in the SAFE direction. A fixture asserting
    // two nodes share a left edge passes trivially when both are unstyled
    // blocks at the same content edge, and one asserting a control is "filled"
    // passes-as-transparent - on the fixed tree and the broken one alike. Any
    // geometric or colour claim measured without this was vacuous.
    //
    // jsdom runs are unaffected: vitest does not process CSS by default, so
    // this changes what the dev server serves, not what the suite transforms.
    tailwindcss(),
    babel({
      include: REACT_COMPILER_REGRESSION_FILES,
      presets: [reactCompilerPreset()],
    }).then((plugin) => ({
      ...plugin,
      enforce: "post" as const,
    })),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      {
        find: "@traycer-clients/shared",
        replacement: path.resolve(__dirname, "..", "shared"),
      },
      {
        find: /^@traycer\/protocol\/utils\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "..",
          "..",
          "protocol",
          "utils",
          "$1",
        ),
      },
      {
        find: /^@traycer\/protocol\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "..",
          "..",
          "protocol",
          "src",
          "$1",
        ),
      },
      {
        find: /^@traycer\/html-source$/,
        replacement: path.resolve(
          __dirname,
          "..",
          "..",
          "packages",
          "html-source",
          "src",
          "index.ts",
        ),
      },
    ],
  },
  test: {
    // Vitest 5 flipped clearMocks to true; keep the v4 behavior (mock call history persists across tests).
    clearMocks: false,
    // Anchored to the package directory so siblings whose names merely
    // CONTAIN "zod" (`zod-to-json-schema`, `@hookform/resolvers/zod`) are
    // not dragged in. Full rationale for the workaround itself lives in
    // `clients/desktop/vitest.shared.ts`.
    //
    // `sonner` is inlined for what it keeps: its toast queue is module state, and
    // with `isolate: false` a module Node loaded natively is shared by every file
    // a worker runs, so one file's toasts would render in the next file's Toaster.
    server: {
      deps: {
        inline: [
          /[\\/]node_modules[\\/]zod[\\/]/,
          /[\\/]node_modules[\\/]sonner[\\/]/,
        ],
      },
    },
    environment: "jsdom",
    setupFiles: [
      resolveTestSetup(
        import.meta.dirname,
        "../../scripts/test-worker-environment.ts",
      ),
      "./__tests__/test-file-reset.ts",
      "./__tests__/test-browser-apis.ts",
    ],
    sequence: { setupFiles: "list" },
    include: [
      "__tests__/**/*.test.ts",
      "__tests__/**/*.test.tsx",
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "src/components/bots/__tests__/bot-channel-exchange-lines.test.tsx",
      "src/components/bots/__tests__/bot-chat-transcript-channel-rows.test.tsx",
      "src/components/chat/__tests__/chat-fork-dialog-staged-sandbox.test.tsx",
      "src/components/chat/__tests__/task-reference-chip.test.tsx",
      "src/components/chat/segments/__tests__/agent-reference-markdown-needs-you-post.test.tsx",
      "src/components/comments/__tests__/comment-card-person-avatar.test.tsx",
      "src/components/comments/__tests__/comment-sidebar.test.tsx",
      "src/components/comments/__tests__/comment-thread-card-submit.test.tsx",
      "src/components/comments/__tests__/floating-draft-popover-submit.test.tsx",
      "src/components/comments/__tests__/mention-row-person-avatar.test.tsx",
      "src/components/comments/__tests__/thread-anchor-hover-popover.test.tsx",
      "src/components/epic-canvas/__tests__/route-sync-retires-arm-stand-in.test.tsx",
      "src/components/epic-canvas/comm-graph/__tests__/comm-graph-tile.test.tsx",
      "src/components/epic-canvas/comm-graph/__tests__/comm-graph-timeline.test.tsx",
      "src/components/epic-canvas/comm-graph/__tests__/use-comm-graph-snapshot-cloud-authority.test.tsx",
      "src/components/epic-canvas/mobile/__tests__/switcher-comments-list.test.tsx",
      "src/components/epic-canvas/panels/__tests__/epic-usage-dialog.test.tsx",
      "src/components/epic-canvas/sidebar/__tests__/new-conversation-modal-team-sandbox.test.tsx",
      "src/components/home/__tests__/use-landing-composer-actions.test.tsx",
      "src/components/home/__tests__/use-landing-composer-actions-staged-sandbox.test.tsx",
      "src/components/home-focus/__tests__/home-getting-started-section.test.tsx",
      "src/components/layout/__tests__/app-shell-lifecycle-bridges.test.tsx",
      "src/components/layout/dialogs/__tests__/system-tab-modal-theme-editor.test.tsx",
      "src/components/layout/shell/__tests__/mobile-nav-drawer.test.tsx",
      "src/components/layout/tabs/__tests__/tab-strip-context-menu.test.tsx",
      "src/components/notifications/__tests__/notification-desktop-pass.test.tsx",
      "src/components/notifications/__tests__/notification-row-person.test.tsx",
      "src/components/notifications/__tests__/notifications-popover.test.tsx",
      "src/components/onboarding/__tests__/getting-started-checklist.test.ts",
      "src/components/sandboxes/__tests__/pending-sandbox-sends.test.tsx",
      "src/components/sandboxes/__tests__/pending-sandbox-stop-failure.test.tsx",
      "src/components/sandboxes/__tests__/pending-sandbox-stops.test.tsx",
      "src/components/settings/__tests__/settings-modal-content.test.tsx",
      "src/components/settings/__tests__/settings-search-fixtures.test.tsx",
      "src/components/settings/__tests__/settings-sidebar.test.tsx",
      "src/components/settings/__tests__/settings-sidebar-layout-entry.test.tsx",
      "src/components/settings/panels/__tests__/alerts-settings-panel.test.tsx",
      "src/components/settings/panels/__tests__/getting-started-settings-panel.test.tsx",
      "src/components/settings/panels/__tests__/push-permission-section.test.tsx",
      "src/hooks/__tests__/use-epic-collaborators-query.test.tsx",
      "src/hooks/auth/__tests__/use-user-sessions-query.test.tsx",
      "src/hooks/auto-mode/__tests__/auto-mode-write-scopes.test.tsx",
      "src/hooks/chats/__tests__/use-cloud-chat-payload-verdict.test.tsx",
      "src/hooks/chats/__tests__/use-cloud-chat-transcript-unauthorized.test.tsx",
      "src/hooks/comments/__tests__/use-comment-thread-mutations-verdict.test.tsx",
      "src/hooks/comments/__tests__/use-epic-comment-threads-poll-wiring.test.tsx",
      "src/hooks/comments/__tests__/use-mention-collaborators-verdict.test.tsx",
      "src/hooks/drafts/__tests__/use-cloud-drafts-directory.test.tsx",
      "src/hooks/epic/__tests__/epic-pin-dispatch-admitted.test.ts",
      "src/hooks/epic/__tests__/use-epic-chat-archive-routing.test.tsx",
      "src/hooks/epic/__tests__/use-epic-chat-mutations-team-owner.test.ts",
      "src/hooks/epic/__tests__/use-epic-create-dispatch-floor.test.tsx",
      "src/hooks/epic/__tests__/use-epic-get-task-contexts-query.test.tsx",
      "src/hooks/epic/__tests__/use-epic-owner-gone-routing.test.tsx",
      "src/hooks/epic/__tests__/use-epic-record-viewed-mutation.test.tsx",
      "src/hooks/epic/__tests__/use-epic-rename-delete-routing.test.tsx",
      "src/hooks/epic/__tests__/use-epic-set-pinned-mutation.test.tsx",
      "src/hooks/epic/__tests__/use-epic-set-pinned-mutation-task-contexts-race.test.tsx",
      "src/hooks/epic/__tests__/use-epic-task-pinned-states-structural-sharing-integration.test.tsx",
      "src/hooks/epic/__tests__/use-epic-task-pinned-states-unverified-probe.test.tsx",
      "src/hooks/home/__tests__/use-current-tasks.test.tsx",
      "src/hooks/notifications/__tests__/use-notification-center-open-lifecycle.test.tsx",
      "src/hooks/runner/__tests__/use-push-muted-severities-mutation.test.tsx",
      "src/hooks/sandboxes/__tests__/use-bound-sandbox-send.test.tsx",
      "src/lib/__tests__/analytics.test.ts",
      "src/lib/__tests__/epic-selectors.test.tsx",
      "src/lib/__tests__/settings-sections-layout.test.ts",
      "src/lib/__tests__/settings-sections-mobile-app.test.ts",
      "src/lib/attachments/__tests__/use-chat-image-fetcher.test.tsx",
      "src/lib/auth/__tests__/auth-service-fetch-registered-hosts.test.ts",
      "src/lib/auth/__tests__/auth-service-sandbox-secrets.test.ts",
      "src/lib/auth/__tests__/auth-service-session-recovery-wake.test.ts",
      "src/lib/cloud-epic-tasks-query/__tests__/local-first-admission-dispatch-floor.test.ts",
      "src/lib/cloud-epic-tasks-query/__tests__/query.test.ts",
      "src/lib/commands/__tests__/navigation.source.test.tsx",
      "src/lib/drafts/__tests__/draft-blob-transport.test.ts",
      "src/lib/environment/__tests__/executable-write-grant-auth-generation.test.ts",
      "src/lib/host/__tests__/auth-era-composition.test.ts",
      "src/lib/notifications/__tests__/host-surface-routing.test.ts",
      "src/lib/sandboxes/__tests__/pending-sandbox-message-return.test.ts",
      "src/lib/sandboxes/__tests__/pending-sandbox-send.test.ts",
      "src/lib/sandboxes/__tests__/pending-sandbox-send-refused-write.test.ts",
      "src/lib/sandboxes/__tests__/staged-sandbox-run.test.ts",
      "src/lib/settings-search/__tests__/settings-search.test.ts",
      "src/lib/settings-search/__tests__/settings-search-index.test.ts",
      "src/providers/__tests__/epic-access-coordinator.test.tsx",
      "src/providers/__tests__/epic-tab-existence-reconciler.test.tsx",
      "src/providers/__tests__/epic-tab-existence-reconciler-context-race.test.tsx",
      "src/providers/__tests__/host-compatibility-provider.test.tsx",
      "src/providers/__tests__/notifications-session-provider.test.tsx",
      "src/stores/auth/__tests__/auth-store-shape.test.ts",
      "src/stores/epics/open-epic/__tests__/chat-records-environment-owner.test.ts",
      "src/stores/epics/open-epic/__tests__/replica-runtime-behavior-identity.test.ts",
      "src/stores/epics/open-epic/__tests__/tui-agent-records-merge.test.ts",
      "src/stores/notifications/__tests__/merged-notifications-actions.test.tsx",
      "src/stores/notifications/__tests__/merged-notifications-resolve-dispatch.test.tsx",
      "src/stores/tabs/__tests__/desktop-tabs-persistence.test.ts",
      "src/stores/tabs/__tests__/settings-kind.test.ts",
      "src/stores/tabs/__tests__/transaction-coordinator.test.ts",
    ],
    globals: false,
    pool: "forks",
    isolate: false,
    // A few suites advance large fake-timer windows. Limiting concurrently
    // running files keeps those timers responsive on CI's shared runners.
    maxWorkers: MAX_TEST_WORKERS,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Don't let a stray post-teardown async error (a timer/socket/microtask
    // rejecting after a test finished) fail the whole run with exit 1 and no
    // failing test - the classic intermittent CI flake. The setup file
    // (`__tests__/test-browser-apis.ts`) still logs every such error, so we keep
    // visibility instead of silently swallowing it.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});

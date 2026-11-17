import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useProvidersList } from "@/hooks/providers/use-providers-list-query";
import { PROVIDER_INVALIDATIONS } from "@/hooks/providers/invalidations";
import { hostQueryKeys } from "@/lib/query-keys";
import { agentProviderLabel } from "@/lib/chat/sender-display";
import { useHostClient } from "@/lib/host";
import { useStreamHostId } from "@/lib/host/stream-runtime-context";

/**
 * The custom binary path may be empty on disk when the app launches - the user
 * configures an executable that is copied in later, or a removable volume has
 * not been mounted yet. The host already tolerates that: it checks the file on
 * every resolution and falls back to the managed pack or PATH, without
 * spawning or erroring. What was missing was the other half of the promise -
 * noticing when the file finally stands in and telling the user.
 *
 * This bridge watches only providers whose selection is an explicit custom
 * path (the vacuous-on-launch case). It seeds each path with one probe:
 *
 * - present at that first probe -> recorded as present, never announced, so a
 *   normal launch with a working binary cannot produce a false "appeared"
 *   toast;
 * - absent at that first probe -> recorded as missing, and probed again on a
 *   short interval while the window is visible;
 * - missing -> present later -> one cheerful toast, the provider queries are
 *   invalidated, and that path is no longer polled.
 *
 * Every probe failure (absent file, host transport hiccup, shutdown) is
 * silent by construction: this bridge never turns a still-missing binary into
 * a warning or an error toast.
 */
const PROBE_INTERVAL_MS = 5_000;

type Verdict = "unknown" | "missing" | "present";

interface WatchedPath {
  readonly path: string;
  verdict: Verdict;
}

function selectedCustomPath(
  selected: { readonly kind: string; readonly path?: string },
): string | null {
  if (selected.kind !== "custom") return null;
  const path = selected.path;
  return path === undefined || path.trim().length === 0 ? null : path;
}

function candidateVersion(
  candidates: ReadonlyArray<{
    readonly kind: string;
    readonly path: string;
    readonly version: string | null;
  }>,
  path: string,
): string | null {
  const candidate = candidates.find(
    (entry) => entry.kind === "custom" && entry.path === path,
  );
  return candidate?.version ?? null;
}

function candidateAvailable(
  candidates: ReadonlyArray<{
    readonly kind: string;
    readonly path: string;
    readonly available: boolean;
  }>,
  path: string,
): boolean {
  const candidate = candidates.find(
    (entry) => entry.kind === "custom" && entry.path === path,
  );
  return candidate?.available ?? false;
}

export function ProviderBinaryDetectedToastBridge(): ReactNode {
  const providers = useProvidersList({ enabled: true, subscribed: true });
  const client = useHostClient();
  const hostId = useStreamHostId();
  const queryClient = useQueryClient();
  const watchedRef = useRef(new Map<string, WatchedPath>());
  const announcedRef = useRef(new Set<string>());

  const announce = useCallback(
    (providerId: string, path: string, version: string | null): void => {
      const key = `${providerId}\u0000${path}`;
      if (announcedRef.current.has(key)) return;
      announcedRef.current.add(key);
      const label = agentProviderLabel(providerId);
      toast.success(`${label} is ready`, {
        description: `Found ${path}${version === null ? "" : ` (v${version})`}. Your next turn will pick it up automatically.`,
      });
      if (hostId !== null) {
        for (const method of PROVIDER_INVALIDATIONS) {
          void queryClient.invalidateQueries({
            queryKey: hostQueryKeys.methodScope(hostId, method),
          });
        }
      }
    },
    [hostId, queryClient],
  );

  // Track exactly the providers whose selection is a custom path, and reset a
  // path's verdict when the user points the provider somewhere else.
  useEffect(() => {
    const data = providers.data;
    if (data === undefined) return;
    const tracked = watchedRef.current;
    const live = new Set<string>();
    for (const state of data.providers) {
      const path = selectedCustomPath(state.selected);
      if (path === null) continue;
      live.add(state.providerId);
      const current = tracked.get(state.providerId);
      if (current === undefined || current.path !== path) {
        tracked.set(state.providerId, { path, verdict: "unknown" });
        continue;
      }
      // A list refresh can resolve the path before the next probe does. Only a
      // path this bridge already judged missing earns the toast here.
      if (
        current.verdict === "missing" &&
        candidateAvailable(state.candidates, path)
      ) {
        current.verdict = "present";
        announce(state.providerId, path, candidateVersion(state.candidates, path));
      }
    }
    for (const providerId of [...tracked.keys()]) {
      if (!live.has(providerId)) tracked.delete(providerId);
    }
  }, [announce, providers.data]);

  // A list refresh restarts this effect, so newly tracked paths are seeded
  // immediately instead of waiting a full interval.
  useEffect(() => {
    const controller = new AbortController();
    const inFlight = new Set<string>();

    const tick = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      for (const [providerId, watched] of [...watchedRef.current]) {
        if (watched.verdict === "present") continue;
        if (inFlight.has(providerId)) continue;
        inFlight.add(providerId);
        try {
          const result = await client.requestWithSignal(
            "providers.detectVersion",
            { candidatePath: watched.path },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (!result.executable) {
            watched.verdict = "missing";
            continue;
          }
          const appeared = watched.verdict === "missing";
          watched.verdict = "present";
          if (appeared) announce(providerId, watched.path, result.version);
        } catch {
          // Still absent (or the host is momentarily unreachable): stay
          // silent and try again on the next tick.
        } finally {
          inFlight.delete(providerId);
        }
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, PROBE_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [announce, client, providers.data]);

  return null;
}

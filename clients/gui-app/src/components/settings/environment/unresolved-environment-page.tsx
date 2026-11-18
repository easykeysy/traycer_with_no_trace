import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HostScopeGate } from "@/components/settings/host-scope/host-scope-gate";
import {
  useHostScopeFor,
  WINDOW_HOST_SELECTION,
} from "@/components/settings/host-scope/use-host-scope";
import { TeamReadFailed } from "@/components/settings/environment/team-read-failed";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import type { HostRpcRegistry } from "@/lib/host";
import { queryKeys } from "@/lib/query-keys";

/** No configuration is known yet: never mount a configuration's editors. */
type FailureSnapshot = { failed: boolean; detail: string | null };
const NO_FAILURE: FailureSnapshot = { failed: false, detail: null };

export function UnresolvedEnvironmentPage(): ReactNode {
  const scope = useHostScopeFor(WINDOW_HOST_SELECTION);
  const queryClient = useQueryClient();
  const hostId = scope.activeHostId;
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const readFailure = useCallback((): FailureSnapshot => {
    if (hostId === null) return NO_FAILURE;
    const state = queryClient.getQueryState(
      queryKeys.hostMethod<HostRpcRegistry, "environment.status">(
        hostId,
        "environment.status",
        {},
      ),
    );
    const failed = state?.status === "error" && state.fetchStatus === "idle";
    if (!failed) return NO_FAILURE;
    const err = state?.error as
      | { message?: unknown; code?: unknown }
      | null
      | undefined;
    // A host too old to serve `environment.status` is not a failed settings
    // read: the window still belongs to that computer, whose own pages the
    // picker falls back to instead of this page.
    if (err?.code === "E_HOST_UNSUPPORTED") return NO_FAILURE;
    const detail =
      err && typeof err.message === "string" && err.message.trim().length > 0
        ? err.message.trim()
        : null;
    return readFailure.cache.failed && readFailure.cache.detail === detail
      ? readFailure.cache
      : (readFailure.cache = { failed: true, detail });
  }, [queryClient, hostId]);
  // Stable snapshot cache for useSyncExternalStore (Object.is comparison).
  (readFailure as typeof readFailure & { cache: FailureSnapshot }).cache ??=
    NO_FAILURE;
  const failure = useSyncExternalStore(subscribe, readFailure);
  const retry = (): void => {
    if (hostId === null) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.hostMethod<HostRpcRegistry, "environment.status">(
        hostId,
        "environment.status",
        {},
      ),
    });
  };
  if (scope.host === null && scope.listsFailed) {
    return (
      <HostScopeGate scope={scope} skeleton={null}>
        {null}
      </HostScopeGate>
    );
  }
  if (failure.failed) {
    return (
      <TeamReadFailed
        message={
          failure.detail
            ? `Couldn't read these settings. ${failure.detail}`
            : "Couldn't read these settings."
        }
        onRetry={retry}
      />
    );
  }
  return (
    <AgentSpinningDots
      className={undefined}
      testId="environment-source-loading"
      variant={undefined}
      tone="muted"
    />
  );
}

import { useCallback, useMemo } from "react";
import {
  queryOptions,
  useQueries,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { EnvironmentStatusResponseV12 } from "@traycer/protocol/host/environment-schemas";
import type { HostRpcError } from "@traycer-clients/shared/host-transport/host-messenger";
import { useHostNegotiatedMethodVersions } from "@/hooks/host/use-host-negotiated-method-version";
import { hostClientUnavailableError } from "@/hooks/host/use-host-query";
import { useHostBinding, type HostRpcRegistry } from "@/lib/host";
import { resolveNamedHostClient } from "@/lib/host/binding-host-client";
import { stampHostRpcMethod } from "@/lib/host-rpc-policy/host-method-policy-table";
import { withHostQueryErrorBoundary } from "@/lib/query/host-query-error-boundary";
import { queryKeys } from "@/lib/query-keys";
import type { HostRuntimeBinding } from "@/providers/host-runtime-provider";

const METHOD = "environment.status";
const EMPTY_PARAMS = {};

/**
 * Long, because the Environment dropdown is the only reader that asks every
 * computer (`isEnvironmentComputer`): a Local row changes when a person moves that
 * computer's settings, which they do from this window or from that
 * computer's own, and the one host this window shows is polled by its page.
 */
const STATUS_STALE_MS = 5 * 60_000;

/**
 * `environment.status` for each host in `hostIds`, one Query per host
 * through that host's own requester, unpolled. The key is the one
 * `useHostQuery` files the same read under, so a page that polls one host's
 * status (the Personal frame, the Overview) keeps that host's row current
 * here, and this read never duplicates it.
 *
 * Map entries are `null` until a host answers, and for a host that cannot:
 * one that is not `connectable` is never dialled, and one whose handshake
 * does not advertise `environment.status` is never asked.
 */
export function useRegisteredHostEnvironmentStatuses(
  hosts: ReadonlyArray<{
    readonly hostId: string;
    readonly connectable: boolean;
  }>,
): ReadonlyMap<string, EnvironmentStatusResponseV12 | null> {
  const binding = useHostBinding();
  const hostIds = useMemo(() => hosts.map((host) => host.hostId), [hosts]);
  // A host whose handshake positively reports `environment.status` absent is
  // never asked: it would answer every entry with `E_HOST_UNSUPPORTED`, an
  // error no retry can clear, and the Environment page reads it as a failed
  // settings read. `null` is NOT that answer - it means no handshake has
  // completed yet, and this read is one of the ones that completes it, so the
  // gate stays open and closes only on evidence.
  const versions = useHostNegotiatedMethodVersions(hostIds, METHOD);
  const combine = useCallback(
    (
      results: Array<
        UseQueryResult<EnvironmentStatusResponseV12, HostRpcError>
      >,
    ): ReadonlyMap<string, EnvironmentStatusResponseV12 | null> =>
      new Map(
        results.map((result, index) => [
          hosts[index]?.hostId ?? "",
          result.data ?? null,
        ]),
      ),
    [hosts],
  );
  return useQueries({
    queries: hosts.map((host) =>
      environmentStatusQueryOptions(
        binding,
        host.hostId,
        host.connectable &&
          binding !== null &&
          versions.get(host.hostId) !== false,
      ),
    ),
    combine,
  });
}

/**
 * One host's `environment.status` read through that host's own requester,
 * unpolled, under the key `useHostQuery` files it. Shared with the binding
 * producers (`use-host-environment-bindings-query.ts`), which ask a host's
 * status before its binding.
 */
export function environmentStatusQueryOptions(
  binding: Pick<HostRuntimeBinding<HostRpcRegistry>, "hostClient"> | null,
  hostId: string,
  enabled: boolean,
) {
  // `binding` only resolves the requester, whose host the key already
  // names; adding it would refetch on binding identity drift alone.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return queryOptions<EnvironmentStatusResponseV12, HostRpcError>({
    queryKey: queryKeys.hostMethod<HostRpcRegistry, typeof METHOD>(
      hostId,
      METHOD,
      EMPTY_PARAMS,
    ),
    queryFn: ({ signal }): Promise<EnvironmentStatusResponseV12> =>
      withHostQueryErrorBoundary(METHOD, async () => {
        const client = resolveNamedHostClient(binding, hostId);
        if (client === null) throw hostClientUnavailableError(METHOD);
        return client.requestWithSignal(METHOD, EMPTY_PARAMS, signal);
      }),
    meta: stampHostRpcMethod(undefined, METHOD),
    enabled,
    staleTime: STATUS_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

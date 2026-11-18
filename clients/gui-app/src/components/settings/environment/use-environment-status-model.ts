import { useMemo } from "react";
import type { EnvironmentStatusResponseV11 } from "@traycer/protocol/host/environment-schemas";
import {
  environmentPickerModel,
  isEnvironmentComputer,
  type EnvironmentPickerModel,
} from "@/components/settings/environment/environment-picker-model";
import type { HostScope } from "@/components/settings/host-scope/use-host-scope";
import { useRegisteredHostEnvironmentStatuses } from "@/hooks/environment/use-registered-host-environment-statuses";
import { useHostNegotiatedMethodVersions } from "@/hooks/host/use-host-negotiated-method-version";
import { useAuthStore } from "@/stores/auth/auth-store";

/**
 * The Environment dropdown's model and the `environment.status` of each
 * computer it reads (`isEnvironmentComputer`).
 */
export function useEnvironmentStatusModel(scope: HostScope): {
  readonly picker: EnvironmentPickerModel;
  readonly statuses: ReadonlyMap<string, EnvironmentStatusResponseV11 | null>;
} {
  const hosts = useMemo(
    () => scope.hosts.filter(isEnvironmentComputer),
    [scope.hosts],
  );
  const hostIds = useMemo(() => hosts.map((host) => host.hostId), [hosts]);
  const statuses = useRegisteredHostEnvironmentStatuses(hosts);
  const versions = useHostNegotiatedMethodVersions(
    hostIds,
    "environment.status",
  );
  const windowHost = scope.hosts.find(
    (host) => host.hostId === scope.activeHostId,
  );
  // A listed sandbox has no own-settings row; an unlisted host is still unknown.
  const windowHostId =
    windowHost !== undefined && windowHost.sandbox !== null
      ? null
      : scope.activeHostId;
  // Personal is the account's cloud configuration: only an account can open
  // it, so a window with no host yet waits for its own instead of showing it.
  const accountSignedIn = useAuthStore((state) => state.status === "signed-in");
  const picker = useMemo(
    () =>
      environmentPickerModel({
        hosts,
        statuses,
        versions,
        windowHostId,
        accountSignedIn,
      }),
    [hosts, statuses, versions, windowHostId, accountSignedIn],
  );
  return { picker, statuses };
}

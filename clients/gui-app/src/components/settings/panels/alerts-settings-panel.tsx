import { ALERTS } from "@/components/settings/panels/alerts-settings.definitions";
import { PushPermissionSection } from "@/components/settings/panels/push-permission-section";
import { SystemNotificationSettingsSection } from "@/components/settings/panels/system-notification-settings-section";
import { SettingsGroup } from "@/components/settings/settings-group";
import { SettingsPanelShell } from "@/components/settings/settings-panel-shell";
import { Button } from "@/components/ui/button";

export function AlertsSettingsPanel() {
  return (
    <SettingsPanelShell
      title="Alerts"
      description="How this app alerts you."
      bodyClassName="overflow-visible rounded-none border-none bg-transparent"
    >
      {/* The OS row exists on the desktop and the push row in the phone
        app; each gates itself. Notification events is drawn in every shell,
        so the card always has a row. */}
      <SettingsGroup
        group={ALERTS.definitions.notifications}
        showTitle
        tone="default"
        dataTestId="alerts-notifications-section"
        fill={false}
      >
        <SystemNotificationSettingsSection />
        <PushPermissionSection />
      </SettingsGroup>
    </SettingsPanelShell>
  );
}

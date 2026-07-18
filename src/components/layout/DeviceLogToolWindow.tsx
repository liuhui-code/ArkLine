import { memo, useCallback, useEffect, useState } from "react";
import { DeviceFaultLogPanel } from "@/components/layout/DeviceFaultLogPanel";
import { DeviceHiLogPanel } from "@/components/layout/DeviceHiLogPanel";
import type { DeviceLogDevice, WorkspaceApi } from "@/features/workspace/workspace-api";

type DeviceLogToolWindowProps = {
  active: boolean;
  workspaceApi: WorkspaceApi;
  onStatusChange: (status: string) => void;
};

type DeviceLogWorkbenchTab = "hilog" | "faultLog";

export const DeviceLogToolWindow = memo(function DeviceLogToolWindow({
  active,
  workspaceApi,
  onStatusChange,
}: DeviceLogToolWindowProps) {
  const [devices, setDevices] = useState<DeviceLogDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [activeTab, setActiveTab] = useState<DeviceLogWorkbenchTab>("hilog");
  const [panelStatus, setPanelStatus] = useState("Idle");

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;
    void workspaceApi.listDeviceLogDevices().then((items) => {
      if (cancelled) {
        return;
      }
      setDevices(items);
      setSelectedDeviceId((current) => current || items[0]?.id || "");
    });

    return () => {
      cancelled = true;
    };
  }, [active, workspaceApi]);
  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? null;

  const handlePanelStatusChange = useCallback((status: string) => {
    setPanelStatus(status);
    onStatusChange(status);
  }, [onStatusChange]);

  return (
    <section className="device-log-tool-window" aria-label="Device Log Panel">
      <header className="device-log-tool-window__toolbar">
        <select
          aria-label="Device"
          value={selectedDeviceId}
          onChange={(event) => setSelectedDeviceId(event.target.value)}
        >
          {devices.length === 0 ? <option value="">No devices</option> : null}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </select>
        <span className="device-log-tool-window__status">
          {selectedDevice ? `${selectedDevice.status} | ${selectedDevice.detail}` : "No device"}
        </span>
        <span className="device-log-tool-window__status">{panelStatus}</span>
      </header>
      <div className="device-log-tool-window__tabs" role="tablist" aria-label="Device Log Views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "hilog"}
          className={activeTab === "hilog" ? "device-log-tool-window__tab device-log-tool-window__tab--active" : "device-log-tool-window__tab"}
          onClick={() => setActiveTab("hilog")}
        >
          HiLog
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "faultLog"}
          className={activeTab === "faultLog" ? "device-log-tool-window__tab device-log-tool-window__tab--active" : "device-log-tool-window__tab"}
          onClick={() => setActiveTab("faultLog")}
        >
          Fault Log
        </button>
      </div>
      <div className="device-log-tool-window__content" hidden={activeTab !== "hilog"} aria-hidden={activeTab !== "hilog"}>
        <DeviceHiLogPanel
          active={active && activeTab === "hilog"}
          deviceId={selectedDeviceId}
          workspaceApi={workspaceApi}
          onStatusChange={handlePanelStatusChange}
        />
      </div>
      <div className="device-log-tool-window__content" hidden={activeTab !== "faultLog"} aria-hidden={activeTab !== "faultLog"}>
        <DeviceFaultLogPanel
          active={active && activeTab === "faultLog"}
          deviceId={selectedDeviceId}
          workspaceApi={workspaceApi}
          onStatusChange={handlePanelStatusChange}
        />
      </div>
    </section>
  );
});

import streamDeck, { type KeyAction } from "@elgato/streamdeck";

import { SynapseCtrlBridge, type BridgeStatus } from "./synapsectrl/bridge-client";
import { type BridgeEvent, type SynapseDevice, isRecord } from "./synapsectrl/protocol";

export const SETUP_DOCS_URL = "https://github.com/gabrielzv1233/SynapseDeck/blob/main/docs/Setup.md";

export type ProfileSettings = {
  deviceId?: string;
  deviceName?: string;
  profileId?: string;
  profileName?: string;
};

export type DataSourceItem = {
  label: string;
  value: string;
  disabled?: boolean;
};

export type InspectorStatus = {
  phase: BridgeStatus["phase"];
  message: string;
  docsUrl: string;
  ready: boolean;
  synapseCtrlVersion?: string;
};

type VisibleAction = {
  action: KeyAction<ProfileSettings>;
  settings: ProfileSettings;
};

export class SynapseManager {
  readonly bridge = new SynapseCtrlBridge();
  #actions = new Map<string, VisibleAction>();
  #devices = new Map<string, SynapseDevice>();
  #started = false;

  constructor() {
    this.bridge.on("status", (status: BridgeStatus) => {
      if (status.service) this.#replaceDevices(status.service.devices);
      void this.renderAll();
      this.#sendInspectorStatus();
    });
    this.bridge.on("hello", (hello: { service: { devices: SynapseDevice[] } }) => {
      this.#replaceDevices(hello.service.devices);
      void this.renderAll();
      this.#sendInspectorData();
    });
    this.bridge.on("event", (event: BridgeEvent) => this.#handleBridgeEvent(event));
    this.bridge.on("diagnostic", (message: string) => streamDeck.logger.warn(message));
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.bridge.start();
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    await this.bridge.stop();
  }

  register(action: KeyAction<ProfileSettings>, settings: ProfileSettings): void {
    this.#actions.set(action.id, { action, settings });
    void this.render(action.id);
  }

  update(action: KeyAction<ProfileSettings>, settings: ProfileSettings): void {
    this.#actions.set(action.id, { action, settings });
    void this.render(action.id);
  }

  unregister(actionId: string): void {
    this.#actions.delete(actionId);
  }

  get status(): InspectorStatus {
    const status = this.bridge.status;
    let message = status.message;
    if (status.phase === "missing") {
      message = "SynapseCTRL is required but could not be found. Install SynapseCTRL, complete its hook setup, then restart Stream Deck.";
    } else if (status.phase === "synapse-unavailable") {
      message = "Synapse is not running or prepared. Razer Synapse may be closed, or SynapseCTRL installation/setup may not be complete.";
    } else if (status.phase === "incompatible") {
      message = "The installed SynapseCTRL bridge is incompatible with this SynapseDeck version. Update SynapseCTRL.";
    }
    return {
      phase: status.phase,
      message,
      docsUrl: SETUP_DOCS_URL,
      ready: status.phase === "ready",
      synapseCtrlVersion: status.synapseCtrlVersion,
    };
  }

  async retry(): Promise<void> {
    await this.bridge.restart();
    this.#sendInspectorStatus();
  }

  async deviceItems(): Promise<DataSourceItem[]> {
    if (this.bridge.status.phase === "ready") {
      try {
        this.#replaceDevices(await this.bridge.listDevices());
      } catch (error) {
        streamDeck.logger.warn(`Could not refresh Synapse devices: ${this.#message(error)}`);
      }
    }
    return [...this.#devices.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((device) => ({
        label: device.name,
        value: device.id,
        disabled: !device.connected || !device.profilesSupported,
      }));
  }

  async profileItems(deviceId?: string): Promise<DataSourceItem[]> {
    if (!deviceId) return [];
    let profiles = this.#devices.get(deviceId)?.profiles ?? [];
    if (this.bridge.status.phase === "ready") {
      try {
        profiles = await this.bridge.listProfiles(deviceId);
        const device = this.#devices.get(deviceId);
        if (device) this.#devices.set(deviceId, { ...device, profiles });
      } catch (error) {
        streamDeck.logger.warn(`Could not refresh Synapse profiles: ${this.#message(error)}`);
      }
    }
    return profiles
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((profile) => ({ label: profile.name, value: profile.id }));
  }

  async activate(action: KeyAction<ProfileSettings>, settings: ProfileSettings): Promise<void> {
    if (!settings.deviceId || !settings.profileId || this.bridge.status.phase !== "ready") {
      await action.showAlert();
      return;
    }

    try {
      const result = await this.bridge.activateProfile(settings.deviceId, settings.profileId);
      if (result.status !== "verified" && result.status !== "already_active") {
        streamDeck.logger.warn(`Profile switch was not verified: ${result.status}`);
        await action.showAlert();
        return;
      }
      this.#setActiveProfile(result.deviceId, result.profileId);
      await this.renderDevice(result.deviceId);
    } catch (error) {
      streamDeck.logger.error(`Synapse profile switch failed: ${this.#message(error)}`);
      await action.showAlert();
    }
  }

  async render(actionId: string): Promise<void> {
    const entry = this.#actions.get(actionId);
    if (!entry) return;
    const { action, settings } = entry;

    try {
      if (!settings.deviceId || !settings.profileId) {
        await action.setState(0);
        await action.setTitle("Select\nProfile");
        return;
      }

      const phase = this.bridge.status.phase;
      if (phase !== "ready") {
        await action.setState(0);
        await action.setTitle(phase === "missing" ? "Setup\nRequired" : "Synapse\nUnavailable");
        return;
      }

      const device = this.#devices.get(settings.deviceId);
      if (!device || !device.connected) {
        await action.setState(0);
        await action.setTitle("Device\nUnavailable");
        return;
      }

      const profile = device.profiles.find((item) => item.id.toLowerCase() === settings.profileId?.toLowerCase());
      const title = settings.profileName || profile?.name || "Profile";
      await action.setState(device.activeProfileId?.toLowerCase() === settings.profileId.toLowerCase() ? 1 : 0);
      await action.setTitle(title);
    } catch (error) {
      streamDeck.logger.warn(`Could not render SynapseDeck key ${actionId}: ${this.#message(error)}`);
    }
  }

  async renderDevice(deviceId: string): Promise<void> {
    await Promise.all(
      [...this.#actions.entries()]
        .filter(([, entry]) => entry.settings.deviceId === deviceId)
        .map(([id]) => this.render(id)),
    );
  }

  async renderAll(): Promise<void> {
    await Promise.all([...this.#actions.keys()].map((id) => this.render(id)));
  }

  async refreshDevices(): Promise<void> {
    if (this.bridge.status.phase !== "ready") return;
    try {
      this.#replaceDevices(await this.bridge.listDevices());
      await this.renderAll();
      this.#sendInspectorData();
    } catch (error) {
      streamDeck.logger.warn(`Could not refresh SynapseDeck state: ${this.#message(error)}`);
    }
  }

  #handleBridgeEvent(event: BridgeEvent): void {
    if (event.event === "profile.changed") {
      const deviceId = typeof event.data.deviceId === "string" ? event.data.deviceId : undefined;
      const profileId = typeof event.data.profileId === "string" ? event.data.profileId : null;
      if (deviceId) {
        this.#setActiveProfile(deviceId, profileId);
        void this.renderDevice(deviceId);
      }
      return;
    }

    if (event.event === "device.changed" && isRecord(event.data.device)) {
      const device = event.data.device as unknown as SynapseDevice;
      if (typeof device.id === "string") {
        this.#devices.set(device.id, device);
        void this.renderDevice(device.id);
        this.#sendInspectorData();
      }
      return;
    }

    if (event.event === "devices.changed" || event.event === "synapse.available") {
      void this.refreshDevices();
      return;
    }

    if (event.event === "synapse.unavailable") {
      void this.renderAll();
      this.#sendInspectorStatus();
    }
  }

  #replaceDevices(devices: SynapseDevice[]): void {
    this.#devices = new Map(devices.map((device) => [device.id, device]));
  }

  #setActiveProfile(deviceId: string, profileId: string | null): void {
    const device = this.#devices.get(deviceId);
    if (!device) return;
    this.#devices.set(deviceId, {
      ...device,
      activeProfileId: profileId,
      profiles: device.profiles.map((profile) => ({
        ...profile,
        active: profileId !== null && profile.id.toLowerCase() === profileId.toLowerCase(),
      })),
    });
  }

  #sendInspectorStatus(): void {
    void streamDeck.ui.sendToPropertyInspector({ event: "status", status: this.status });
  }

  #sendInspectorData(): void {
    this.#sendInspectorStatus();
    void this.deviceItems().then((items) =>
      streamDeck.ui.sendToPropertyInspector({ event: "getDevices", items }),
    );
  }

  #message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export const synapseManager = new SynapseManager();

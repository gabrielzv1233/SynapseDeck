import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { synapseManager, type ProfileSettings } from "../synapse-manager";
import { isRecord } from "../synapsectrl/protocol";

@action({ UUID: "com.gabrielzv1233.synapsedeck.profile" })
export class SynapseProfileAction extends SingletonAction<ProfileSettings> {
  override onWillAppear(ev: WillAppearEvent<ProfileSettings>): void {
    if (!ev.action.isKey()) return;
    synapseManager.register(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<ProfileSettings>): void {
    synapseManager.unregister(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ProfileSettings>): void {
    if (!ev.action.isKey()) return;
    synapseManager.update(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<ProfileSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await synapseManager.activate(ev.action, ev.payload.settings);
  }

  override async onPropertyInspectorDidAppear(
    ev: PropertyInspectorDidAppearEvent<ProfileSettings>,
  ): Promise<void> {
    const settings = await ev.action.getSettings<ProfileSettings>();
    await this.#sendStatus();
    await this.#sendDevices();
    await this.#sendProfiles(settings.deviceId);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, ProfileSettings>): Promise<void> {
    if (!isRecord(ev.payload) || typeof ev.payload.event !== "string") return;
    const event = ev.payload.event;

    if (event === "getDevices") {
      await this.#sendDevices();
      return;
    }

    if (event === "getProfiles") {
      const settings = await ev.action.getSettings<ProfileSettings>();
      const requestedDevice = typeof ev.payload.deviceId === "string" ? ev.payload.deviceId : settings.deviceId;
      await this.#sendProfiles(requestedDevice);
      return;
    }

    if (event === "getStatus") {
      await this.#sendStatus();
      return;
    }

    if (event === "retryBridge") {
      await synapseManager.retry();
      await this.#sendStatus();
      await this.#sendDevices();
    }
  }

  async #sendStatus(): Promise<void> {
    await streamDeck.ui.sendToPropertyInspector({
      event: "status",
      status: synapseManager.status,
    });
  }

  async #sendDevices(): Promise<void> {
    await streamDeck.ui.sendToPropertyInspector({
      event: "getDevices",
      items: await synapseManager.deviceItems(),
    });
  }

  async #sendProfiles(deviceId?: string): Promise<void> {
    await streamDeck.ui.sendToPropertyInspector({
      event: "getProfiles",
      items: await synapseManager.profileItems(deviceId),
    });
  }
}

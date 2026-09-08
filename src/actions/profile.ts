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

const logger = streamDeck.logger.createScope("SynapseProfile");

function describeSettings(settings: ProfileSettings): string {
  const device = settings.deviceName || settings.deviceId || "<unset>";
  const profile = settings.profileName || settings.profileId || "<unset>";
  return `device=${device}, profile=${profile}`;
}

@action({ UUID: "com.gabrielzv1233.synapsedeck.profile" })
export class SynapseProfileAction extends SingletonAction<ProfileSettings> {
  override onWillAppear(ev: WillAppearEvent<ProfileSettings>): void {
    if (!ev.action.isKey()) return;
    logger.info(`Action ${ev.action.id} appeared with ${describeSettings(ev.payload.settings)}`);
    synapseManager.register(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<ProfileSettings>): void {
    synapseManager.unregister(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ProfileSettings>): void {
    if (!ev.action.isKey()) return;
    logger.info(`Action ${ev.action.id} settings updated: ${describeSettings(ev.payload.settings)}`);
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
    logger.info(`Property Inspector opened for ${ev.action.id}: ${describeSettings(settings)}`);
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
      deviceId,
      items: await synapseManager.profileItems(deviceId),
    });
  }
}

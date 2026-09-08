import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class FakeElement {
  constructor(id) {
    this.id = id;
    this.disabled = false;
    this.className = "";
    this.textContent = "";
    this.href = "";
    this._value = undefined;
    this.listeners = new Map();
  }

  get value() {
    return this._value;
  }

  set value(value) {
    if (this._value === value) return;
    this._value = value;
    this.emit("valuechange");
  }

  addEventListener(event, callback) {
    const callbacks = this.listeners.get(event) ?? [];
    callbacks.push(callback);
    this.listeners.set(event, callbacks);
  }

  emit(event) {
    for (const callback of this.listeners.get(event) ?? []) {
      Promise.resolve(callback()).catch((error) => {
        queueMicrotask(() => {
          throw error;
        });
      });
    }
  }

  refresh() {}
}

function createEventSource() {
  const callbacks = [];
  return {
    subscribe(callback) {
      callbacks.push(callback);
    },
    emit(message) {
      for (const callback of callbacks) callback(message);
    },
  };
}

const ids = ["status", "status-title", "status-message", "setup-link", "device", "profile", "retry"];
const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
const didReceiveSettings = createEventSource();
const sendToPropertyInspector = createEventSource();

let storedSettings = {
  deviceId: "device-1",
  deviceName: "Device One",
  profileId: "profile-1",
  profileName: "Profile One",
};
const savedSettings = [];
const sentMessages = [];

const streamDeckClient = {
  didReceiveSettings,
  sendToPropertyInspector,
  async getSettings() {
    return {
      coordinates: { column: 0, row: 0 },
      isInMultiAction: false,
      settings: { ...storedSettings },
    };
  },
  async setSettings(settings) {
    storedSettings = { ...settings };
    savedSettings.push({ ...settings });
    didReceiveSettings.emit({ payload: { settings: { ...storedSettings } } });
  },
  async send(event, payload) {
    sentMessages.push({ event, payload });
  },
};

const context = vm.createContext({
  SDPIComponents: { streamDeckClient },
  document: {
    getElementById(id) {
      return elements.get(id);
    },
  },
  console: { debug() {}, log() {}, warn() {}, error() {} },
  Map,
  Promise,
  queueMicrotask,
});

const source = await readFile("com.gabrielzv1233.synapsedeck.sdPlugin/ui/profile.js", "utf8");
vm.runInContext(source, context, { filename: "profile.js" });
await new Promise((resolve) => setTimeout(resolve, 0));

const device = elements.get("device");
const profile = elements.get("profile");

assert.equal(device.value, "device-1", "initial device should hydrate from payload.settings");
assert.equal(profile.value, "profile-1", "initial profile should hydrate from payload.settings");
assert.equal(savedSettings.length, 0, "hydration must not persist or clear settings");

sendToPropertyInspector.emit({
  payload: {
    event: "status",
    status: { phase: "ready", ready: true, message: "", docsUrl: "https://example.invalid" },
  },
});
sendToPropertyInspector.emit({
  payload: {
    event: "getDevices",
    items: [
      { value: "device-1", label: "Device One" },
      { value: "device-2", label: "Device Two" },
    ],
  },
});
sendToPropertyInspector.emit({
  payload: {
    event: "getProfiles",
    items: [{ value: "profile-1", label: "Profile One" }],
  },
});

// Simulate a real user device change. The profile must be cleared, but the
// settings sent to Stream Deck must be the action settings object itself --
// never the getSettings payload wrapper.
device.value = "device-2";
await new Promise((resolve) => setTimeout(resolve, 0));

assert.deepEqual(savedSettings.at(-1), {
  deviceId: "device-2",
  deviceName: "Device Two",
});
assert.equal("settings" in savedSettings.at(-1), false, "must not nest settings inside settings");
assert.deepEqual(sentMessages.at(-1), {
  event: "sendToPlugin",
  payload: { event: "getProfiles", deviceId: "device-2" },
});

sendToPropertyInspector.emit({
  payload: {
    event: "getProfiles",
    items: [
      { value: "profile-2", label: "Profile Two" },
      { value: "profile-3", label: "Profile Three" },
    ],
  },
});

profile.value = "profile-3";
await new Promise((resolve) => setTimeout(resolve, 0));

assert.deepEqual(savedSettings.at(-1), {
  deviceId: "device-2",
  deviceName: "Device Two",
  profileId: "profile-3",
  profileName: "Profile Three",
});
assert.deepEqual(storedSettings, savedSettings.at(-1));

console.log("Property Inspector settings regression test passed.");

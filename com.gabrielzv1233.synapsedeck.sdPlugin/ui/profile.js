const { streamDeckClient } = SDPIComponents;
const statusBox = document.getElementById("status");
const statusTitle = document.getElementById("status-title");
const statusMessage = document.getElementById("status-message");
const setupLink = document.getElementById("setup-link");
const deviceSelect = document.getElementById("device");
const profileSelect = document.getElementById("profile");
const retryButton = document.getElementById("retry");

let initialized = false;
let suppressSelectionEvents = false;
let lastPhase;
let currentSettings = {};
let deviceLabels = new Map();
let profileLabels = new Map();

function asSettings(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function readActionSettings() {
  // SDPIComponents.getSettings() returns the full didReceiveSettings payload:
  // { settings, coordinates, isInMultiAction, ... }. Only payload.settings is
  // the action's persisted settings object.
  const payload = await streamDeckClient.getSettings();
  return asSettings(payload?.settings);
}

function labelsFrom(items) {
  if (!Array.isArray(items)) return new Map();
  return new Map(
    items
      .filter((item) => item && typeof item.value === "string")
      .map((item) => [item.value, typeof item.label === "string" ? item.label : item.value]),
  );
}

function setSelectValue(select, value) {
  suppressSelectionEvents = true;
  try {
    select.value = typeof value === "string" && value.length > 0 ? value : undefined;
  } finally {
    suppressSelectionEvents = false;
  }
}

function applySettings(settings) {
  currentSettings = { ...asSettings(settings) };
  setSelectValue(deviceSelect, currentSettings.deviceId);
  setSelectValue(profileSelect, currentSettings.profileId);
  profileSelect.disabled = !currentSettings.deviceId || lastPhase !== "ready";
}

async function saveSettings(settings) {
  currentSettings = { ...asSettings(settings) };
  console.debug("[SynapseDeck] Saving action settings", currentSettings);
  await streamDeckClient.setSettings(currentSettings);
}

function setStatus(status) {
  if (!status || typeof status !== "object") return;
  const phase = status.phase || "starting";
  statusBox.className = `status ${phase}`;
  statusTitle.textContent = {
    ready: "Connected to Razer Synapse",
    missing: "SynapseCTRL is not installed",
    "synapse-unavailable": "Razer Synapse is not running or prepared",
    incompatible: "SynapseCTRL needs an update",
    error: "SynapseCTRL connection problem",
    stopped: "SynapseCTRL bridge stopped",
    starting: "Connecting to SynapseCTRL…",
  }[phase] || "SynapseDeck status";

  const compactMessages = {
    ready: "",
    "synapse-unavailable": "Synapse may be closed, or SynapseCTRL installation/setup may be incomplete.",
  };
  statusMessage.textContent = compactMessages[phase] ?? status.message ?? "";
  if (status.docsUrl) setupLink.href = status.docsUrl;

  const ready = Boolean(status.ready);
  deviceSelect.disabled = !ready;
  profileSelect.disabled = !ready || !currentSettings.deviceId;
  retryButton.disabled = phase === "starting";

  if (ready && lastPhase !== "ready") {
    Promise.resolve(deviceSelect.refresh?.()).catch(() => undefined);
    if (currentSettings.deviceId) {
      Promise.resolve(profileSelect.refresh?.()).catch(() => undefined);
    }
  }
  lastPhase = phase;
}

async function initialize() {
  // We deliberately own the complete action-settings object here instead of
  // using sdpi-select's `setting` attribute. That prevents control hydration
  // from being mistaken for a user device change and keeps every key's
  // device/profile pair independent.
  applySettings(await readActionSettings());
  console.debug("[SynapseDeck] Loaded action settings", currentSettings);
  initialized = true;
  await streamDeckClient.send("sendToPlugin", { event: "getStatus" });
}

streamDeckClient.didReceiveSettings?.subscribe?.((message) => {
  const settings = asSettings(message?.payload?.settings);
  if (!initialized) return;
  applySettings(settings);
  console.debug("[SynapseDeck] Received action settings", currentSettings);
});

streamDeckClient.sendToPropertyInspector.subscribe((message) => {
  const payload = message?.payload;
  if (!payload || typeof payload !== "object") return;

  if (payload.event === "status") {
    setStatus(payload.status);
    return;
  }

  if (payload.event === "getDevices") {
    deviceLabels = labelsFrom(payload.items);
    return;
  }

  if (payload.event === "getProfiles") {
    profileLabels = labelsFrom(payload.items);
    if (currentSettings.profileId) {
      setSelectValue(profileSelect, currentSettings.profileId);
    }
  }
});

deviceSelect.addEventListener("valuechange", async () => {
  if (!initialized || suppressSelectionEvents) return;

  const deviceId = typeof deviceSelect.value === "string" ? deviceSelect.value : "";
  if (deviceId === (currentSettings.deviceId || "")) return;

  const next = { ...currentSettings };

  if (deviceId) {
    next.deviceId = deviceId;
    next.deviceName = deviceLabels.get(deviceId) || deviceId;
  } else {
    delete next.deviceId;
    delete next.deviceName;
  }

  delete next.profileId;
  delete next.profileName;

  setSelectValue(profileSelect, undefined);
  profileLabels = new Map();
  profileSelect.disabled = !deviceId || lastPhase !== "ready";
  await saveSettings(next);

  if (deviceId && lastPhase === "ready") {
    // Tell the plugin exactly which device we just selected instead of relying
    // on a second getSettings round trip racing the just-sent setSettings.
    await streamDeckClient.send("sendToPlugin", { event: "getProfiles", deviceId });
  }
});

profileSelect.addEventListener("valuechange", async () => {
  if (!initialized || suppressSelectionEvents) return;

  const profileId = typeof profileSelect.value === "string" ? profileSelect.value : "";
  if (profileId === (currentSettings.profileId || "")) return;

  const next = { ...currentSettings };

  if (profileId) {
    next.profileId = profileId;
    next.profileName = profileLabels.get(profileId) || profileId;
  } else {
    delete next.profileId;
    delete next.profileName;
  }

  await saveSettings(next);
});

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  await streamDeckClient.send("sendToPlugin", { event: "retryBridge" });
});

void initialize();

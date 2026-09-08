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

async function saveSettings(settings) {
  currentSettings = settings;
  await streamDeckClient.setSettings(settings);
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
  // sdpi-select's built-in `setting` persistence emits valuechange while it is
  // hydrating the control. With dependent selects that can look like a real
  // device change and clear profileId/profileName. We deliberately own the
  // complete action-settings object here so each key is updated atomically.
  currentSettings = asSettings(await streamDeckClient.getSettings());
  setSelectValue(deviceSelect, currentSettings.deviceId);
  setSelectValue(profileSelect, currentSettings.profileId);
  profileSelect.disabled = !currentSettings.deviceId;
  initialized = true;
  await streamDeckClient.send("sendToPlugin", { event: "getStatus" });
}

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
  }
});

deviceSelect.addEventListener("valuechange", async () => {
  if (!initialized || suppressSelectionEvents) return;

  const deviceId = typeof deviceSelect.value === "string" ? deviceSelect.value : "";
  if (deviceId === (currentSettings.deviceId || "")) return;

  const latest = asSettings(await streamDeckClient.getSettings());
  const next = { ...latest };

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
    await Promise.resolve(profileSelect.refresh?.());
  }
});

profileSelect.addEventListener("valuechange", async () => {
  if (!initialized || suppressSelectionEvents) return;

  const profileId = typeof profileSelect.value === "string" ? profileSelect.value : "";
  if (profileId === (currentSettings.profileId || "")) return;

  const latest = asSettings(await streamDeckClient.getSettings());
  const next = { ...latest };

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

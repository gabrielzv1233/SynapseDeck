import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const plugin = "com.gabrielzv1233.synapsedeck.sdPlugin";
const sourcePath = path.join("icons", "synapse.svg");
const actionDir = path.join(plugin, "imgs", "actions", "profile");
const pluginDir = path.join(plugin, "imgs", "plugin");
const uiDir = path.join(plugin, "ui");
const activeGreen = /#44d62c/gi;

const source = await readFile(sourcePath, "utf8");
if (!activeGreen.test(source)) {
  throw new Error(`${sourcePath} must contain #44D62C so the inactive icon can be generated deterministically.`);
}

const active = source;
const inactive = source.replace(activeGreen, "#151515");

await Promise.all([
  mkdir(actionDir, { recursive: true }),
  mkdir(pluginDir, { recursive: true }),
  mkdir(uiDir, { recursive: true }),
]);

await Promise.all([
  writeFile(path.join(actionDir, "active.svg"), active),
  writeFile(path.join(actionDir, "inactive.svg"), inactive),
  writeFile(path.join(actionDir, "icon.svg"), active),
  writeFile(path.join(pluginDir, "category-icon.svg"), active),
  writeFile(path.join(pluginDir, "marketplace.svg"), active),
]);

const sdpiPath = path.join(uiDir, "sdpi-components.js");
try {
  await readFile(sdpiPath);
} catch {
  const response = await fetch("https://sdpi-components.dev/releases/v4/sdpi-components.js");
  if (!response.ok) {
    throw new Error(`Failed to download sdpi-components.js: HTTP ${response.status}`);
  }
  await writeFile(sdpiPath, await response.text());
}

console.log("Prepared SynapseDeck action, plugin, and property-inspector assets.");

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const plugin = "com.gabrielzv1233.synapsedeck.sdPlugin";
const sourcePath = path.join("icons", "synapse.svg");
const actionDir = path.join(plugin, "imgs", "actions", "profile");
const pluginDir = path.join(plugin, "imgs", "plugin");
const uiDir = path.join(plugin, "ui");
const activeGreen = /#44d62c/gi;

const source = await readFile(sourcePath, "utf8");
if (!/#44d62c/i.test(source)) {
  throw new Error(`${sourcePath} must contain #44D62C so inactive assets can be generated deterministically.`);
}

const active = source;
const inactive = source.replace(activeGreen, "#151515");
const monochrome = source.replace(activeGreen, "#FFFFFF");

await Promise.all([
  mkdir(actionDir, { recursive: true }),
  mkdir(pluginDir, { recursive: true }),
  mkdir(uiDir, { recursive: true }),
]);

await Promise.all([
  writeFile(path.join(actionDir, "active.svg"), active),
  writeFile(path.join(actionDir, "inactive.svg"), inactive),
  writeFile(path.join(actionDir, "icon.svg"), monochrome),
  writeFile(path.join(pluginDir, "category-icon.svg"), monochrome),
  sharp(Buffer.from(active)).resize(256, 256).png().toFile(path.join(pluginDir, "marketplace.png")),
  sharp(Buffer.from(active)).resize(512, 512).png().toFile(path.join(pluginDir, "marketplace@2x.png")),
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

console.log("Prepared SynapseDeck active/inactive, action-list, marketplace, and property-inspector assets.");

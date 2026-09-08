import streamDeck from "@elgato/streamdeck";

import { SynapseProfileAction } from "./actions/profile";
import { synapseManager } from "./synapse-manager";

streamDeck.logger.setLevel("info");
streamDeck.actions.registerAction(new SynapseProfileAction());
streamDeck.connect();
synapseManager.start();

const shutdown = (): void => {
  void synapseManager.stop().finally(() => process.exit(0));
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export const BRIDGE_PROTOCOL_VERSION = "1" as const;

export type BridgeError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type SynapseProfile = {
  id: string;
  name: string;
  active: boolean;
};

export type SynapseDevice = {
  id: string;
  name: string;
  vendorId: number;
  productId: number;
  containerId: string;
  serialNumber: string | null;
  connected: boolean;
  profilesSupported: boolean;
  controllable: boolean;
  unavailableReason: string | null;
  activeProfileId: string | null;
  profiles: SynapseProfile[];
};

export type ServiceState = {
  state: "starting" | "ready" | "unavailable" | string;
  synapseAvailable: boolean;
  devices: SynapseDevice[];
  error: BridgeError | null;
  updatedAtMs: number | null;
};

export type SwitchResult = {
  status: "verified" | "sent" | "already_active" | "timeout" | "failed";
  deviceId: string;
  profileId: string;
  previousProfileId: string | null;
  sent: boolean;
  verified: boolean;
  elapsedMs: number;
  error: BridgeError | null;
};

export type HelloResult = {
  protocolVersion: string;
  synapseCtrlVersion: string;
  transport: "stdio" | string;
  service: ServiceState;
};

export type BridgeResponse<T = unknown> = {
  protocolVersion: string;
  id: number | string | null;
  result?: T;
  error?: BridgeError;
};

export type BridgeEvent = {
  protocolVersion: string;
  event: string;
  data: Record<string, unknown>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

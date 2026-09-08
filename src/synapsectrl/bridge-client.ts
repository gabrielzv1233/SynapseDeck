import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import os from "node:os";
import path from "node:path";

import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeError,
  type BridgeEvent,
  type BridgeResponse,
  type HelloResult,
  type ServiceState,
  type SwitchResult,
  type SynapseDevice,
  type SynapseProfile,
  isRecord,
} from "./protocol";

export type BridgePhase =
  | "stopped"
  | "starting"
  | "ready"
  | "synapse-unavailable"
  | "missing"
  | "incompatible"
  | "error";

export type BridgeStatus = {
  phase: BridgePhase;
  message: string;
  command?: string;
  synapseCtrlVersion?: string;
  service?: ServiceState;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class BridgeRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BridgeRequestError";
  }
}

const NORMAL_RESTART_DELAYS = [1000, 2000, 5000, 10000, 30000] as const;
const MISSING_RETRY_MS = 30000;

export class SynapseCtrlBridge extends EventEmitter {
  #child: ChildProcessWithoutNullStreams | null = null;
  #reader: ReadLineInterface | null = null;
  #pending = new Map<string, PendingRequest>();
  #nextId = 1;
  #restartTimer: NodeJS.Timeout | null = null;
  #restartIndex = 0;
  #stopping = false;
  #starting = false;
  #status: BridgeStatus = { phase: "stopped", message: "Bridge is stopped." };

  get status(): BridgeStatus {
    return this.#status;
  }

  get running(): boolean {
    return this.#child !== null;
  }

  start(): void {
    if (this.#stopping) this.#stopping = false;
    if (this.#child || this.#starting) return;
    void this.#startAttempt();
  }

  async restart(): Promise<void> {
    this.#stopping = false;
    this.#clearRestart();
    await this.#disposeChild(false);
    this.#restartIndex = 0;
    this.start();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#clearRestart();
    if (this.#child) {
      try {
        await this.request("shutdown", {}, 1000);
      } catch {
        // The child may already be exiting; disposal below is authoritative.
      }
    }
    await this.#disposeChild(false);
    this.#setStatus({ phase: "stopped", message: "Bridge is stopped." });
  }

  async state(): Promise<ServiceState> {
    return this.request<ServiceState>("service.state");
  }

  async refresh(): Promise<SynapseDevice[]> {
    return this.request<SynapseDevice[]>("service.refresh");
  }

  async listDevices(): Promise<SynapseDevice[]> {
    return this.request<SynapseDevice[]>("devices.list");
  }

  async listProfiles(deviceId: string): Promise<SynapseProfile[]> {
    return this.request<SynapseProfile[]>("profiles.list", { deviceId });
  }

  async activateProfile(deviceId: string, profileId: string): Promise<SwitchResult> {
    return this.request<SwitchResult>(
      "profile.activate",
      { deviceId, profileId, timeout: 5, verify: true },
      10000,
    );
  }

  request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<T> {
    const child = this.#child;
    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      return Promise.reject(new BridgeRequestError("bridge_unavailable", "SynapseCTRL bridge is not available."));
    }

    const id = this.#nextId++;
    const key = String(id);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(key);
        reject(new BridgeRequestError("bridge_timeout", `SynapseCTRL bridge request '${method}' timed out.`));
      }, timeoutMs);

      this.#pending.set(key, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      const line = `${JSON.stringify({ id, method, params })}\n`;
      child.stdin.write(line, "utf8", (error) => {
        if (!error) return;
        const pending = this.#pending.get(key);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(key);
        pending.reject(new BridgeRequestError("bridge_write_failed", error.message));
      });
    });
  }

  async #startAttempt(): Promise<void> {
    if (this.#starting || this.#child || this.#stopping) return;
    this.#starting = true;
    this.#setStatus({ phase: "starting", message: "Starting SynapseCTRL bridge…" });

    try {
      let child: ChildProcessWithoutNullStreams | null = null;
      let command = "";
      const failures: string[] = [];

      for (const candidate of this.#commands()) {
        if (this.#stopping) return;
        try {
          child = await this.#spawnCandidate(candidate);
          command = candidate;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${candidate}: ${message}`);
        }
      }

      if (!child) {
        this.#setStatus({
          phase: "missing",
          message: "SynapseCTRL is not installed or is not available to Stream Deck.",
        });
        this.emit("diagnostic", failures.join(" | "));
        this.#scheduleRestart(MISSING_RETRY_MS);
        return;
      }

      this.#attachChild(child, command);
      let hello: HelloResult;
      try {
        hello = await this.request<HelloResult>("hello", {}, 8000);
      } catch (error) {
        this.#setStatus({
          phase: "error",
          message: error instanceof Error ? error.message : "SynapseCTRL bridge handshake failed.",
          command,
        });
        await this.#disposeChild(true);
        return;
      }

      if (hello.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
        this.#setStatus({
          phase: "incompatible",
          message: `Unsupported SynapseCTRL bridge protocol ${hello.protocolVersion}; SynapseDeck requires ${BRIDGE_PROTOCOL_VERSION}.`,
          command,
          synapseCtrlVersion: hello.synapseCtrlVersion,
          service: hello.service,
        });
        await this.#disposeChild(false);
        return;
      }

      this.#restartIndex = 0;
      this.#applyServiceState(hello.service, {
        command,
        synapseCtrlVersion: hello.synapseCtrlVersion,
      });
      this.emit("hello", hello);
    } finally {
      this.#starting = false;
    }
  }

  #commands(): string[] {
    const candidates = [
      process.env.SYNAPSECTRL_PATH,
      "SynapseCTRL",
      path.join(os.homedir(), ".local", "bin", "synapsectrl.exe"),
    ].filter((value): value is string => Boolean(value));
    return [...new Set(candidates)];
  }

  #spawnCandidate(command: string): Promise<ChildProcessWithoutNullStreams> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        command,
        ["bridge", "--stdio", "--parent-pid", String(process.pid)],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          env: process.env,
        },
      );
      const onError = (error: Error): void => {
        child.removeListener("spawn", onSpawn);
        reject(error);
      };
      const onSpawn = (): void => {
        child.removeListener("error", onError);
        resolve(child);
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    });
  }

  #attachChild(child: ChildProcessWithoutNullStreams, command: string): void {
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    this.#reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.#reader.on("line", (line) => this.#handleLine(line));
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) this.emit("diagnostic", `[SynapseCTRL] ${message}`);
    });
    child.once("exit", (code, signal) => {
      if (child !== this.#child) return;
      this.#reader?.close();
      this.#reader = null;
      this.#child = null;
      this.#rejectPending(
        new BridgeRequestError("bridge_exited", `SynapseCTRL bridge exited (${code ?? signal ?? "unknown"}).`),
      );
      if (!this.#stopping && this.#status.phase !== "incompatible") {
        this.#setStatus({
          phase: "error",
          message: "SynapseCTRL bridge exited unexpectedly; reconnecting…",
          command,
        });
        this.#scheduleRestart();
      }
    });
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      this.emit("diagnostic", `Ignored non-JSON SynapseCTRL stdout: ${trimmed}`);
      return;
    }
    if (!isRecord(payload)) return;

    if (typeof payload.event === "string") {
      const event = payload as unknown as BridgeEvent;
      if (event.protocolVersion !== BRIDGE_PROTOCOL_VERSION) return;
      this.#handleEvent(event);
      this.emit("event", event);
      return;
    }

    if (!("id" in payload)) return;
    const response = payload as BridgeResponse;
    const pending = this.#pending.get(String(response.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(String(response.id));
    if (response.error) {
      pending.reject(this.#errorFrom(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  #handleEvent(event: BridgeEvent): void {
    if (event.event === "synapse.available") {
      void this.state().then((state) => this.#applyServiceState(state)).catch(() => undefined);
      return;
    }
    if (event.event === "synapse.unavailable") {
      const current = this.#status.service;
      const service: ServiceState = {
        state: "unavailable",
        synapseAvailable: false,
        devices: [],
        error: isRecord(event.data.error) ? (event.data.error as BridgeError) : current?.error ?? null,
        updatedAtMs: Date.now(),
      };
      this.#applyServiceState(service);
    }
  }

  #applyServiceState(
    service: ServiceState,
    extra: Pick<BridgeStatus, "command" | "synapseCtrlVersion"> = {},
  ): void {
    const current = this.#status;
    const status: BridgeStatus = service.synapseAvailable
      ? {
          phase: "ready",
          message: "Connected to Razer Synapse through SynapseCTRL.",
          command: extra.command ?? current.command,
          synapseCtrlVersion: extra.synapseCtrlVersion ?? current.synapseCtrlVersion,
          service,
        }
      : {
          phase: "synapse-unavailable",
          message: "Razer Synapse is not running or prepared for SynapseCTRL.",
          command: extra.command ?? current.command,
          synapseCtrlVersion: extra.synapseCtrlVersion ?? current.synapseCtrlVersion,
          service,
        };
    this.#setStatus(status);
  }

  #errorFrom(error: BridgeError): BridgeRequestError {
    return new BridgeRequestError(error.code, error.message, error.details ?? {});
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  async #disposeChild(restart: boolean): Promise<void> {
    const child = this.#child;
    if (!child) {
      if (restart && !this.#stopping) this.#scheduleRestart();
      return;
    }
    this.#child = null;
    this.#reader?.close();
    this.#reader = null;
    this.#rejectPending(new BridgeRequestError("bridge_restarting", "SynapseCTRL bridge is restarting."));
    if (!child.killed) child.kill();
    if (restart && !this.#stopping) this.#scheduleRestart();
  }

  #scheduleRestart(delay?: number): void {
    if (this.#stopping || this.#restartTimer) return;
    const selectedDelay = delay ?? NORMAL_RESTART_DELAYS[Math.min(this.#restartIndex++, NORMAL_RESTART_DELAYS.length - 1)];
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      this.start();
    }, selectedDelay);
  }

  #clearRestart(): void {
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
  }

  #setStatus(status: BridgeStatus): void {
    this.#status = status;
    this.emit("status", status);
  }
}

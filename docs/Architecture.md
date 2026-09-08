# Architecture

SynapseDeck is intentionally a thin Stream Deck integration over SynapseCTRL rather than a second Synapse reverse-engineering implementation.

## Process model

```text
Elgato Stream Deck
        |
        | plugin lifecycle + key/UI events
        v
SynapseDeck (Node.js / TypeScript)
        |
        | one child process, NDJSON stdin/stdout
        v
SynapseCTRL bridge --stdio
        |
        | SynapseService + one persistent SynapseClient
        v
Razer Synapse 4
```

The bridge is private to SynapseDeck. It is launched with SynapseDeck's process ID, so SynapseCTRL can terminate itself if the parent disappears unexpectedly.

## One bridge, many keys

`SynapseManager` owns one `SynapseCtrlBridge` and a registry of visible Stream Deck key contexts. The manager fans one cached device/profile state out to every key.

Twenty keys assigned to one mouse still use the same SynapseCTRL process and the same SynapseService watcher. There is no per-button Python process or polling loop.

## State flow

On startup:

1. SynapseDeck starts `SynapseCTRL bridge --stdio --parent-pid ...`.
2. It sends the bridge `hello` request.
3. Protocol version `1` is verified.
4. The returned `service` snapshot seeds SynapseDeck's cache.
5. Visible keys are rendered from that shared cache.

The bridge then sends events such as:

- `profile.changed`
- `device.changed`
- `devices.changed`
- `synapse.available`
- `synapse.unavailable`

SynapseDeck updates only the affected cached state and re-renders relevant buttons. Device-set changes trigger a fresh `devices.list` request.

## Profile switching

A configured key stores stable SynapseCTRL identifiers:

```json
{
  "deviceId": "DEVICE_ID",
  "deviceName": "Razer Naga V2 Hyperspeed",
  "profileId": "PROFILE_GUID",
  "profileName": "Siege"
}
```

On key press, SynapseDeck sends `profile.activate` with verification enabled. Only `verified` and `already_active` are treated as success. The manager immediately updates its cache and every visible key associated with that device; the regular bridge watcher remains the fallback/source of truth for outside changes.

## Key states

The manifest defines two states and disables Stream Deck's automatic toggling:

- state `0`: inactive
- state `1`: active

SynapseDeck calls `setState()` based on the actual active Synapse profile rather than based on whether the user just pressed the key.

The source artwork is `icons/synapse.svg`. Build tooling generates the inactive key by replacing `#44D62C` with `#151515`.

## Failure states

Bridge lifecycle and Synapse availability are deliberately separate:

- **missing** — SynapseCTRL executable could not be found
- **starting** — bridge is launching/handshaking
- **ready** — bridge and Synapse are available
- **synapse-unavailable** — bridge is alive but Synapse is closed/unprepared
- **incompatible** — unsupported bridge protocol
- **error** — bridge exited or handshake failed; automatic restart follows

Unexpected bridge exits use bounded exponential backoff. A missing executable is retried periodically so a later SynapseCTRL installation can recover without rebuilding the plugin.

## Property Inspector

The Property Inspector uses Elgato's `sdpi-components` library and obtains device/profile dropdowns through `sendToPlugin` data-source requests. Dropdown values are stable IDs; labels are cached into settings for readable key titles.

Setup problems are displayed directly in the Property Inspector with a link to SynapseDeck's own setup/troubleshooting documentation.

# SynapseDeck

Stream Deck control for **Razer Synapse 4 software profiles**, powered by [SynapseCTRL](https://github.com/gabrielzv1233/SynapseCTRL).

SynapseDeck gives each configured key a device/profile pair. Pressing the key switches that Synapse software profile, and the key automatically reflects whether the profile is currently active — including changes made by Synapse itself or another tool.

## Requirements

- Windows 10 or newer
- Stream Deck 7.1 or newer
- Razer Synapse 4
- [SynapseCTRL](https://github.com/gabrielzv1233/SynapseCTRL) installed and prepared

Install and prepare SynapseCTRL first:

```powershell
uv tool install synapsectrl
SynapseCTRL hook install
```

Fully exit and reopen Razer Synapse, then verify:

```powershell
SynapseCTRL doctor
```

See [Setup & Troubleshooting](docs/Setup.md) for the complete flow.

## How it works

SynapseDeck automatically starts one private persistent SynapseCTRL bridge when the Stream Deck plugin starts:

```text
Stream Deck
    |
    v
SynapseDeck
    |
    | NDJSON stdin/stdout
    v
SynapseCTRL bridge --stdio --parent-pid <SynapseDeck PID>
    |
    v
Razer Synapse 4
```

The user does **not** run bridge mode manually. One bridge is shared by every SynapseDeck button, so adding more buttons does not create more Python processes or independent pollers.

## Profile action

Add **SynapseDeck → Synapse Profile** and choose:

1. a Razer device
2. one of that device's Synapse software profiles

The key uses two states generated from [`icons/synapse.svg`](icons/synapse.svg):

- **active:** the source icon's `#44D62C` green
- **inactive:** the same artwork with the green replaced by `#151515`

If SynapseCTRL cannot be found, or Razer Synapse is not running/prepared, SynapseDeck shows a setup/unavailable state instead of silently failing.

## Development

Requires Node.js 24+.

```powershell
npm install
npm run typecheck
npm run build
npm run validate
npm run pack
```

`npm run watch` rebuilds and restarts the plugin during development.

The packaged `.streamDeckPlugin` is written to `dist/`.

## Documentation

- [Setup & Troubleshooting](docs/Setup.md)
- [Architecture](docs/Architecture.md)
- [SynapseCTRL bridge protocol](https://github.com/gabrielzv1233/SynapseCTRL/blob/main/docs/Bridge.md)

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

SynapseDeck is an independent community project and is not affiliated with or endorsed by Razer or Elgato.

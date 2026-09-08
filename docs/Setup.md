# Setup & Troubleshooting

SynapseDeck depends on **Razer Synapse 4** and **SynapseCTRL**. SynapseDeck owns bridge mode automatically; you should not keep a separate `SynapseCTRL bridge` terminal running.

## 1. Install SynapseCTRL

Recommended:

```powershell
uv tool install synapsectrl
```

Or with pip:

```powershell
python -m pip install synapsectrl
```

Make sure this works in a normal terminal:

```powershell
SynapseCTRL --version
```

## 2. Prepare Razer Synapse

Install the SynapseCTRL launch hook:

```powershell
SynapseCTRL hook install
```

Windows will request administrator elevation. After it completes, **fully exit Razer Synapse and reopen it**.

Verify setup:

```powershell
SynapseCTRL doctor
```

A healthy setup should allow:

```powershell
SynapseCTRL devices
```

## 3. Install SynapseDeck

For development/source builds:

```powershell
npm install
npm run pack
```

Open the `.streamDeckPlugin` created in `dist/` to install it in Stream Deck.

After installing, add **SynapseDeck → Synapse Profile** to a key and select a device and profile in the Property Inspector.

## What SynapseDeck starts

When Stream Deck starts the plugin, SynapseDeck starts:

```powershell
SynapseCTRL bridge --stdio --parent-pid <SynapseDeck PID>
```

with hidden stdio pipes. This bridge process:

- stays alive for the plugin lifetime
- is shared by all SynapseDeck keys
- exits if SynapseDeck/Stream Deck exits
- keeps watching Synapse even when no key is being pressed
- automatically recovers when Synapse is restarted

You do not need to run this command yourself.

## “SynapseCTRL is required”

SynapseDeck could not start the `SynapseCTRL` command.

Check:

```powershell
SynapseCTRL --version
```

If you installed SynapseCTRL while Stream Deck was already running, fully restart Stream Deck so its plugin process inherits the updated `PATH`.

`uv tool install synapsectrl` normally exposes the tool globally. SynapseDeck also checks the common uv tool location:

```text
%USERPROFILE%\.local\bin\synapsectrl.exe
```

For unusual installations, you can explicitly set:

```text
SYNAPSECTRL_PATH=C:\full\path\to\synapsectrl.exe
```

before Stream Deck starts.

## “Synapse is not running or prepared”

The SynapseCTRL bridge exists, but cannot currently use Razer Synapse. Common causes:

- Razer Synapse is closed
- SynapseCTRL's hook has not been installed
- Synapse was not fully restarted after hook installation
- a Synapse update changed or broke the installed hook/runtime integration

Run:

```powershell
SynapseCTRL doctor
```

If it reports hook problems:

```powershell
SynapseCTRL hook repair
```

Then fully exit and reopen Razer Synapse.

## Device/profile list is empty

First verify SynapseCTRL itself sees the device:

```powershell
SynapseCTRL devices
SynapseCTRL profiles "Naga"
```

If the CLI does not see it, fix the SynapseCTRL/Synapse side first. If the CLI sees it but SynapseDeck does not, use **Refresh SynapseCTRL** or restart Stream Deck and report the SynapseDeck logs.

## A key shows an alert

A yellow Stream Deck alert means the requested profile switch was missing required configuration, could not be sent, or was not verified by Synapse. SynapseDeck intentionally does not claim success unless SynapseCTRL reports `verified` or `already_active`.

## Updating SynapseCTRL

Because SynapseDeck launches the installed global command, updating the tool is enough:

```powershell
uv tool upgrade synapsectrl
```

Restart Stream Deck afterward so the private bridge restarts on the new version.

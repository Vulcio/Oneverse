---
title: Your own stem separation server
description: Run Songverse Sonic with Docker or on Proxmox, and connect it to your team or organisation.
---

Songverse splits recordings into stems (see [Separating a recording into stems](/library/#separating-a-recording-into-stems)) on a **Songverse Sonic** server: Demucs, which does the separating, and an analysis of each recording - its tempo, beats and bars, key and sections. A team or an organisation can run its own, on its own computer or server, and connect it. Its songs are then split there, by its members, without needing a role from this Songverse's admin.

## Before you start

- **This Songverse allows it.** Its admin turns on **Teams and organisations may connect their own Songverse Sonic server** in Admin > Stem separation. Until then, the **Stem separation** section doesn't show on a team's or an organisation's page.
- **A computer that stays on:** Linux with Docker, or a Proxmox host. The processor is enough (a few minutes a song); an NVIDIA graphics card is much faster. Count 8 GB of memory and 10 GB of disk for the models and the jobs.
- **Songverse can reach it:** a public address starting with https://, usually behind a reverse proxy. A private or local address (`http://192.168.1.20:8000`) only works when this Songverse's admin allows it (**On private or local addresses too**), which makes sense only when both servers are on the same network.

## With Docker

```bash
docker run -d --name sonic --restart unless-stopped -p 8000:8000 \
  -e DEMUX_API_KEY="$(openssl rand -hex 32)" \
  -e DEMUX_PRELOAD_MODELS="htdemucs htdemucs_ft" \
  -v sonic-data:/var/lib/demucs-api \
  ghcr.io/bricedupuy/songverse-sonic:latest
```

- **Its API key**, to paste into Songverse: `docker exec sonic printenv DEMUX_API_KEY`.
- **With an NVIDIA graphics card:** the `ghcr.io/bricedupuy/songverse-sonic:cuda` image, with `--gpus all` (the NVIDIA container toolkit must be installed). Without a usable card, it says so in its log and uses the processor.
- **Docker Compose:** the repository has a `docker-compose.yml` and a `.env.example` to copy.
- **Updating:** `docker pull` the image and create the container again; the jobs and models stay in the `sonic-data` volume.

Every setting is in the [Songverse Sonic repository](https://github.com/Vulcio/songverse-sonic).

## On Proxmox

On the Proxmox host, as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/bricedupuy/songverse-sonic/main/ct/demucs-api.sh)"
```

It creates a Debian container running Songverse Sonic, with a guided choice of processor or graphics card. Its API key: `pct exec <CTID> -- cat /etc/demucs-api/api-key`. Inside the container, `update` updates it.

## Making it reachable

Put it behind a reverse proxy that gives it an https:// address. With Caddy, for example:

```text
sonic.example.org {
  reverse_proxy localhost:8000
}
```

Then tell it its public address and to trust the proxy: `DEMUX_PUBLIC_BASE_URL=https://sonic.example.org`, `DEMUX_TRUST_PROXY_HEADERS=true` and `DEMUX_FORWARDED_ALLOW_IPS` set to the proxy's address. Sonic tells Songverse when stems are ready; if it can't reach Songverse, Songverse asks it every 2 minutes instead.

## Connecting it

On the team's page - or the organisation's - its admins find **Stem separation**:

- **Server address** and **API key**, then **Connect**;
- **Then a finer pass**: a slower, better separation that replaces the first stems when the server has time;
- **Separations per person in 30 days**: empty for no limit.

**Test connection** checks the address and the key: **Connected: songverse-sonic 1.6.0. Models: …**. If its version doesn't find beats and bars, it says to update it. The key is never shown again: leave it blank to keep it. **Disconnect** stops using the server: anything still being split there fails, and the stems already split stay.

## Which server a song uses

- **A team's song:** the team's own server, else its organisation's, else this Songverse's own, if it has one.
- **Your own songs:** this Songverse's own server.
- **Who can separate:** on a team's or an organisation's server, the team's members, within its limit. On this Songverse's own server, whoever its admin allowed.

When you separate a recording, the window names the server it goes to: **On Grace Church's Sonic server**.

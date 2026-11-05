# 0011. The platform is hosted on a remote VM

- **Status:** Accepted (supersedes the plan's "one host at the venue")
- **Date:** 2026-11-04

## Context
The first plan put one host at the venue, reached on the LAN, with Tailscale for remote admins and "running without internet" as a non-goal phrased for an on-site host. In practice the VM is offered by a hoster in a server room away from the venue. RAM and disk are scarce, so one VM is the start.

## Decision
- **One hosted VM away from the venue** runs the shared stack (Debian, Docker Compose).
- **Attendees and the projector PC reach it over the internet** through the venue uplink. The VM sees the venue as one public address. Therefore:
  - **HTTPS with a real domain is required** (certificates via DNS-01; edge Caddy, [0013](0013-multi-tenant-core.md));
  - **the venue uplink is a dependency:** screens cache their last state and assets and keep showing them when it drops, and admin shows them as offline;
  - LAN-only ideas (L2 access, the venue router's DNS-rebinding check, plain http on a LAN IP) no longer apply.
- **The projector is a venue PC** running a full-screen browser on `/screen`, with picture and sound over HDMI. The VM serves web pages only.
- **The fallback laptop is the only on-site copy:** event repo, images downloaded in advance, one-command restore of the latest backup.
- **Access and firewall** (ufw, deny incoming by default on IPv4 and IPv6):
  - everything on the Tailscale interface; Tailscale key expiry is off;
  - ssh from the old development machine's address and the hoster's jump host (kept for good);
  - ports 80/443 only from the venue's public address until HTTPS and sign-in exist, then open to everyone. The address lives in `deploy/.env`, never in the repo.
- LLMNR and mDNS are off.
- **Boot survival:** a systemd unit starts the stack at boot; Docker starts on boot; Docker's own firewall chain follows the same policy for published ports; the install checklist includes a reboot test.

## Consequences
- Discord sign-in (#5) waits for the domain and a DNS API token.
- Setup (#12) covers IPv6 and 443 and can open the web ports to everyone later.
- Cast must be measured over the uplink before its design is fixed ([roadmap](../roadmap.md#cast)).
- A stuck VM needs the hoster; the fallback laptop is a hard requirement.

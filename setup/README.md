# setup

Scripts for installing a host and keeping the stack up across reboots. The platform runs as one shared stack ([decision 0013](../docs/decisions/0013-multi-tenant-core.md)); events are tenants (rows), so there is no per-event setup here. Every script takes `--dry-run` and fails with a clear message (exit 2) when something is missing or unreachable.

- `install [--dry-run] [--boot]`: checks Docker, writes `deploy/.env` from `deploy/.env.example` (random Postgres password, mode 600), starts the stack and checks `/api/hello/health`.
  - `--boot` (root, for a host reachable from outside) also installs `cp-firewall.service` and `cp-stack.service`, enables Docker, the firewall and the stack at boot, puts the firewall in place **before** the stack publishes its ports, starts the stack through `cp-stack`, and ends with `check-boot`.
  - Before it changes anything, `--boot` validates `CP_WEB_ALLOW` as the units will see it: from `deploy/.env` only (a `CP_WEB_ALLOW` in the environment is ignored), test-loading the rules. It refuses a checkout path with characters other than letters, digits and `/._-`, because the units bake the path in.
- `firewall apply|close|remove|check|status [--dry-run]`: the DOCKER-USER firewall for IPv4 (iptables) and IPv6 (ip6tables).
  - Docker's NAT bypasses ufw, so the `CP-FIREWALL` chain, hooked first into `DOCKER-USER`, drops published traffic unless it comes from a source in `CP_WEB_ALLOW` to port 80 or 443. Container-to-container and outbound traffic are untouched.
  - `CP_WEB_ALLOW` lives in `deploy/.env`, never in the repo: a space or comma separated list of IPv4/IPv6 addresses or CIDRs, or `any` to open the web ports to everyone (once HTTPS and sign-in exist). An empty or invalid list makes `apply` refuse without changing anything.
  - `apply` validates every entry (IPv4 octets and prefixes, IPv6 syntax and prefixes; Python's `ipaddress` too when present), then test-loads both families with `iptables-restore --test` and `ip6tables-restore --test`, and only then replaces each chain atomically. It is idempotent. `close` drops all published traffic.
  - `check` exits 0 only if, on both families, `FORWARD` jumps to `DOCKER-USER`, `DOCKER-USER` jumps to the chain and the chain ends in the DNAT DROP rule. That fails on a flushed chain and on Docker's nftables backend. A closed firewall passes, with a `closed:` line that `check-boot` reports as a failure.
  - A container that calls the host's own public address on a published port also arrives as published (DNAT) traffic from a Docker subnet, and is dropped unless that subnet is in `CP_WEB_ALLOW`. Containers reach each other by service name, which is untouched.
  - Sources to IPv6 are only matched for networks Docker runs with IPv6. On an IPv4-only network, Docker serves the `[::]` ports through docker-proxy, so that traffic reaches the host's INPUT chain and ufw filters it.
  - To reach the web ports over Tailscale too, add its ranges (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`) to `CP_WEB_ALLOW`.
- `cp-firewall.service`: runs `firewall apply` before `docker.service`, and Docker requires it (`RequiredBy=docker.service`), so the rules exist before Docker restores any container. If apply fails it runs `firewall close` and Docker starts with the web ports shut; if even `close` fails, the unit fails and Docker does not start.
- `cp-stack.service`: after Docker and `cp-firewall`, checks the firewall and runs `docker compose up -d --wait`.
- `check-boot`: checks that Docker, `cp-firewall` and `cp-stack` start at boot, Docker requires `cp-firewall`, every running service has a restart policy (`docker inspect`; no `jq` needed), and the firewall is in place and not closed on IPv4 and IPv6.

`deploy/compose.yml` publishes Caddy explicitly on `0.0.0.0` and `[::]` for ports 80 and 443, because a host's Docker default bind may be `127.0.0.1`. On a host reachable from outside, start the stack only through `setup/install --boot` or `cp-stack.service`, so the firewall is in place first: plain `setup/install` and `docker compose up` publish on all interfaces with no firewall. A host booted with IPv6 off (`ipv6.disable=1`) cannot bind `::`, so `compose up` fails there.

**Check command:** `setup/test.sh`. It needs no root and changes nothing on the host: every script runs with `--dry-run` or against an unreachable Docker daemon, plus `systemd-analyze verify` on the units, the compose ports and shellcheck (each skipped with a message when its tool is missing).

## Install checklist
1. Set `CP_WEB_ALLOW` in `deploy/.env` (copy `deploy/.env.example` first if the file does not exist yet).
2. `sudo setup/install --boot`.
3. `sudo setup/check-boot` shows only `ok`.
4. From an allowed address, `http://<host>/api/hello/health` answers; from any other address it times out, on IPv4 and on IPv6.
5. **Reboot test:** `sudo reboot`. Once it is back, without touching anything:
   - `systemctl status cp-firewall cp-stack` shows both active;
   - `docker ps` lists every service healthy;
   - `sudo setup/check-boot` shows only `ok`;
   - health answers from an allowed address and is still blocked from others (IPv4 and IPv6);
   - `sudo ufw status` is unchanged.

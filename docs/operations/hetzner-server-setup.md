# Setting up a Hetzner server

How to get a server at Hetzner and run SurveyJS Studio on it at `https://studio.surveyjs.io` in mode 1.1 (the app
on the surveyjs.io SQL database and Azure storage). The app's settings, the checks after start-up and the rollout
are in [Operations](../operations.md); this page covers the server around it.

The server runs two containers with Docker Compose: the app, from the image CI publishes for each `master` commit
(`ghcr.io/surveyjs/surveyjs-studio:<full commit id>`, [Operations › Deployment](../operations.md#deployment)), and
Caddy, which serves https and forwards every request to the app. Two scripts in
[`deploy/hetzner/`](../../deploy/hetzner/) do the work on the server:

| Script                                                    | What it does                                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`setup.sh`](../../deploy/hetzner/setup.sh)               | Takes a fresh Ubuntu 24.04 server to a running app: updates, a deploy user, SSH hardening, Docker, the compose project, the registry login, the start |
| [`update.sh`](../../deploy/hetzner/update.sh)             | Deploys one image tag, waits until the app is healthy, and goes back to the previous tag when it is not                                               |
| [`app.env.example`](../../deploy/hetzner/app.env.example) | The app's settings to fill in                                                                                                                         |

Sections 1 to 4 happen in the Hetzner console and in DNS; section 5 runs the script.

To do the same with Terraform and Ansible instead of the console and `ssh`, see
[Automating the Hetzner server](automating-hetzner.md).

## 1. Account and SSH key

1. Sign up at hetzner.com and open the **Cloud Console**. A new account may be asked for an ID check or a prepayment;
   allow a day for it.
2. Create a **Project**, for example `surveyjs-studio`.
3. On your computer (Git Bash), make an SSH key:

   ```sh
   ssh-keygen -t ed25519 -C "surveyjs-studio-hetzner"
   cat ~/.ssh/id_ed25519.pub     # the public key, for Hetzner
   ```

4. In the project, **Security → SSH keys → Add SSH key**, and paste the public key.

## 2. Firewall

Create it before the server: **Firewalls → Create Firewall**, with these inbound rules:

| Protocol | Port | Source                                                  |
| -------- | ---- | ------------------------------------------------------- |
| TCP      | 22   | Your own address only (`x.x.x.x/32`)                    |
| TCP      | 80   | Any (Let's Encrypt and the redirect from http to https) |
| TCP      | 443  | Any                                                     |
| UDP      | 443  | Any (HTTP/3; optional)                                  |

Use Hetzner's firewall, not `ufw` on the server: Docker writes its own iptables rules for published ports and goes
around `ufw`.

## 3. The server

**Add Server**, with:

- **Location:** the one closest to the Azure region of the surveyjs.io stores (for West Europe, Falkenstein or
  Nuremberg; for East US, Ashburn). Every page makes several calls to the SQL database and the storage accounts, so
  the distance adds to each of them.
- **Image:** Ubuntu 24.04.
- **Type:** Shared vCPU, **x86** (Intel or AMD), 2 vCPU and 4 GB. Not Arm (CAX): CI runs on `ubuntu-latest`, so the
  image is built for amd64 only, and `setup.sh` stops on another architecture.
- **Networking:** public IPv4 and IPv6. Turn **off "auto delete"** for the IPv4 address: it then stays yours if the
  server is rebuilt, and the Azure firewall rules that list it keep working.
- **SSH key:** the one from section 1. **Firewall:** the one from section 2.
- **Backups:** optional. The server holds no data, only configuration; but backups and snapshots contain the settings
  file and the registry token, so treat them as secret.

## 4. DNS, the Azure firewall and the app's settings

- **DNS:** an **A record** for `studio.surveyjs.io` with the server's IPv4 address (and an AAAA record for IPv6, if
  you want it). With Cloudflare, keep it "DNS only". Caddy gets the https certificate once the record points to the
  server; `setup.sh` warns when it does not yet.
- **Azure:** the server's IPv4 address in the firewall rules of the SQL server and in the network rules of both
  storage accounts ([runbook, step 1](../operations.md#step-1-internal-use-on-production-data-read-only-first)).
- **The OIDC client** at `auth.surveyjs.io`, with the redirect URI `https://studio.surveyjs.io/api/v1/auth/callback`
  and `https://studio.surveyjs.io/` after sign-out.
- **A registry token:** a classic GitHub personal access token with only `read:packages` (and SSO authorised for
  `surveyjs`, if the organisation asks). It lets the server pull the private image.
- **The settings file:** copy [`app.env.example`](../../deploy/hetzner/app.env.example) **outside the repository**
  and fill every `<placeholder>` ([the mode 1.1 settings](../operations.md#mode-11-hosted-side-by-side-with-the-old-section)).
  Keep `TRUST_PROXY=172.30.0.0/24` (the Docker network Caddy's requests come from) and `READ_ONLY=true` for the first
  start. Compose reads this file and expands `$`: a value that contains `$` goes in **single quotes**
  ([Running the app › Changing settings](../running.md#changing-settings)).

## 5. Run `setup.sh`

Copy the scripts and the filled settings file to the server, then run the script as root. `<tag>` is the full
40-character id of a `master` commit whose CI passed (`git rev-parse origin/master`; the `publish` job's summary prints
it too):

```sh
scp -r deploy/hetzner root@<server-ip>:/root/hetzner
scp <path>/app.env root@<server-ip>:/root/app.env
ssh root@<server-ip>
cd /root/hetzner
./setup.sh --tag <tag> --env-file /root/app.env --ghcr-user <github-user>   # asks for the registry token
rm /root/app.env
```

It prints each step. At the end the app runs, healthy, and the script shows the `starting` log line: check that it
says `"readOnly":true`, `"storageProvider":"azure-legacy"` and the right `publicBaseUrl`. **Root sign-in is now off**:
from here on, `ssh deploy@<server-ip>` and `sudo`.

| Option                 | Default                            | Meaning                                                                        |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| `--tag`                | (required on the first run)        | The image tag                                                                  |
| `--env-file`           | (required on the first run)        | The settings; installed as `/etc/surveyjs-studio/app.env`, readable by root    |
| `--domain`             | `studio.surveyjs.io`               | Must match `PUBLIC_BASE_URL`                                                   |
| `--image`              | `ghcr.io/surveyjs/surveyjs-studio` | The image without its tag                                                      |
| `--ghcr-user`          | none                               | Sign in to ghcr.io; the token from `GHCR_TOKEN`, `GHCR_TOKEN_FILE` or a prompt |
| `--readyz-allow "IPS"` | none                               | A monitor's addresses that may call `/readyz` through Caddy                    |
| `--restrict-to "IPS"`  | none                               | Serve only these addresses; others get `403` (rollout step 1, if wanted)       |
| `--deploy-user`        | `deploy`                           | The everyday user; `--no-deploy-user` skips it                                 |
| `--no-ssh-hardening`   |                                    | Keep password and root sign-in over SSH                                        |

**Running it again** is safe, also on a server set up by hand before: each step checks what is there. It rewrites
`compose.yaml`, the `Caddyfile` and `.env` in `/opt/surveyjs-studio`, keeps `/etc/surveyjs-studio/app.env` unless
`--env-file` is given, and keeps the running tag unless `--tag` is given. That is how to change the domain, the
`/readyz` addresses or the restriction: run it again with other options. A changed `Caddyfile` is applied by
restarting Caddy, so a new version of the script (such as the one that stopped compressing the survey documents) takes
effect when it is run again with the same options.

Then continue with [rollout step 1](../operations.md#step-1-internal-use-on-production-data-read-only-first) from its
item 4: the schema check, the checks after start-up, the read-only browse, `pnpm smoke:legacy` (from a checkout whose
address the Azure firewall allows) and the switch to read-write.

### What `setup.sh` does

1. Checks its input before it changes anything: root, x86, the settings file (the required variables, no
   placeholders left, `PUBLIC_BASE_URL` equal to `https://<domain>`, `TRUST_PROXY`, unquoted `$`).
2. Installs the system updates and turns on automatic security updates.
3. Creates the `deploy` user with root's SSH keys and `sudo` without a password (it has no password to type).
4. Turns off password and root sign-in over SSH, but only when `deploy` has a key, so nobody is locked out.
5. Installs Docker from Docker's own package repository, with log rotation (the app logs every request, and Docker's
   default log driver never rotates).
6. Writes `/opt/surveyjs-studio/compose.yaml` (the app and Caddy on the `172.30.0.0/24` network; only Caddy publishes
   ports), the `Caddyfile` (https for the domain, compression except for the survey definition and theme, whose
   `ETag` it would rewrite, `/readyz` only for the monitor) and `.env` (`IMAGE` and `TAG`);
   installs `update.sh` as `/opt/surveyjs-studio/update.sh` and the command `surveyjs-studio-update`.
7. Signs in to ghcr.io, checks the DNS record, and starts the app with `update.sh <tag>`.

## 6. Update, roll back, status

The tag is the full commit id of a `master` commit whose CI passed: each push to `master` publishes
`ghcr.io/surveyjs/surveyjs-studio:<full commit id>`, and so does a manual run (Actions › CI › Run workflow). Sign in
with `ssh deploy@<server-ip>`, then:

```sh
sudo surveyjs-studio-update <tag>       # deploy a tag
sudo surveyjs-studio-update --status    # the running tag, the container's health and /readyz
```

`update.sh` pulls the image first (nothing changes when the pull fails), writes the tag into
`/opt/surveyjs-studio/.env`, re-creates the app and waits until it is healthy:

- **Healthy:** it checks `/readyz`, prints the `starting` log line, and removes old images, keeping the current and
  the previous tag's.
- **Not healthy** (the container stops, restarts, or takes longer than `HEALTH_TIMEOUT`, 150 s): it prints the app's
  last log lines, goes back to the previous tag and exits with `1`.
- **Healthy, but `/readyz` fails** (SQL or storage unreachable): it warns and keeps the new tag. The cause is outside
  the image, often the Azure firewall.

**Without the script**, the same with plain Docker, but with no health check, no automatic rollback and no clean-up of
old images:

```sh
cd /opt/surveyjs-studio
sudo docker pull ghcr.io/surveyjs/surveyjs-studio:<tag>
sudo sed -i 's/^TAG=.*/TAG=<tag>/' .env
sudo docker compose up -d --remove-orphans
sudo docker compose ps                  # wait for "healthy"
```

**Roll back** by deploying the earlier tag: the app has no database migrations, so an earlier image runs on the same
data, and the previous tag's image is still on the server.

**After a change to the settings** (`sudo nano /etc/surveyjs-studio/app.env`, for example `READ_ONLY=false`), apply
them with `sudo surveyjs-studio-update <the running tag>`: Compose re-creates the container with the new settings.
`docker restart` would keep the old ones ([Operations › Running the image](../operations.md#running-the-image)).

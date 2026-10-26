# Setting up a Hetzner server

How to get a server at Hetzner and prepare it to run My Surveys at `https://studio.surveyjs.io` in mode 1.1 (the
app on the surveyjs.io SQL database and Azure storage). The app's settings, the checks after start-up and the rollout
are in [Operations](../operations.md); this page covers the server around it.

The server runs two containers with Docker Compose: the app, from a ready image in the GitHub registry
(`ghcr.io/surveyjs/surveyjs-studio`), and Caddy, which serves https and forwards every request to the app.

CI publishes an image for each `master` commit that passes it, tagged with the full commit id
([Operations › Deployment](../operations.md#deployment)). **Not in the repository yet:** the `compose.yaml` and
`Caddyfile` below as files.

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
  image is built for amd64 only.
- **Networking:** public IPv4 and IPv6. Turn **off "auto delete"** for the IPv4 address: it then stays yours if the
  server is rebuilt, and the Azure firewall rules that list it keep working.
- **SSH key:** the one from section 1. **Firewall:** the one from section 2.
- **Backups:** optional. The server holds no data, only configuration; but backups and snapshots contain the settings
  file with its secrets, so treat them as secret.

## 4. First login and hardening

```sh
ssh root@<server-ip>
apt update && apt full-upgrade -y
adduser deploy                      # your everyday user
usermod -aG sudo deploy
rsync -a ~/.ssh /home/deploy/ && chown -R deploy:deploy /home/deploy/.ssh
```

Turn off password and root sign-in:

```sh
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh
```

**Before you close the root session**, check in a second terminal that `ssh deploy@<server-ip>` and `sudo -v` work.
Otherwise you can lock yourself out.

Automatic security updates (Ubuntu cloud images usually have them on already):

```sh
sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
```

## 5. Docker, with log rotation

```sh
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
sudo systemctl restart docker
```

The app writes a JSON line for every request, and Docker's default log driver never rotates: without these settings
the disk fills up.

Do not add `deploy` to the `docker` group: that group is as good as root. Run Docker with `sudo`.

## 6. DNS

Whoever runs the surveyjs.io DNS adds an **A record** (and an AAAA record for IPv6) for `studio.surveyjs.io`
with the server's address. Caddy gets the https certificate only after the record exists.

## 7. The deployment files

```text
/opt/surveyjs-studio/compose.yaml     # how the app and Caddy run
/opt/surveyjs-studio/Caddyfile        # https and forwarding
/etc/surveyjs-studio/app.env          # the settings and secrets: owned by root, chmod 600
```

### `compose.yaml`

```yaml
services:
  app:
    image: ghcr.io/surveyjs/surveyjs-studio:${TAG}
    env_file: /etc/surveyjs-studio/app.env
    restart: unless-stopped
    stop_grace_period: 60s # requests in flight may finish
    networks: [web]
  caddy:
    image: caddy:2.10.2 # an exact version, as the repository pins everything
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data # the certificates
      - caddy_config:/config
    networks: [web]
networks:
  web:
    ipam:
      config: [{ subnet: 172.30.0.0/24 }] # fixed, so TRUST_PROXY is known
volumes:
  caddy_data:
  caddy_config:
```

The app's port is not published: only Caddy reaches it, inside the `web` network.

### `Caddyfile`

```text
studio.surveyjs.io {
	encode zstd gzip
	@readyz_blocked {
		path /readyz
		not remote_ip 203.0.113.10
	}
	respond @readyz_blocked 404
	reverse_proxy app:3000
}
```

- Replace `203.0.113.10` with your monitor's address: `/readyz` reaches the stores, so only the monitor may call it.
- Caddy gets and renews the Let's Encrypt certificate itself, sets `X-Forwarded-For`, and passes the app's security
  headers through unchanged.
- It has no body size limit by default, so the app's 30 MB limit applies.

### `app.env`

The [mode 1.1 settings](../operations.md#mode-11-hosted-side-by-side-with-the-old-section), with:

- `TRUST_PROXY=172.30.0.0/24`: the `web` network, where Caddy's requests come from;
- `READ_ONLY=true` for the first runs (rollout step 1).

Compose reads this file and expands `$`: a value that contains `$` goes in **single quotes**
([Running the app › Changing settings](../running.md#changing-settings)).

```sh
sudo install -d -m 700 /etc/surveyjs-studio
sudo nano /etc/surveyjs-studio/app.env
sudo chmod 600 /etc/surveyjs-studio/app.env
```

## 8. Deploy, update and roll back

Sign in to the registry once, with a classic GitHub personal access token that has only `read:packages`. Docker keeps
it in `/root/.docker/config.json`.

```sh
sudo docker login ghcr.io -u <github-user>
```

Start the app. `TAG` is the full 40-character id of a `master` commit whose CI passed (`git rev-parse <commit>`; the
`publish` job's summary prints it too):

```sh
cd /opt/surveyjs-studio
sudo TAG=<commit-sha> docker compose pull
sudo TAG=<commit-sha> docker compose up -d
sudo docker compose logs app | head            # the "starting" line: readOnly, storageProvider, publicBaseUrl
curl -sI https://studio.surveyjs.io/ | grep -i content-security-policy
```

- **Update:** the same two commands with the new `TAG`.
- **Roll back:** the same two commands with the previous `TAG`. The app has no database migrations, so an earlier
  image runs on the same data.
- **After a change to `app.env`:** run `up -d` again. Compose re-creates the container; `docker restart` would keep
  the old settings ([Operations › Running the image](../operations.md#running-the-image)).

Then continue with [rollout step 1](../operations.md#step-1-internal-use-on-production-data-read-only-first) from its
item 4: the schema check, the checks after start-up, the read-only browse, `pnpm smoke:legacy` and the switch to
read-write.

# Automating the Hetzner server

How to create the Hetzner server with **Terraform** and set it up and update it with **Ansible**, instead of the console
clicks and the hand-run commands of [Setting up a Hetzner server](hetzner-server-setup.md). Both tools only drive what
that page describes: Terraform makes the Hetzner resources (sections 1 to 3 there), and Ansible copies the settings and
runs [`setup.sh`](../../deploy/hetzner/setup.sh) and [`update.sh`](../../deploy/hetzner/update.sh) (sections 5 and 6).

| Part                                                          | Tool                    | Why this tool                                                                         |
| ------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| The server, its firewall, the kept IPv4 address, the SSH key  | Terraform               | Describes the Hetzner side as code: rebuildable, reviewable, and the IP never changes |
| The app's settings and the registry token, running `setup.sh` | Ansible, with its vault | Brings secrets from an encrypted file at run time; `setup.sh` is safe to run again    |
| Deploying a tag                                               | Ansible (`update.yml`)  | One command from your computer, with the result printed                               |
| DNS, the Azure firewall rules, the OIDC client                | By hand                 | Owned by other teams; each is done once, when the IP address is new                   |

**Secrets stay out of Terraform.** Terraform could also hand the settings to the server through cloud-init
(`user_data`), but any process on the server can read `user_data` from Hetzner's metadata service, and Terraform keeps
it in its state file. So Terraform holds nothing secret (its own API token comes from the environment), and the app's
settings travel only through Ansible, from a vault file encrypted on your computer.

The file contents below are complete. A good place for them is `deploy/terraform/` and `deploy/ansible/` in this
repository, **without** the state, the `terraform.tfvars` and the vault file (see
[What goes into git](#what-goes-into-git)).

## 1. The workstation

Ansible does not run on Windows itself, so on Windows use **WSL** (Ubuntu) for both tools. On macOS or Linux use the
same commands natively (Homebrew on macOS: `brew install terraform ansible`).

1. **WSL** (PowerShell as administrator, once; restart when asked):

   ```powershell
   wsl --install -d Ubuntu-24.04
   ```

2. **A checkout inside WSL.** Clone the repository into the WSL home, not under `/mnt/c`: Ansible ignores an
   `ansible.cfg` in a world-writable folder, and every folder under `/mnt/c` looks world-writable to it.

   ```sh
   cd ~ && git clone https://github.com/surveyjs/surveyjs-studio.git && cd surveyjs-studio
   ```

3. **Your SSH key in WSL** (the key Hetzner knows, from the Windows side):

   ```sh
   mkdir -p ~/.ssh && cp /mnt/c/Users/<you>/.ssh/id_ed25519* ~/.ssh/ && chmod 600 ~/.ssh/id_ed25519
   ```

4. **Terraform** from HashiCorp's package repository:

   ```sh
   sudo apt update && sudo apt install -y gnupg software-properties-common jq
   wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
     | sudo tee /etc/apt/sources.list.d/hashicorp.list
   sudo apt update && sudo apt install -y terraform
   terraform version          # 1.5 or later is needed for the import blocks below
   ```

5. **Ansible** with pipx (the way Ansible's own documentation recommends):

   ```sh
   sudo apt install -y pipx && pipx ensurepath
   exec bash                  # picks up the new PATH
   pipx install --include-deps ansible
   ansible --version
   ```

## 2. Terraform: the Hetzner resources

### The API token

In the Hetzner Cloud Console, open the project, then **Security → API tokens → Generate API token**, with **Read &
Write**. Terraform reads it from the environment, so it is never in a file of the repository:

```sh
read -r -s -p "Hetzner API token: " HCLOUD_TOKEN && export HCLOUD_TOKEN && echo
```

(`read -s` keeps it out of the shell history. It is gone when the terminal closes; run the line again next time.)

### The files (`deploy/terraform/`)

**`versions.tf`**: the Terraform and provider versions.

```hcl
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.70"
    }
  }
}

# The token comes from the HCLOUD_TOKEN environment variable.
provider "hcloud" {}
```

**`variables.tf`**: what differs between setups.

```hcl
variable "location" {
  description = "Hetzner location: fsn1 or nbg1 (Germany), hel1 (Finland), ash (Virginia), hil (Oregon). Pick the one closest to the Azure region of the stores."
  type        = string
}

variable "server_type" {
  description = "A shared x86 type with 2 vCPU and 4 GB. Not Arm (cax...): the image is amd64 only. Check which types the location offers in the console's Add Server page."
  type        = string
  default     = "cx23"
}

variable "admin_ips" {
  description = "Addresses (CIDR) that may connect over SSH, e.g. [\"203.0.113.7/32\"]."
  type        = list(string)
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}
```

**`main.tf`**: the SSH key, the firewall, the kept IPv4 address and the server.

```hcl
resource "hcloud_ssh_key" "admin" {
  name       = "surveyjs-studio-admin"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "hcloud_firewall" "studio" {
  name = "surveyjs-studio"

  rule {
    description = "SSH from the admins"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.admin_ips
  }
  rule {
    description = "http: Let's Encrypt and the redirect to https"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
  rule {
    description = "https"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
  rule {
    description = "HTTP/3"
    direction   = "in"
    protocol    = "udp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
  rule {
    description = "ping"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
}

# A Primary IP of its own, so the address survives a rebuilt or replaced server: the Azure firewall rules and the DNS
# record name it.
resource "hcloud_primary_ip" "ipv4" {
  name              = "surveyjs-studio-ipv4"
  type              = "ipv4"
  location          = var.location
  auto_delete       = false
  delete_protection = true
}

resource "hcloud_server" "studio" {
  name               = "surveyjs-studio"
  image              = "ubuntu-24.04"
  server_type        = var.server_type
  location           = var.location
  ssh_keys           = [hcloud_ssh_key.admin.id]
  firewall_ids       = [hcloud_firewall.studio.id]
  delete_protection  = true
  rebuild_protection = true

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.ipv4.id
    ipv6_enabled = true
  }

  lifecycle {
    # These only matter when the server is created; a change must not replace a running server.
    ignore_changes = [ssh_keys, image, user_data]
  }
}

output "ipv4" {
  value = hcloud_primary_ip.ipv4.ip_address
}

output "ipv6" {
  value = hcloud_server.studio.ipv6_address
}
```

**`terraform.tfvars`**: your values (not committed).

```hcl
location  = "fsn1"
admin_ips = ["203.0.113.7/32"]
```

What the protections do: `delete_protection` and `rebuild_protection` make Hetzner refuse to delete or rebuild the
server and the IP address, also through Terraform. To replace the server on purpose, set them to `false`, `apply`,
replace, and set them back.

### A new server

```sh
cd deploy/terraform
terraform init             # downloads the provider; writes .terraform.lock.hcl (commit that file)
terraform plan             # shows what it will create: 4 resources
terraform apply            # type "yes"
terraform output ipv4      # the server's address
```

### The server you already made in the console

Terraform can take over existing resources instead of creating new ones. Find their ids through the API:

```sh
for kind in servers primary_ips firewalls ssh_keys; do
  echo "$kind:"; curl -s -H "Authorization: Bearer $HCLOUD_TOKEN" "https://api.hetzner.cloud/v1/$kind" \
    | jq -r ".${kind}[] | \"  \(.id)  \(.name)\""
done
```

Put the ids into **`import.tf`** next to the other files:

```hcl
import {
  to = hcloud_server.studio
  id = "<server id>"
}
import {
  to = hcloud_primary_ip.ipv4
  id = "<primary ip id>"
}
import {
  to = hcloud_firewall.studio
  id = "<firewall id>"
}
import {
  to = hcloud_ssh_key.admin
  id = "<ssh key id>"
}
```

Set `location` in `terraform.tfvars` to the server's location (the API lists it under `location.name` of the server),
then:

```sh
terraform init
terraform plan
```

Read the plan before you apply it. It must say **`will be imported`** for the four resources, and it may update some
of them **in place** (`~`): the names, the firewall rules, the protections. It **must not** say
`must be replaced` or `destroy` for the server or the IP address. If it does, change `main.tf` to match what exists
(for example `name` or `server_type`) and plan again. Then `terraform apply`, and delete `import.tf`.

### Day to day

- `terraform plan` shows the difference between the files and Hetzner, for example after a change in the console.
- Changing `admin_ips` (a new office address) is an `apply` that updates the firewall only.
- `terraform apply -replace=hcloud_server.studio` builds a fresh server with the **same** IP address (after turning
  the protections off); then run the Ansible setup again (section 3). DNS and the Azure rules stay as they are.

The **state** (`terraform.tfstate`) is Terraform's record of what it made. It holds no secret here, but losing it
means importing everything again: keep it backed up, or keep it in a remote backend (for example an S3-compatible
bucket in Hetzner Object Storage) once more than one person runs Terraform.

## 3. Ansible: the settings, the setup and the updates

### The secrets

The vault file holds the app's settings and the registry token. Keep it **outside the repository**, for example in
`~/.surveyjs-studio/`. `ansible-vault` encrypts it with a password you choose; keep that password in your password
manager.

```sh
mkdir -p -m 700 ~/.surveyjs-studio
EDITOR=nano ansible-vault create ~/.surveyjs-studio/secrets.yml
```

It opens an empty file. Write:

```yaml
# The app's settings: deploy/hetzner/app.env.example, filled. The text is copied as it is, so a value with $ keeps
# its single quotes: KEY='a$b'.
app_env: |
  PUBLIC_BASE_URL=https://studio.surveyjs.io
  SESSION_SECRET=<at least 32 random characters>
  APP_EDITION=hosted
  STORAGE_PROVIDER=azure-legacy
  LEGACY_SQL_CONNECTION_STRING=<the site database>
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING=<the surveys storage account>
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING=<the results storage account>
  OIDC_ISSUER_URL=https://auth.surveyjs.io
  OIDC_CLIENT_ID=<the client id>
  OIDC_CLIENT_SECRET=<the client secret>
  ACCOUNT_NOTICES=surveyjs-licenses
  SURVEYJS_LICENSE_KEY=<the SurveyJS licence key>
  TRUST_PROXY=172.30.0.0/24
  READ_ONLY=true

# A classic GitHub token with only read:packages.
ghcr_user: <github user>
ghcr_token: <ghp_...>
```

Save and close; the file on disk is now encrypted. Later: `ansible-vault edit ~/.surveyjs-studio/secrets.yml` (for
example to set `READ_ONLY=false`), and `ansible-vault view` to read it.

To avoid typing the vault password on each run, put it in a file only you can read, and pass
`--vault-password-file ~/.surveyjs-studio/vault-pass` instead of `--ask-vault-pass` below:

```sh
read -r -s -p "Vault password: " p && printf '%s' "$p" > ~/.surveyjs-studio/vault-pass && chmod 600 ~/.surveyjs-studio/vault-pass && unset p && echo
```

### The files (`deploy/ansible/`)

**`ansible.cfg`**:

```ini
[defaults]
inventory = inventory.yml
interpreter_python = auto_silent

[ssh_connection]
pipelining = True
```

**`inventory.yml`**: the server, and the options of `setup.sh`.

```yaml
studio:
  hosts:
    studio.surveyjs.io:
      ansible_host: 203.0.113.10 # the ipv4 output of Terraform
  vars:
    ansible_user: deploy # after the first setup root cannot sign in
    domain: studio.surveyjs.io
    readyz_allow: "" # a monitor's addresses, space separated
    restrict_to: "" # only these addresses may use the app (rollout step 1), or empty
```

**`setup.yml`**: copies the scripts and the settings and runs `setup.sh`. Safe to run again: it is also how a
changed setting or option reaches the server.

```yaml
- name: Set up the SurveyJS Studio server
  hosts: studio
  become: true
  vars:
    scripts_dir: /root/surveyjs-studio-scripts
  tasks:
    - name: Require the image tag
      ansible.builtin.assert:
        that: tag is defined and tag is match('^[0-9a-f]{40}$')
        fail_msg: "Pass the full commit id of a master commit whose CI passed: -e tag=<id>"

    - name: Folders
      ansible.builtin.file:
        path: "{{ item }}"
        state: directory
        owner: root
        group: root
        mode: "0700"
      loop: ["{{ scripts_dir }}", /etc/surveyjs-studio]

    - name: The scripts
      ansible.builtin.copy:
        src: "{{ playbook_dir }}/../hetzner/{{ item }}"
        dest: "{{ scripts_dir }}/{{ item }}"
        mode: "0755"
      loop: [setup.sh, update.sh]

    - name: The app's settings
      ansible.builtin.copy:
        content: "{{ app_env }}"
        dest: /etc/surveyjs-studio/app.env
        owner: root
        group: root
        mode: "0600"
      no_log: true

    - name: The registry token, for the script only
      ansible.builtin.copy:
        content: "{{ ghcr_token }}"
        dest: "{{ scripts_dir }}/ghcr-token"
        mode: "0600"
      no_log: true

    # One task, so the token file is removed even though setup.sh turns off root sign-in on the way.
    - name: Run setup.sh
      ansible.builtin.shell: |
        set -u
        GHCR_TOKEN_FILE={{ scripts_dir }}/ghcr-token {{ scripts_dir }}/setup.sh \
          --tag {{ tag | quote }} --domain {{ domain | quote }} --ghcr-user {{ ghcr_user | quote }} \
          {{ ('--readyz-allow ' ~ (readyz_allow | quote)) if readyz_allow else '' }} \
          {{ ('--restrict-to ' ~ (restrict_to | quote)) if restrict_to else '' }}
        status=$?
        rm -f {{ scripts_dir }}/ghcr-token
        exit $status
      args:
        executable: /bin/bash
      register: setup
      changed_when: true

    - name: What setup.sh printed
      ansible.builtin.debug:
        var: setup.stdout_lines
```

**`update.yml`**: deploys one tag with `update.sh`, which rolls back by itself when the new tag is not healthy.

```yaml
- name: Deploy a SurveyJS Studio image tag
  hosts: studio
  become: true
  tasks:
    - name: Require the image tag
      ansible.builtin.assert:
        that: tag is defined and tag is match('^[0-9a-f]{40}$')
        fail_msg: "Pass the full commit id: -e tag=<id>"

    - name: Run update.sh
      ansible.builtin.command:
        argv: [/usr/local/bin/surveyjs-studio-update, "{{ tag }}"]
      register: update
      changed_when: true

    - name: What update.sh printed
      ansible.builtin.debug:
        var: update.stdout_lines
```

When `update.sh` fails (exit `1`, after it has gone back to the previous tag), Ansible stops and shows its output.

### The first run

1. **Trust the server's host key** once (`ssh` asks; answer `yes`, then leave):

   ```sh
   ssh root@<ipv4>    # or deploy@<ipv4> for the server set up by hand
   ```

2. **Check the connection** (from `deploy/ansible/`). A fresh server has only `root`:

   ```sh
   cd deploy/ansible
   ansible studio -m ping -e ansible_user=root
   ```

3. **Run the setup** with the tag to start:

   ```sh
   ansible-playbook setup.yml --ask-vault-pass \
     -e @$HOME/.surveyjs-studio/secrets.yml \
     -e tag=$(git rev-parse origin/master) \
     -e ansible_user=root
   ```

   On the server set up by hand, leave out `-e ansible_user=root` (it signs in as `deploy`) and add
   `--ask-become-pass` this one time: that `deploy` user still needs its password for `sudo`, until `setup.sh` gives
   it key-only `sudo`.

The output ends with what `setup.sh` printed, including the `starting` line. From now on every run signs in as
`deploy`.

### Day to day

| Task                                          | Command (from `deploy/ansible/`)                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy a tag                                  | `ansible-playbook update.yml -e tag=<full commit id>`                                                                                                    |
| Roll back                                     | The same with the earlier tag                                                                                                                            |
| Status                                        | `ansible studio -b -a "surveyjs-studio-update --status"`                                                                                                 |
| Change a setting (`READ_ONLY=false`)          | `ansible-vault edit ~/.surveyjs-studio/secrets.yml`, then the setup command above without `ansible_user=root`, with `-e tag=` set to the **running** tag |
| Change `readyz_allow` or `restrict_to`        | Edit `inventory.yml`, then the same setup command                                                                                                        |
| A rebuilt server (`terraform apply -replace`) | The first run again                                                                                                                                      |

The running tag is in the status output, or on the server in `/opt/surveyjs-studio/.env`.

## 4. From nothing to a running app

1. Terraform: `terraform apply`, note `terraform output ipv4`.
2. By hand, once per address: the DNS A record for `studio.surveyjs.io`; the address in the Azure SQL firewall and in
   both storage accounts' network rules; the OIDC client at `auth.surveyjs.io`
   ([Setting up a Hetzner server › 4](hetzner-server-setup.md#4-dns-the-azure-firewall-and-the-apps-settings)).
3. The address into `inventory.yml`; the vault file with the settings.
4. Ansible: the first run (section 3).
5. The checks of [rollout step 1](../operations.md#step-1-internal-use-on-production-data-read-only-first) from its
   item 4.

## What goes into git

| File                                           | Commit?     | Why                                                       |
| ---------------------------------------------- | ----------- | --------------------------------------------------------- |
| `*.tf`, `.terraform.lock.hcl`                  | Yes         | The description of the server; the lock pins the provider |
| `terraform.tfvars`                             | No          | Your addresses                                            |
| `terraform.tfstate*`, `.terraform/`            | No          | Terraform's record, local to whoever runs it; back it up  |
| `import.tf`                                    | No          | Used once, then deleted                                   |
| `ansible.cfg`, `setup.yml`, `update.yml`       | Yes         | The steps                                                 |
| `inventory.yml`                                | Your choice | The server's address is public anyway (DNS)               |
| `~/.surveyjs-studio/secrets.yml`, `vault-pass` | Never       | Outside the repository: the secrets and their password    |

Even encrypted, the vault file does not belong in a repository that will be open-sourced: anyone who later learns the
vault password could read every old version of it.

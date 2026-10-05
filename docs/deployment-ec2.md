# Deploying WayFlow on AWS EC2 (wayflow.vimunk.tech)

Production runbook. WayFlow runs on **one EC2 instance** in `ap-southeast-1` (Singapore), served at **https://wayflow.vimunk.tech**.

- Everything runs inside the VM: Postgres, Valkey, RustFS (photo storage), planner, API, web and the nginx gateway. No S3, no RDS, no load balancer.
- HTTPS is terminated by **nginx + certbot on the host**.
- **The VM holds no hand-made config except `.env`.** Compose settings (`docker-compose.prod.yml`), the host nginx site (`infra/nginx/wayflow-host.conf`) and the deploy script (`infra/deploy.sh`) all live in the repo. Deploys, manual or from CD, hard-reset tracked files to the repo, so never edit them on the server; change the repo instead.
- Repo files used in production:

| File | Role |
| --- | --- |
| `docker-compose.yml` + `docker-compose.prod.yml` | Stack and production overrides (loopback gateway, no DB/cache/storage ports, `NODE_ENV=production`, secure cookies, 2 proxy hops) |
| `infra/nginx/wayflow-host.conf` | Host nginx: HTTP to HTTPS redirect, TLS, SSE, 6 MB uploads |
| `infra/deploy.sh` | Fetch, reset, rebuild, wait for `/api/v1/ready` |
| `.github/workflows/deploy.yml` | CD: runs `deploy.sh` over SSH |
| `.env` (server only, gitignored) | Secrets and public origin |
| `data/source/*.csv` (server only, gitignored) | Competition data |

- For the short overview and the later managed-AWS path see [deployment.md](deployment.md).

## 0. Architecture

```
Browser
  │  DNS: wayflow.vimunk.tech → Elastic IP
  ▼
Security group  (inbound 80, 443 from anywhere; 22 from your IP only)
  ▼
EC2 (Ubuntu 24.04)
  ├─ host nginx :80/:443  ← certbot (Let's Encrypt), TLS ends here
  │     │ proxy_pass http://127.0.0.1:8080
  │     ▼
  └─ Docker Compose network (docker-compose.prod.yml, nothing else published)
        gateway (nginx :8080, loopback only)
          ├─ /api/*  → api :3000 ──┬─ planner :8000  (internal)
          │                        ├─ postgres :5432
          │                        ├─ valkey :6379
          │                        └─ rustfs :9000   (photos)
          └─ /       → web :8080
```

Only ports 80 and 443 are reachable from the internet. The gateway is bound to `127.0.0.1:8080`; Postgres, Valkey, RustFS and the planner are reachable only on the Docker network (CLAUDE.md: the planner stays internal).

## 1. Prerequisites

- AWS account with an IAM admin user (not root) and MFA enabled. Use the console in `ap-southeast-1` (top-right region selector) for every step below.
- Control of DNS for `vimunk.tech` (registrar or Route 53).
- Read access to the repository for the VM (a read-only deploy key or personal access token), and admin access to the GitHub repo to add Actions secrets (section 13.1).
- The competition CSVs on your laptop (`data/source/`). They are gitignored and must never be committed or published (T&C).
- A terminal with `ssh`, `scp`/`rsync`.
- Optional: AWS CLI v2 configured (`aws configure`, region `ap-southeast-1`) if you prefer the CLI snippets.

## 2. Instance sizing

Limits come from `docker-compose.yml`: `api` 768 MB, `planner` 1 GB. Postgres, Valkey, RustFS, two nginx containers, the OS and host nginx need roughly another 1 to 1.5 GB.

| Resource | Minimum | Recommended | Why |
| --- | --- | --- | --- |
| Instance type | **t4g.medium** (Graviton2, 2 vCPU, 4 GB) | t4g.large (2 vCPU, 8 GB) | 4 GB runs the stack with ~1 GB headroom. t4g.small (2 GB) is **not supported**: planner solve or image build gets OOM-killed. |
| Swap | 2 GB swap file | 2 GB | Absorbs build spikes (pnpm install, Python wheels such as OR-Tools). |
| Disk | **30 GB gp3** | 40 GB gp3 | Images and build cache 6 to 8 GB, Postgres, RustFS photos, CSVs, logs, snapshots working space. |
| Network | Public IPv4 (Elastic IP) | same | Stable address for DNS. |
| OS | Ubuntu Server 24.04 LTS (**arm64**) | same | Graviton is ARM64; pick the Arm AMI. |

Notes:

- **Architecture check done:** every image in `docker-compose.yml` (postgres 18, valkey 9, nginx-unprivileged, rustfs, rustfs/rc, node 24-alpine, python 3.12-slim) publishes `linux/arm64`, the planner lockfile includes OR-Tools `aarch64` wheels, and no Dockerfile pins a platform. Build on the instance (not on an x86 laptop) so images match the CPU, and do not copy x86 images to it. Re-check after bumping an image tag.
- t4g is burstable (like t3). Default "unlimited" credits mode avoids CPU throttling during planner solves; for a short event the extra cost is small. If you switch to "standard", watch the `CPUCreditBalance` metric.
- Building images on the box is the peak memory moment. On a t4g.medium it works with the swap file. If you pull prebuilt images from GHCR instead, they must be built for `linux/arm64`; the runtime minimum is the same t4g.medium.
- Ballpark cost in Singapore (on-demand): t4g.medium about US$0.04/h (~US$30/month, roughly 20% below t3.medium) plus ~US$2.5/month for 30 GB gp3. Public IPv4 addresses are billed (~US$3.6/month). Check the current price on the AWS pricing page.

## 3. Networking

The default VPC is fine for a single instance. Use a custom VPC only if the account has none (then create a VPC `10.0.0.0/16`, one public subnet, an internet gateway, and a route `0.0.0.0/0 → igw`).

### 3.1 Check the default VPC

Console: VPC → Your VPCs → the VPC marked "Default". Confirm it has an internet gateway attached and the main route table has `0.0.0.0/0 → igw-…`. Note a subnet in `ap-southeast-1a` that has **Auto-assign public IPv4** enabled.

### 3.2 Security group

Console: EC2 → Security Groups → Create security group.

- Name: `wayflow-web`, description: `WayFlow web and SSH`, VPC: default.
- Inbound rules:

| Type | Protocol | Port | Source | Purpose |
| --- | --- | --- | --- | --- |
| HTTP | TCP | 80 | `0.0.0.0/0` and `::/0` | Redirect to HTTPS and Let's Encrypt HTTP-01 challenge |
| HTTPS | TCP | 443 | `0.0.0.0/0` and `::/0` | The app |
| SSH | TCP | 22 | **My IP** (`x.x.x.x/32`) | Admin access |

- Outbound: leave the default (all). The box needs outbound HTTPS for apt, Docker Hub, git and Let's Encrypt.
- Never open 3000, 5432, 6379, 8000, 8080, 9000 or 9001. They are not published to the host (or only on loopback) and the group must not expose them either.

Port 80 **must** stay open permanently: certbot renews certificates over HTTP-01.

If your home IP changes, update the SSH rule, or avoid SSH entirely with Session Manager (section 5.3).

CLI equivalent:

```sh
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 create-security-group --group-name wayflow-web --description "WayFlow web and SSH" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions \
  'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
  'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
  "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$(curl -s https://checkip.amazonaws.com)/32}]"
```

### 3.3 Elastic IP

An Elastic IP keeps the address across stop/start, so DNS stays valid.

Console: EC2 → Elastic IPs → Allocate Elastic IP address → Allocate. Associate it after the instance exists (section 5.2). Write the address down; it is `<EIP>` below.

### 3.4 Optional network extras

- **IPv6**: skip unless you want it. If you add an `AAAA` record, the security group rules above already allow `::/0`, and host nginx must `listen [::]:443`.
- **VPC Flow Logs**: useful for audit, not needed for the demo.
- **NACLs**: leave the default allow-all. The security group is the control.

## 4. DNS

Create an `A` record **before** requesting the certificate. Let's Encrypt validates through DNS and fails (and rate-limits repeated failures) if the name does not resolve to this server.

| Name | Type | Value | TTL |
| --- | --- | --- | --- |
| `wayflow.vimunk.tech` | A | `<EIP>` | 300 |

- **Registrar / other DNS host**: add the record in its DNS panel for `vimunk.tech` with host `wayflow`.
- **Route 53**: Hosted zones → `vimunk.tech` → Create record → name `wayflow`, type A, value `<EIP>`, TTL 300.
- If the zone is on Cloudflare, set the record to **DNS only** (grey cloud). Proxying would buffer server-sent events and complicate certificate issuance.
- If a CAA record exists on `vimunk.tech`, it must allow `letsencrypt.org`.

Verify from your laptop (wait for the TTL):

```sh
dig +short wayflow.vimunk.tech      # must print <EIP>
```

## 5. Launch the instance

### 5.1 Create the instance

Console: EC2 → Launch instance.

- **Name**: `wayflow`.
- **AMI**: Ubuntu Server 24.04 LTS, **64-bit (Arm)**. The architecture selector must read `arm64`, otherwise t4g types are not offered.
- **Instance type**: `t4g.medium` (section 2).
- **Key pair**: create a new one (`wayflow-key`, RSA or ED25519, `.pem`). Store it safely; `chmod 400 wayflow-key.pem`.
- **Network settings**: default VPC, a subnet with auto-assign public IP, **select existing security group** `wayflow-web`.
- **Storage**: 30 GiB `gp3`, **Encrypted** (default KMS key is fine). Leave "Delete on termination" on unless you want the disk to outlive the instance.
- **Advanced details**:
  - Metadata version: **V2 only** (IMDSv2 required).
  - Termination protection: **Enable**.
  - Credit specification: Unlimited (optional, see section 2).
- Launch.

### 5.2 Attach the Elastic IP

EC2 → Elastic IPs → select the address → Actions → Associate Elastic IP address → pick the `wayflow` instance → Associate.

### 5.3 Connect

```sh
ssh -i wayflow-key.pem ubuntu@wayflow.vimunk.tech
```

(Use `<EIP>` until DNS has propagated.) Optional SSM alternative: attach an IAM role with `AmazonSSMManagedInstanceCore`, then connect from the console (Connect → Session Manager) and close port 22 in the security group.

## 6. Host preparation

Run on the instance.

### 6.1 Updates, timezone, swap

```sh
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get -y install unattended-upgrades ufw curl git ca-certificates dnsutils
sudo dpkg-reconfigure -plow unattended-upgrades      # choose Yes
sudo timedatectl set-timezone Asia/Colombo           # the app runs on Asia/Colombo time

# 2 GB swap (needed for image builds on 4 GB RAM)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### 6.2 SSH and host firewall

Key-only SSH is the Ubuntu default; confirm:

```sh
sudo grep -Ei '^(PasswordAuthentication|PermitRootLogin)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf
# expect PasswordAuthentication no, PermitRootLogin no/prohibit-password
```

Host firewall as second layer behind the security group:

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Docker publishes ports by editing iptables directly and bypasses ufw. That is why `docker-compose.prod.yml` (section 9) binds the gateway to `127.0.0.1` and publishes nothing else. Do not rely on ufw to hide a published container port.

### 6.3 Install Docker Engine and Compose

Official Docker apt repository:

```sh
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
```

Log out and back in so the group applies, then check. The compose files use the `!override`/`!reset` YAML tags, which need Compose v2.24 or newer (the plugin from this repo is newer):

```sh
docker compose version
```

Cap container log size so logs cannot fill the disk:

```sh
sudo tee /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
sudo systemctl restart docker
sudo systemctl enable docker
```

### 6.4 Install nginx and certbot

```sh
sudo apt-get -y install nginx certbot
sudo systemctl enable --now nginx
sudo rm -f /etc/nginx/sites-enabled/default
```

## 7. Get the code and data

```sh
cd ~
git clone <repository-url> way-flow        # use a deploy key or PAT for a private repo
cd way-flow
git checkout main
```

Copy the competition CSVs from your **laptop** (run there, not on the server):

```sh
rsync -avz -e "ssh -i wayflow-key.pem" ./data/source/ ubuntu@wayflow.vimunk.tech:~/way-flow/data/source/
```

`infra/deploy.sh` must already be on `main` (merge the deployment files first). Back on the server confirm the files are present (compare with `data/README.md`) and that `git status` stays clean (the CSVs are gitignored):

```sh
ls -lh data/source
git status --short
```

## 8. Configure `.env`

```sh
cp .env.example .env
chmod 600 .env
```

`docker-compose.yml` hard-wires the internal hostnames (`postgres`, `valkey`, `rustfs`, `planner`) and builds `DATABASE_URL` itself, so the `localhost` URLs in `.env.example` are ignored in the container stack. What compose does read from `.env`:

```env
NODE_ENV=production
TZ=Asia/Colombo
LOG_LEVEL=info

# public origin: https, no trailing slash, no localhost
CORS_ORIGINS=https://wayflow.vimunk.tech
COOKIE_SECURE=true

# each value different: openssl rand -base64 48
JWT_SECRET=
REFRESH_TOKEN_PEPPER=
CSRF_SECRET=

# strong and unique
POSTGRES_PASSWORD=
APP_DB_PASSWORD=
RUSTFS_ADMIN_PASSWORD=
S3_SECRET_KEY=

# password of every seeded account, 12+ chars, not the example value
SEED_DEFAULT_PASSWORD=

# true only if judges may move the simulation clock and reset demo data
ENABLE_DEMO_TOOLS=true

# makes plain `docker compose ...` on the VM use the committed production file (section 9)
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

Generate and paste secrets quickly:

```sh
for k in JWT_SECRET REFRESH_TOKEN_PEPPER CSRF_SECRET POSTGRES_PASSWORD APP_DB_PASSWORD RUSTFS_ADMIN_PASSWORD S3_SECRET_KEY; do
  sed -i "s|^$k=.*|$k=$(openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-48)|" .env
done
```

(`tr` strips characters that are awkward inside URLs; the Postgres passwords end up in connection strings.) Then edit the remaining values with `nano .env`.

Notes:

- The API **refuses to start** if `NODE_ENV=production` with example secrets, `COOKIE_SECURE=false` or a localhost origin. That is intentional (SEC-58).
- Leave `S3_ENDPOINT` alone. Compose forces `http://rustfs:9000`. Photos live in the `rustfsdata` Docker volume on this VM.
- Back up `.env` somewhere private (password manager). Never commit it.

## 9. Production compose file

Nothing to create on the server. `docker-compose.prod.yml` is committed in the repo, so the VM never carries local edits and git and CD stay clean. It binds the gateway to `127.0.0.1:8080`, closes the Postgres, Valkey and RustFS host ports, and sets `NODE_ENV=production`, `COOKIE_SECURE=true` and `TRUST_PROXY_HOPS=2`.

Why `TRUST_PROXY_HOPS: '2'`: the gateway appends to `X-Forwarded-For`, and host nginx adds the real client IP before it. The API trusts exactly that many hops, so rate limiting and login throttling see the real client address and spoofed values are ignored.

All compose commands on the VM use both files. The `.env` above sets `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`, so plain `docker compose ...` on the VM uses both files (the commands below assume it). Without it, spell them out:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml <command>
```

## 10. Host nginx and TLS certificate

### 10.1 HTTP-only bootstrap block (for the challenge)

The committed config needs the certificate files, so nginx cannot load it yet. Use a temporary HTTP-only block first:

```sh
sudo mkdir -p /var/www/certbot
sudo tee /etc/nginx/sites-enabled/wayflow <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name wayflow.vimunk.tech;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
```

### 10.2 Request the certificate

DNS (section 4) and port 80 (section 3.2) must already work.

```sh
sudo certbot certonly --webroot -w /var/www/certbot -d wayflow.vimunk.tech \
  --email nadawa.kaushalya@gmail.com --agree-tos --no-eff-email
```

While testing, add `--staging` first to avoid rate limits, then rerun without it. Certificates land in `/etc/letsencrypt/live/wayflow.vimunk.tech/`.

### 10.3 Final HTTPS server block

The final config is committed as `infra/nginx/wayflow-host.conf` (HTTP redirect, TLS, SSE location, 6 MB body limit). Replace the bootstrap file with a symlink so git updates reach nginx without editing anything on the VM:

```sh
sudo ln -sf ~/way-flow/infra/nginx/wayflow-host.conf /etc/nginx/sites-enabled/wayflow
sudo nginx -t && sudo systemctl reload nginx
```

After a deploy that changes this file, reload nginx once (`sudo nginx -t && sudo systemctl reload nginx`); `deploy.sh` does not touch host nginx.

### 10.4 Auto-renewal

Ubuntu installs a `certbot.timer`. Add a hook so nginx reloads after each renewal, then test:

```sh
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

Until the stack is up, https returns `502 Bad Gateway`. That is expected.

## 11. First start

```sh
cd ~/way-flow
sh infra/deploy.sh
```

`infra/deploy.sh` fetches, hard-resets to `origin/main`, runs `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans`, prunes old images and waits up to 150 s for `http://127.0.0.1:8080/api/v1/ready`. It exits non-zero (and prints `docker compose ps`) if the API never becomes ready. CD runs the same script.

The first build takes several minutes. Startup order is: postgres, valkey, rustfs → `storage-init` (bucket and app key) and `migrate` (migrations, least-privilege DB role, CSV reference data, demo seed; exits) → planner, api → web, gateway. Watch it:

```sh
docker compose ps
docker compose logs -f migrate api
```

Healthy end state: `migrate` and `storage-init` show `Exited (0)`, everything else `Up`/`healthy`. If the API exits immediately, read its first log line; it names the offending setting (section 14).

Confirm nothing but loopback is published:

```sh
docker compose ps --format 'table {{.Name}}\t{{.Ports}}'
sudo ss -tlnp | grep -E ':(80|443|8080|3000|5432|6379|8000|9000)\b'
# expect 0.0.0.0:80, 0.0.0.0:443 (nginx) and 127.0.0.1:8080 only
```

## 12. Verify

From the server:

```sh
curl -fsS http://127.0.0.1:8080/api/v1/ready
```

From your laptop:

```sh
curl -I http://wayflow.vimunk.tech/         # 301 to https
curl -I https://wayflow.vimunk.tech/        # 200, strict-transport-security + content-security-policy
curl -fsS https://wayflow.vimunk.tech/api/v1/ready
curl -N https://wayflow.vimunk.tech/api/v1/notifications/stream    # needs auth; expect 401, not a hang or 502
```

Then in the browser and on a **phone over mobile data**:

1. Sign in as each of the four roles (dispatcher, loader, driver, store manager) with `SEED_DEFAULT_PASSWORD`. A redirect loop back to sign-in means a cookie or origin mismatch (section 14).
2. Run the [judge walkthrough](../README.md#3-judge-walkthrough).
3. Upload a proof-of-delivery photo as the driver and view it as the dispatcher (proves the RustFS path).
4. Open a live notification stream in two roles and confirm updates arrive without delay (proves SSE is not buffered).
5. Install the PWA, switch to airplane mode, and confirm the driver and loader screens still work (offline-first requirement).
6. Optional: run the integration suite from your laptop with `API_URL=https://wayflow.vimunk.tech/api/v1`.
7. TLS grade: https://www.ssllabs.com/ssltest/ (expect A or better).

Check resource headroom under load:

```sh
free -h
docker stats --no-stream
df -h /
```

## 13. Operations

### 13.1 Deploy an update and CD

Manual deploy, on the VM:

```sh
sh ~/way-flow/infra/deploy.sh              # origin/main
sh ~/way-flow/infra/deploy.sh v1.2.0       # a tag or commit
```

Rollback is the same command with the previous tag or commit. Database migrations are not reversed automatically.

**CD** is `.github/workflows/deploy.yml` (`workflow_dispatch` with an optional `ref`; add `push: branches: [main]` under `on:` to deploy every merge). It SSHes to the VM and runs `deploy.sh`. One-time setup:

1. On your laptop create a dedicated key: `ssh-keygen -t ed25519 -f wayflow-deploy -C github-cd -N ""`.
2. On the VM add the public key, restricted, to `~/.ssh/authorized_keys`:
   `no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-cd`
3. GitHub repo, Settings, Secrets and variables, Actions: add `EC2_HOST` (`wayflow.vimunk.tech`), `EC2_USER` (`ubuntu`) and `EC2_SSH_KEY` (contents of `wayflow-deploy`).
4. Reachability: GitHub-hosted runners have changing IPs, so port 22 limited to your IP blocks them. Choose one: open 22 to `0.0.0.0/0` (key-only auth, ufw and fail2ban recommended), or run a self-hosted runner on the VM, or switch the job to AWS SSM with GitHub OIDC.
5. Run the workflow once from the Actions tab and check it ends with `deployed <sha>`.

Rules that keep CD from breaking the server: never edit tracked files on the VM (they are reset on each run), keep `.env` and `data/` only on the VM, and keep the checkout at `~/way-flow` as a clone of the repo. A new secret or variable goes into the VM `.env`, then run the workflow again.

### 13.2 Day-to-day commands

```sh
docker compose ps
docker compose logs -f --tail=200 api
docker compose restart api
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log
```

Services use `restart: unless-stopped`, and Docker starts on boot, so the stack returns after a reboot. Test it once: `sudo reboot`, wait a minute, then re-run the checks in section 12.

### 13.3 Restore the demo state

Dispatcher sidebar → **Change** → *Reset demo data* (needs `ENABLE_DEMO_TOOLS=true`), or:

```sh
docker compose run --rm migrate node dist/seed/run.js --reset
```

### 13.4 Backups (all inside AWS EBS and the VM, no S3)

**EBS snapshots (recommended, whole disk).** Console: EC2 → Lifecycle Manager → Create lifecycle policy → EBS snapshot policy → target the volume (tag `Name=wayflow`) → daily, retain 7. A snapshot is crash-consistent; for a clean copy of the database also take a dump:

**Nightly Postgres dump and RustFS archive on the VM:**

```sh
mkdir -p ~/backups
cat > ~/backup.sh <<'EOF'
#!/bin/sh
set -e
cd ~/way-flow
STAMP=$(date +%F-%H%M)
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > ~/backups/pg-$STAMP.dump
docker run --rm -v way-flow_rustfsdata:/data:ro -v ~/backups:/backup alpine tar czf /backup/rustfs-$STAMP.tgz -C /data .
find ~/backups -type f -mtime +7 -delete
EOF
chmod +x ~/backup.sh
( crontab -l 2>/dev/null; echo '30 2 * * * ~/backup.sh' ) | crontab -
```

The volume name is `<project>_rustfsdata`; confirm with `docker volume ls` (the project name defaults to the directory name `way-flow`). Periodically copy `~/backups` to your laptop with `rsync -avz -e "ssh -i wayflow-key.pem" ubuntu@wayflow.vimunk.tech:backups/ ./wayflow-backups/`.

Restore database: `docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < ~/backups/pg-<stamp>.dump`. Drill this once before you need it.

### 13.5 Monitoring and cost

- External uptime check (UptimeRobot, Route 53 health check or similar) on `https://wayflow.vimunk.tech/api/v1/ready`.
- EC2 auto-recovery: select the instance → Actions → Monitor and troubleshoot → Manage CloudWatch alarms → add a `StatusCheckFailed_System` alarm with the *Recover* action.
- Billing alarm: Billing → Budgets → monthly cost budget with an email alert.
- Do not stop or terminate the instance until results are announced. Stop/start is safe because of the Elastic IP; an Elastic IP **not** attached to a running instance is billed.

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `certbot` fails with timeout or "unauthorized" | DNS not pointing at the EIP, port 80 closed in the security group or ufw, or the HTTP block not loaded | `dig +short wayflow.vimunk.tech`; check section 3.2 rule for 80; `sudo nginx -t`; retry with `--staging` |
| `too many failed authorizations` | Rate limit after repeated failures | Wait an hour or use `--staging` while fixing |
| Browser shows `502 Bad Gateway` | Stack not up or gateway not on `127.0.0.1:8080` | `docker compose ps`; `curl http://127.0.0.1:8080/api/v1/ready`; check `COMPOSE_FILE` in `.env` includes `docker-compose.prod.yml` (`docker compose config \| grep -A2 8080`) | grep -A2 8080`)\| grep -A2 8080`) |
| API container exits at startup | Example secrets, `COOKIE_SECURE=false`, or localhost in `CORS_ORIGINS` with `NODE_ENV=production` | Fix `.env`, then `docker compose up -d` |
| Sign-in succeeds then bounces back to login | `CORS_ORIGINS` not exactly `https://wayflow.vimunk.tech`, or `COOKIE_SECURE` not `true` | Fix `.env`, `docker compose up -d api` |
| Everyone shares one rate-limit bucket or logins are throttled together | `TRUST_PROXY_HOPS` is `1` instead of `2` | Use `docker-compose.prod.yml` (section 9), recreate `api` |
| Live notifications lag or reconnect | SSE location missing or a proxy in front buffering (Cloudflare orange cloud) | Use the SSE block in section 10.3; DNS-only record |
| Photo upload returns 413 | Body larger than 5 MB | Expected limit; host nginx and gateway allow 6 MB |
| Build killed (`exit 137`) | Out of memory | Confirm swap (`free -h`), stop other containers during the build, or use t4g.large |
| `no space left on device` | Images, build cache or logs | `df -h`; `docker system prune -af` (never `--volumes`); resize the EBS volume and `sudo growpart /dev/nvme0n1 1 && sudo resize2fs /dev/nvme0n1p1` |
| `docker compose` rejects `!override` | Compose older than v2.24 | Upgrade the `docker-compose-plugin` |
| Deploy workflow fails at SSH | Wrong secret, key not in `authorized_keys`, or port 22 blocked for GitHub IPs | Test `ssh -i wayflow-deploy ubuntu@wayflow.vimunk.tech` from a machine that can reach it; review section 13.1 step 4 |
| `deploy.sh` ends with "API not ready after deploy" | Bad `.env` value or failed migration | `docker compose logs --tail=100 api migrate`; fix `.env`, rerun the script |
| `git reset` or fetch fails in `deploy.sh` | Repo remote needs credentials, or `~/way-flow` is not a clone of the repo | Fix the deploy key or PAT; `git -C ~/way-flow remote -v` |
| Site works on Wi-Fi but not mobile data | IPv6-only resolver and no `AAAA`, or captive DNS | Check `dig AAAA`; normally IPv4 works, test another network |

## 15. Security checklist before sharing the URL

- [ ] `.env` is `chmod 600`, secrets are unique, none is an example value.
- [ ] `SEED_DEFAULT_PASSWORD` changed; `ENABLE_DEMO_TOOLS` is `true` only if judges need it.
- [ ] Security group exposes only 80 and 443 to the world; 22 is limited to your IP, or open key-only if CD uses SSH (section 13.1).
- [ ] CD key is a dedicated, restricted key; GitHub secrets set; one successful `Deploy` run.
- [ ] `git status --short` on the VM is clean (no hand edits).
- [ ] `ss -tlnp` shows nothing public except nginx 80/443.
- [ ] `curl -I https://wayflow.vimunk.tech/` shows HSTS and CSP.
- [ ] `certbot renew --dry-run` passes.
- [ ] `data/` never committed; CSVs only on the server's disk.
- [ ] Snapshot policy active and one restore tested.

## 16. Teardown

Terminate the instance (disable termination protection first), release the Elastic IP, delete the security group and key pair, delete leftover EBS snapshots, and remove the `A` record for `wayflow.vimunk.tech`.

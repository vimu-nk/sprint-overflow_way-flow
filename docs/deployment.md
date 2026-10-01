# Deployment

## Fast path: one host with Docker Compose (specs/15 §2)

1. **Host.** Ubuntu 24.04, 2 vCPU / 4 GB (e.g. EC2 t3.medium in `ap-south-1` or `ap-southeast-1`), Elastic IP. Security group: 80 and 443 open; SSH only from your IP (or SSM Session Manager). Enable IMDSv2 and EBS encryption.
2. **Software.** Docker Engine with the Compose plugin, git.
3. **DNS.** Point an `A` record (e.g. `wayflow.example.com`) at the Elastic IP.
4. **Code and data.** Clone the private repository, copy the competition CSVs to `data/source/` (they are not in git).
5. **Configuration.** `cp .env.example .env` and set at least:

   ```env
   NODE_ENV=production
   DOMAIN=wayflow.example.com
   CORS_ORIGINS=https://wayflow.example.com
   COOKIE_SECURE=true
   JWT_SECRET=<openssl rand -base64 48>
   REFRESH_TOKEN_PEPPER=<different openssl rand -base64 48>
   CSRF_SECRET=<different openssl rand -base64 48>
   SEED_DEFAULT_PASSWORD=<unique, 12+ characters>
   POSTGRES_PASSWORD=<strong>
   APP_DB_PASSWORD=<strong>
   RUSTFS_ADMIN_PASSWORD=<strong>
   S3_SECRET_KEY=<strong>
   ENABLE_DEMO_TOOLS=true      # only if judges should be able to move the clock and reset
   ```

   The API refuses to start with example secrets, `COOKIE_SECURE=false` or a localhost origin in production.
6. **Start.**

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```

   Caddy obtains a Let's Encrypt certificate and adds HSTS; the gateway, database, cache and object store publish no host ports.
7. **Verify.** Open the URL on a phone over mobile data, sign in as all four roles and run the [walkthrough](../README.md#3-judge-walkthrough); upload a photo; check `curl -I https://wayflow.example.com/`; run the integration suite with `API_URL=https://wayflow.example.com/api/v1`.
8. **Keep it live.** Uptime check on `/api/v1/ready`, instance auto-recovery, EBS snapshots or a nightly `pg_dump` to an encrypted private bucket, CloudWatch billing alarm. Do not stop the instance until results are announced.

To restore the demo state on the server: dispatcher sidebar → **Change** → *Reset demo data*, or `docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm migrate node dist/seed/run.js --reset`.

### Using AWS S3 instead of RustFS

Create a private bucket (Block Public Access on, TLS-only bucket policy, SSE-S3, 90-day lifecycle rule for photos), give the instance an IAM role limited to that bucket, set `S3_ENDPOINT=` (empty), `S3_REGION`, `S3_BUCKET`, and remove the `rustfs` and `storage-init` services from the override. The code only uses the S3 API.

## Later: managed AWS (specs/15 §3)

Route 53 → ACM → ALB (or CloudFront) → ECS Fargate services `web`, `api`, `planner` (internal) → RDS PostgreSQL in private subnets, S3, Secrets Manager. Run `migrate` as a one-off ECS task before each deploy. SSE fan-out already goes through Valkey pub/sub, so several API tasks work with ElastiCache. Images are published to GHCR by the release workflow; push them to ECR from CI with GitHub OIDC.

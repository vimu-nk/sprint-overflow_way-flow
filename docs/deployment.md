# Deployment

Production is a single AWS EC2 instance serving `https://wayflow.vimunk.tech`. The full step-by-step guide (networking, DNS, host nginx + certbot, `.env`, first start, operations, backups, troubleshooting) is [deployment-ec2.md](deployment-ec2.md).

Summary:

- Stack: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`, normally through `infra/deploy.sh` (also what the `Deploy` workflow runs).
- TLS: host nginx + certbot, config in `infra/nginx/wayflow-host.conf`. Only 80 and 443 are public; the gateway listens on `127.0.0.1:8080`.
- Photos live in the RustFS volume on the VM. The code only uses the S3 API, so AWS S3 works by setting `S3_ENDPOINT=` (empty), `S3_REGION`, `S3_BUCKET` and removing `rustfs` and `storage-init`.
- The API refuses to start in production with example secrets, `COOKIE_SECURE=false` or a localhost origin.

## Later: managed AWS (specs/15 §3)

Route 53 → ACM → ALB (or CloudFront) → ECS Fargate services `web`, `api`, `planner` (internal) → RDS PostgreSQL in private subnets, S3, Secrets Manager. Run `migrate` as a one-off ECS task before each deploy. SSE fan-out already goes through Valkey pub/sub, so several API tasks work with ElastiCache. Images are published to GHCR by the release workflow; push them to ECR from CI with GitHub OIDC.

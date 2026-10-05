import { env, isProd } from './env.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

const adapter = new FastifyAdapter({
  // Trust exactly the configured number of proxy hops, never "any" (SEC-51).
  trustProxy: (_addr: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
  bodyLimit: 1024 * 1024, // JSON ≤ 1 MB (SEC-39)
  connectionTimeout: 30_000,
  keepAliveTimeout: 10_000,
  requestTimeout: 30_000,
  maxParamLength: 200,
  genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
    const h = req.headers['x-request-id'];
    return typeof h === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(h) ? h : randomUUID();
  },
  logger: {
    level: env.LOG_LEVEL,
    // SEC-66: never log credentials, cookies or tokens.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]', '*.password', '*.token', '*.refreshToken', '*.passwordHash', '*.hash'],
      censor: '[redacted]',
    },
  },
});

const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: false });
const fastify = app.getHttpAdapter().getInstance();

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, parts: 6 } });
// API responses are JSON/images only: lock everything down (SEC-46, SEC-47).
await app.register(helmet, {
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: isProd ? { maxAge: 31_536_000 } : false,
});
fastify.addHook('onSend', async (req, reply, payload) => {
  reply.header('x-request-id', req.id);
  reply.header('x-robots-tag', 'noindex, nofollow');
  reply.header('permissions-policy', 'camera=(self), geolocation=(self), microphone=(), payment=()');
  reply.removeHeader('x-powered-by');
  // SEC-49: authenticated API responses are never cached by shared caches.
  if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  return payload;
});

app.enableCors({
  origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['content-type', 'x-csrf-token', 'x-request-id'],
});
app.setGlobalPrefix('api/v1');
app.enableShutdownHooks();

// SEC-53: OpenAPI docs only in development when explicitly enabled.
if (env.ENABLE_API_DOCS && !isProd) {
  const config = new DocumentBuilder().setTitle('WayFlow API').setDescription('Waypoint delivery planning').setVersion('1').build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
}

await app.listen(env.API_PORT, '0.0.0.0');

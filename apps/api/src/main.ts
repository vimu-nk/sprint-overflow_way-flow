import './env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
app.setGlobalPrefix('api');
app.enableShutdownHooks();

const config = new DocumentBuilder().setTitle('WayFlow API').setVersion('0.1.0').build();
SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));

await app.listen(process.env.API_PORT ?? 3000, '0.0.0.0');

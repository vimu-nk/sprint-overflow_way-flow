import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginLimiter } from './login-limiter.js';

@Global()
@Module({ controllers: [AuthController], providers: [AuthService, LoginLimiter], exports: [AuthService] })
export class AuthModule {}

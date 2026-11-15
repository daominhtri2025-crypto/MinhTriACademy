import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig, CONFIG } from '../config/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => ({
        secret: cfg.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] }, // chặn tấn công đổi thuật toán
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, DevicesService, TokensService, JwtAuthGuard],
  exports: [TokensService, JwtAuthGuard],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActivationController } from './activation.controller';
import { ActivationService } from './activation.service';
import { CodeKeyring } from './code-keyring.service';

@Module({
  imports: [AuthModule],
  controllers: [ActivationController],
  providers: [ActivationService, CodeKeyring],
  exports: [CodeKeyring],
})
export class ActivationModule {}

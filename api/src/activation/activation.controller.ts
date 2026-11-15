import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/tokens.service';
import { ClientIp } from '../common/http';
import { ActivationService } from './activation.service';

export class ActivateDto {
  // Độ dài rộng: người dùng có thể gõ có/không tiền tố, dấu gạch, khoảng trắng. Chuẩn hóa chặt ở service.
  @IsString() @Length(8, 40) code!: string;
}

@Controller()
export class ActivationController {
  constructor(private readonly activation: ActivationService) {}

  /** POST /v1/activate — kích hoạt khóa học hoặc gia hạn bằng mã (gắn 1-1 với tài khoản/email). */
  @Post('activate') @HttpCode(200) @UseGuards(JwtAuthGuard)
  activate(@CurrentUser() user: AuthUser, @Body() dto: ActivateDto, @ClientIp() ip: string) {
    return this.activation.redeem(user.id, dto.code, ip);
  }
}

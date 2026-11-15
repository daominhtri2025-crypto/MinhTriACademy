import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClientIp, UserAgent } from '../common/http';
import { AppConfig, CONFIG } from '../config/config';
import { AuthService } from './auth.service';
import { clearRefreshCookie, ensureDeviceCookie, REFRESH_COOKIE, setRefreshCookie } from './cookies';
import { DevicesService } from './devices.service';
import { DeviceOtpDto, LoginDto, RegisterDto, ResendDto, RevokeDevicesDto, VerifyEmailDto } from './dto';
import { CurrentUser, JwtAuthGuard } from './jwt-auth.guard';
import { AuthUser } from './tokens.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly devices: DevicesService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post('register') @HttpCode(202)
  async register(@Body() dto: RegisterDto, @ClientIp() ip: string, @UserAgent() userAgent: string) {
    await this.auth.register(dto, { ip, userAgent });
    return { status: 'accepted', message: 'Nếu email hợp lệ, chúng tôi đã gửi thư xác minh.' };
  }

  @Post('verify-email') @HttpCode(200)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { status: 'verified' };
  }

  @Post('resend-verification') @HttpCode(202)
  async resend(@Body() dto: ResendDto, @ClientIp() ip: string, @UserAgent() userAgent: string) {
    await this.auth.resendVerification(dto.email, { ip, userAgent });
    return { status: 'accepted', message: 'Nếu email cần xác minh, chúng tôi đã gửi lại thư.' };
  }

  @Post('login') @HttpCode(200)
  async login(
    @Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string, @UserAgent() userAgent: string,
  ) {
    // Đặt cookie thiết bị TRƯỚC khi xử lý: nếu chạm giới hạn thiết bị, lần đăng nhập lại sau khi gỡ thiết bị vẫn dùng cùng cookie.
    const deviceCookie = ensureDeviceCookie(req, res, this.cfg);
    const r = await this.auth.login(dto, { ip, userAgent }, deviceCookie);
    setRefreshCookie(res, r.refreshToken, this.cfg);
    return { access_token: r.accessToken, token_type: 'Bearer', expires_in: r.expiresIn, kiosk: r.kiosk, user: r.user };
  }

  @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string, @UserAgent() userAgent: string) {
    try {
      const r = await this.auth.refresh((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE], { ip, userAgent });
      if (r.refreshToken) setRefreshCookie(res, r.refreshToken, this.cfg); // trong cửa sổ ân hạn: giữ nguyên cookie
      return { access_token: r.accessToken, token_type: 'Bearer', expires_in: r.expiresIn };
    } catch (e) {
      clearRefreshCookie(res, this.cfg);
      throw e;
    }
  }

  @Post('logout') @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]);
    clearRefreshCookie(res, this.cfg);
  }

  @Get('me') @UseGuards(JwtAuthGuard)
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.id);
  }

  // ── Quản lý thiết bị ──
  @Get('devices') @UseGuards(JwtAuthGuard)
  async listDevices(@CurrentUser() u: AuthUser) {
    return { devices: await this.devices.list(u.id, u.deviceId) };
  }

  @Delete('devices/:id') @UseGuards(JwtAuthGuard) @HttpCode(204)
  async removeDevice(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.devices.revoke(u.id, [id]);
  }

  /** Bước 1 khi chạm giới hạn thiết bị: gửi OTP qua email. */
  @Post('devices/otp') @HttpCode(202)
  async deviceOtp(@Body() dto: DeviceOtpDto) {
    await this.devices.requestOtp(dto.challenge_token);
    return { status: 'accepted', message: 'Đã gửi mã xác nhận tới email.' };
  }

  /** Bước 2: xác nhận OTP và gỡ thiết bị; sau đó đăng nhập lại. */
  @Post('devices/revoke') @HttpCode(200)
  async deviceRevoke(@Body() dto: RevokeDevicesDto) {
    return { revoked: await this.devices.revokeWithOtp(dto.challenge_token, dto.otp, dto.device_ids) };
  }
}

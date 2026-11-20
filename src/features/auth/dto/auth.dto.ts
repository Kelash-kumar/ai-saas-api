import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EmailDto {
  @ApiProperty({ example: 'ada@example.com', maxLength: 320 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class RegisterDto extends EmailDto {
  @ApiProperty({ minLength: 15, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(15)
  @MaxLength(128)
  password!: string;
}

export class LoginDto extends EmailDto {
  @ApiProperty({ maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ maxLength: 120, example: 'Work laptop' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

export class VerificationDto {
  @ApiProperty({ minLength: 43, maxLength: 43, writeOnly: true })
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class CredentialsDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() csrfToken!: string;
  @ApiProperty() expiresIn!: number;
  @ApiProperty() sessionId!: string;
}

export class MessageDto {
  @ApiProperty() message!: string;
}

export class PrincipalDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() userType!: string;
}

export class CsrfDto {
  @ApiProperty() csrfToken!: string;
}

export class SessionSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) deviceName!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) lastSeenAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt!: Date | null;
}

export class SessionPageMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() hasNextPage!: boolean;
  @ApiProperty() hasPreviousPage!: boolean;
}

export class SessionPageDto {
  @ApiProperty({ type: [SessionSummaryDto] }) data!: SessionSummaryDto[];
  @ApiProperty({ type: SessionPageMetaDto }) meta!: SessionPageMetaDto;
}

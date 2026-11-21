import { ApiProperty, ApiPropertyOptional, PartialType, IntersectionType } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsIn,
  Matches,
  MaxLength,
  IsUUID,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
} from 'class-validator';
import { CreateManagedUserDto, UserProfileDto } from '../users/dto/user-management.dto';
import { PageQueryDto } from '../../common/pagination/page-query.dto';
export class CrmQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fromDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() toDate?: string;
  @ApiPropertyOptional({ enum: ['active', 'with', 'only'] })
  @IsIn(['active', 'with', 'only'])
  deleted: 'active' | 'with' | 'only' = 'active';
  @ApiPropertyOptional({ enum: ['admin', 'user'] }) @IsOptional() @IsIn(['admin', 'user']) guard?:
    'admin' | 'user';
  @ApiPropertyOptional({ enum: ['csv', 'xlsx'] }) @IsOptional() @IsIn(['csv', 'xlsx']) format?:
    'csv' | 'xlsx';
}
export class CrmProfileDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-zA-Z0-9_.-]{3,80}$/) username?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['male', 'female', 'other', 'prefer_not_to_say'])
  gender?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) avatarData?: string | null;
  @ApiPropertyOptional({ enum: ['none', 'email'] })
  @IsOptional()
  @IsIn(['none', 'email'])
  notificationChannel?: 'none' | 'email';
  @ApiPropertyOptional({ enum: ['none', 'email'] })
  @IsOptional()
  @IsIn(['none', 'email'])
  twoFactor?: 'none' | 'email';
}
export class CrmGrantsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  roleIds?: string[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  permissionIds?: string[];
}
export class CreateCrmUserDto extends IntersectionType(
  CreateManagedUserDto,
  CrmProfileDto,
  CrmGrantsDto,
) {
  @ApiProperty() @IsString() @MaxLength(128) confirmPassword!: string;
}
export class UpdateCrmUserDto extends IntersectionType(
  PartialType(UserProfileDto, { skipNullProperties: false }),
  CrmProfileDto,
  CrmGrantsDto,
) {
  @ApiPropertyOptional({
    enum: [true],
    description: 'Explicitly approve managed login without claiming mailbox verification',
  })
  @IsOptional()
  @IsIn([true])
  allowLogin?: true;
}
export class CrmRoleDto {
  @ApiProperty() @Matches(/^[a-z][a-z0-9_-]{0,79}$/) name!: string;
  @ApiProperty({ enum: ['admin', 'user'] }) @IsIn(['admin', 'user']) guard!: 'admin' | 'user';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) description?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  permissionIds?: string[];
}
export class CrmBulkDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
  @ApiProperty({ enum: ['delete', 'restore'] }) @IsIn(['delete', 'restore']) action!:
    'delete' | 'restore';
}

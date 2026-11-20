import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PageMetaDto } from '../../../common/pagination/page-meta.dto';

export class CreateRoleDto {
  @ApiProperty({ example: 'report-reader', maxLength: 80 })
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,79}$/)
  name!: string;
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
export class RoleDescriptionDto {
  @ApiProperty({
    maxLength: 255,
    description: 'Role names are immutable; empty string clears the description.',
  })
  @IsString()
  @MaxLength(255)
  description!: string;
}
export class CreatePermissionDto {
  @ApiProperty({ example: 'reports', maxLength: 80 })
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,79}$/)
  resource!: string;
  @ApiProperty({ example: 'view', maxLength: 80 })
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,79}$/)
  action!: string;
}
export class UserStatusDto {
  @ApiProperty({ enum: ['active', 'inactive'] }) @IsIn(['active', 'inactive']) status!:
    'active' | 'inactive';
}
export class AuthorityDto {
  @ApiProperty({ type: [String], format: 'uuid' }) roleIds!: string[];
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class RoleViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
export class RoleDetailsDto extends RoleViewDto {
  @ApiProperty({ type: [String] }) permissionIds!: string[];
  @ApiProperty({ type: [String] }) inheritedRoleIds!: string[];
  @ApiProperty({ type: [String] }) roleIds!: string[];
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [String] }) permissions!: string[];
}
export class PermissionViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() resource!: string;
  @ApiProperty() action!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
export class ManagedUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() userType!: string;
  @ApiProperty({ enum: ['active', 'inactive'] }) status!: string;
  @ApiProperty({ type: String, nullable: true }) deactivationSource!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) emailVerifiedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lockedUntil!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}
export class RolePageDto {
  @ApiProperty({ type: [RoleViewDto] }) data!: RoleViewDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class PermissionPageDto {
  @ApiProperty({ type: [PermissionViewDto] }) data!: PermissionViewDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}
export class ManagedUserPageDto {
  @ApiProperty({ type: [ManagedUserDto] }) data!: ManagedUserDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}

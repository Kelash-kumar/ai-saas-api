import { ApiProperty, ApiPropertyOptional, PartialType, IntersectionType } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { RegisterDto } from '../../auth/dto/auth.dto';
import { PageQueryDto } from '../../../common/pagination/page-query.dto';
import { PageMetaDto } from '../../../common/pagination/page-meta.dto';
export class UserProfileDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @Length(1, 100) lastName!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) @IsOptional() @IsUUID() companyId?:
    string | null;
}
export class CreateManagedUserDto extends IntersectionType(RegisterDto, UserProfileDto) {}
export class UpdateManagedUserDto extends PartialType(UserProfileDto, {
  skipNullProperties: false,
}) {}
export class UserManagementQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() companyId?: string;
}
export class UserViewDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  accessApprovedAt!: Date | null;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ type: String, nullable: true }) firstName!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastName!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) companyId!: string | null;
  @ApiProperty({ enum: ['active', 'inactive'] }) status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) emailVerifiedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
export class UserManagementPageDto {
  @ApiProperty({ type: [UserViewDto] }) data!: UserViewDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}

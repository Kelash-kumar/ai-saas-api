import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/pagination/page-meta.dto';
export class CreateCompanyDto {
  @ApiProperty({ maxLength: 160 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 160)
  name!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 320 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  website?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string | null;
}
export class UpdateCompanyDto extends PartialType(CreateCompanyDto, {
  skipNullProperties: false,
}) {}
export class CompanyViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) website!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
export class CompanyPageDto {
  @ApiProperty({ type: [CompanyViewDto] }) data!: CompanyViewDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}

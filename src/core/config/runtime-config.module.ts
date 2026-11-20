import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './environment';
import { RuntimeConfig } from './runtime-config.service';
import { DatabaseConfig } from './database-config.service';
import { AuthConfig } from './auth-config.service';
import { MailConfig } from './mail-config.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      validate: validateEnvironment,
      skipProcessEnv: true,
    }),
  ],
  providers: [RuntimeConfig, DatabaseConfig, AuthConfig, MailConfig],
  exports: [RuntimeConfig, DatabaseConfig, AuthConfig, MailConfig],
})
export class RuntimeConfigModule {}

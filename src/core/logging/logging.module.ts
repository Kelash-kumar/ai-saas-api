import { Global, Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { RuntimeConfig } from '../config/runtime-config.service';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { AppLogger } from './app-logger.service';
import { loggingOptions } from './logging.options';

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [RuntimeConfigModule],
      inject: [RuntimeConfig],
      useFactory: (config: RuntimeConfig) => ({
        pinoHttp: loggingOptions(config),
        forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      }),
    }),
  ],
  providers: [AppLogger],
  exports: [AppLogger, LoggerModule],
})
export class LoggingModule {}

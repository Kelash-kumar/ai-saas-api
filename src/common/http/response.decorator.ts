import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE = 'http:raw-response';
/** Preserve protocols such as Terminus responses, files, and streaming endpoints. */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

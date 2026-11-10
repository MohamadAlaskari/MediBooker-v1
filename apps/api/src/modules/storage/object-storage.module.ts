import { Module } from '@nestjs/common';
import { Clock } from '../../common/time/clock.js';
import { ENV } from '../../config/env.module.js';
import { objectStorageFor } from './object-storage.factory.js';
import { ObjectStorage } from './object-storage.js';

/** File storage (F09, ADR 0015). Nothing uses it yet but the check command; R02 builds on it. */
@Module({
  providers: [{ provide: ObjectStorage, inject: [ENV, Clock], useFactory: objectStorageFor }],
  exports: [ObjectStorage],
})
export class ObjectStorageModule {}

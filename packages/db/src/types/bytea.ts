import { Buffer } from 'node:buffer';
import { customType } from 'drizzle-orm/pg-core';

export const bytea = customType<{
  data: Uint8Array;
  driverData: Buffer;
}>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  },
});

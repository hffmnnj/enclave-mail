// @enclave/types — Shared TypeScript types and interfaces
// These types are used across apps/server and apps/web

export type PackageVersion = string;
export const TYPES_PACKAGE_VERSION: PackageVersion = '0.0.1';

export { QUEUE_NAMES, type QueueName } from './queues.js';

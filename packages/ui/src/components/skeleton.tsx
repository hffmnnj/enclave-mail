import type * as React from 'react';

import { cn } from '../lib/utils.js';

const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('animate-pulse rounded-sm bg-surface-raised', className)} {...props} />
);

export { Skeleton };

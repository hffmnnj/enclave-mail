import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-1.5 py-0 text-ui-xs font-medium transition-colors duration-fast',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/10 text-primary',
        secondary: 'border-secondary/30 bg-secondary/10 text-secondary',
        success: 'border-success/30 bg-success/10 text-success',
        danger: 'border-danger/30 bg-danger/10 text-danger',
        outline: 'border-border bg-transparent text-text-secondary',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <div className={cn(badgeVariants({ variant }), className)} {...props} />
);

export { Badge, badgeVariants };
export type { BadgeProps };

import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 cursor-default select-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-background hover:bg-primary/90',
        secondary: 'bg-secondary text-background hover:bg-secondary/90',
        outline: 'border border-border bg-transparent hover:bg-surface text-text-primary',
        ghost: 'bg-transparent hover:bg-surface text-text-primary',
        destructive: 'bg-danger text-background hover:bg-danger/90',
      },
      size: {
        sm: 'h-6 px-2 text-ui-sm rounded-sm',
        default: 'h-7 px-3 text-ui-base rounded-sm',
        lg: 'h-8 px-4 text-ui-md rounded',
        icon: 'h-7 w-7 rounded-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
export type { ButtonProps };

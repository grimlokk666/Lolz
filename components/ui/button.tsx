import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-xs font-mono uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "bg-cyan-500/20 text-cyan-100 border border-cyan-500/40 hover:bg-cyan-500/30 hover:border-cyan-400/60",
        ghost:
          "bg-transparent text-cyan-200/80 border border-transparent hover:border-cyan-500/30 hover:bg-cyan-500/10",
        active:
          "bg-cyan-400/30 text-cyan-50 border border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.35)]",
        danger:
          "bg-red-500/20 text-red-200 border border-red-500/40 hover:bg-red-500/30",
        outline:
          "border border-cyan-500/40 bg-black/40 text-cyan-100 hover:bg-cyan-500/10",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 px-2 text-[10px]",
        lg: "h-10 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

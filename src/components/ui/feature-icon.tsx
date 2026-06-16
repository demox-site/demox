import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type FeatureIconVariant = "default" | "step-1" | "step-2" | "step-3";

type FeatureIconProps = {
  icon: LucideIcon;
  size?: "md" | "lg";
  variant?: FeatureIconVariant;
  className?: string;
};

const variantStyles: Record<FeatureIconVariant, string> = {
  default:
    "border-border bg-muted/60 text-foreground group-hover:border-foreground/20 group-hover:bg-muted",
  "step-1":
    "border-step-1/30 bg-step-1/10 text-step-1 shadow-[0_0_30px_-10px_hsl(var(--step-1)/0.45)] group-hover:border-step-1/50 group-hover:bg-step-1/15",
  "step-2":
    "border-step-2/30 bg-step-2/10 text-step-2 shadow-[0_0_30px_-10px_hsl(var(--step-2)/0.45)] group-hover:border-step-2/50 group-hover:bg-step-2/15",
  "step-3":
    "border-step-3/30 bg-step-3/10 text-step-3 shadow-[0_0_30px_-10px_hsl(var(--step-3)/0.45)] group-hover:border-step-3/50 group-hover:bg-step-3/15",
};

/**
 * Marketing / support section icon — theme-aware with optional step accent.
 */
export function FeatureIcon({
  icon: Icon,
  size = "md",
  variant = "default",
  className,
}: FeatureIconProps) {
  const shell =
    size === "lg"
      ? "w-24 h-24 [&_svg]:w-8 [&_svg]:h-8"
      : "w-16 h-16 [&_svg]:w-7 [&_svg]:h-7";

  return (
    <div
      className={cn(
        "rounded-full border flex items-center justify-center transition-all duration-300",
        "backdrop-blur-sm",
        variantStyles[variant],
        shell,
        className
      )}
    >
      <Icon strokeWidth={1.5} aria-hidden />
    </div>
  );
}

"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const Accordion = AccordionPrimitive.Root;

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn(
      "group/item relative overflow-hidden rounded-md border border-white/[0.07]",
      "bg-white/[0.015] backdrop-blur-sm",
      "transition-all duration-300 ease-cyber",
      "hover:border-red-500/40 hover:bg-red-500/[0.03]",
      "data-[state=open]:border-red-500/50",
      "data-[state=open]:bg-red-500/[0.05]",
      "data-[state=open]:shadow-[0_0_22px_rgba(239,68,68,0.18)]",
      className,
    )}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-start justify-between gap-4 px-5 py-5 text-left",
        "font-display text-sm font-semibold leading-snug text-zinc-200 sm:text-base",
        "transition-colors duration-200 hover:text-white",
        "data-[state=open]:text-white",
        "[&[data-state=open]>svg]:rotate-45 [&[data-state=open]>svg]:text-red-400",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-red-500/50",
        className,
      )}
      {...props}
    >
      <span className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-[3px] select-none font-mono text-xs text-red-500/70 transition-colors group-hover/item:text-red-400"
        >
          {">"}
        </span>
        {children}
      </span>
      <Plus
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 text-zinc-500",
          "transition-all duration-300 ease-cyber",
        )}
        aria-hidden="true"
      />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
    {...props}
  >
    <div
      className={cn(
        "border-t border-red-500/10 px-5 pb-5 pt-4",
        "text-sm leading-relaxed text-zinc-400",
        className,
      )}
    >
      {children}
    </div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };

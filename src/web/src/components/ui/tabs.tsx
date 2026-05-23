import * as TabsPrimitive from "@radix-ui/react-tabs";
import { type ComponentPropsWithoutRef, forwardRef } from "react";

import { cn } from "../../lib/utils";

// Thin wrappers over @radix-ui/react-tabs. The visual styling lives in the
// design-system `.tabs` rules (tablist / button.active / tabpanel); these just
// attach the right class names and forward props/refs.
export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
	({ className, ...props }, ref) => <TabsPrimitive.List ref={ref} className={cn("tablist", className)} {...props} />,
);
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
	({ className, ...props }, ref) => <TabsPrimitive.Trigger ref={ref} className={cn(className)} {...props} />,
);
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
	({ className, ...props }, ref) => (
		<TabsPrimitive.Content ref={ref} className={cn("tabpanel", className)} {...props} />
	),
);
TabsContent.displayName = "TabsContent";

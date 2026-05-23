import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn-style class combiner: clsx for conditional joins, tailwind-merge
// to dedupe conflicting Tailwind utilities. Used by hand-authored ui/* primitives.
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

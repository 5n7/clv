import type { Severity } from "@shared/types";
import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Circle,
	Copy,
	File,
	Folder,
	Hash,
	Info,
	Lightbulb,
	Moon,
	OctagonAlert,
	PanelLeft,
	ShieldAlert,
	Sun,
	TriangleAlert,
	type LucideIcon,
} from "lucide-react";

// Maps the prototype's icon names (primitives.jsx) onto lucide-react icons.
const ICONS: Record<string, LucideIcon> = {
	check: Check,
	chevDown: ChevronDown,
	chevLeft: ChevronLeft,
	chevRight: ChevronRight,
	copy: Copy,
	critical: ShieldAlert,
	danger: OctagonAlert,
	dot: Circle,
	file: File,
	folder: Folder,
	hash: Hash,
	info: Info,
	moon: Moon,
	panelLeft: PanelLeft,
	sun: Sun,
	tip: Lightbulb,
	warning: TriangleAlert,
};

export type IconProps = {
	name: string;
	size?: number;
	stroke?: number;
	className?: string;
	title?: string;
};

export function Icon({ name, size = 16, stroke = 1.6, ...rest }: IconProps) {
	const Cmp = ICONS[name];
	if (!Cmp) return null;
	return <Cmp size={size} strokeWidth={stroke} {...rest} />;
}

// Severity → human-readable label, used by callouts and findings.
export const SEV_LABEL: Record<Severity, string> = {
	critical: "Critical",
	danger: "Danger",
	warning: "Warning",
	tip: "Tip",
	info: "Note",
};

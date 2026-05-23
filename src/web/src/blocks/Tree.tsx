import type { FileChange, Tree as TreeData, TreeNode } from "@shared/types";
import { useMemo } from "react";

import { BlockFrame } from "../components/BlockFrame";
import { Icon } from "../components/Icon";

type TreeProps = {
	data: TreeData;
	id?: string;
};

// Internal node of the hierarchical tree built from path strings.
type TNode = {
	name: string;
	children: Map<string, TNode>;
	node: TreeNode | null;
	depth: number;
};

type FlatRow = {
	name: string;
	prefix: string;
	isLast: boolean;
	isDir: boolean;
	node: TreeNode | null;
	depth: number;
};

// Build a nested map from each node's path segments, then flatten to rows with
// `├──`/`└──` twig prefixes. Directories sort before files, then alphabetically.
export function Tree({ data, id }: TreeProps) {
	const root = useMemo<TNode>(() => {
		const r: TNode = { name: "", children: new Map(), node: null, depth: -1 };
		for (const n of data.nodes || []) {
			const parts = n.path.split("/");
			let cur = r;
			parts.forEach((p, i) => {
				if (!cur.children.has(p)) {
					cur.children.set(p, { name: p, children: new Map(), node: null, depth: i });
				}
				cur = cur.children.get(p)!;
			});
			cur.node = n;
		}
		return r;
	}, [data.nodes]);

	const flat = useMemo<FlatRow[]>(() => {
		const list: FlatRow[] = [];
		const walk = (node: TNode, prefix: string, isLast: boolean, depth: number) => {
			if (node !== root) {
				list.push({
					name: node.name,
					prefix,
					isLast,
					isDir: node.children.size > 0,
					node: node.node,
					depth,
				});
			}
			const kids = Array.from(node.children.values()).sort((a, b) => {
				const ad = a.children.size > 0;
				const bd = b.children.size > 0;
				if (ad !== bd) return ad ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
			kids.forEach((k, i) => {
				const last = i === kids.length - 1;
				const np = node === root ? "" : prefix + (isLast ? "    " : "│   ");
				walk(k, np, last, depth + 1);
			});
		};
		walk(root, "", true, -1);
		return list;
	}, [root]);

	const counts = useMemo(() => {
		const c: Record<FileChange, number> = { added: 0, modified: 0, deleted: 0, renamed: 0 };
		for (const n of data.nodes || []) {
			if (n.status && c[n.status] != null) c[n.status]++;
		}
		return c;
	}, [data.nodes]);

	const summaryBits = [
		counts.added > 0 && (
			<span key="a" className="statbadge added">
				+{counts.added}
			</span>
		),
		counts.modified > 0 && (
			<span key="m" className="statbadge modified">
				~{counts.modified}
			</span>
		),
		counts.deleted > 0 && (
			<span key="d" className="statbadge deleted">
				{"−"}
				{counts.deleted}
			</span>
		),
		counts.renamed > 0 && (
			<span key="r" className="statbadge renamed">
				{"↦"}
				{counts.renamed}
			</span>
		),
	].filter(Boolean);

	return (
		<BlockFrame
			type="tree"
			id={id}
			title={data.title}
			collapsed={data.collapsed}
			extraHead={<div style={{ display: "flex", gap: 6 }}>{summaryBits}</div>}
		>
			<div className="tree-list">
				{flat.map((row, i) => (
					<div key={i} className={"tree-row " + (row.isDir ? "dir" : "")}>
						<div className="left">
							<span className="twig">
								{row.prefix}
								{row.isLast ? "└── " : "├── "}
							</span>
							<Icon name={row.isDir ? "folder" : "file"} size={13} stroke={1.5} />
							<span className="nm">
								{row.node?.href ? (
									<a
										href={row.node.href}
										style={{ color: "inherit", textDecoration: "none", borderBottom: "1px dashed var(--line)" }}
									>
										{row.name}
									</a>
								) : (
									row.name
								)}
							</span>
							{row.node?.note && <span className="note">— {row.node.note}</span>}
						</div>
						<div className="right">
							{row.node?.status && <span className={"statbadge " + row.node.status}>{row.node.status}</span>}
						</div>
					</div>
				))}
			</div>
		</BlockFrame>
	);
}

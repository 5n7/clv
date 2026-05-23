import type { Table as TableData, TableColumn } from "@shared/types";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { BlockFrame } from "../components/BlockFrame";
import { TokenLine } from "../lib/CodeTokens";
import { type CodeToken, tokenizeInline } from "../lib/shiki";
import { cn } from "../lib/utils";

type Row = Record<string, string | number>;

// Sortable table via @tanstack/react-table, styled with the `.tbl` design rules
// and the prototype's ↕/↑/↓ sort indicators. Columns carrying a `lang` render
// their cell value with inline shiki highlight (reusing lib/shiki.ts).
type TableProps = {
	data: TableData;
	id?: string;
};

export function Table({ data, id }: TableProps) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const tokenCache = useMemo(() => new Map<string, CodeToken[]>(), []);

	const columns = useMemo<ColumnDef<Row>[]>(
		() =>
			data.columns.map((c) => ({
				id: c.key,
				accessorKey: c.key,
				header: c.label,
				enableSorting: c.sortable !== false,
				// Numeric-aware sort: compare as numbers when both sides parse.
				sortingFn: (a, b) => {
					const av = a.getValue<string | number>(c.key);
					const bv = b.getValue<string | number>(c.key);
					const an = typeof av === "number" ? av : parseFloat(String(av).replace(/[^0-9.-]/g, ""));
					const bn = typeof bv === "number" ? bv : parseFloat(String(bv).replace(/[^0-9.-]/g, ""));
					if (!isNaN(an) && !isNaN(bn)) return an - bn;
					return String(av).localeCompare(String(bv));
				},
				cell: (ctx) => {
					const value = ctx.getValue<string | number>();
					if (c.lang && value != null) {
						const key = c.lang + "\0" + String(value);
						let tokens = tokenCache.get(key);
						if (!tokens) {
							tokens = tokenizeInline(String(value), c.lang);
							tokenCache.set(key, tokens);
						}
						return <TokenLine tokens={tokens} />;
					}
					return value;
				},
			})),
		[data.columns, tokenCache],
	);

	const table = useReactTable({
		data: data.rows as Row[],
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	const colByKey = useMemo(() => new Map(data.columns.map((c) => [c.key, c])), [data.columns]);

	return (
		<BlockFrame type="table" id={id} title={data.title} collapsed={data.collapsed}>
			<table className="tbl">
				<thead>
					{table.getHeaderGroups().map((hg) => (
						<tr key={hg.id}>
							{hg.headers.map((header) => {
								const col = colByKey.get(header.column.id);
								const sortable = header.column.getCanSort();
								const sorted = header.column.getIsSorted();
								const cls = cn(alignClass(col?.align), sorted && "sorted");
								return (
									<th
										key={header.id}
										className={cls}
										onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
									>
										{flexRender(header.column.columnDef.header, header.getContext())}
										{sortable && <span className="so">{sortIndicator(sorted)}</span>}
									</th>
								);
							})}
						</tr>
					))}
				</thead>
				<tbody>
					{table.getRowModel().rows.map((row) => (
						<tr key={row.id}>
							{row.getVisibleCells().map((cell) => {
								const col = colByKey.get(cell.column.id);
								const raw = cell.getValue<string | number>();
								const mono = typeof raw === "number" || col?.align === "right" || !!col?.lang;
								const cls = cn(alignClass(col?.align), mono && "mono");
								return (
									<td key={cell.id} className={cls}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
				{data.caption && <caption>{data.caption}</caption>}
			</table>
		</BlockFrame>
	);
}

function sortIndicator(sorted: false | "asc" | "desc"): string {
	switch (sorted) {
		case "asc":
			return "↑";
		case "desc":
			return "↓";
		default:
			return "↕";
	}
}

function alignClass(align?: TableColumn["align"]): string {
	switch (align) {
		case "right":
			return "r";
		case "center":
			return "c";
		default:
			return "";
	}
}

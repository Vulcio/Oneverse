import {
  type Column,
  type ColumnDef,
  type RowData,
  type SortingState,
  type ColumnOrderState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState, type ComponentProps } from "react";
import { Input } from "./input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must match the library's declaration
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Hidden on phone-width screens, where only the essential columns fit. */
    secondary?: boolean;
  }
}

function responsiveClass<TData>(column: Column<TData, unknown>): string | undefined {
  return column.columnDef.meta?.secondary ? "hidden sm:table-cell" : undefined;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
  /** More of a row's attributes: a row that can be dragged somewhere, its test id. */
  rowProps?: (row: TData) => ComponentProps<"tr">;
  emptyMessage?: string;
  /** Shows a search box above the table, filtering across every column's
   * rendered value, when set. */
  filterPlaceholder?: string;
  /** Sorting done elsewhere (e.g. by the server): the table only shows and
   * reports it, instead of sorting `data` itself. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Which columns show (by id; left out: shown), and in what order (issue #150). */
  columnVisibility?: VisibilityState;
  columnOrder?: ColumnOrderState;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  rowProps,
  emptyMessage = "No results.",
  filterPlaceholder,
  sorting: controlledSorting,
  onSortingChange,
  columnVisibility,
  columnOrder,
}: DataTableProps<TData, TValue>) {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const manualSorting = controlledSorting !== undefined;
  const sorting = controlledSorting ?? localSorting;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, ...(columnVisibility ? { columnVisibility } : {}), ...(columnOrder ? { columnOrder } : {}) },
    manualSorting,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (manualSorting) onSortingChange?.(next);
      else setLocalSorting(next);
    },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="flex flex-col gap-3">
      {filterPlaceholder ? (
        <div className="px-4 pt-4">
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={filterPlaceholder}
            className="max-w-xs"
          />
        </div>
      ) : null}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className={responsiveClass(header.column)}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                {...rowProps?.(row.original)}
                onClick={() => onRowClick?.(row.original)}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={responsiveClass(cell.column)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

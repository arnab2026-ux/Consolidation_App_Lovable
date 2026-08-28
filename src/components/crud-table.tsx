import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Download, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { CsvImportSheet, type ImportValidator } from "@/components/csv-import-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

// This component is generic over table names, which the generated typed client
// cannot express; use an untyped view of the query builder inside it.
const db = supabase as unknown as import("@supabase/supabase-js").SupabaseClient;
import { exportCsv, type CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/utils";

export interface ColumnFilterDef {
  column: string;
  label: string;
  type?: "text" | "boolean";
}

export interface CrudTableProps<T extends { id: string }> {
  /** Physical table name in the database. */
  table: string;
  title: string;
  /** Extra equality filters applied to every query (besides tenant). */
  eqFilters?: Record<string, string | number | boolean>;
  columns: ColumnDef<T, unknown>[];
  /** Columns included in the global ILIKE search. */
  searchColumns: string[];
  filters?: ColumnFilterDef[];
  orderBy: { column: string; ascending?: boolean };
  tenantId: string | null | undefined;
  csvColumns: CsvColumn<T>[];
  importValidator: ImportValidator;
  /** Unique key columns used for CSV upsert. */
  conflictTarget: string;
  renderForm: (args: { row: T | null; close: () => void }) => ReactNode;
  toolbar?: ReactNode;
  pageSize?: number;
  onRowsChanged?: () => void;
}

export function CrudTable<T extends { id: string }>({
  table,
  title,
  eqFilters,
  columns,
  searchColumns,
  filters = [],
  orderBy,
  tenantId,
  csvColumns,
  importValidator,
  conflictTarget,
  renderForm,
  toolbar,
  pageSize = 25,
  onRowsChanged,
}: CrudTableProps<T>) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [editing, setEditing] = useState<{ row: T | null } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filterKey = JSON.stringify({ columnFilters, search, eqFilters });
  const queryKey = [table, tenantId, page, pageSize, filterKey, orderBy] as const;

  const query = useQuery({
    queryKey,
    enabled: Boolean(tenantId),
    queryFn: async () => {
      let q = db
        .from(table)
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId as string);
      for (const [col, val] of Object.entries(eqFilters ?? {})) q = q.eq(col, val);
      for (const [col, val] of Object.entries(columnFilters)) {
        if (!val) continue;
        if (val === "__true__") q = q.eq(col, true);
        else if (val === "__false__") q = q.eq(col, false);
        else q = q.ilike(col, `%${val}%`);
      }
      if (search.trim()) {
        q = q.or(searchColumns.map((c) => `${c}.ilike.%${search.trim()}%`).join(","));
      }
      q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
      const { data, error, count } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as T[], count: count ?? 0 };
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [table] });
    onRowsChanged?.();
  };

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await db.from(table).delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_data, ids) => {
      toast.success(`${ids.length} row(s) deleted`);
      setRowSelection({});
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selectionColumn: ColumnDef<T, unknown> = useMemo(
    () => ({
      id: "__select",
      size: 32,
      header: ({ table: t }) => (
        <Checkbox
          aria-label="Select page"
          checked={t.getIsAllPageRowsSelected() || (t.getIsSomePageRowsSelected() && "indeterminate")}
          onCheckedChange={(value) => t.toggleAllPageRowsSelected(Boolean(value))}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
        />
      ),
      enableSorting: false,
    }),
    [],
  );

  const tableInstance = useReactTable({
    data: rows,
    columns: [selectionColumn, ...columns],
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualPagination: true,
    manualFiltering: true,
    pageCount,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  const handleExport = async () => {
    let q = db.from(table).select("*").eq("tenant_id", tenantId as string);
    for (const [col, val] of Object.entries(eqFilters ?? {})) q = q.eq(col, val);
    const { data, error } = await q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    if (error) {
      toast.error(error.message);
      return;
    }
    exportCsv(`${table}.csv`, csvColumns, (data ?? []) as unknown as T[]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder="Search…"
          className="h-8 w-56"
        />
        {filters.map((filter) => (
          <Input
            key={filter.column}
            value={columnFilters[filter.column] ?? ""}
            onChange={(event) => {
              setColumnFilters((prev) => ({ ...prev, [filter.column]: event.target.value }));
              setPage(0);
            }}
            placeholder={filter.label}
            className="h-8 w-36"
          />
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {toolbar}
          {selectedIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => deleteMutation.mutate(selectedIds)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-1 size-3.5" /> Delete ({selectedIds.length})
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8" onClick={() => setImportOpen(true)}>
            <Upload className="mr-1 size-3.5" /> Import CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => void handleExport()}>
            <Download className="mr-1 size-3.5" /> Export CSV
          </Button>
          <Button size="sm" className="h-8" onClick={() => setEditing({ row: null })}>
            <Plus className="mr-1 size-3.5" /> New
          </Button>
        </div>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            {tableInstance.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-8 whitespace-nowrap px-2 text-xs font-medium">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {query.isLoading && (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="h-16 text-center text-xs text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {query.isError && (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="h-16 text-center text-xs text-destructive">
                  {(query.error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!query.isLoading && !query.isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="h-16 text-center text-xs text-muted-foreground">
                  No {title.toLowerCase()} rows.
                </TableCell>
              </TableRow>
            )}
            {tableInstance.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={cn("cursor-pointer")}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("[role=checkbox]")) return;
                  setEditing({ row: row.original });
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="whitespace-nowrap px-2 py-1.5 text-xs">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total} row(s){selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ""}
        </span>
        <div className="flex items-center gap-2">
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-sm">
              {editing?.row ? `Edit ${title}` : `New ${title}`}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {editing?.row ? "Update the selected master data record." : "Create a new master data record."}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {editing && renderForm({ row: editing.row, close: () => setEditing(null) })}
          </div>
        </SheetContent>
      </Sheet>

      <CsvImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        table={table}
        title={title}
        tenantId={tenantId}
        conflictTarget={conflictTarget}
        validator={importValidator}
        onImported={invalidate}
      />
    </div>
  );
}

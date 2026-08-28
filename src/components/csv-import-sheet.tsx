import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { parseCsvFile, type CsvRow } from "@/lib/csv";

const db = supabase as unknown as import("@supabase/supabase-js").SupabaseClient;

export interface ImportResult {
  record: Record<string, unknown> | null;
  errors: string[];
}

/** Maps a raw CSV row to a database record and collects validation errors. */
export type ImportValidator = (row: CsvRow, index: number) => ImportResult | Promise<ImportResult>;

export function CsvImportSheet({
  open,
  onOpenChange,
  table,
  title,
  tenantId,
  conflictTarget,
  validator,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: string;
  title: string;
  tenantId: string | null | undefined;
  conflictTarget: string;
  validator: ImportValidator;
  onImported: () => void;
}) {
  const [preview, setPreview] = useState<{ raw: CsvRow; result: ImportResult }[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);

  const reset = () => {
    setPreview([]);
    setFileName(null);
  };

  const handleFile = async (file: File) => {
    try {
      const rows = await parseCsvFile(file);
      const results = [];
      for (let i = 0; i < rows.length; i += 1) {
        results.push({ raw: rows[i]!, result: await validator(rows[i]!, i) });
      }
      setFileName(file.name);
      setPreview(results);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const valid = preview.filter((p) => p.result.errors.length === 0 && p.result.record);
  const invalid = preview.length - valid.length;

  const commit = useMutation({
    mutationFn: async () => {
      const records = valid.map((p) => ({ ...p.result.record, tenant_id: tenantId }));
      const { error } = await db.from(table).upsert(records, { onConflict: conflictTarget });
      if (error) throw error;
      return records.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} row(s) imported`);
      reset();
      onOpenChange(false);
      onImported();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const headers = preview.length > 0 ? Object.keys(preview[0]!.raw) : [];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="text-sm">Import {title} from CSV</SheetTitle>
          <SheetDescription className="text-xs">
            Rows are validated before anything is written. Existing records matching the key are updated.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6">
          <Input
            type="file"
            accept=".csv,text/csv"
            className="h-8 text-xs"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {fileName && (
            <p className="text-xs text-muted-foreground">
              {fileName} · {preview.length} row(s) · {valid.length} valid · {invalid} with errors
            </p>
          )}
          {preview.length > 0 && (
            <div className="max-h-[60vh] overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="h-8 px-2 text-xs">#</TableHead>
                    <TableHead className="h-8 px-2 text-xs">Status</TableHead>
                    {headers.map((header) => (
                      <TableHead key={header} className="h-8 whitespace-nowrap px-2 text-xs">
                        {header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((entry, index) => {
                    const ok = entry.result.errors.length === 0 && entry.result.record;
                    return (
                      <TableRow key={index} className={ok ? undefined : "bg-destructive/5"}>
                        <TableCell className="px-2 py-1 text-xs">{index + 1}</TableCell>
                        <TableCell className="px-2 py-1 text-xs">
                          {ok ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <Check className="size-3.5" /> Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-start gap-1 text-destructive">
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                              <span>{entry.result.errors.join("; ")}</span>
                            </span>
                          )}
                        </TableCell>
                        {headers.map((header) => (
                          <TableCell key={header} className="whitespace-nowrap px-2 py-1 text-xs">
                            {entry.raw[header]}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={valid.length === 0 || commit.isPending}
              onClick={() => commit.mutate()}
            >
              Import {valid.length} valid row(s)
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

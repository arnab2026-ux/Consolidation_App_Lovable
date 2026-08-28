import { useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import type { Pov } from "@/lib/pov-context";
import { parseUploadFile, type ParsedFile } from "@/lib/upload-parse";

export function StepFile({
  tenantId,
  appUserId,
  pov,
  parsed,
  batchId,
  disabled,
  onLoaded,
  onNext,
}: {
  tenantId: string;
  appUserId: string | null;
  pov: Pov;
  parsed: ParsedFile | null;
  batchId: string | null;
  disabled: boolean;
  onLoaded: (parsed: ParsedFile, batchId: string) => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!pov.versionId) {
      toast.error("Select a version in the point of view first");
      return;
    }
    setBusy(true);
    try {
      const result = await parseUploadFile(file);
      if (result.columns.length === 0 || result.rows.length === 0) {
        throw new Error("The file has no readable header row or no data rows");
      }
      const path = `${tenantId}/${crypto.randomUUID()}-${file.name}`;
      const upload = await supabase.storage.from("uploads").upload(path, file, { upsert: false });
      if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);

      const { data, error } = await supabase
        .from("upload_batch")
        .insert({
          tenant_id: tenantId,
          file_name: file.name,
          storage_path: path,
          version_id: pov.versionId,
          fiscal_year: pov.fiscalYear,
          period: pov.period,
          row_count: result.rows.length,
          status: "UPLOADED",
          ...(appUserId ? { created_by: appUserId } : {}),
        })
        .select("id")
        .single();
      if (error) throw error;

      onLoaded(result, data.id);
      toast.success(`${result.rows.length} row(s) read from ${file.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read the file");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  const previewColumns = parsed?.columns ?? [];
  const previewRows = parsed?.rows.slice(0, 20) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded border border-dashed p-8 text-xs ${
          dragging ? "border-foreground bg-muted" : "text-muted-foreground"
        }`}
      >
        <Upload className="size-5" />
        <p>Drag and drop a CSV or Excel file here</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.xlsx,.xlsm,.xls"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={busy || disabled}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Reading…" : "Choose file"}
        </Button>
      </div>

      {parsed && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-5">
            <Stat label="File" value={parsed.fileName} icon />
            <Stat label="Format" value={parsed.kind + (parsed.sheetName ? ` · ${parsed.sheetName}` : "")} />
            <Stat label="Delimiter" value={parsed.delimiter} />
            <Stat label="Encoding" value={parsed.encoding} />
            <Stat label="Rows detected" value={String(parsed.rows.length)} />
          </div>

          <div className="overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 w-12 text-xs">#</TableHead>
                  {previewColumns.map((column) => (
                    <TableHead key={column} className="h-8 whitespace-nowrap text-xs">
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell className="py-1 text-xs text-muted-foreground">{index + 1}</TableCell>
                    {previewColumns.map((column) => (
                      <TableCell key={column} className="whitespace-nowrap py-1 text-xs">
                        {row[column]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Showing the first {previewRows.length} of {parsed.rows.length} row(s). Batch {batchId?.slice(0, 8)}.
          </p>
          <div className="flex justify-end">
            <Button size="sm" className="h-8" disabled={disabled} onClick={onNext}>
              Continue to mapping
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon = false }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="rounded border px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="flex items-center gap-1 truncate text-xs font-medium" title={value}>
        {icon && <FileSpreadsheet className="size-3.5 shrink-0" />}
        {value}
      </p>
    </div>
  );
}

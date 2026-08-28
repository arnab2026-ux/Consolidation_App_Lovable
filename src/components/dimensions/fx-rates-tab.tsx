import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { CsvImportSheet } from "@/components/csv-import-sheet";
import { SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { usePov } from "@/lib/pov-context";
import { supabase } from "@/integrations/supabase/client";
import { exportCsv, parseClipboardMatrix, parseNum, pick, type CsvRow } from "@/lib/csv";

const RATE_TYPES = [
  { value: "CLOSING", label: "Closing" },
  { value: "AVERAGE", label: "Average" },
  { value: "HISTORICAL", label: "Historical" },
  { value: "OPENING", label: "Opening" },
];

const PERIODS = Array.from({ length: 12 }, (_, index) => index + 1);

type PairKey = string; // `${from}>${to}`

export function FxRatesTab() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const { pov } = usePov();
  const queryClient = useQueryClient();

  const [rateType, setRateType] = useState("CLOSING");
  const [fiscalYear, setFiscalYear] = useState<number>(pov.fiscalYear ?? new Date().getFullYear());
  const [grid, setGrid] = useState<Record<PairKey, Record<number, string>>>({});
  const [newPair, setNewPair] = useState({ from: "", to: "" });
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (pov.fiscalYear) setFiscalYear(pov.fiscalYear);
  }, [pov.fiscalYear]);

  const currencies = useQuery({
    queryKey: ["dim_currency"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("dim_currency").select("*").order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rates = useQuery({
    queryKey: ["fx_rate", tenantId, rateType, fiscalYear, pov.versionId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      let q = supabase
        .from("fx_rate")
        .select("*")
        .eq("rate_type", rateType)
        .eq("fiscal_year", fiscalYear);
      if (pov.versionId) q = q.eq("version_id", pov.versionId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const next: Record<PairKey, Record<number, string>> = {};
    for (const rate of rates.data ?? []) {
      const key = `${rate.from_currency}>${rate.to_currency}`;
      next[key] = next[key] ?? {};
      next[key]![rate.period] = String(rate.rate);
    }
    setGrid(next);
  }, [rates.data]);

  const pairs = useMemo(() => Object.keys(grid).sort(), [grid]);

  const setCell = (key: PairKey, period: number, value: string) =>
    setGrid((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), [period]: value } }));

  /** Paste an Excel block starting at the given cell. */
  const handlePaste = (key: PairKey, period: number, text: string) => {
    const matrix = parseClipboardMatrix(text);
    if (matrix.length === 0) return;
    setGrid((prev) => {
      const next = { ...prev };
      matrix.forEach((line, rowOffset) => {
        const targetKey = pairs[pairs.indexOf(key) + rowOffset];
        if (!targetKey) return;
        const row = { ...(next[targetKey] ?? {}) };
        line.forEach((cell, colOffset) => {
          const targetPeriod = period + colOffset;
          if (targetPeriod > 12) return;
          row[targetPeriod] = cell;
        });
        next[targetKey] = row;
      });
      return next;
    });
    toast.success("Pasted from clipboard");
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!pov.versionId) throw new Error("Select a version in the point of view before saving rates");
      const records: {
        tenant_id: string;
        rate_type: string;
        from_currency: string;
        to_currency: string;
        fiscal_year: number;
        period: number;
        rate: number;
        version_id: string;
      }[] = [];
      for (const key of pairs) {
        const [from, to] = key.split(">");
        for (const period of PERIODS) {
          const raw = grid[key]?.[period];
          if (raw === undefined || raw === "") continue;
          const value = parseNum(raw);
          if (value === null || value <= 0) throw new Error(`${key} period ${period}: invalid rate "${raw}"`);
          records.push({
            tenant_id: tenantId as string,
            rate_type: rateType,
            from_currency: from as string,
            to_currency: to as string,
            fiscal_year: fiscalYear,
            period,
            rate: value,
            version_id: pov.versionId,
          });
        }
      }
      if (records.length === 0) throw new Error("Nothing to save");
      const { error } = await supabase.from("fx_rate").upsert(records, {
        onConflict: "tenant_id,rate_type,from_currency,to_currency,fiscal_year,period,version_id",
      });
      if (error) throw error;
      return records.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} rate(s) saved`);
      void queryClient.invalidateQueries({ queryKey: ["fx_rate"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const importValidator = (row: CsvRow) => {
    const from = pick(row, "from_currency", "from").toUpperCase();
    const to = pick(row, "to_currency", "to").toUpperCase();
    const period = parseNum(pick(row, "period"));
    const year = parseNum(pick(row, "fiscal_year", "year")) ?? fiscalYear;
    const rate = parseNum(pick(row, "rate"));
    const type = (pick(row, "rate_type") || rateType).toUpperCase();
    const errors: string[] = [];
    if (!from || !to) errors.push("from_currency and to_currency are required");
    if (from === to) errors.push("Currency pair must differ");
    if (period === null || period < 1 || period > 12) errors.push("Period must be 1–12");
    if (rate === null || rate <= 0) errors.push("Rate must be a positive number");
    if (!RATE_TYPES.some((t) => t.value === type)) errors.push(`Unknown rate type ${type}`);
    if (!pov.versionId) errors.push("Select a version in the point of view first");
    return {
      errors,
      record: errors.length
        ? null
        : {
            rate_type: type,
            from_currency: from,
            to_currency: to,
            fiscal_year: year,
            period,
            rate,
            version_id: pov.versionId,
          },
    };
  };

  const currencyOptions = (currencies.data ?? []).map((c) => ({ value: c.code, label: c.code }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={rateType} onValueChange={setRateType}>
          <TabsList className="h-8">
            {RATE_TYPES.map((type) => (
              <TabsTrigger key={type.value} value={type.value} className="h-6 text-xs">
                {type.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Fiscal year</span>
          <Input
            type="number"
            className="h-8 w-24 text-xs"
            value={fiscalYear}
            onChange={(event) => setFiscalYear(Number(event.target.value))}
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={() => setImportOpen(true)}>
            <Upload className="mr-1 size-3.5" /> Import CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() =>
              exportCsv(
                `fx_rate_${rateType}_${fiscalYear}.csv`,
                [
                  { key: "rate_type", label: "rate_type" },
                  { key: "from_currency", label: "from_currency" },
                  { key: "to_currency", label: "to_currency" },
                  { key: "fiscal_year", label: "fiscal_year" },
                  { key: "period", label: "period" },
                  { key: "rate", label: "rate" },
                ],
                rates.data ?? [],
              )
            }
          >
            <Download className="mr-1 size-3.5" /> Export CSV
          </Button>
          <Button size="sm" className="h-8" disabled={save.isPending} onClick={() => save.mutate()}>
            Save grid
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded border p-2">
        <div className="w-28">
          <SelectField
            value={newPair.from}
            onChange={(v) => setNewPair({ ...newPair, from: v })}
            options={currencyOptions}
            placeholder="From"
          />
        </div>
        <div className="w-28">
          <SelectField
            value={newPair.to}
            onChange={(v) => setNewPair({ ...newPair, to: v })}
            options={currencyOptions}
            placeholder="To"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => {
            if (!newPair.from || !newPair.to || newPair.from === newPair.to) {
              toast.error("Pick two different currencies");
              return;
            }
            const key = `${newPair.from}>${newPair.to}`;
            if (grid[key]) {
              toast.error("Pair already in the grid");
              return;
            }
            setGrid((prev) => ({ ...prev, [key]: {} }));
            setNewPair({ from: "", to: "" });
          }}
        >
          <Plus className="mr-1 size-3.5" /> Add pair
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">
          Paste a block copied from Excel into any cell to fill the grid from that position.
        </p>
      </div>

      <div className="overflow-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="h-8 px-2 text-xs font-medium">Pair</TableHead>
              {PERIODS.map((period) => (
                <TableHead key={period} className="h-8 px-2 text-xs font-medium">
                  P{period}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pairs.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="h-16 text-center text-xs text-muted-foreground">
                  No currency pairs for {rateType.toLowerCase()} rates in {fiscalYear}. Add a pair to start.
                </TableCell>
              </TableRow>
            )}
            {pairs.map((key) => (
              <TableRow key={key}>
                <TableCell className="whitespace-nowrap px-2 py-1 text-xs font-medium">
                  {key.replace(">", " → ")}
                </TableCell>
                {PERIODS.map((period) => (
                  <TableCell key={period} className="px-1 py-1">
                    <Input
                      className="h-7 w-20 text-right text-xs tabular-nums"
                      value={grid[key]?.[period] ?? ""}
                      onChange={(event) => setCell(key, period, event.target.value)}
                      onPaste={(event) => {
                        const text = event.clipboardData.getData("text/plain");
                        if (!text.includes("\t") && !text.includes("\n")) return;
                        event.preventDefault();
                        handlePaste(key, period, text);
                      }}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CsvImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        table="fx_rate"
        title="FX Rates"
        tenantId={tenantId}
        conflictTarget="tenant_id,rate_type,from_currency,to_currency,fiscal_year,period,version_id"
        validator={importValidator}
        onImported={() => void queryClient.invalidateQueries({ queryKey: ["fx_rate"] })}
      />
    </div>
  );
}

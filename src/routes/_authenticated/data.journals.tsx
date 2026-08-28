import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Field, SelectField } from "@/components/field";
import { PageShell } from "@/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useActiveDimensions } from "@/hooks/use-active-dimensions";
import { useAuth } from "@/hooks/use-auth";
import { useMasterCodes } from "@/hooks/use-master-codes";
import { usePeriodGuard } from "@/hooks/use-period-status";
import { usePov } from "@/lib/pov-context";
import {
  buildLinePayload,
  emptyLine,
  journalDimensionColumns,
  journalTotals,
  lineAmountLc,
  POSTING_LEVELS,
  validateJournal,
  type JournalLine,
  type PostingLevel,
} from "@/lib/journal";
import { untyped, unwrap } from "@/lib/supabase-untyped";
import { supabase } from "@/integrations/supabase/client";

const TITLE = "Manual Journals";
const DESCRIPTION = "Post manual adjustments at entity level 01 or group level 30 for the selected point of view.";

export const Route = createFileRoute("/_authenticated/data/journals")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Consolidation` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: `${TITLE} | Consolidation` },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JournalsPage,
});

interface JournalDoc {
  id: string;
  doc_number: number;
  doc_type: string;
  posting_level: string;
  description: string | null;
  fiscal_year: number;
  period: number;
  is_reversed: boolean | null;
  reversed_by: string | null;
  created_at: string;
}

function JournalsPage() {
  const { appUser } = useAuth();
  const { pov } = usePov();
  const queryClient = useQueryClient();
  const dimensions = useActiveDimensions();
  const master = useMasterCodes(appUser?.tenant_id);
  const guard = usePeriodGuard(pov);

  const [postingLevel, setPostingLevel] = useState<PostingLevel>("01");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([emptyLine(), emptyLine()]);

  const columns = useMemo(() => journalDimensionColumns(dimensions.data ?? []), [dimensions.data]);
  const totals = journalTotals(lines);
  const consGroupId = postingLevel === "30" ? pov.consGroupId : null;
  const issues = validateJournal(lines, postingLevel, consGroupId);
  const blocked = guard.data?.blocked ?? false;

  const documents = useQuery({
    queryKey: ["journals", appUser?.tenant_id, pov.versionId, pov.fiscalYear, pov.period],
    enabled: Boolean(appUser && pov.versionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_header")
        .select(
          "id, doc_number, doc_type, posting_level, description, fiscal_year, period, is_reversed, reversed_by, created_at",
        )
        .eq("version_id", pov.versionId as string)
        .eq("fiscal_year", pov.fiscalYear)
        .eq("period", pov.period)
        .in("doc_type", ["MANUAL", "REVERSAL"])
        .order("doc_number", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as JournalDoc[];
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      const result = await unwrap(
        untyped.rpc<{ doc_number: number; rows_posted: number }>("post_manual_journal", {
          p_header: {
            doc_type: "MANUAL",
            posting_level: postingLevel,
            version_id: pov.versionId,
            fiscal_year: pov.fiscalYear,
            period: pov.period,
            cons_group_id: consGroupId,
            description,
            created_by: appUser?.id ?? null,
          },
          p_lines: buildLinePayload(lines, columns),
        }),
      );
      if (!result) throw new Error("Posting returned no result");
      return result;
    },
    onSuccess: (result) => {
      toast.success(`Document ${result.doc_number} posted with ${result.rows_posted} line(s)`);
      setLines([emptyLine(), emptyLine()]);
      setDescription("");
      void queryClient.invalidateQueries({ queryKey: ["journals"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reverse = useMutation({
    mutationFn: async (journalId: string) => {
      const result = await unwrap(
        untyped.rpc<{ doc_number: number; rows_posted: number }>("reverse_journal", {
          p_journal_id: journalId,
        }),
      );
      if (!result) throw new Error("Reversal returned no result");
      return result;
    },
    onSuccess: (result) => {
      toast.success(`Reversal document ${result.doc_number} created (${result.rows_posted} line(s))`);
      void queryClient.invalidateQueries({ queryKey: ["journals"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copyPrevious = useMutation({
    mutationFn: async () => {
      const previous = (documents.data ?? []).find((doc) => doc.doc_type === "MANUAL");
      if (!previous) throw new Error("No previous manual document in this point of view");
      const { data, error } = await supabase
        .from("fact_balances")
        .select(
          "amount_lc, amount_tc, transaction_currency, posting_level, entity_id, account_id, movement_id, partner_id, zdim01, zdim02, zdim03, zdim04, zdim05, zdim06, zdim07, zdim08, zdim09, zdim10",
        )
        .eq("journal_id", previous.id);
      if (error) throw error;
      return { previous, rows: data ?? [] };
    },
    onSuccess: ({ previous, rows }) => {
      const codes = master.data;
      const byId = (list: { id: string; code: string }[] | undefined, id: string | null) =>
        (id && list?.find((row) => row.id === id)?.code) || "";
      const copied: JournalLine[] = rows.map((row) => {
        const line = emptyLine();
        line.values["entity_code"] = byId(codes?.entities, row.entity_id);
        line.values["account_code"] = byId(codes?.accounts, row.account_id);
        line.values["movement_code"] = byId(codes?.movements, row.movement_id);
        line.values["partner_code"] = byId(codes?.entities, row.partner_id);
        for (const column of columns) {
          if (column.generic) {
            const generic = (row as unknown as Record<string, string | null>)[column.key];
            line.values[column.key] = generic ?? "";
          }
        }
        const amount = Number(row.amount_lc ?? 0);
        if (amount >= 0) line.debit = String(amount);
        else line.credit = String(Math.abs(amount));
        line.amountTc = row.amount_tc === null ? "" : String(row.amount_tc);
        line.transactionCurrency = row.transaction_currency ?? "";
        return line;
      });
      if (copied.length === 0) {
        toast.error("The previous document has no lines to copy");
        return;
      }
      setPostingLevel((previous.posting_level.trim() as PostingLevel) === "30" ? "30" : "01");
      setDescription(`Copy of document ${previous.doc_number}`);
      setLines(copied);
      toast.success(`Copied ${copied.length} line(s) from document ${previous.doc_number}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateLine(key: string, patch: Partial<JournalLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function updateValue(key: string, column: string, value: string) {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, values: { ...line.values, [column]: value } } : line,
      ),
    );
  }

  function optionsFor(column: (typeof columns)[number]) {
    const codes = master.data;
    if (!codes) return [];
    const list =
      column.key === "entity_code" || column.key === "partner_code"
        ? codes.entities
        : column.key === "account_code"
          ? codes.accounts
          : column.key === "movement_code"
            ? codes.movements
            : (codes.genericMembers[column.dimCode ?? ""] ?? []);
    return list.map((row) => ({ value: row.code, label: `${row.code}${row.name ? ` — ${row.name}` : ""}` }));
  }

  const canPost =
    Boolean(pov.versionId) && !blocked && totals.balanced && issues.length === 0 && !post.isPending;

  return (
    <PageShell
      title={TITLE}
      description={DESCRIPTION}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px]">
            FY {pov.fiscalYear} · P{String(pov.period).padStart(2, "0")}
          </Badge>
          <Badge variant={blocked ? "destructive" : "outline"} className="text-[11px]">
            Period {guard.data?.status ?? "…"}
          </Badge>
        </div>
      }
    >
      {!pov.versionId && (
        <Alert>
          <AlertTitle className="text-sm">Select a version</AlertTitle>
          <AlertDescription className="text-xs">
            Choose version, year and period in the point of view selector before posting a journal.
          </AlertDescription>
        </Alert>
      )}
      {blocked && (
        <Alert variant="destructive">
          <AlertTitle className="text-sm">Period {guard.data?.status}</AlertTitle>
          <AlertDescription className="text-xs">
            This point of view is closed for posting; journals and reversals are blocked.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-2 rounded border p-2 md:grid-cols-4">
        <Field label="Document type">
          <Input className="h-8 text-xs" value="MANUAL" readOnly />
        </Field>
        <Field
          label="Posting level"
          hint={postingLevel === "01" ? "Entity level — no consolidation group" : "Group level — group from POV"}
        >
          <SelectField
            value={postingLevel}
            onChange={(value) => setPostingLevel(value as PostingLevel)}
            options={POSTING_LEVELS}
          />
        </Field>
        <Field label="Point of view">
          <Input
            className="h-8 text-xs"
            readOnly
            value={
              postingLevel === "30"
                ? `${pov.fiscalYear}/${pov.period} · ${
                    master.data?.consGroups.find((g) => g.id === pov.consGroupId)?.code ?? "no group"
                  }`
                : `${pov.fiscalYear}/${pov.period} · entity level`
            }
          />
        </Field>
        <Field label="Description">
          <Input
            className="h-8 text-xs"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Adjustment narrative"
          />
        </Field>
      </div>

      <div className="overflow-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 w-10 text-xs">#</TableHead>
              {columns.map((column) => (
                <TableHead key={column.key} className="h-8 min-w-40 text-xs">
                  {column.label}
                </TableHead>
              ))}
              <TableHead className="h-8 w-28 text-right text-xs">Debit</TableHead>
              <TableHead className="h-8 w-28 text-right text-xs">Credit</TableHead>
              <TableHead className="h-8 w-28 text-right text-xs">Amount LC</TableHead>
              <TableHead className="h-8 w-28 text-right text-xs">Amount TC</TableHead>
              <TableHead className="h-8 w-16 text-xs">TC</TableHead>
              <TableHead className="h-8 w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, index) => (
              <TableRow key={line.key}>
                <TableCell className="py-1 text-xs text-muted-foreground">{index + 1}</TableCell>
                {columns.map((column) => (
                  <TableCell key={column.key} className="py-1">
                    <SelectField
                      value={line.values[column.key] || null}
                      onChange={(value) => updateValue(line.key, column.key, value)}
                      options={optionsFor(column)}
                      placeholder={column.key === "partner_code" ? "optional" : "Select…"}
                    />
                  </TableCell>
                ))}
                <TableCell className="py-1">
                  <Input
                    className="h-8 text-right font-mono text-xs"
                    value={line.debit}
                    onChange={(event) => updateLine(line.key, { debit: event.target.value })}
                  />
                </TableCell>
                <TableCell className="py-1">
                  <Input
                    className="h-8 text-right font-mono text-xs"
                    value={line.credit}
                    onChange={(event) => updateLine(line.key, { credit: event.target.value })}
                  />
                </TableCell>
                <TableCell className="py-1 text-right font-mono text-xs">
                  {lineAmountLc(line).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="py-1">
                  <Input
                    className="h-8 text-right font-mono text-xs"
                    placeholder="= LC"
                    value={line.amountTc}
                    onChange={(event) => updateLine(line.key, { amountTc: event.target.value })}
                  />
                </TableCell>
                <TableCell className="py-1">
                  <Input
                    className="h-8 text-xs uppercase"
                    maxLength={3}
                    value={line.transactionCurrency}
                    onChange={(event) => updateLine(line.key, { transactionCurrency: event.target.value })}
                  />
                </TableCell>
                <TableCell className="py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={columns.length + 1} className="py-1 text-xs font-medium">
                Totals
              </TableCell>
              <TableCell className="py-1 text-right font-mono text-xs">
                {totals.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell className="py-1 text-right font-mono text-xs">
                {totals.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell
                className={`py-1 text-right font-mono text-xs ${
                  totals.difference === 0 ? "" : "text-destructive"
                }`}
              >
                {totals.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell colSpan={3} className="py-1">
                <Badge variant={totals.balanced ? "outline" : "destructive"} className="text-[11px]">
                  {totals.balanced ? "Balanced" : `Out of balance ${totals.difference}`}
                </Badge>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-8" onClick={() => setLines((c) => [...c, emptyLine()])}>
          <Plus className="mr-1 size-3.5" /> Add line
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={copyPrevious.isPending}
          onClick={() => copyPrevious.mutate()}
        >
          <Copy className="mr-1 size-3.5" /> Copy previous document
        </Button>
        <Button size="sm" className="h-8" disabled={!canPost} onClick={() => post.mutate()}>
          {post.isPending ? "Posting…" : "Post journal"}
        </Button>
        {issues.length > 0 && (
          <span className="text-xs text-destructive">
            {issues[0]!.line > 0 ? `Line ${issues[0]!.line}: ` : ""}
            {issues[0]!.message}
            {issues.length > 1 ? ` (+${issues.length - 1} more)` : ""}
          </span>
        )}
      </div>

      <div className="overflow-auto rounded border">
        <p className="border-b px-2 py-1 text-xs font-medium">Documents in this point of view</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 text-xs">Doc</TableHead>
              <TableHead className="h-8 text-xs">Type</TableHead>
              <TableHead className="h-8 text-xs">Level</TableHead>
              <TableHead className="h-8 text-xs">Description</TableHead>
              <TableHead className="h-8 text-xs">Created</TableHead>
              <TableHead className="h-8 text-xs">Status</TableHead>
              <TableHead className="h-8 w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(documents.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-2 text-xs text-muted-foreground">
                  No manual documents posted for this point of view yet.
                </TableCell>
              </TableRow>
            )}
            {(documents.data ?? []).map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="py-1 font-mono text-xs">{doc.doc_number}</TableCell>
                <TableCell className="py-1 text-xs">{doc.doc_type}</TableCell>
                <TableCell className="py-1 text-xs">{doc.posting_level}</TableCell>
                <TableCell className="py-1 text-xs">{doc.description ?? "—"}</TableCell>
                <TableCell className="py-1 text-xs text-muted-foreground">
                  {new Date(doc.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="py-1">
                  <Badge variant={doc.is_reversed ? "destructive" : "outline"} className="text-[11px]">
                    {doc.is_reversed ? "Reversed" : "Posted"}
                  </Badge>
                </TableCell>
                <TableCell className="py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={Boolean(doc.is_reversed) || doc.doc_type === "REVERSAL" || blocked || reverse.isPending}
                    onClick={() => reverse.mutate(doc.id)}
                  >
                    <RotateCcw className="mr-1 size-3.5" /> Reverse
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}

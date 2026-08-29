import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download } from "lucide-react";

import { SelectField } from "@/components/field";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { usePov } from "@/lib/pov-context";
import { exportXlsx, money } from "@/lib/reporting";

interface AuditRow {
  journal_id: string;
  doc_number: number;
  doc_type: string;
  posting_level: string;
  fiscal_year: number;
  period: number;
  entity_code: string | null;
  cons_group_code: string | null;
  description: string | null;
  is_reversed: boolean;
  created_at: string;
  created_by_email: string | null;
  task_type: string | null;
  task_status: string | null;
  line_count: number;
  total_lc: number;
  total_gc: number;
}

interface LineRow {
  fact_id: number;
  entity_code: string;
  account_code: string;
  account_name: string;
  movement_code: string | null;
  partner_code: string | null;
  posting_level: string;
  amount_lc: number;
  amount_gc: number;
}

const DOC_TYPES = [
  "UPLOAD",
  "MANUAL",
  "BCF",
  "NETINCOME",
  "TRANSLATION",
  "IC_ELIM",
  "COI",
  "REVERSAL",
];
const LEVELS = ["00", "01", "05", "10", "20", "30"];

const TITLE = "Audit Trail | Consolidation";
const DESCRIPTION = "Every document posted, who or what wrote it, and the lines it carries.";

export const Route = createFileRoute("/_authenticated/reports/audit-trail")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditTrailPage,
});

function AuditTrailPage() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id ?? null;
  const { pov } = usePov();
  const { versionId, fiscalYear, period } = pov;

  const [docType, setDocType] = useState("");
  const [level, setLevel] = useState("");
  const [scopeToPov, setScopeToPov] = useState("POV");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const docs = useQuery({
    queryKey: [
      "report_audit_trail",
      tenantId,
      versionId,
      fiscalYear,
      period,
      docType,
      level,
      scopeToPov,
    ],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_audit_trail", {
        ...(scopeToPov === "POV" && versionId
          ? { p_version: versionId, p_year: fiscalYear, p_period: period }
          : {}),
        ...(docType ? { p_doc_type: docType } : {}),
        ...(level ? { p_posting_level: level } : {}),
        p_limit: 500,
      });
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const lines = useQuery({
    queryKey: ["report_journal_lines", expanded],
    enabled: Boolean(expanded),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_journal_lines", {
        p_journal_id: expanded as string,
      });
      if (error) throw error;
      return (data ?? []) as LineRow[];
    },
  });

  const filtered = useMemo(
    () =>
      (docs.data ?? []).filter(
        (d) =>
          !search ||
          String(d.doc_number).includes(search) ||
          (d.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (d.entity_code ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (d.created_by_email ?? "").toLowerCase().includes(search.toLowerCase()),
      ),
    [docs.data, search],
  );

  const handleExport = () => {
    exportXlsx(`audit-trail-${fiscalYear}-${period}.xlsx`, [
      {
        name: "Documents",
        columns: [
          { key: "doc_number", label: "Document" },
          { key: "doc_type", label: "Type" },
          { key: "posting_level", label: "Level" },
          { key: "fiscal_year", label: "Year" },
          { key: "period", label: "Period" },
          { key: "entity_code", label: "Entity" },
          { key: "cons_group_code", label: "Group" },
          { key: "description", label: "Description" },
          { key: "line_count", label: "Lines", numeric: true },
          { key: "total_lc", label: "Total LC", numeric: true },
          { key: "total_gc", label: "Total GC", numeric: true },
          { key: "created_by_email", label: "Created by" },
          { key: "created_at", label: "Created at" },
        ],
        rows: filtered as unknown as Record<string, unknown>[],
      },
    ]);
  };

  return (
    <PageShell
      title="Audit Trail"
      description={DESCRIPTION}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={filtered.length === 0}
          onClick={handleExport}
        >
          <Download className="mr-1 size-3.5" /> Export XLSX
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-2 rounded border p-3">
        <div className="w-40">
          <SelectField
            value={scopeToPov}
            onChange={setScopeToPov}
            options={[
              { value: "POV", label: "This point of view" },
              { value: "ALL", label: "All periods" },
            ]}
          />
        </div>
        <div className="w-40">
          <SelectField
            value={docType}
            onChange={setDocType}
            placeholder="All document types"
            options={[
              { value: "", label: "All document types" },
              ...DOC_TYPES.map((d) => ({ value: d, label: d })),
            ]}
          />
        </div>
        <div className="w-36">
          <SelectField
            value={level}
            onChange={setLevel}
            placeholder="All levels"
            options={[
              { value: "", label: "All levels" },
              ...LEVELS.map((l) => ({ value: l, label: l })),
            ]}
          />
        </div>
        <Input
          className="h-8 w-56 text-xs"
          placeholder="Search document, entity, user…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="ml-auto text-xs text-muted-foreground">{filtered.length} document(s)</p>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8 w-8" />
              <TableHead className="h-8">Doc</TableHead>
              <TableHead className="h-8">Type</TableHead>
              <TableHead className="h-8">Level</TableHead>
              <TableHead className="h-8">Period</TableHead>
              <TableHead className="h-8">Unit</TableHead>
              <TableHead className="h-8">Description</TableHead>
              <TableHead className="h-8 text-right">Lines</TableHead>
              <TableHead className="h-8 text-right">Total LC</TableHead>
              <TableHead className="h-8 text-right">Total GC</TableHead>
              <TableHead className="h-8">By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-xs text-muted-foreground">
                  {docs.isLoading ? "Loading…" : "No documents match these filters."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((d) => (
              <Fragment key={d.journal_id}>
                <TableRow
                  className={`cursor-pointer text-xs hover:bg-accent ${d.is_reversed ? "text-muted-foreground line-through" : ""}`}
                  onClick={() => setExpanded(expanded === d.journal_id ? null : d.journal_id)}
                >
                  <TableCell>
                    {expanded === d.journal_id ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">#{d.doc_number}</TableCell>
                  <TableCell>{d.doc_type}</TableCell>
                  <TableCell>{d.posting_level}</TableCell>
                  <TableCell className="tabular-nums">
                    {d.fiscal_year}/{d.period}
                  </TableCell>
                  <TableCell>{d.entity_code ?? d.cons_group_code ?? "—"}</TableCell>
                  <TableCell className="max-w-72 truncate">{d.description ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.line_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(d.total_lc)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(d.total_gc)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.created_by_email ?? d.task_type ?? "system"}
                  </TableCell>
                </TableRow>
                {expanded === d.journal_id && (
                  <TableRow>
                    <TableCell colSpan={11} className="bg-muted/30 p-0">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead className="h-7 pl-10">Entity</TableHead>
                            <TableHead className="h-7">Account</TableHead>
                            <TableHead className="h-7">Movement</TableHead>
                            <TableHead className="h-7">Partner</TableHead>
                            <TableHead className="h-7 text-right">Amount LC</TableHead>
                            <TableHead className="h-7 text-right">Amount GC</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(lines.data ?? []).length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={6}
                                className="pl-10 text-xs text-muted-foreground"
                              >
                                {lines.isLoading ? "Loading lines…" : "This document has no lines."}
                              </TableCell>
                            </TableRow>
                          )}
                          {(lines.data ?? []).map((l) => (
                            <TableRow key={l.fact_id} className="text-xs">
                              <TableCell className="pl-10">{l.entity_code}</TableCell>
                              <TableCell>
                                <span className="text-muted-foreground">{l.account_code}</span>{" "}
                                {l.account_name}
                              </TableCell>
                              <TableCell>{l.movement_code ?? "—"}</TableCell>
                              <TableCell>{l.partner_code ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(l.amount_lc)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {money(l.amount_gc)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}

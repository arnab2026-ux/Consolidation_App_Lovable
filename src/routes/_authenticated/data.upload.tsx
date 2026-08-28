import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { PageShell } from "@/components/page-shell";
import { StepFile } from "@/components/upload/step-file";
import { StepMapping } from "@/components/upload/step-mapping";
import { StepPost, type PostResult } from "@/components/upload/step-post";
import { StepValidate, type ValidationResult } from "@/components/upload/step-validate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveDimensions } from "@/hooks/use-active-dimensions";
import { useAuth } from "@/hooks/use-auth";
import { usePeriodGuard } from "@/hooks/use-period-status";
import { usePov } from "@/lib/pov-context";
import { autoMap, buildTargets, emptyMapping, type MappingState } from "@/lib/upload-mapping";
import type { ParsedFile } from "@/lib/upload-parse";

const TITLE = "Upload Trial Balance";
const DESCRIPTION = "Load a CSV or Excel trial balance, map it, validate it and post it to fact balances.";

export const Route = createFileRoute("/_authenticated/data/upload")({
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
  component: UploadWizard,
});

const STEPS = [
  { value: "file", label: "1 · File" },
  { value: "mapping", label: "2 · Mapping" },
  { value: "validate", label: "3 · Validate" },
  { value: "post", label: "4 · Post" },
] as const;

type StepValue = (typeof STEPS)[number]["value"];

function UploadWizard() {
  const { appUser } = useAuth();
  const { pov } = usePov();
  const dimensions = useActiveDimensions();
  const guard = usePeriodGuard(pov);

  const [step, setStep] = useState<StepValue>("file");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<MappingState>(emptyMapping);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [posted, setPosted] = useState<PostResult | null>(null);

  const targets = useMemo(() => buildTargets(dimensions.data ?? []), [dimensions.data]);

  useEffect(() => {
    if (!parsed) return;
    setMapping((current) =>
      Object.keys(current.columnMap).length > 0
        ? current
        : { ...current, columnMap: autoMap(parsed.columns, targets) },
    );
  }, [parsed, targets]);

  const blocked = guard.data?.blocked ?? false;

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
            Choose a version, year and period in the point of view selector before uploading.
          </AlertDescription>
        </Alert>
      )}

      {blocked && (
        <Alert variant="destructive">
          <AlertTitle className="text-sm">Period {guard.data?.status}</AlertTitle>
          <AlertDescription className="text-xs">
            This point of view is closed for posting. Reopen the period to stage, post or reverse data.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={step} onValueChange={(value) => setStep(value as StepValue)}>
        <TabsList className="h-8">
          {STEPS.map((entry) => (
            <TabsTrigger
              key={entry.value}
              value={entry.value}
              className="text-xs"
              disabled={
                (entry.value !== "file" && !parsed) ||
                (entry.value === "post" && !validation)
              }
            >
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="file" className="mt-3">
          {appUser && (
            <StepFile
              tenantId={appUser.tenant_id}
              appUserId={appUser.id}
              pov={pov}
              parsed={parsed}
              batchId={batchId}
              disabled={blocked || !pov.versionId}
              onLoaded={(file, id) => {
                setParsed(file);
                setBatchId(id);
                setMapping({ ...emptyMapping, columnMap: autoMap(file.columns, targets) });
                setValidation(null);
                setPosted(null);
              }}
              onNext={() => setStep("mapping")}
            />
          )}
        </TabsContent>

        <TabsContent value="mapping" className="mt-3">
          {appUser && parsed && (
            <StepMapping
              tenantId={appUser.tenant_id}
              parsed={parsed}
              targets={targets}
              mapping={mapping}
              onChange={setMapping}
              onBack={() => setStep("file")}
              onNext={() => setStep("validate")}
            />
          )}
        </TabsContent>

        <TabsContent value="validate" className="mt-3">
          {appUser && parsed && batchId && (
            <StepValidate
              tenantId={appUser.tenant_id}
              batchId={batchId}
              parsed={parsed}
              targets={targets}
              mapping={mapping}
              result={validation}
              onResult={(result) => {
                setValidation(result);
                setPosted(null);
              }}
              onBack={() => setStep("mapping")}
              onNext={() => setStep("post")}
              blocked={blocked}
            />
          )}
        </TabsContent>

        <TabsContent value="post" className="mt-3">
          {batchId && (
            <StepPost
              batchId={batchId}
              validation={validation}
              posted={posted}
              onPosted={setPosted}
              onReversed={() => setPosted(null)}
              onBack={() => setStep("validate")}
              blocked={blocked}
            />
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

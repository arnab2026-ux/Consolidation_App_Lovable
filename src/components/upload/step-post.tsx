import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { untyped, unwrap } from "@/lib/supabase-untyped";
import type { ValidationResult } from "@/components/upload/step-validate";

export interface PostResult {
  journal_id: string;
  doc_number: string;
  task_run_id: string;
  rows_posted: number;
}

export function StepPost({
  batchId,
  validation,
  posted,
  onPosted,
  onReversed,
  onBack,
  blocked,
}: {
  batchId: string;
  validation: ValidationResult | null;
  posted: PostResult | null;
  onPosted: (result: PostResult) => void;
  onReversed: () => void;
  onBack: () => void;
  blocked: boolean;
}) {
  const [validOnly, setValidOnly] = useState(false);

  const post = useMutation({
    mutationFn: async () => {
      const result = await unwrap(
        untyped.rpc<PostResult>("post_upload_batch", { p_batch_id: batchId, p_valid_only: validOnly }),
      );
      if (!result) throw new Error("Posting returned no result");
      return result;
    },
    onSuccess: (result) => {
      onPosted(result);
      toast.success(`Posted ${result.rows_posted} row(s) as document ${result.doc_number}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reverse = useMutation({
    mutationFn: async () => {
      const result = await unwrap(
        untyped.rpc<{ rows_deleted: number }>("reverse_upload_batch", { p_batch_id: batchId }),
      );
      return result?.rows_deleted ?? 0;
    },
    onSuccess: (rows) => {
      onReversed();
      toast.success(`Reversed — ${rows} fact row(s) removed`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const errors = validation?.error_rows ?? 0;
  const canPost = Boolean(validation) && !blocked && (errors === 0 || validOnly);

  return (
    <div className="flex flex-col gap-3">
      {!posted && (
        <div className="flex flex-col gap-3 rounded border p-3">
          <p className="text-xs text-muted-foreground">
            Posting creates an <span className="font-medium">UPLOAD</span> journal at posting level 00 and
            inserts the staged rows into fact balances for the selected point of view.
          </p>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px]">
              {validation?.valid_rows ?? 0} valid
            </Badge>
            <Badge variant={errors > 0 ? "destructive" : "outline"} className="text-[11px]">
              {errors} in error
            </Badge>
          </div>
          {errors > 0 && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={validOnly} onCheckedChange={(value) => setValidOnly(value === true)} />
              Post valid rows only ({validation?.valid_rows ?? 0} row(s))
            </label>
          )}
          <div>
            <Button size="sm" className="h-8" disabled={!canPost || post.isPending} onClick={() => post.mutate()}>
              {post.isPending ? "Posting…" : "Post to fact balances"}
            </Button>
          </div>
        </div>
      )}

      {posted && (
        <div className="flex flex-col gap-3 rounded border p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-4" /> Upload posted
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Summary label="Document number" value={posted.doc_number} />
            <Summary label="Rows posted" value={String(posted.rows_posted)} />
            <Summary label="Task run" value={posted.task_run_id.slice(0, 8)} />
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={reverse.isPending || blocked}
              onClick={() => reverse.mutate()}
            >
              <RotateCcw className="mr-1 size-3.5" />
              {reverse.isPending ? "Reversing…" : "Reverse this upload"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="h-8" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-xs">{value}</p>
    </div>
  );
}

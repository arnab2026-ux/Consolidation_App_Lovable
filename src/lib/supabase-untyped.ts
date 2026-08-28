import { supabase } from "@/integrations/supabase/client";

/**
 * Escape hatch for relations and functions that are not part of the generated
 * database types (`upload_mapping`, the upload RPCs, reporting views). Row
 * shapes are pinned by the caller through the generic parameter.
 */
export interface UntypedResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface UntypedBuilder<T> extends PromiseLike<UntypedResult<T>> {
  select(columns?: string): UntypedBuilder<T>;
  eq(column: string, value: string | number | boolean): UntypedBuilder<T>;
  in(column: string, values: readonly (string | number)[]): UntypedBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): UntypedBuilder<T>;
  limit(count: number): UntypedBuilder<T>;
  single(): UntypedBuilder<T>;
  maybeSingle(): UntypedBuilder<T>;
}

export interface UntypedFrom {
  select<T>(columns?: string): UntypedBuilder<T>;
  insert<T>(values: unknown): UntypedBuilder<T>;
  upsert<T>(values: unknown, options?: { onConflict?: string }): UntypedBuilder<T>;
  update<T>(values: unknown): UntypedBuilder<T>;
  delete<T>(): UntypedBuilder<T>;
}

export const untyped = supabase as unknown as {
  from(relation: string): UntypedFrom;
  rpc<T>(fn: string, args?: Record<string, unknown>): UntypedBuilder<T>;
};

/** Await an untyped call and throw its Postgrest error, mirroring typed usage. */
export async function unwrap<T>(builder: UntypedBuilder<T>): Promise<T | null> {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data;
}

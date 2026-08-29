import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { reportLovableError } from "./lib/lovable-error-reporting";
import { routeTree } from "./routeTree.gen";

/**
 * Every failed query and mutation surfaces once, here, rather than each call
 * site remembering to handle it. Queries had no error handling at all before
 * this: a failing RPC left a table silently empty, which on a consolidation
 * report is indistinguishable from "there is no data" and considerably worse.
 *
 * Mutations that already pass their own `onError` keep it — this only fires
 * when nothing else has.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong";
}

function report(error: unknown, context: Record<string, unknown>) {
  console.error("[query]", context, error);
  reportLovableError(error instanceof Error ? error : new Error(describe(error)), context);
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        report(error, { boundary: "react_query", queryKey: query.queryKey });
        toast.error(describe(error));
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        report(error, {
          boundary: "react_query_mutation",
          mutationKey: mutation.options.mutationKey,
        });
        // A mutation with its own onError has already told the user.
        if (!mutation.options.onError) toast.error(describe(error));
      },
    }),
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

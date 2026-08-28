import type { ReactNode } from "react";

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <PageShell title={title} description={description}>
      <div className="rounded border border-dashed p-6 text-xs text-muted-foreground">
        This screen is part of the application shell. Functionality will be implemented in a
        following step; the point of view selected in the top bar applies here.
      </div>
    </PageShell>
  );
}

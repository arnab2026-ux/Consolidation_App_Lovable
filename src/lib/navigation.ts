import {
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  Database,
  FileSpreadsheet,
  FileStack,
  GitCompareArrows,
  History,
  Layers,
  ListTree,
  Network,
  NotebookPen,
  Repeat,
  Scale,
  ScrollText,
  Table2,
  TrendingUp,
  Upload,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Setup",
    items: [
      { title: "Data Model", to: "/setup/data-model", icon: Boxes },
      { title: "Dimensions", to: "/setup/dimensions", icon: Layers },
      { title: "Hierarchies", to: "/setup/hierarchies", icon: ListTree },
      { title: "Consolidation Groups", to: "/setup/cons-groups", icon: Building2 },
      { title: "FX Rates", to: "/setup/fx-rates", icon: Coins },
    ],
  },
  {
    label: "Rules",
    items: [
      { title: "Balance Carry Forward", to: "/rules/balance-carry-forward", icon: Repeat },
      { title: "Net Income", to: "/rules/net-income", icon: TrendingUp },
      { title: "Currency Translation", to: "/rules/currency-translation", icon: GitCompareArrows },
      { title: "IC Elimination", to: "/rules/ic-elimination", icon: Network },
      { title: "Consolidation of Investments", to: "/rules/consolidation-of-investments", icon: Scale },
    ],
  },
  {
    label: "Data",
    items: [
      { title: "Upload Trial Balance", to: "/data/upload", icon: Upload },
      { title: "Manual Journals", to: "/data/journals", icon: NotebookPen },
      { title: "Data Browser", to: "/data/browser", icon: Database },
    ],
  },
  {
    label: "Process",
    items: [
      { title: "Workflow Templates", to: "/process/workflow-templates", icon: Workflow },
      { title: "Consolidation Monitor", to: "/process/monitor", icon: CalendarClock },
      { title: "Task Log", to: "/process/task-log", icon: ClipboardList },
    ],
  },
  {
    label: "Reports",
    items: [
      { title: "Trial Balance", to: "/reports/trial-balance", icon: Table2 },
      { title: "Consolidated Statements", to: "/reports/consolidated-statements", icon: FileSpreadsheet },
      { title: "IC Reconciliation", to: "/reports/ic-reconciliation", icon: FileStack },
      { title: "Audit Trail", to: "/reports/audit-trail", icon: History },
    ],
  },
];

export const allNavItems: NavItem[] = navGroups.flatMap((g) => g.items);

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return { group, item };
    }
  }
  return null;
}

export const iconAliases = { ScrollText };

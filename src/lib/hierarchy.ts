import type { Tables } from "@/types/db";

export type HierarchyRow = Tables<"dim_hierarchy">;
export type HierarchyNodeRow = Tables<"dim_hierarchy_node">;

export interface DimensionMember {
  code: string;
  name: string;
}

/** Which master table holds the members of a dimension. */
export function memberSource(dimCode: string): { table: "dim_entity" | "dim_account" | "dim_movement" | "dim_generic_member"; dimCode?: string } {
  switch (dimCode) {
    case "ENTITY":
    case "PARTNER":
      return { table: "dim_entity" };
    case "ACCOUNT":
      return { table: "dim_account" };
    case "MOVEMENT":
      return { table: "dim_movement" };
    default:
      return { table: "dim_generic_member", dimCode };
  }
}

export interface FlatNode {
  memberCode: string;
  parentMemberCode: string | null;
  depth: number;
  sign: number;
  order: number;
  id: string;
}

/** Depth-first flatten of the stored node rows, ordered by node_order then code. */
export function flattenNodes(rows: HierarchyNodeRow[]): FlatNode[] {
  const byParent = new Map<string, HierarchyNodeRow[]>();
  for (const row of rows) {
    const key = row.parent_member_code ?? "__root__";
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.node_order ?? 100) - (b.node_order ?? 100) || a.member_code.localeCompare(b.member_code));
  }

  const out: FlatNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const row of byParent.get(parent ?? "__root__") ?? []) {
      if (seen.has(row.member_code)) continue; // cycle guard
      seen.add(row.member_code);
      out.push({
        id: row.member_code,
        memberCode: row.member_code,
        parentMemberCode: row.parent_member_code,
        depth,
        sign: row.aggregation_sign ?? 1,
        order: row.node_order ?? 100,
      });
      walk(row.member_code, depth + 1);
    }
  };
  walk(null, 0);

  // Rows unreachable from the root (orphans / cycle participants) still need to be visible.
  for (const row of rows) {
    if (seen.has(row.member_code)) continue;
    out.push({
      id: row.member_code,
      memberCode: row.member_code,
      parentMemberCode: row.parent_member_code,
      depth: 0,
      sign: row.aggregation_sign ?? 1,
      order: row.node_order ?? 100,
    });
  }
  return out;
}

export function descendantCodes(rows: HierarchyNodeRow[], memberCode: string): Set<string> {
  const out = new Set<string>();
  const stack = [memberCode];
  const guard = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (guard.has(current)) continue;
    guard.add(current);
    for (const row of rows) {
      if (row.parent_member_code === current) {
        out.add(row.member_code);
        stack.push(row.member_code);
      }
    }
  }
  return out;
}

/**
 * Where a dragged row lands: the row above it decides the allowed depth range,
 * the horizontal drag offset decides the depth inside that range.
 */
export function projectDrop(
  items: FlatNode[],
  activeId: string,
  overId: string,
  offsetX: number,
  indent = 20,
): { parentMemberCode: string | null; depth: number; index: number } {
  const overIndex = items.findIndex((item) => item.id === overId);
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const reordered = arrayMove(items, activeIndex, overIndex);
  const previous = reordered[overIndex - 1];
  const next = reordered[overIndex + 1];
  const active = items[activeIndex]!;

  const dragDepth = Math.round(offsetX / indent);
  const projected = active.depth + dragDepth;
  const maxDepth = previous ? previous.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.max(minDepth, Math.min(projected, maxDepth));

  let parentMemberCode: string | null = null;
  if (depth > 0) {
    if (previous && previous.depth === depth - 1) parentMemberCode = previous.memberCode;
    else {
      const candidate = reordered
        .slice(0, overIndex)
        .reverse()
        .find((item) => item.depth === depth - 1);
      parentMemberCode = candidate?.memberCode ?? null;
    }
  }
  return { parentMemberCode, depth, index: overIndex };
}

export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const copy = list.slice();
  if (from < 0 || to < 0) return copy;
  const [item] = copy.splice(from, 1);
  if (item !== undefined) copy.splice(to, 0, item);
  return copy;
}

export interface HierarchyIssue {
  severity: "error" | "warning";
  kind: "cycle" | "orphan" | "duplicate" | "unknown-member";
  memberCode: string;
  message: string;
}

/** Cycles, orphans, duplicate members and members missing from master data. */
export function validateHierarchy(rows: HierarchyNodeRow[], knownMembers: Set<string>): HierarchyIssue[] {
  const issues: HierarchyIssue[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.member_code, (counts.get(row.member_code) ?? 0) + 1);
  for (const [code, count] of counts) {
    if (count > 1) {
      issues.push({
        severity: "error",
        kind: "duplicate",
        memberCode: code,
        message: `Member appears ${count} times in this hierarchy.`,
      });
    }
  }

  const codes = new Set(rows.map((row) => row.member_code));
  const parentOf = new Map<string, string | null>();
  for (const row of rows) parentOf.set(row.member_code, row.parent_member_code);

  for (const row of rows) {
    if (row.parent_member_code && !codes.has(row.parent_member_code)) {
      issues.push({
        severity: "error",
        kind: "orphan",
        memberCode: row.member_code,
        message: `Parent "${row.parent_member_code}" is not a node of this hierarchy.`,
      });
    }
    if (!knownMembers.has(row.member_code)) {
      issues.push({
        severity: "warning",
        kind: "unknown-member",
        memberCode: row.member_code,
        message: "Member does not exist in the dimension master data.",
      });
    }
  }

  for (const start of codes) {
    const path = new Set<string>();
    let current: string | null | undefined = start;
    while (current) {
      if (path.has(current)) {
        issues.push({
          severity: "error",
          kind: "cycle",
          memberCode: start,
          message: `Cycle detected through "${current}".`,
        });
        break;
      }
      path.add(current);
      current = parentOf.get(current) ?? null;
    }
  }

  return issues;
}

export const SIGN_LABEL: Record<number, string> = { 1: "+1", [-1]: "−1", 0: "0" };
export const SIGN_CYCLE: Record<number, number> = { 1: -1, [-1]: 0, 0: 1 };

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical, Search, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  SIGN_CYCLE,
  SIGN_LABEL,
  descendantCodes,
  flattenNodes,
  memberSource,
  projectDrop,
  validateHierarchy,
  type DimensionMember,
  type FlatNode,
  type HierarchyIssue,
  type HierarchyNodeRow,
  type HierarchyRow,
} from "@/lib/hierarchy";

const INDENT = 20;

export const nodesQueryKey = (hierarchyId: string) => ["dim_hierarchy_node", hierarchyId] as const;

export function useHierarchyNodes(hierarchyId: string | null) {
  return useQuery({
    queryKey: nodesQueryKey(hierarchyId ?? "none"),
    enabled: Boolean(hierarchyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dim_hierarchy_node")
        .select("*")
        .eq("hierarchy_id", hierarchyId as string);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDimensionMembers(dimCode: string | null) {
  return useQuery({
    queryKey: ["dimension-members", dimCode],
    enabled: Boolean(dimCode),
    queryFn: async (): Promise<DimensionMember[]> => {
      const source = memberSource(dimCode as string);
      const sel = (value: string): string => value;
      if (source.table === "dim_generic_member") {
        const { data, error } = await supabase
          .from("dim_generic_member")
          .select(sel("code, name"))
          .eq("dim_code", source.dimCode as string)
          .order("code")
          .returns<DimensionMember[]>();
        if (error) throw error;
        return data ?? [];
      }
      const { data, error } = await supabase
        .from(source.table)
        .select(sel("code, name"))
        .order("code")
        .returns<DimensionMember[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function HierarchyTreeEditor({
  hierarchy,
  tenantId,
}: {
  hierarchy: HierarchyRow;
  tenantId: string;
}) {
  const queryClient = useQueryClient();
  const nodes = useHierarchyNodes(hierarchy.id);
  const members = useDimensionMembers(hierarchy.dim_code);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [memberFilter, setMemberFilter] = useState("");
  const [issues, setIssues] = useState<HierarchyIssue[] | null>(null);

  const rows = nodes.data ?? [];
  const flat = useMemo(() => flattenNodes(rows), [rows]);
  const visible = useMemo(() => {
    const hidden = new Set<string>();
    for (const code of collapsed) for (const child of descendantCodes(rows, code)) hidden.add(child);
    return flat.filter((item) => !hidden.has(item.memberCode));
  }, [flat, collapsed, rows]);

  const assigned = new Set(rows.map((row) => row.member_code));
  const unassigned = (members.data ?? [])
    .filter((member) => !assigned.has(member.code))
    .filter((member) =>
      memberFilter.trim()
        ? `${member.code} ${member.name}`.toLowerCase().includes(memberFilter.trim().toLowerCase())
        : true,
    );
  const memberName = (code: string) => (members.data ?? []).find((m) => m.code === code)?.name ?? "";
  const hasChildren = (code: string) => rows.some((row) => row.parent_member_code === code);

  const patch = (updater: (current: HierarchyNodeRow[]) => HierarchyNodeRow[]) => {
    const key = nodesQueryKey(hierarchy.id);
    const previous = queryClient.getQueryData<HierarchyNodeRow[]>(key) ?? [];
    queryClient.setQueryData<HierarchyNodeRow[]>(key, updater(previous));
    return { key, previous };
  };

  const move = useMutation({
    mutationFn: async (vars: { memberCode: string; parentMemberCode: string | null; nodeOrder: number }) => {
      const { error } = await supabase
        .from("dim_hierarchy_node")
        .update({ parent_member_code: vars.parentMemberCode, node_order: vars.nodeOrder })
        .eq("hierarchy_id", hierarchy.id)
        .eq("member_code", vars.memberCode);
      if (error) throw error;
    },
    onMutate: (vars) =>
      patch((current) =>
        current.map((row) =>
          row.member_code === vars.memberCode
            ? { ...row, parent_member_code: vars.parentMemberCode, node_order: vars.nodeOrder }
            : row,
        ),
      ),
    onError: (error: Error, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.previous);
      toast.error(error.message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: nodesQueryKey(hierarchy.id) }),
  });

  const setSign = useMutation({
    mutationFn: async (vars: { memberCode: string; sign: number }) => {
      const { error } = await supabase
        .from("dim_hierarchy_node")
        .update({ aggregation_sign: vars.sign })
        .eq("hierarchy_id", hierarchy.id)
        .eq("member_code", vars.memberCode);
      if (error) throw error;
    },
    onMutate: (vars) =>
      patch((current) =>
        current.map((row) => (row.member_code === vars.memberCode ? { ...row, aggregation_sign: vars.sign } : row)),
      ),
    onError: (error: Error, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.previous);
      toast.error(error.message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: nodesQueryKey(hierarchy.id) }),
  });

  const addMember = useMutation({
    mutationFn: async (vars: { memberCode: string; parentMemberCode: string | null }) => {
      const siblings = rows.filter((row) => (row.parent_member_code ?? null) === vars.parentMemberCode);
      const nodeOrder = siblings.reduce((max, row) => Math.max(max, row.node_order ?? 100), 0) + 10;
      const { error } = await supabase.from("dim_hierarchy_node").insert({
        tenant_id: tenantId,
        hierarchy_id: hierarchy.id,
        member_code: vars.memberCode,
        parent_member_code: vars.parentMemberCode,
        node_order: nodeOrder,
        aggregation_sign: 1,
      });
      if (error) throw error;
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: nodesQueryKey(hierarchy.id) }),
  });

  const removeNode = useMutation({
    mutationFn: async (memberCode: string) => {
      const subtree = [memberCode, ...descendantCodes(rows, memberCode)];
      const { error } = await supabase
        .from("dim_hierarchy_node")
        .delete()
        .eq("hierarchy_id", hierarchy.id)
        .in("member_code", subtree);
      if (error) throw error;
      return subtree.length;
    },
    onMutate: (memberCode) => {
      const subtree = new Set([memberCode, ...descendantCodes(rows, memberCode)]);
      return patch((current) => current.filter((row) => !subtree.has(row.member_code)));
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.previous);
      toast.error(error.message);
    },
    onSuccess: (count) => toast.success(`Removed ${count} node(s)`),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: nodesQueryKey(hierarchy.id) }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setOffsetX(0);
  };

  const handleDragMove = (event: DragMoveEvent) => setOffsetX(event.delta.x);

  const handleDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    setActiveId(null);
    setOffsetX(0);
    if (!over) return;

    // Member dragged in from the picker.
    if (active.startsWith("member:")) {
      const memberCode = active.slice("member:".length);
      const parent = over === "root" ? null : over.startsWith("node:") ? over.slice("node:".length) : null;
      addMember.mutate({ memberCode, parentMemberCode: parent });
      return;
    }

    if (!active.startsWith("node:")) return;
    const activeCode = active.slice("node:".length);
    if (over === "root") {
      move.mutate({ memberCode: activeCode, parentMemberCode: null, nodeOrder: 999 });
      return;
    }
    if (!over.startsWith("node:")) return;
    const overCode = over.slice("node:".length);
    if (overCode === activeCode) return;
    if (descendantCodes(rows, activeCode).has(overCode)) {
      toast.error("A node cannot be moved inside its own subtree");
      return;
    }
    const drop = projectDrop(visible, activeCode, overCode, offsetX, INDENT);
    const siblings = visible.filter(
      (item) => (item.parentMemberCode ?? null) === drop.parentMemberCode && item.memberCode !== activeCode,
    );
    const overSiblingIndex = siblings.findIndex((item) => item.memberCode === overCode);
    const before = overSiblingIndex >= 0 ? siblings[overSiblingIndex] : siblings[siblings.length - 1];
    const nodeOrder = before ? (before.order ?? 100) + 5 : 10;
    move.mutate({ memberCode: activeCode, parentMemberCode: drop.parentMemberCode, nodeOrder });
  };

  const runValidation = () => {
    const known = new Set((members.data ?? []).map((member) => member.code));
    const found = validateHierarchy(rows, known);
    setIssues(found);
    if (found.length === 0) toast.success("Hierarchy is valid");
    else toast.error(`${found.length} issue(s) found`);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {hierarchy.hierarchy_code} · {rows.length} node(s) · drag rows to nest or reorder, drag left/right to
              change level
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={runValidation}>
              Validate hierarchy
            </Button>
          </div>

          <RootDropZone />

          <div className="rounded border">
            {visible.length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">
                No nodes yet. Drag members from the picker on the right.
              </p>
            )}
            {visible.map((item) => (
              <TreeRow
                key={item.id}
                item={item}
                name={memberName(item.memberCode)}
                collapsed={collapsed.has(item.memberCode)}
                hasChildren={hasChildren(item.memberCode)}
                onToggleCollapse={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.memberCode)) next.delete(item.memberCode);
                    else next.add(item.memberCode);
                    return next;
                  })
                }
                onToggleSign={() => setSign.mutate({ memberCode: item.memberCode, sign: SIGN_CYCLE[item.sign] ?? 1 })}
                onRemove={() => removeNode.mutate(item.memberCode)}
              />
            ))}
          </div>

          {issues !== null && <IssuePanel issues={issues} />}
        </div>

        <MemberPicker
          members={unassigned}
          filter={memberFilter}
          onFilterChange={setMemberFilter}
          loading={members.isLoading}
        />
      </div>

      <DragOverlay>
        {activeId && (
          <div className="rounded border bg-background px-2 py-1 text-xs shadow">
            {activeId.replace(/^(node|member):/, "")}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function RootDropZone() {
  const { setNodeRef, isOver } = useDroppableRef("root");
  return (
    <div
      ref={setNodeRef}
      className={`rounded border border-dashed px-3 py-2 text-[11px] ${
        isOver ? "border-foreground bg-muted" : "text-muted-foreground"
      }`}
    >
      Drop here to place a member at the top level
    </div>
  );
}

function useDroppableRef(id: string) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return { setNodeRef, isOver };
}

function TreeRow({
  item,
  name,
  collapsed,
  hasChildren,
  onToggleCollapse,
  onToggleSign,
  onRemove,
}: {
  item: FlatNode;
  name: string;
  collapsed: boolean;
  hasChildren: boolean;
  onToggleCollapse: () => void;
  onToggleSign: () => void;
  onRemove: () => void;
}) {
  const draggableId = `node:${item.memberCode}`;
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggableRef(draggableId);
  const { setNodeRef: setDropRef, isOver } = useDroppableRef(draggableId);

  return (
    <div
      ref={setDropRef}
      className={`flex items-center gap-2 border-b px-2 py-1 last:border-b-0 ${isOver ? "bg-muted" : ""} ${
        isDragging ? "opacity-40" : ""
      }`}
      style={{ paddingLeft: 8 + item.depth * INDENT }}
    >
      <button
        ref={setDragRef}
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground"
        aria-label={`Drag ${item.memberCode}`}
      >
        <GripVertical className="size-3.5" />
      </button>
      {hasChildren ? (
        <button onClick={onToggleCollapse} aria-label="Toggle children" className="text-muted-foreground">
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      ) : (
        <span className="w-3.5" />
      )}
      <span className="font-medium">{item.memberCode}</span>
      <span className="truncate text-xs text-muted-foreground">{name}</span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-6 w-10 px-0 font-mono text-[11px]"
          onClick={onToggleSign}
          title="Aggregation sign"
        >
          {SIGN_LABEL[item.sign] ?? "+1"}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1" onClick={onRemove} aria-label={`Remove ${item.memberCode}`}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function useDraggableRef(id: string) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return { attributes, listeners, setNodeRef, isDragging };
}

function MemberPicker({
  members,
  filter,
  onFilterChange,
  loading,
}: {
  members: DimensionMember[];
  filter: string;
  onFilterChange: (value: string) => void;
  loading: boolean;
}) {
  return (
    <aside className="flex max-h-[70vh] flex-col gap-2 rounded border p-2">
      <div className="flex items-center gap-2">
        <Search className="size-3.5 text-muted-foreground" />
        <Input
          className="h-7 text-xs"
          placeholder="Unassigned members"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{members.length} unassigned</p>
      <div className="flex-1 overflow-auto">
        {loading && <p className="p-2 text-xs text-muted-foreground">Loading members…</p>}
        {!loading && members.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">Every member is assigned.</p>
        )}
        {members.map((member) => (
          <MemberChip key={member.code} member={member} />
        ))}
      </div>
    </aside>
  );
}

function MemberChip({ member }: { member: DimensionMember }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggableRef(`member:${member.code}`);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`mb-1 cursor-grab rounded border px-2 py-1 text-xs ${isDragging ? "opacity-40" : "bg-background"}`}
    >
      <span className="font-medium">{member.code}</span>
      <span className="ml-2 text-muted-foreground">{member.name}</span>
    </div>
  );
}

function IssuePanel({ issues }: { issues: HierarchyIssue[] }) {
  return (
    <Collapsible defaultOpen className="rounded border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium">
        <TriangleAlert className={`size-3.5 ${issues.length ? "text-destructive" : "text-muted-foreground"}`} />
        Validation · {issues.length === 0 ? "no issues" : `${issues.length} issue(s)`}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        {issues.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">No cycles, orphans or duplicate members.</p>
        )}
        {issues.map((issue, index) => (
          <div key={`${issue.kind}-${issue.memberCode}-${index}`} className="flex items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0">
            <Badge variant={issue.severity === "error" ? "destructive" : "secondary"} className="text-[10px]">
              {issue.kind}
            </Badge>
            <span className="font-medium">{issue.memberCode}</span>
            <span className="text-muted-foreground">{issue.message}</span>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

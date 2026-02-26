import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Download,
  Upload,
  Plus,
  Trash2,
  Pencil,
  UserPlus,
  GitBranch,
  Search,
  House,
  HeartHandshake,
} from "lucide-react";
import type { AppState, Family, Gender, Member, Relationship, RelationshipType } from "./types";
import { loadState, saveState } from "./lib/storage";
import {
  cleanRelationships,
  generationByCenter,
  inferTitle,
  pathToText,
  relationshipLabel,
  overrideKey,
  canonicalRelationshipKey,
} from "./lib/kinship";

type MemberDraft = {
  id: string;
  name: string;
  gender: Gender;
  birthDate: string;
  alive: boolean;
  notes: string;
  avatar: string;
  customTitle: string;
  customTitleFromId: string;
  bindTargetId: string;
  bindType: "none" | "parent_of_target" | "child_of_target" | "spouse_of_target" | "sibling_of_target";
};

type RelationDraft = {
  aId: string;
  bId: string;
  type: RelationshipType;
};

type TabKey = "home" | "family" | "member" | "relation" | "query";

type PersonNodeData = {
  memberId: string;
  name: string;
  avatar: string;
  relationTitle: string;
  isCenter: boolean;
  alive: boolean;
  gender: Gender;
};

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function createFamily(name: string): Family {
  return {
    id: uid(),
    name,
    createdAt: now(),
  };
}

function createInitialState(): AppState {
  const family = createFamily("我的家族");
  return {
    version: 1,
    families: [family],
    members: [],
    relationships: [],
    activeFamilyId: family.id,
    centerByFamily: {},
    titleOverrides: {},
  };
}

function normalizeState(raw: Partial<AppState> | null): AppState {
  const fallback = createInitialState();
  if (!raw) return fallback;

  const families = Array.isArray(raw.families) ? raw.families.filter((f) => f && f.id && f.name) : [];
  if (!families.length) return fallback;

  const familySet = new Set(families.map((f) => f.id));
  const members = Array.isArray(raw.members)
    ? raw.members.filter((m) => m && m.id && m.familyId && familySet.has(m.familyId))
    : [];

  const memberSet = new Set(members.map((m) => m.id));

  const relationships = Array.isArray(raw.relationships)
    ? cleanRelationships(
        raw.relationships.filter(
          (r) =>
            r &&
            r.id &&
            r.familyId &&
            familySet.has(r.familyId) &&
            r.aId &&
            r.bId &&
            memberSet.has(r.aId) &&
            memberSet.has(r.bId)
        )
      )
    : [];

  const activeFamilyId = familySet.has(raw.activeFamilyId ?? "") ? (raw.activeFamilyId as string) : families[0].id;

  const centerByFamily: Record<string, string> = {};
  if (raw.centerByFamily && typeof raw.centerByFamily === "object") {
    for (const [familyId, memberId] of Object.entries(raw.centerByFamily)) {
      if (familySet.has(familyId) && memberSet.has(memberId)) {
        centerByFamily[familyId] = memberId;
      }
    }
  }

  const titleOverrides: Record<string, string> = {};
  if (raw.titleOverrides && typeof raw.titleOverrides === "object") {
    for (const [k, v] of Object.entries(raw.titleOverrides)) {
      if (typeof v === "string" && v.trim()) {
        titleOverrides[k] = v.trim();
      }
    }
  }

  return {
    version: 1,
    families,
    members,
    relationships,
    activeFamilyId,
    centerByFamily,
    titleOverrides,
  };
}

function readImageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_AVATAR_SIZE) {
      reject(new Error("图片超过 5MB 限制"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function defaultAvatar(gender: Gender): string {
  if (gender === "male") {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='100%25' height='100%25' fill='%23dbeafe'/%3E%3Ccircle cx='36' cy='26' r='12' fill='%232563eb'/%3E%3Crect x='18' y='40' width='36' height='20' rx='10' fill='%232563eb'/%3E%3C/svg%3E";
  }
  if (gender === "female") {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='100%25' height='100%25' fill='%23fce7f3'/%3E%3Ccircle cx='36' cy='26' r='12' fill='%23db2777'/%3E%3Crect x='18' y='40' width='36' height='20' rx='10' fill='%23db2777'/%3E%3C/svg%3E";
  }
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='100%25' height='100%25' fill='%23f3e8dc'/%3E%3Ccircle cx='36' cy='26' r='12' fill='%237f6249'/%3E%3Crect x='18' y='40' width='36' height='20' rx='10' fill='%237f6249'/%3E%3C/svg%3E";
}

function emptyMemberDraft(): MemberDraft {
  return {
    id: "",
    name: "",
    gender: "male",
    birthDate: "",
    alive: true,
    notes: "",
    avatar: "",
    customTitle: "",
    customTitleFromId: "",
    bindTargetId: "",
    bindType: "none",
  };
}

function avatarRingClass(gender: Gender) {
  if (gender === "male") return "border-blue-300 bg-blue-50";
  if (gender === "female") return "border-pink-300 bg-pink-50";
  return "border-amber-200 bg-amber-50";
}

function PersonNode({ data }: NodeProps<PersonNodeData>) {
  const cardClass = !data.alive
    ? "border-slate-300 bg-slate-100"
    : data.isCenter
      ? "border-pine-500 bg-emerald-50"
      : "border-orange-200 bg-white";
  const textClass = data.alive ? "text-amber-900" : "text-slate-700";
  const subTextClass = data.alive ? "text-amber-700" : "text-slate-600";

  return (
    <div className={`w-[220px] max-w-[220px] rounded-2xl border px-3 py-2 shadow-card ${cardClass}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-orange-400" />
      <div className="flex items-center gap-2">
        <img
          src={data.avatar}
          alt={data.name}
          className={`h-10 w-10 rounded-full border object-cover ${avatarRingClass(data.gender)}`}
        />
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${textClass}`}>{data.name}</p>
          <p className={`truncate text-xs ${subTextClass}`}>{data.alive ? "在世" : "已故"}</p>
        </div>
      </div>
      <p
        className={`mt-2 truncate whitespace-nowrap rounded-lg px-2 py-1 text-xs ${
          data.alive ? "bg-amber-50 text-amber-700" : "bg-slate-200 text-slate-700"
        }`}
      >
        {data.relationTitle}
      </p>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-orange-400" />
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("home");

  const [familyName, setFamilyName] = useState("");
  const [memberDraft, setMemberDraft] = useState<MemberDraft>(emptyMemberDraft());
  const [relationDraft, setRelationDraft] = useState<RelationDraft>({ aId: "", bId: "", type: "parent" });

  const [queryFrom, setQueryFrom] = useState("");
  const [queryTo, setQueryTo] = useState("");
  const [overrideTitle, setOverrideTitle] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void loadState().then((saved) => {
      if (!alive) return;
      setState(normalizeState(saved));
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void saveState(state);
  }, [loaded, state]);

  const activeFamily = useMemo(
    () => state.families.find((f) => f.id === state.activeFamilyId) ?? state.families[0],
    [state.activeFamilyId, state.families]
  );

  const activeFamilyId = activeFamily?.id ?? "";

  const activeMembers = useMemo(
    () => state.members.filter((m) => m.familyId === activeFamilyId),
    [state.members, activeFamilyId]
  );

  const activeMemberMap = useMemo(() => new Map(activeMembers.map((m) => [m.id, m])), [activeMembers]);

  const activeRelationships = useMemo(
    () =>
      state.relationships.filter(
        (r) => r.familyId === activeFamilyId && activeMemberMap.has(r.aId) && activeMemberMap.has(r.bId)
      ),
    [state.relationships, activeFamilyId, activeMemberMap]
  );

  const centerMemberId =
    state.centerByFamily[activeFamilyId] && activeMemberMap.has(state.centerByFamily[activeFamilyId])
      ? state.centerByFamily[activeFamilyId]
      : activeMembers[0]?.id ?? "";

  useEffect(() => {
    if (!activeFamilyId || !centerMemberId) return;
    if (state.centerByFamily[activeFamilyId] === centerMemberId) return;
    setState((prev) => ({
      ...prev,
      centerByFamily: {
        ...prev.centerByFamily,
        [activeFamilyId]: centerMemberId,
      },
    }));
  }, [activeFamilyId, centerMemberId, state.centerByFamily]);

  useEffect(() => {
    if (!activeMembers.length) {
      setQueryFrom("");
      setQueryTo("");
      setOverrideTitle("");
      return;
    }

    const defaultFrom = centerMemberId || activeMembers[0].id;
    const defaultTo = activeMembers.find((m) => m.id !== defaultFrom)?.id ?? defaultFrom;

    setQueryFrom((prev) => (prev && activeMemberMap.has(prev) ? prev : defaultFrom));
    setQueryTo((prev) => (prev && activeMemberMap.has(prev) ? prev : defaultTo));
  }, [activeMembers, centerMemberId, activeMemberMap]);

  useEffect(() => {
    if (!activeFamilyId || !queryFrom || !queryTo) {
      setOverrideTitle("");
      return;
    }
    setOverrideTitle(state.titleOverrides[overrideKey(activeFamilyId, queryFrom, queryTo)] ?? "");
  }, [activeFamilyId, queryFrom, queryTo, state.titleOverrides]);

  useEffect(() => {
    if (!memberDraft.id || !memberDraft.customTitleFromId) return;
    const key = overrideKey(activeFamilyId, memberDraft.customTitleFromId, memberDraft.id);
    const exist = state.titleOverrides[key] ?? "";
    if (exist === memberDraft.customTitle) return;
    setMemberDraft((prev) => ({ ...prev, customTitle: exist }));
  }, [
    activeFamilyId,
    memberDraft.customTitle,
    memberDraft.customTitleFromId,
    memberDraft.id,
    state.titleOverrides,
  ]);

  const queryResult = useMemo(() => {
    if (!queryFrom || !queryTo) {
      return { title: "请选择查询双方", pathText: "" };
    }

    const from = activeMemberMap.get(queryFrom);
    const to = activeMemberMap.get(queryTo);
    if (!from || !to) {
      return { title: "成员不存在", pathText: "" };
    }

    const custom = state.titleOverrides[overrideKey(activeFamilyId, queryFrom, queryTo)];
    const result = inferTitle(queryFrom, queryTo, activeMemberMap, activeRelationships);

    return {
      title: custom || result.title,
      pathText: pathToText(result.path, activeMemberMap),
      mode: custom ? "自定义" : "规则推断",
    };
  }, [activeFamilyId, activeMemberMap, activeRelationships, queryFrom, queryTo, state.titleOverrides]);

  const graphData = useMemo(() => {
    if (!centerMemberId || !activeMembers.length) {
      return { nodes: [] as Node<PersonNodeData>[], edges: [] as Edge[] };
    }

    const pairKey = (aId: string, bId: string) => [aId, bId].sort().join("<->");
    const spousePairSet = new Set<string>();
    const parentByChild = new Map<string, string[]>();
    const spouseByMember = new Map<string, string[]>();

    for (const rel of activeRelationships) {
      if (rel.type === "parent") {
        const list = parentByChild.get(rel.bId) ?? [];
        list.push(rel.aId);
        parentByChild.set(rel.bId, list);
      }
      if (rel.type === "spouse") {
        spousePairSet.add(pairKey(rel.aId, rel.bId));
        const a = spouseByMember.get(rel.aId) ?? [];
        a.push(rel.bId);
        spouseByMember.set(rel.aId, a);
        const b = spouseByMember.get(rel.bId) ?? [];
        b.push(rel.aId);
        spouseByMember.set(rel.bId, b);
      }
    }

    const levels = generationByCenter(centerMemberId, activeRelationships);
    const grouped = new Map<number, Member[]>();
    const disconnected: Member[] = [];

    for (const member of activeMembers) {
      const level = levels.get(member.id);
      if (level === undefined) {
        disconnected.push(member);
      } else {
        if (!grouped.has(level)) grouped.set(level, []);
        grouped.get(level)!.push(member);
      }
    }

    disconnected.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    const levelKeys = [...grouped.keys()].sort((a, b) => a - b);
    const minLevel = levelKeys.length ? Math.min(...levelKeys) : 0;
    const maxLevel = levelKeys.length ? Math.max(...levelKeys) : 0;

    const nodes: Node<PersonNodeData>[] = [];
    const positionedX = new Map<string, number>();

    const parentsAtLevel = (memberId: string, level: number): string[] =>
      (parentByChild.get(memberId) ?? []).filter((parentId) => levels.get(parentId) === level - 1);

    type RowUnit = {
      members: Member[];
      familyKey: string;
      anchor: number | null;
      sortBirth: string;
      sortName: string;
    };

    const buildRowUnits = (row: Member[], level: number, groupByParents: boolean): RowUnit[] => {
      const rowIds = new Set(row.map((m) => m.id));
      const sortedRow = row
        .slice()
        .sort(
          (a, b) =>
            (a.birthDate || "9999-12-31").localeCompare(b.birthDate || "9999-12-31") ||
            a.name.localeCompare(b.name, "zh-CN")
        );
      const used = new Set<string>();
      const units: RowUnit[] = [];

      for (const seed of sortedRow) {
        if (used.has(seed.id)) continue;
        used.add(seed.id);

        const spouseId = (spouseByMember.get(seed.id) ?? [])
          .filter((id) => rowIds.has(id) && !used.has(id))
          .sort((a, b) => {
            const ma = activeMemberMap.get(a);
            const mb = activeMemberMap.get(b);
            return (ma?.name || "").localeCompare(mb?.name || "", "zh-CN");
          })[0];
        const spouse = spouseId ? activeMemberMap.get(spouseId) : undefined;
        if (spouse) used.add(spouse.id);

        let members = spouse ? [seed, spouse] : [seed];
        const seedParents = groupByParents ? parentsAtLevel(seed.id, level).sort() : [];
        const spouseParents = spouse && groupByParents ? parentsAtLevel(spouse.id, level).sort() : [];

        // Keep lineage member on the left when one side has parent lineage in this row.
        if (spouse && seedParents.length === 0 && spouseParents.length > 0) {
          members = [spouse, seed];
        }

        const lineage = members[0];
        const lineageParents = groupByParents ? parentsAtLevel(lineage.id, level).sort() : [];
        const familyKey = lineageParents.length
          ? `parents:${lineageParents.join("+")}`
          : spouse
            ? `couple:${pairKey(seed.id, spouse.id)}`
            : `single:${seed.id}`;

        const anchorCandidates = lineageParents
          .map((parentId) => positionedX.get(parentId))
          .filter((x): x is number => x !== undefined);
        const anchor = anchorCandidates.length
          ? anchorCandidates.reduce((sum, x) => sum + x, 0) / anchorCandidates.length
          : null;

        units.push({
          members,
          familyKey,
          anchor,
          sortBirth: lineage.birthDate || "9999-12-31",
          sortName: lineage.name,
        });
      }
      return units;
    };

    const layoutRowUnits = (units: RowUnit[]): Map<string, number> => {
      const groupedUnits = new Map<string, RowUnit[]>();
      for (const unit of units) {
        const list = groupedUnits.get(unit.familyKey) ?? [];
        list.push(unit);
        groupedUnits.set(unit.familyKey, list);
      }

      const groups = [...groupedUnits.entries()].map(([familyKey, familyUnits]) => {
        familyUnits.sort((a, b) => a.sortBirth.localeCompare(b.sortBirth) || a.sortName.localeCompare(b.sortName, "zh-CN"));
        const anchors = familyUnits.map((u) => u.anchor).filter((v): v is number => v !== null);
        const anchor = anchors.length ? anchors.reduce((sum, x) => sum + x, 0) / anchors.length : null;
        return { familyKey, units: familyUnits, anchor, seedName: familyUnits[0]?.sortName ?? "" };
      });

      groups.sort((a, b) => {
        if (a.anchor !== null && b.anchor !== null) return a.anchor - b.anchor;
        if (a.anchor !== null) return -1;
        if (b.anchor !== null) return 1;
        return a.seedName.localeCompare(b.seedName, "zh-CN");
      });

      const xMap = new Map<string, number>();
      const nodeHalf = 110; // card width is 220px
      const coupleOffset = 130;
      const unitGap = 36;
      const groupGap = 140;

      let previousCenter: number | null = null;
      let previousHalf = 0;

      for (let g = 0; g < groups.length; g += 1) {
        const group = groups[g];
        for (let i = 0; i < group.units.length; i += 1) {
          const unit = group.units[i];
          const isCouple =
            unit.members.length === 2 && spousePairSet.has(pairKey(unit.members[0].id, unit.members[1].id));
          const unitHalf = isCouple ? coupleOffset + nodeHalf : nodeHalf;
          const desiredCenter = unit.anchor ?? (i === 0 ? group.anchor : null);

          let center = desiredCenter ?? 0;
          if (previousCenter !== null) {
            const extraGap = i === 0 ? groupGap : 0;
            const minCenter = previousCenter + previousHalf + unitHalf + unitGap + extraGap;
            center = desiredCenter === null ? minCenter : Math.max(minCenter, desiredCenter);
          }

          if (isCouple) {
            xMap.set(unit.members[0].id, center - coupleOffset);
            xMap.set(unit.members[1].id, center + coupleOffset);
          } else {
            xMap.set(unit.members[0].id, center);
          }

          previousCenter = center;
          previousHalf = unitHalf;
        }
      }

      const xs = [...xMap.values()];
      const shift = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
      for (const [id, x] of xMap.entries()) {
        xMap.set(id, x - shift);
      }
      return xMap;
    };

    for (const level of levelKeys) {
      const row = grouped.get(level)!;
      const y = (level - minLevel) * 195 + 32;
      const rowX = layoutRowUnits(buildRowUnits(row, level, true));

      row.forEach((member) => {
        const x = rowX.get(member.id) ?? 0;
        positionedX.set(member.id, x);
        const custom = state.titleOverrides[overrideKey(activeFamilyId, centerMemberId, member.id)];
        const relation = member.id === centerMemberId
          ? "中心视角"
          : custom || inferTitle(centerMemberId, member.id, activeMemberMap, activeRelationships).title;

        nodes.push({
          id: member.id,
          type: "person",
          position: { x, y },
          data: {
            memberId: member.id,
            name: member.name,
            avatar: member.avatar || defaultAvatar(member.gender),
            relationTitle: relation,
            isCenter: member.id === centerMemberId,
            alive: member.alive,
            gender: member.gender,
          },
        });
      });
    }

    if (disconnected.length) {
      const y = (maxLevel - minLevel + 2.1) * 195 + 32;
      const xMap = layoutRowUnits(buildRowUnits(disconnected, maxLevel + 9, false));

      disconnected.forEach((member) => {
        const x = xMap.get(member.id) ?? 0;
        nodes.push({
          id: member.id,
          type: "person",
          position: { x, y },
          data: {
            memberId: member.id,
            name: member.name,
            avatar: member.avatar || defaultAvatar(member.gender),
            relationTitle: "未连接分支",
            isCenter: false,
            alive: member.alive,
            gender: member.gender,
          },
        });
      });
    }

    const edges: Edge[] = activeRelationships.map((rel) => {
      const base = {
        id: rel.id,
        source: rel.aId,
        target: rel.bId,
        animated: false,
      } as Edge;

      if (rel.type === "parent") {
        return {
          ...base,
          style: { stroke: "#c9732f", strokeWidth: 2.2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#c9732f" },
          type: "default",
        };
      }

      if (rel.type === "spouse") {
        return {
          ...base,
          style: { stroke: "#167a6e", strokeWidth: 2, strokeDasharray: "5 4" },
          type: "straight",
        };
      }

      return {
        ...base,
        style: { stroke: "#d97706", strokeWidth: 2, strokeDasharray: "4 3" },
        type: "straight",
      };
    });

    return { nodes, edges };
  }, [
    activeFamilyId,
    activeMemberMap,
    activeMembers,
    activeRelationships,
    centerMemberId,
    state.titleOverrides,
  ]);

  const nodeTypes = useMemo(() => ({ person: PersonNode }), []);

  function upsertMember() {
    const name = memberDraft.name.trim();
    if (!name) {
      window.alert("请输入成员姓名");
      return;
    }

    if (!activeFamilyId) return;

    const isEdit = Boolean(memberDraft.id);
    const id = memberDraft.id || uid();

    setState((prev) => {
      let members = prev.members;
      let titleOverrides = { ...prev.titleOverrides };
      const existing = members.find((m) => m.id === id);

      if (isEdit && existing) {
        members = members.map((m) =>
          m.id === id
            ? {
                ...m,
                name,
                gender: memberDraft.gender,
                birthDate: memberDraft.birthDate || undefined,
                alive: memberDraft.alive,
                notes: memberDraft.notes.trim() || undefined,
                avatar: memberDraft.avatar || m.avatar,
              }
            : m
        );
      } else {
        members = members.concat({
          id,
          familyId: activeFamilyId,
          name,
          gender: memberDraft.gender,
          birthDate: memberDraft.birthDate || undefined,
          alive: memberDraft.alive,
          notes: memberDraft.notes.trim() || undefined,
          avatar: memberDraft.avatar || undefined,
          createdAt: now(),
        });
      }

      let relationships = prev.relationships;
      if (memberDraft.bindType !== "none" && memberDraft.bindTargetId && memberDraft.bindTargetId !== id) {
        let type: RelationshipType = "parent";
        let aId = id;
        let bId = memberDraft.bindTargetId;

        if (memberDraft.bindType === "parent_of_target") {
          type = "parent";
          aId = id;
          bId = memberDraft.bindTargetId;
        }
        if (memberDraft.bindType === "child_of_target") {
          type = "parent";
          aId = memberDraft.bindTargetId;
          bId = id;
        }
        if (memberDraft.bindType === "spouse_of_target") {
          type = "spouse";
          aId = id;
          bId = memberDraft.bindTargetId;
        }
        if (memberDraft.bindType === "sibling_of_target") {
          type = "sibling";
          aId = id;
          bId = memberDraft.bindTargetId;
        }

        const key = canonicalRelationshipKey(activeFamilyId, type, aId, bId);
        const existKeySet = new Set(
          prev.relationships.filter((r) => r.familyId === activeFamilyId).map((r) => canonicalRelationshipKey(r.familyId, r.type, r.aId, r.bId))
        );
        if (!existKeySet.has(key)) {
          relationships = prev.relationships.concat({
            id: uid(),
            familyId: activeFamilyId,
            type,
            aId,
            bId,
            createdAt: now(),
          });
        }
      }

      const centerByFamily = { ...prev.centerByFamily };
      if (!centerByFamily[activeFamilyId]) centerByFamily[activeFamilyId] = id;
      const selectedFromIdValid = members.some((m) => m.id === memberDraft.customTitleFromId);
      const fromId = selectedFromIdValid
        ? memberDraft.customTitleFromId
        : centerByFamily[activeFamilyId] || "";
      const customTitle = memberDraft.customTitle.trim();
      if (customTitle && fromId && fromId !== id) {
        titleOverrides[overrideKey(activeFamilyId, fromId, id)] = customTitle;
      }

      return {
        ...prev,
        members,
        relationships: cleanRelationships(relationships),
        centerByFamily,
        titleOverrides,
      };
    });

    setMemberDraft(emptyMemberDraft());
  }

  function editMember(memberId: string) {
    const m = activeMemberMap.get(memberId);
    if (!m) return;
    const fromId = centerMemberId || "";
    setMemberDraft({
      id: m.id,
      name: m.name,
      gender: m.gender,
      birthDate: m.birthDate || "",
      alive: m.alive,
      notes: m.notes || "",
      avatar: m.avatar || "",
      customTitle: fromId ? state.titleOverrides[overrideKey(activeFamilyId, fromId, m.id)] ?? "" : "",
      customTitleFromId: fromId,
      bindTargetId: "",
      bindType: "none",
    });
  }

  function removeMember(memberId: string) {
    const member = activeMemberMap.get(memberId);
    if (!member) return;
    if (!window.confirm(`确定删除成员「${member.name}」吗？`)) return;

    setState((prev) => {
      const members = prev.members.filter((m) => m.id !== memberId);
      const relationships = prev.relationships.filter((r) => r.aId !== memberId && r.bId !== memberId);

      const titleOverrides: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev.titleOverrides)) {
        if (k.includes(`:${memberId}->`) || k.endsWith(`->${memberId}`)) continue;
        titleOverrides[k] = v;
      }

      const centerByFamily = { ...prev.centerByFamily };
      if (centerByFamily[activeFamilyId] === memberId) {
        const next = members.find((m) => m.familyId === activeFamilyId)?.id;
        if (next) centerByFamily[activeFamilyId] = next;
        else delete centerByFamily[activeFamilyId];
      }

      return {
        ...prev,
        members,
        relationships,
        titleOverrides,
        centerByFamily,
      };
    });

    setMemberDraft((prev) => (prev.id === memberId ? emptyMemberDraft() : prev));
  }

  function addRelationship() {
    if (!relationDraft.aId || !relationDraft.bId) {
      window.alert("请选择关系双方");
      return;
    }

    if (relationDraft.aId === relationDraft.bId) {
      window.alert("同一成员不能建立关系");
      return;
    }

    const key = canonicalRelationshipKey(activeFamilyId, relationDraft.type, relationDraft.aId, relationDraft.bId);
    const exists = activeRelationships.some(
      (r) => canonicalRelationshipKey(r.familyId, r.type, r.aId, r.bId) === key
    );

    if (exists) {
      window.alert("该关系已存在");
      return;
    }

    setState((prev) => ({
      ...prev,
      relationships: cleanRelationships(
        prev.relationships.concat({
          id: uid(),
          familyId: activeFamilyId,
          type: relationDraft.type,
          aId: relationDraft.aId,
          bId: relationDraft.bId,
          createdAt: now(),
        })
      ),
    }));
  }

  function deleteRelationship(id: string) {
    setState((prev) => ({
      ...prev,
      relationships: prev.relationships.filter((r) => r.id !== id),
    }));
  }

  async function handleAvatarUpload(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("请选择图片文件");
      return;
    }

    try {
      const data = await readImageAsBase64(file);
      setMemberDraft((prev) => ({ ...prev, avatar: data }));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "图片处理失败");
    }
  }

  function addFamily() {
    const name = familyName.trim();
    if (!name) {
      window.alert("请输入家族名称");
      return;
    }

    const family = createFamily(name);
    setState((prev) => ({
      ...prev,
      families: prev.families.concat(family),
      activeFamilyId: family.id,
    }));
    setFamilyName("");
    setMemberDraft(emptyMemberDraft());
  }

  function removeActiveFamily() {
    if (!activeFamilyId) return;
    if (state.families.length <= 1) {
      window.alert("至少保留一个家族");
      return;
    }
    if (!window.confirm(`确定删除家族「${activeFamily?.name}」吗？`)) return;

    setState((prev) => {
      const families = prev.families.filter((f) => f.id !== activeFamilyId);
      const members = prev.members.filter((m) => m.familyId !== activeFamilyId);
      const relationships = prev.relationships.filter((r) => r.familyId !== activeFamilyId);
      const nextFamilyId = families[0]?.id ?? "";
      const centerByFamily = { ...prev.centerByFamily };
      delete centerByFamily[activeFamilyId];

      const titleOverrides: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev.titleOverrides)) {
        if (k.startsWith(`${activeFamilyId}:`)) continue;
        titleOverrides[k] = v;
      }

      return {
        ...prev,
        families,
        members,
        relationships,
        activeFamilyId: nextFamilyId,
        centerByFamily,
        titleOverrides,
      };
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `family-tree-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File | null) {
    if (!file) return;
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as Partial<AppState>;
      const normalized = normalizeState(parsed);
      setState(normalized);
      window.alert("导入成功");
    } catch {
      window.alert("导入失败，JSON 格式不正确");
    }
  }

  function saveOverride() {
    if (!activeFamilyId || !queryFrom || !queryTo) {
      window.alert("请先选择查询双方");
      return;
    }
    const value = overrideTitle.trim();
    if (!value) {
      window.alert("请输入称呼");
      return;
    }
    const key = overrideKey(activeFamilyId, queryFrom, queryTo);
    setState((prev) => ({
      ...prev,
      titleOverrides: {
        ...prev.titleOverrides,
        [key]: value,
      },
    }));
  }

  function clearOverride() {
    if (!activeFamilyId || !queryFrom || !queryTo) return;
    const key = overrideKey(activeFamilyId, queryFrom, queryTo);
    setState((prev) => {
      const next = { ...prev.titleOverrides };
      delete next[key];
      return {
        ...prev,
        titleOverrides: next,
      };
    });
    setOverrideTitle("");
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "home", label: "首页图谱" },
    { key: "family", label: "家族管理" },
    { key: "member", label: "成员管理" },
    { key: "relation", label: "关系管理" },
    { key: "query", label: "称呼查询" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-warm-50 via-amber-50 to-orange-100 px-3 pb-8 pt-4 md:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="rounded-2xl border border-orange-200 bg-white/85 p-4 shadow-card backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="m-0 text-2xl font-bold text-warm-700">家族族谱助手</h1>
              <p className="mt-1 text-sm text-amber-700">移动端优先 · 本地存储 · 多家族管理</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={exportJson}
                className="inline-flex items-center gap-2 rounded-xl bg-pine-500 px-3 py-2 text-sm font-medium text-white"
                type="button"
              >
                <Download size={16} /> 导出 JSON
              </button>
              <button
                onClick={() => importRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl border border-pine-500 bg-white px-3 py-2 text-sm font-medium text-pine-700"
                type="button"
              >
                <Upload size={16} /> 导入 JSON
              </button>
              <input
                ref={importRef}
                hidden
                type="file"
                accept="application/json"
                onChange={(e) => {
                  void importJson(e.target.files?.[0] ?? null);
                  e.currentTarget.value = "";
                }}
              />
            </div>
          </div>
        </header>
        <nav className="rounded-2xl border border-orange-200 bg-white p-2 shadow-card">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                  activeTab === tab.key
                    ? "bg-pine-500 text-white"
                    : "border border-orange-200 bg-amber-50 text-amber-800 hover:bg-orange-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {activeTab === "family" ? (
        <section className="rounded-2xl border border-orange-200 bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center gap-2 text-warm-700">
            <House size={18} />
            <h2 className="m-0 text-lg font-semibold">家族管理</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
              <label className="text-sm text-amber-800">
                当前家族
                <select
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                  value={activeFamilyId}
                  onChange={(e) => setState((prev) => ({ ...prev, activeFamilyId: e.target.value }))}
                >
                  {state.families.map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-amber-800">
                新建家族
                <div className="mt-1 flex gap-2">
                  <input
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                    placeholder="例如：女朋友家族"
                    className="w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={addFamily}
                    className="rounded-xl bg-warm-500 px-3 py-2 font-medium text-white"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </label>
            </div>
            <button
              type="button"
              onClick={removeActiveFamily}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              <Trash2 size={16} /> 删除当前家族
            </button>
          </div>
        </section>
        ) : null}

        {activeTab === "member" ? (
          <section className="rounded-2xl border border-orange-200 bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center gap-2 text-warm-700">
              <UserPlus size={18} />
              <h2 className="m-0 text-lg font-semibold">成员管理</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-amber-800">
                姓名
                <input
                  value={memberDraft.name}
                  onChange={(e) => setMemberDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="输入姓名"
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                />
              </label>
              <label className="text-sm text-amber-800">
                性别
                <select
                  value={memberDraft.gender}
                  onChange={(e) => setMemberDraft((prev) => ({ ...prev, gender: e.target.value as Gender }))}
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  <option value="male">男</option>
                  <option value="female">女</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <label className="text-sm text-amber-800">
                出生日期
                <input
                  type="date"
                  value={memberDraft.birthDate}
                  onChange={(e) => setMemberDraft((prev) => ({ ...prev, birthDate: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                />
              </label>
              <label className="text-sm text-amber-800">
                状态
                <select
                  value={memberDraft.alive ? "alive" : "deceased"}
                  onChange={(e) => setMemberDraft((prev) => ({ ...prev, alive: e.target.value === "alive" }))}
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  <option value="alive">在世</option>
                  <option value="deceased">已故</option>
                </select>
              </label>
              <label className="text-sm text-amber-800 md:col-span-2">
                备注
                <textarea
                  rows={2}
                  value={memberDraft.notes}
                  onChange={(e) => setMemberDraft((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="可选"
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                />
              </label>
              <label className="text-sm text-amber-800 md:col-span-2">
                头像（JPG/PNG/WebP，≤ 5MB）
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    void handleAvatarUpload(e.target.files?.[0] ?? null);
                    e.currentTarget.value = "";
                  }}
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                />
                {memberDraft.avatar ? (
                  <img
                    src={memberDraft.avatar}
                    alt="avatar preview"
                    className="mt-2 h-14 w-14 rounded-full border border-orange-200 object-cover"
                  />
                ) : null}
              </label>
              <label className="text-sm text-amber-800">
                自定义称呼（可选）
                <input
                  value={memberDraft.customTitle}
                  onChange={(e) => setMemberDraft((prev) => ({ ...prev, customTitle: e.target.value }))}
                  placeholder="例如：姥姥、幺姨"
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                />
              </label>
              <label className="text-sm text-amber-800">
                称呼视角（谁来称呼 TA）
                <select
                  value={memberDraft.customTitleFromId}
                  onChange={(e) => setMemberDraft((prev) => ({ ...prev, customTitleFromId: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  <option value="">当前中心成员</option>
                  {activeMembers.map((m) => (
                    <option value={m.id} key={`from-${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-amber-800">
                添加时绑定到成员
                <select
                  value={memberDraft.bindTargetId}
                  onChange={(e) => setMemberDraft((prev) => ({ ...prev, bindTargetId: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  <option value="">不绑定</option>
                  {activeMembers.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-amber-800">
                绑定关系
                <select
                  value={memberDraft.bindType}
                  onChange={(e) =>
                    setMemberDraft((prev) => ({
                      ...prev,
                      bindType: e.target.value as MemberDraft["bindType"],
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  <option value="none">不创建关系</option>
                  <option value="parent_of_target">Ta 的父/母</option>
                  <option value="child_of_target">Ta 的子女</option>
                  <option value="spouse_of_target">Ta 的配偶/伴侣</option>
                  <option value="sibling_of_target">Ta 的兄弟姐妹</option>
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={upsertMember}
                className="inline-flex items-center gap-2 rounded-xl bg-warm-500 px-4 py-2 font-medium text-white"
              >
                {memberDraft.id ? <Pencil size={16} /> : <Plus size={16} />}
                {memberDraft.id ? "更新成员" : "保存成员"}
              </button>
              <button
                type="button"
                onClick={() => setMemberDraft(emptyMemberDraft())}
                className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-2 text-amber-800"
              >
                重置
              </button>
            </div>

            <div className="mt-4 grid gap-2">
              {activeMembers.length ? (
                activeMembers
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
                  .map((member) => (
                    <div
                      key={member.id}
                      className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 ${
                        member.alive ? "border-orange-100 bg-amber-50" : "border-slate-300 bg-slate-100"
                      }`}
                    >
                      <img
                        src={member.avatar || defaultAvatar(member.gender)}
                        alt={member.name}
                        className={`h-10 w-10 rounded-full border object-cover ${avatarRingClass(member.gender)}`}
                      />
                      <div className="min-w-[140px] flex-1">
                        <p className={`m-0 text-sm font-semibold ${member.alive ? "text-amber-900" : "text-slate-700"}`}>
                          {member.name}
                          {member.id === centerMemberId ? "（中心）" : ""}
                        </p>
                        <p className={`m-0 text-xs ${member.alive ? "text-amber-700" : "text-slate-600"}`}>
                          {member.gender === "male" ? "男" : member.gender === "female" ? "女" : "其他"} ·
                          {member.alive ? " 在世" : " 已故"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded-lg border border-teal-300 bg-white px-2 py-1 text-xs text-teal-700"
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            centerByFamily: {
                              ...prev.centerByFamily,
                              [activeFamilyId]: member.id,
                            },
                          }))
                        }
                      >
                        设为中心
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-orange-300 bg-white px-2 py-1 text-xs text-amber-700"
                        onClick={() => editMember(member.id)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700"
                        onClick={() => removeMember(member.id)}
                      >
                        删除
                      </button>
                    </div>
                  ))
              ) : (
                <p className="text-sm text-amber-700">当前家族还没有成员。</p>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "relation" ? (
          <section className="rounded-2xl border border-orange-200 bg-white p-4 shadow-card">
              <div className="mb-3 flex items-center gap-2 text-warm-700">
                <GitBranch size={18} />
                <h2 className="m-0 text-lg font-semibold">关系管理</h2>
              </div>

              <div className="grid gap-2">
                <select
                  value={relationDraft.aId}
                  onChange={(e) => setRelationDraft((prev) => ({ ...prev, aId: e.target.value }))}
                  className="w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  <option value="">成员 A</option>
                  {activeMembers.map((m) => (
                    <option value={m.id} key={`a-${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select
                  value={relationDraft.type}
                  onChange={(e) =>
                    setRelationDraft((prev) => ({
                      ...prev,
                      type: e.target.value as RelationshipType,
                    }))
                  }
                  className="w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  <option value="parent">A 是 B 的父/母</option>
                  <option value="spouse">A 与 B 是配偶/伴侣</option>
                  <option value="sibling">A 与 B 是兄弟姐妹</option>
                </select>
                <select
                  value={relationDraft.bId}
                  onChange={(e) => setRelationDraft((prev) => ({ ...prev, bId: e.target.value }))}
                  className="w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  <option value="">成员 B</option>
                  {activeMembers.map((m) => (
                    <option value={m.id} key={`b-${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addRelationship}
                  className="rounded-xl bg-pine-500 px-3 py-2 font-medium text-white"
                >
                  新增关系
                </button>
              </div>

              <div className="mt-3 grid max-h-[220px] gap-2 overflow-auto pr-1">
                {activeRelationships.length ? (
                  activeRelationships.map((rel) => (
                    <div
                      key={rel.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-orange-100 bg-amber-50 px-2 py-2"
                    >
                      <p className="m-0 text-xs text-amber-800">{relationshipLabel(rel, activeMemberMap)}</p>
                      <button
                        type="button"
                        onClick={() => deleteRelationship(rel.id)}
                        className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700"
                      >
                        删除
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-amber-700">暂无关系。</p>
                )}
              </div>
          </section>
        ) : null}

        {activeTab === "query" ? (
          <section className="rounded-2xl border border-orange-200 bg-white p-4 shadow-card">
              <div className="mb-3 flex items-center gap-2 text-warm-700">
                <Search size={18} />
                <h2 className="m-0 text-lg font-semibold">称呼查询器</h2>
              </div>
              <div className="grid gap-2">
                <select
                  value={queryFrom}
                  onChange={(e) => setQueryFrom(e.target.value)}
                  className="w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  {activeMembers.map((m) => (
                    <option value={m.id} key={`qf-${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select
                  value={queryTo}
                  onChange={(e) => setQueryTo(e.target.value)}
                  className="w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                >
                  {activeMembers.map((m) => (
                    <option value={m.id} key={`qt-${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
                  <p className="m-0 text-sm text-amber-900">建议称呼：{queryResult.title}</p>
                  {queryResult.mode ? <p className="m-0 mt-1 text-xs text-amber-700">来源：{queryResult.mode}</p> : null}
                  <p className="m-0 mt-1 text-xs text-amber-700">关系路径：{queryResult.pathText}</p>
                </div>
                <label className="text-sm text-amber-800">
                  自定义称呼（覆盖当前方向）
                  <input
                    value={overrideTitle}
                    onChange={(e) => setOverrideTitle(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-orange-200 bg-amber-50 px-3 py-2"
                    placeholder="例如：二姨夫"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={saveOverride}
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl bg-warm-500 px-3 py-2 text-sm font-medium text-white"
                  >
                    <HeartHandshake size={16} /> 保存覆盖
                  </button>
                  <button
                    onClick={clearOverride}
                    type="button"
                    className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    清除
                  </button>
                </div>
              </div>
          </section>
        ) : null}

        {activeTab === "home" ? (
        <section className="rounded-2xl border border-orange-200 bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h2 className="m-0 text-lg font-semibold text-warm-700">族谱可视化（可拖拽/缩放）</h2>
              <p className="m-0 mt-1 text-sm text-amber-700">点击任意节点可切换中心视角并自动刷新称呼标注。</p>
            </div>
          </div>
          <div className="h-[62vh] min-h-[420px] overflow-hidden rounded-2xl border border-orange-200">
            <ReactFlow
              nodes={graphData.nodes}
              edges={graphData.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              minZoom={0.05}
              maxZoom={2}
              zoomOnScroll
              zoomOnPinch
              panOnDrag
              nodesDraggable
              onNodeClick={(_, node) => {
                setState((prev) => ({
                  ...prev,
                  centerByFamily: {
                    ...prev.centerByFamily,
                    [activeFamilyId]: node.id,
                  },
                }));
              }}
            >
              <Background gap={16} color="#f2d9bd" />
              <MiniMap
                pannable
                zoomable
                nodeStrokeWidth={2}
                nodeColor={(node) => {
                  const data = node.data as PersonNodeData | undefined;
                  if (!data) return "#f8d9b5";
                  if (!data.alive) return "#d1d5db";
                  if (data.gender === "male") return "#93c5fd";
                  if (data.gender === "female") return "#f9a8d4";
                  return "#f8d9b5";
                }}
              />
              <Controls />
            </ReactFlow>
          </div>
        </section>
        ) : null}
      </div>
    </div>
  );
}

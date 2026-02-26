import type { Member, Relationship } from "../types";

type StepKind = "parent" | "child" | "spouse" | "sibling";

export type PathStep = {
  fromId: string;
  toId: string;
  kind: StepKind;
};

type Edge = {
  toId: string;
  kind: StepKind;
};

const STEP_NAME: Record<StepKind, string> = {
  parent: "父母",
  child: "子女",
  spouse: "配偶",
  sibling: "兄弟姐妹",
};

export function buildEdges(memberId: string, relationships: Relationship[]): Edge[] {
  const out: Edge[] = [];
  for (const rel of relationships) {
    if (rel.type === "parent") {
      if (rel.aId === memberId) out.push({ toId: rel.bId, kind: "child" });
      if (rel.bId === memberId) out.push({ toId: rel.aId, kind: "parent" });
    }
    if (rel.type === "spouse") {
      if (rel.aId === memberId) out.push({ toId: rel.bId, kind: "spouse" });
      if (rel.bId === memberId) out.push({ toId: rel.aId, kind: "spouse" });
    }
    if (rel.type === "sibling") {
      if (rel.aId === memberId) out.push({ toId: rel.bId, kind: "sibling" });
      if (rel.bId === memberId) out.push({ toId: rel.aId, kind: "sibling" });
    }
  }
  return out;
}

export function findPath(
  fromId: string,
  toId: string,
  relationships: Relationship[],
  maxDepth = 6
): PathStep[] | null {
  if (fromId === toId) return [];

  const queue: { id: string; path: PathStep[] }[] = [{ id: fromId, path: [] }];
  const seen = new Set<string>([fromId]);

  while (queue.length) {
    const current = queue.shift()!;
    if (current.path.length >= maxDepth) continue;

    for (const edge of buildEdges(current.id, relationships)) {
      if (seen.has(edge.toId)) continue;
      const nextPath = current.path.concat({
        fromId: current.id,
        toId: edge.toId,
        kind: edge.kind,
      });
      if (edge.toId === toId) return nextPath;
      seen.add(edge.toId);
      queue.push({ id: edge.toId, path: nextPath });
    }
  }

  return null;
}

function gender(memberId: string, memberMap: Map<string, Member>): Member["gender"] {
  return memberMap.get(memberId)?.gender ?? "other";
}

function birth(memberId: string, memberMap: Map<string, Member>): string {
  return memberMap.get(memberId)?.birthDate ?? "";
}

function isOlder(aId: string, bId: string, memberMap: Map<string, Member>): boolean | null {
  const a = birth(aId, memberMap);
  const b = birth(bId, memberMap);
  if (!a || !b) return null;
  return a < b;
}

function parentsOf(memberId: string, relationships: Relationship[]): string[] {
  return relationships.filter((r) => r.type === "parent" && r.bId === memberId).map((r) => r.aId);
}

function parentSide(parentId: string, memberMap: Map<string, Member>): "father" | "mother" | "unknown" {
  const g = gender(parentId, memberMap);
  if (g === "male") return "father";
  if (g === "female") return "mother";
  return "unknown";
}

export function inferTitle(
  fromId: string,
  toId: string,
  memberMap: Map<string, Member>,
  relationships: Relationship[]
): { title: string; path: PathStep[] | null } {
  const path = findPath(fromId, toId, relationships, 6);
  if (path === null) {
    return { title: "未找到关系，请补充中间关系", path: null };
  }

  if (path.length === 0) {
    return { title: "自己", path };
  }

  const steps = path.map((s) => s.kind);
  const key = steps.join(",");
  const targetGender = gender(toId, memberMap);

  if (key === "parent") {
    if (targetGender === "male") return { title: "爸爸", path };
    if (targetGender === "female") return { title: "妈妈", path };
    return { title: "父母", path };
  }

  if (key === "child") {
    if (targetGender === "male") return { title: "儿子", path };
    if (targetGender === "female") return { title: "女儿", path };
    return { title: "子女", path };
  }

  if (key === "spouse") {
    if (targetGender === "male") return { title: "丈夫/男朋友", path };
    if (targetGender === "female") return { title: "妻子/女朋友", path };
    return { title: "伴侣", path };
  }

  if (key === "sibling") {
    const older = isOlder(toId, fromId, memberMap);
    if (targetGender === "male") {
      if (older === true) return { title: "哥哥", path };
      if (older === false) return { title: "弟弟", path };
      return { title: "兄弟", path };
    }
    if (targetGender === "female") {
      if (older === true) return { title: "姐姐", path };
      if (older === false) return { title: "妹妹", path };
      return { title: "姐妹", path };
    }
    return { title: "兄弟姐妹", path };
  }

  if (key === "parent,parent") {
    const firstParentId = path[0]?.toId ?? "";
    const side = parentSide(firstParentId, memberMap);
    if (side === "father") {
      if (targetGender === "male") return { title: "爷爷", path };
      if (targetGender === "female") return { title: "奶奶", path };
      return { title: "祖父母", path };
    }
    if (side === "mother") {
      if (targetGender === "male") return { title: "外公", path };
      if (targetGender === "female") return { title: "外婆", path };
      return { title: "外祖父母", path };
    }
    return { title: "祖辈", path };
  }

  if (key === "child,child") {
    if (targetGender === "male") return { title: "孙子/外孙", path };
    if (targetGender === "female") return { title: "孙女/外孙女", path };
    return { title: "孙辈", path };
  }

  if (key === "parent,sibling") {
    const firstParentId = path[0]?.toId ?? "";
    const side = parentSide(firstParentId, memberMap);
    if (side === "father") {
      if (targetGender === "male") {
        const older = isOlder(toId, firstParentId, memberMap);
        if (older === true) return { title: "伯父", path };
        if (older === false) return { title: "叔叔", path };
        return { title: "伯父/叔叔", path };
      }
      if (targetGender === "female") return { title: "姑妈", path };
    }
    if (side === "mother") {
      if (targetGender === "male") return { title: "舅舅", path };
      if (targetGender === "female") return { title: "姨妈", path };
    }
    return { title: "父母的兄弟姐妹", path };
  }

  if (key === "sibling,child") {
    const siblingGender = gender(path[0]?.toId ?? "", memberMap);
    if (siblingGender === "male") {
      if (targetGender === "male") return { title: "侄子", path };
      if (targetGender === "female") return { title: "侄女", path };
    }
    if (siblingGender === "female") {
      if (targetGender === "male") return { title: "外甥", path };
      if (targetGender === "female") return { title: "外甥女", path };
    }
    return { title: "晚辈", path };
  }

  if (key === "parent,sibling,child") {
    const firstParentId = path[0]?.toId ?? "";
    const side = parentSide(firstParentId, memberMap);
    if (side === "father") return { title: "堂亲", path };
    if (side === "mother") return { title: "表亲", path };
    return { title: "同辈亲属", path };
  }

  if (key === "spouse,parent") {
    if (targetGender === "male") return { title: "岳父/公公", path };
    if (targetGender === "female") return { title: "岳母/婆婆", path };
    return { title: "伴侣的父母", path };
  }

  if (key === "child,spouse") {
    if (targetGender === "male") return { title: "女婿", path };
    if (targetGender === "female") return { title: "儿媳", path };
    return { title: "子女配偶", path };
  }

  const readable = steps.map((s) => STEP_NAME[s]).join(" -> ");
  return { title: `关系链：${readable}`, path };
}

export function pathToText(path: PathStep[] | null, memberMap: Map<string, Member>): string {
  if (path === null) return "无路径";
  if (!path.length) return "本人";
  return path
    .map((step) => {
      const name = memberMap.get(step.toId)?.name ?? "未知";
      return `${name}[${STEP_NAME[step.kind]}]`;
    })
    .join(" -> ");
}

export function generationByCenter(
  centerId: string,
  relationships: Relationship[]
): Map<string, number> {
  const levels = new Map<string, number>([[centerId, 0]]);
  const queue = [centerId];

  while (queue.length) {
    const current = queue.shift()!;
    const level = levels.get(current)!;

    for (const edge of buildEdges(current, relationships)) {
      let nextLevel = level;
      if (edge.kind === "parent") nextLevel = level - 1;
      if (edge.kind === "child") nextLevel = level + 1;
      if (!levels.has(edge.toId)) {
        levels.set(edge.toId, nextLevel);
        queue.push(edge.toId);
      }
    }
  }

  return levels;
}

export function relationshipLabel(relationship: Relationship, memberMap: Map<string, Member>): string {
  const a = memberMap.get(relationship.aId)?.name ?? "未知";
  const b = memberMap.get(relationship.bId)?.name ?? "未知";
  if (relationship.type === "parent") return `${a} 是 ${b} 的父/母`;
  if (relationship.type === "spouse") return `${a} 与 ${b} 是配偶/伴侣`;
  return `${a} 与 ${b} 是兄弟姐妹`;
}

export function canonicalRelationshipKey(
  familyId: string,
  type: Relationship["type"],
  aId: string,
  bId: string
): string {
  if (type === "parent") return `${familyId}:${type}:${aId}->${bId}`;
  const [x, y] = [aId, bId].sort();
  return `${familyId}:${type}:${x}<->${y}`;
}

export function cleanRelationships(relationships: Relationship[]): Relationship[] {
  const seen = new Set<string>();
  return relationships.filter((rel) => {
    if (!rel.aId || !rel.bId || rel.aId === rel.bId) return false;
    const key = canonicalRelationshipKey(rel.familyId, rel.type, rel.aId, rel.bId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function overrideKey(familyId: string, fromId: string, toId: string): string {
  return `${familyId}:${fromId}->${toId}`;
}

export function relatedMemberIds(memberId: string, relationships: Relationship[]): Set<string> {
  const result = new Set<string>();
  for (const rel of relationships) {
    if (rel.aId === memberId) result.add(rel.bId);
    if (rel.bId === memberId) result.add(rel.aId);
  }
  return result;
}

export function indirectParentCount(memberId: string, relationships: Relationship[]): number {
  return parentsOf(memberId, relationships).length;
}

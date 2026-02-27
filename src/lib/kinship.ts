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

function pairKey(aId: string, bId: string): string {
  const [x, y] = [aId, bId].sort();
  return `${x}<->${y}`;
}

function withInferredSiblings(relationships: Relationship[]): Relationship[] {
  const expanded = relationships.slice();
  const siblingKeySet = new Set<string>();
  const childSetByParent = new Map<string, Set<string>>();

  for (const rel of relationships) {
    if (rel.type === "sibling") {
      siblingKeySet.add(pairKey(rel.aId, rel.bId));
      continue;
    }
    if (rel.type !== "parent") continue;
    const set = childSetByParent.get(rel.aId) ?? new Set<string>();
    set.add(rel.bId);
    childSetByParent.set(rel.aId, set);
  }

  let inferredIndex = 0;
  for (const childrenSet of childSetByParent.values()) {
    const children = [...childrenSet];
    for (let i = 0; i < children.length; i += 1) {
      for (let j = i + 1; j < children.length; j += 1) {
        const aId = children[i];
        const bId = children[j];
        if (!aId || !bId || aId === bId) continue;
        const key = pairKey(aId, bId);
        if (siblingKeySet.has(key)) continue;
        siblingKeySet.add(key);
        expanded.push({
          id: `inferred-sibling-${inferredIndex}`,
          familyId: relationships[0]?.familyId ?? "__inferred__",
          type: "sibling",
          aId,
          bId,
          createdAt: "",
        });
        inferredIndex += 1;
      }
    }
  }

  return expanded;
}

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

  const graphRelationships = withInferredSiblings(relationships);
  const queue: { id: string; path: PathStep[] }[] = [{ id: fromId, path: [] }];
  const seen = new Set<string>([fromId]);

  while (queue.length) {
    const current = queue.shift()!;
    if (current.path.length >= maxDepth) continue;

    for (const edge of buildEdges(current.id, graphRelationships)) {
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

function collateralPrefix(side: "father" | "mother" | "unknown"): "堂" | "表" | "旁系" {
  if (side === "father") return "堂";
  if (side === "mother") return "表";
  return "旁系";
}

function sameGenerationCollateralTitle(
  prefix: "堂" | "表" | "旁系",
  targetGender: Member["gender"],
  older: boolean | null
): string {
  if (prefix === "旁系") return "旁系同辈";
  if (targetGender === "male") {
    if (older === true) return `${prefix}哥`;
    if (older === false) return `${prefix}弟`;
    return `${prefix}兄弟`;
  }
  if (targetGender === "female") {
    if (older === true) return `${prefix}姐`;
    if (older === false) return `${prefix}妹`;
    return `${prefix}姐妹`;
  }
  return `${prefix}亲`;
}

function collateralDescendantTitle(
  prefix: "堂" | "表" | "旁系",
  targetGender: Member["gender"],
  depth: number
): string {
  if (prefix === "旁系") return "旁系晚辈";
  if (depth === 1) {
    if (targetGender === "male") return `${prefix}侄`;
    if (targetGender === "female") return `${prefix}侄女`;
    return `${prefix}晚辈`;
  }
  if (depth === 2) {
    if (targetGender === "male") return `${prefix}侄孙`;
    if (targetGender === "female") return `${prefix}侄孙女`;
    return `${prefix}晚辈`;
  }
  return `${prefix}晚辈`;
}

function collateralAncestorTitle(
  prefix: "堂" | "表" | "旁系",
  targetGender: Member["gender"],
  depth: number,
  older: boolean | null
): string {
  if (prefix === "旁系") return "旁系长辈";
  if (depth === 1) {
    if (targetGender === "male") {
      if (older === true) return `${prefix}伯父`;
      if (older === false) return `${prefix}叔父`;
      return `${prefix}叔伯`;
    }
    if (targetGender === "female") return `${prefix}姑妈`;
    return `${prefix}长辈`;
  }
  if (depth === 2) {
    if (targetGender === "male") return `${prefix}叔公`;
    if (targetGender === "female") return `${prefix}姑婆`;
    return `${prefix}长辈`;
  }
  return `${prefix}长辈`;
}

function collateralTitle(
  side: "father" | "mother" | "unknown",
  upCount: number,
  downCount: number,
  targetGender: Member["gender"],
  fromId: string,
  toId: string,
  memberMap: Map<string, Member>
): string {
  const prefix = collateralPrefix(side);
  const generationDelta = downCount - upCount;
  const older = isOlder(toId, fromId, memberMap);
  if (generationDelta === 0) {
    return sameGenerationCollateralTitle(prefix, targetGender, older);
  }
  if (generationDelta > 0) {
    return collateralDescendantTitle(prefix, targetGender, generationDelta);
  }
  return collateralAncestorTitle(prefix, targetGender, -generationDelta, older);
}

function collateralSpouseTitle(
  side: "father" | "mother" | "unknown",
  relatedId: string,
  targetGender: Member["gender"],
  fromId: string,
  memberMap: Map<string, Member>
): string {
  const prefix = collateralPrefix(side);
  const relatedGender = gender(relatedId, memberMap);
  const relatedOlder = isOlder(relatedId, fromId, memberMap);
  if (prefix === "旁系") return "旁系亲属的配偶";

  if (relatedGender === "female") {
    if (targetGender === "male") {
      if (relatedOlder === true) return `${prefix}姐夫`;
      if (relatedOlder === false) return `${prefix}妹夫`;
      return `${prefix}姐妹的配偶`;
    }
    return `${prefix}姐妹的伴侣`;
  }

  if (relatedGender === "male") {
    if (targetGender === "female") {
      if (relatedOlder === true) return `${prefix}嫂`;
      if (relatedOlder === false) return `${prefix}弟媳`;
      return `${prefix}兄弟的配偶`;
    }
    return `${prefix}兄弟的伴侣`;
  }

  return `${prefix}亲的配偶`;
}

function collateralGenerationSpouseTitle(
  side: "father" | "mother" | "unknown",
  upCount: number,
  downCount: number,
  relatedId: string,
  targetGender: Member["gender"],
  fromId: string,
  memberMap: Map<string, Member>
): string {
  const prefix = collateralPrefix(side);
  const generationDelta = downCount - upCount;
  const relatedGender = gender(relatedId, memberMap);

  if (generationDelta === 0) {
    return collateralSpouseTitle(side, relatedId, targetGender, fromId, memberMap);
  }

  if (generationDelta === -1) {
    if (prefix === "旁系") return "旁系长辈配偶";
    if (relatedGender === "female") return `${prefix}姑父`;
    if (relatedGender === "male") {
      const older = isOlder(relatedId, fromId, memberMap);
      if (older === true) return `${prefix}伯母`;
      if (older === false) return `${prefix}叔母`;
      return `${prefix}叔伯母`;
    }
    return `${prefix}长辈配偶`;
  }

  if (generationDelta === 1) {
    if (prefix === "旁系") return "旁系晚辈配偶";
    if (relatedGender === "female") return `${prefix}侄婿`;
    if (relatedGender === "male") return `${prefix}侄媳`;
    return `${prefix}晚辈配偶`;
  }

  if (generationDelta < -1) {
    return prefix === "旁系" ? "旁系高辈配偶" : `${prefix}高辈配偶`;
  }
  return prefix === "旁系" ? "旁系低辈配偶" : `${prefix}低辈配偶`;
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

  if (key === "parent,parent,spouse") {
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
    return { title: "祖辈配偶", path };
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
    return {
      title: collateralTitle(side, 1, 1, targetGender, fromId, toId, memberMap),
      path,
    };
  }

  if (key === "parent,spouse,sibling,child") {
    const firstParentId = path[0]?.toId ?? "";
    const firstParentGender = gender(firstParentId, memberMap);
    const side: "father" | "mother" | "unknown" =
      firstParentGender === "male" ? "mother" : firstParentGender === "female" ? "father" : "unknown";
    return {
      title: collateralTitle(side, 1, 1, targetGender, fromId, toId, memberMap),
      path,
    };
  }

  if (key === "parent,sibling,child,spouse") {
    const firstParentId = path[0]?.toId ?? "";
    const side = parentSide(firstParentId, memberMap);
    const cousinId = path[2]?.toId ?? "";
    return {
      title: collateralSpouseTitle(side, cousinId, targetGender, fromId, memberMap),
      path,
    };
  }

  if (key === "parent,spouse,sibling,child,spouse") {
    const firstParentId = path[0]?.toId ?? "";
    const firstParentGender = gender(firstParentId, memberMap);
    const side: "father" | "mother" | "unknown" =
      firstParentGender === "male" ? "mother" : firstParentGender === "female" ? "father" : "unknown";
    const cousinId = path[3]?.toId ?? "";
    return {
      title: collateralSpouseTitle(side, cousinId, targetGender, fromId, memberMap),
      path,
    };
  }

  if (key === "parent,spouse") {
    const firstParentId = path[0]?.toId ?? "";
    const firstParentGender = gender(firstParentId, memberMap);
    if (firstParentGender === "male") {
      if (targetGender === "female") return { title: "妈妈", path };
      if (targetGender === "male") return { title: "继父", path };
      return { title: "父亲的配偶", path };
    }
    if (firstParentGender === "female") {
      if (targetGender === "male") return { title: "爸爸", path };
      if (targetGender === "female") return { title: "继母", path };
      return { title: "母亲的配偶", path };
    }
    return { title: "父母的配偶", path };
  }

  if (key === "sibling,spouse") {
    const siblingId = path[0]?.toId ?? "";
    const siblingGender = gender(siblingId, memberMap);
    const siblingOlder = isOlder(siblingId, fromId, memberMap);
    if (siblingGender === "female") {
      if (targetGender === "male") {
        if (siblingOlder === true) return { title: "姐夫", path };
        if (siblingOlder === false) return { title: "妹夫", path };
        return { title: "姐妹的配偶", path };
      }
      return { title: "姐妹的伴侣", path };
    }
    if (siblingGender === "male") {
      if (targetGender === "female") {
        if (siblingOlder === true) return { title: "嫂子", path };
        if (siblingOlder === false) return { title: "弟媳", path };
        return { title: "兄弟的配偶", path };
      }
      return { title: "兄弟的伴侣", path };
    }
    return { title: "兄弟姐妹的配偶", path };
  }

  if (key === "spouse,sibling") {
    const spouseId = path[0]?.toId ?? "";
    const older = isOlder(toId, spouseId, memberMap);
    if (targetGender === "female") {
      if (older === true) return { title: "大姨子", path };
      if (older === false) return { title: "小姨子", path };
      return { title: "姨子", path };
    }
    if (targetGender === "male") {
      if (older === true) return { title: "大舅子", path };
      if (older === false) return { title: "小舅子", path };
      return { title: "舅子", path };
    }
    return { title: "配偶的兄弟姐妹", path };
  }

  if (key === "parent,spouse,parent") {
    const firstParentId = path[0]?.toId ?? "";
    const firstParentGender = gender(firstParentId, memberMap);
    if (firstParentGender === "male") {
      if (targetGender === "male") return { title: "外公", path };
      if (targetGender === "female") return { title: "外婆", path };
      return { title: "外祖父母", path };
    }
    if (firstParentGender === "female") {
      if (targetGender === "male") return { title: "爷爷", path };
      if (targetGender === "female") return { title: "奶奶", path };
      return { title: "祖父母", path };
    }
    return { title: "父母配偶的父母", path };
  }

  if (key === "parent,spouse,sibling") {
    const firstParentId = path[0]?.toId ?? "";
    const firstParentGender = gender(firstParentId, memberMap);
    const spouseId = path[1]?.toId ?? "";
    if (firstParentGender === "male") {
      if (targetGender === "male") return { title: "舅舅", path };
      if (targetGender === "female") return { title: "姨妈", path };
      return { title: "母系长辈", path };
    }
    if (firstParentGender === "female") {
      if (targetGender === "female") return { title: "姑妈", path };
      if (targetGender === "male") {
        const older = isOlder(toId, spouseId, memberMap);
        if (older === true) return { title: "伯父", path };
        if (older === false) return { title: "叔叔", path };
        return { title: "伯父/叔叔", path };
      }
      return { title: "父系长辈", path };
    }
    return { title: "父母配偶的兄弟姐妹", path };
  }

  if (key === "parent,sibling,spouse") {
    const firstParentId = path[0]?.toId ?? "";
    const side = parentSide(firstParentId, memberMap);
    const parentSiblingId = path[1]?.toId ?? "";
    const parentSiblingGender = gender(parentSiblingId, memberMap);
    if (side === "father") {
      if (parentSiblingGender === "female") return { title: "姑父", path };
      if (parentSiblingGender === "male") {
        const older = isOlder(parentSiblingId, firstParentId, memberMap);
        if (older === true) return { title: "伯母", path };
        if (older === false) return { title: "婶婶", path };
        return { title: "伯母/婶婶", path };
      }
      return { title: "父系长辈配偶", path };
    }
    if (side === "mother") {
      if (parentSiblingGender === "female") return { title: "姨父", path };
      if (parentSiblingGender === "male") return { title: "舅妈", path };
      return { title: "母系长辈配偶", path };
    }
    return { title: "父母兄弟姐妹的配偶", path };
  }

  // General collateral fallback: parent* -> sibling -> child*
  // Useful for distant relatives where exact kinship naming can vary by region.
  const siblingIndex = steps.indexOf("sibling");
  if (siblingIndex >= 0) {
    const before = steps.slice(0, siblingIndex);
    const after = steps.slice(siblingIndex + 1);
    const onlyParentBefore = before.every((step) => step === "parent");
    const onlyChildAfter = after.every((step) => step === "child");

    if (onlyParentBefore && onlyChildAfter) {
      const upCount = before.length;
      const downCount = after.length;
      const firstParentId = path.find((step) => step.kind === "parent")?.toId ?? "";
      const side = parentSide(firstParentId, memberMap);
      return {
        title: collateralTitle(side, upCount, downCount, targetGender, fromId, toId, memberMap),
        path,
      };
    }

    if (steps[steps.length - 1] === "spouse" && after.length >= 2) {
      const childSteps = after.slice(0, -1);
      const onlyChildAfterSibling = childSteps.every((step) => step === "child");
      if (onlyParentBefore && onlyChildAfterSibling) {
        const upCount = before.length;
        const downCount = childSteps.length;
        const firstParentId = path.find((step) => step.kind === "parent")?.toId ?? "";
        const side = parentSide(firstParentId, memberMap);
        const relatedId = path[path.length - 2]?.toId ?? "";
        return {
          title: collateralGenerationSpouseTitle(side, upCount, downCount, relatedId, targetGender, fromId, memberMap),
          path,
        };
      }
    }
  }

  // General collateral fallback without explicit sibling:
  // parent* -> child+ -> spouse
  // This covers cases such as 堂/表兄弟姐妹的配偶 even when sibling links are incomplete.
  if (steps[steps.length - 1] === "spouse") {
    let upCount = 0;
    while (upCount < steps.length && steps[upCount] === "parent") {
      upCount += 1;
    }
    const childSteps = steps.slice(upCount, -1);
    const onlyChildAfterParents = childSteps.length > 0 && childSteps.every((step) => step === "child");
    if (upCount > 0 && onlyChildAfterParents) {
      const firstParentId = path.find((step) => step.kind === "parent")?.toId ?? "";
      const side = parentSide(firstParentId, memberMap);
      const relatedId = path[path.length - 2]?.toId ?? "";
      return {
        title: collateralGenerationSpouseTitle(side, upCount, childSteps.length, relatedId, targetGender, fromId, memberMap),
        path,
      };
    }
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

  if (steps[steps.length - 1] === "spouse") {
    const readable = steps.slice(0, -1).map((s) => STEP_NAME[s]).join(" -> ");
    return { title: readable ? `${readable}的配偶` : "配偶", path };
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
  const graphRelationships = withInferredSiblings(relationships);
  const levels = new Map<string, number>([[centerId, 0]]);
  const queue = [centerId];

  while (queue.length) {
    const current = queue.shift()!;
    const level = levels.get(current)!;

    for (const edge of buildEdges(current, graphRelationships)) {
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

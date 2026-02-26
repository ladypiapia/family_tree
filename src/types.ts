export type Gender = "male" | "female" | "other";

export type Family = {
  id: string;
  name: string;
  createdAt: string;
};

export type Member = {
  id: string;
  familyId: string;
  name: string;
  gender: Gender;
  birthDate?: string;
  alive: boolean;
  avatar?: string;
  notes?: string;
  createdAt: string;
};

export type RelationshipType = "parent" | "spouse" | "sibling";

export type Relationship = {
  id: string;
  familyId: string;
  type: RelationshipType;
  aId: string;
  bId: string;
  createdAt: string;
};

export type AppState = {
  version: number;
  families: Family[];
  members: Member[];
  relationships: Relationship[];
  activeFamilyId: string;
  centerByFamily: Record<string, string>;
  titleOverrides: Record<string, string>;
};

// Shared (browser + server) shapes for family special dates.
export type Child = { name: string; dob: string };
export type FamilyDates = { children: Child[]; fatherDob: string; motherDob: string; anniversary: string };

export const MAX_CHILDREN = 6;
export const EMPTY_FAMILY: FamilyDates = { children: [], fatherDob: "", motherDob: "", anniversary: "" };

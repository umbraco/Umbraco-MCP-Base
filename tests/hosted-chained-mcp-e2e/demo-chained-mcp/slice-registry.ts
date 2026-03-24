export const toolSliceNames = ["read", "list", "create"] as const;
export type ToolSliceName = (typeof toolSliceNames)[number];
export const allSliceNames: readonly string[] = [...toolSliceNames, "other"];

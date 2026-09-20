export type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  ts: number;
  failed?: boolean;
  imageUrl?: string;
};

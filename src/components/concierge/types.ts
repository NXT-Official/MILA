export type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  ts: number;
  failed?: boolean;
  imageUrl?: string;
  /** The attachment the message was sent with — kept on the message so a
   * retry re-sends the same photo, not just its preview (MM-10). */
  attachment?: { file: File; preview: string } | null;
  /** The storage URL the first send uploaded to; a retry reuses it instead
   * of re-uploading the same bytes. */
  uploadedUrl?: string | null;
};

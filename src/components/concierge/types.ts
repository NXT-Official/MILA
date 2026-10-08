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
  /** Her photo once uploaded (the storage URL the first send uploaded to): a
   * retry reuses it instead of dropping it or re-uploading the same bytes. */
  uploadedUrl?: string | null;
  /** The request id this turn was sent with (shared by her message and the reply). */
  clientRequestId?: string;
  /** Shown here but not saved to her history yet (Save retries the write only). */
  unsaved?: boolean;
  /** Replaces "Not sent." when the failure has its own copy. */
  failedNote?: string;
  /** A calm note under the bubble that is not a failure. */
  note?: string;
};

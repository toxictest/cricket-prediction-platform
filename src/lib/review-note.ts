/* ==========================================================================
   REVIEW NOTES
   ==========================================================================

   Both money queues end with a human writing down what they decided. The note
   is the only explanation a member ever gets, so the bounds live here rather
   than in either service: a deposit rejection and a payout rejection should ask
   for the same thing.

   The floor is not decoration. "no" and "x" as a reason produce a support
   conversation and a resubmitted claim, which costs the reviewer more than the
   dozen characters would have.
   ========================================================================== */

export const MIN_REVIEW_NOTE_LENGTH = 3;
export const MAX_REVIEW_NOTE_LENGTH = 500;

/** Trimmed, or null when the field was absent. Length rules are the caller's, because the messages name the caller's field. */
export function trimReviewNote(value: string): string {
  return value.trim();
}

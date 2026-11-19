/* The visit's own vocabulary.

   View-model types for components that know nothing about meetings. They live
   here rather than in src/sdk/types deliberately: putting them behind the seam
   would make every presentational component import from src/sdk, inverting
   the rule the lint override protects. */

export type Role = 'doctor' | 'patient'

export interface ChatMessage {
  id: string
  who: string
  text: string
  mine: boolean
}

import { z } from 'zod'

export const BlueprintNodeSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'trigger',
    'validate',
    'fetch',
    'transform',
    'logic',
    'ai',
    'approval',
    'action',
    'log',
    'error',
  ]),
  name: z.string(),
  // Client-facing plain language.
  purpose: z.string(),
  input: z.string().optional(),
  output: z.string().optional(),
  service: z.string().optional(),
  conditions: z.string().optional(),
  errorHandling: z.string().optional(),
  retryStrategy: z.string().optional(),
  requiresApproval: z.boolean(),
  // Advisory only: shown beside the pattern-derived estimate, never summed into it or the price.
  advisoryHours: z.number().optional(),
  notes: z.string().optional(),
})
export type BlueprintNode = z.infer<typeof BlueprintNodeSchema>

export const BlueprintSchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  name: z.string(),
  nodes: z.array(BlueprintNodeSchema),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      label: z.string().optional(),
      condition: z.string().optional(),
    }),
  ),
})
export type Blueprint = z.infer<typeof BlueprintSchema>

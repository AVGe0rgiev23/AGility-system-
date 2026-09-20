import { z } from 'zod'
import { DeliveryModelSchema } from './company'
import { ProcessSchema } from './process'
import { moneyUnitCurrency, TracedValueSchema } from './traced'

// A free-string path would let a typo silently drop a client's answer.
export const MAPPABLE_PATHS = [
  'company.blendedHourlyCost',
  'company.employeeCount',
  'company.industry',
  'company.sourceOfTruth',
  'company.statedTools',
  'company.constraints.compliance',
  'company.preferredDeliveryModel',
  // Process-scoped paths resolve against the process created by this session.
  'process.frequency.occurrencesPerMonth',
  'process.frequency.minutesPerOccurrence',
  'process.frequency.peopleInvolved',
  'process.errorProfile.errorRatePercent',
  'process.errorProfile.costPerError',
  'process.revenueImpact',
  'process.roleHourlyCost',
] as const

export type MappablePath = (typeof MAPPABLE_PATHS)[number]

export const MappablePathSchema = z.enum(MAPPABLE_PATHS, {
  error: (issue) => `'${String(issue.input)}' is not a mappable path`,
})

export const ANSWER_KINDS = ['text', 'number', 'choice', 'multi', 'boolean', 'duration'] as const
export type AnswerKind = (typeof ANSWER_KINDS)[number]

// What a traced answer is recorded in: a plain unit, or money in the company's currency, per a unit
// of time when `per` is set. The field fixes it, as for every traced figure.
export type Measure = { unit: string; money?: undefined; per?: undefined } | { money: true; per?: string; unit?: undefined }

export interface MappingTarget {
  // The answer kinds that can fill the path.
  kinds: readonly AnswerKind[]
  // traced: the TracedValue lands whole. number: only its value. text: replaces. list: adds missing items.
  lands: 'traced' | 'number' | 'text' | 'list'
  measure?: Measure
  // A path holding an enum takes only these choices.
  choices?: readonly string[]
}

// How each mappable path takes an answer. A question may map only to a path its kind can fill, so no
// answer ever lands as the wrong type.
export const MAPPING_TARGETS: Readonly<Record<MappablePath, MappingTarget>> = {
  'company.blendedHourlyCost': { kinds: ['number'], lands: 'traced', measure: { money: true, per: 'hour' } },
  'company.employeeCount': { kinds: ['number'], lands: 'number', measure: { unit: 'count' } },
  'company.industry': { kinds: ['choice', 'text'], lands: 'text' },
  'company.sourceOfTruth': { kinds: ['text'], lands: 'text' },
  'company.statedTools': { kinds: ['multi'], lands: 'list' },
  'company.constraints.compliance': { kinds: ['multi'], lands: 'list' },
  'company.preferredDeliveryModel': { kinds: ['choice'], lands: 'text', choices: DeliveryModelSchema.options },
  'process.frequency.occurrencesPerMonth': { kinds: ['number'], lands: 'traced', measure: { unit: 'count/month' } },
  'process.frequency.minutesPerOccurrence': { kinds: ['duration'], lands: 'traced', measure: { unit: 'minutes' } },
  'process.frequency.peopleInvolved': { kinds: ['number'], lands: 'traced', measure: { unit: 'count' } },
  'process.errorProfile.errorRatePercent': { kinds: ['number'], lands: 'traced', measure: { unit: 'percent' } },
  'process.errorProfile.costPerError': { kinds: ['number'], lands: 'traced', measure: { money: true } },
  'process.revenueImpact': { kinds: ['choice'], lands: 'text', choices: ProcessSchema.shape.revenueImpact.options },
  'process.roleHourlyCost': { kinds: ['number'], lands: 'traced', measure: { money: true, per: 'hour' } },
}

// A duration is always recorded in minutes.
export const DURATION_UNIT = 'minutes'

// `answerId` holds the id of the question whose answer is tested; there is no answer to name while a
// question set is written.
export const ConditionSchema = z.union([
  z.object({ answerId: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ answerId: z.string(), gt: z.number() }),
  z.object({ answerId: z.string(), includes: z.string() }),
  z.object({
    get all() {
      return z.array(ConditionSchema)
    },
  }),
  z.object({
    get any() {
      return z.array(ConditionSchema)
    },
  }),
])
export type Condition = z.infer<typeof ConditionSchema>

const TRACED_KINDS: readonly AnswerKind[] = ['number', 'duration']

export const AnswerSchema = z
  .object({
    id: z.string(),
    questionId: z.string(),
    kind: z.enum(ANSWER_KINDS),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
    // Present when the answer is a figure.
    traced: TracedValueSchema.optional(),
    followUpTriggered: z.array(z.string()),
    flags: z.array(z.enum(['pain', 'blocker', 'opportunity', 'risk'])),
  })
  .superRefine((answer, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    const { kind, value } = answer
    // Every reader takes the value as its kind says, so a mismatched one would be read wrongly.
    if ((kind === 'text' || kind === 'choice') && typeof value !== 'string') issue(['value'], `A ${kind} answer is text`)
    if (TRACED_KINDS.includes(kind) && typeof value !== 'number') issue(['value'], `A ${kind} answer is a number`)
    if (kind === 'boolean' && typeof value !== 'boolean') issue(['value'], 'A boolean answer is yes or no')
    if (kind === 'multi') {
      if (!Array.isArray(value)) {
        issue(['value'], 'A multi answer is a list')
      } else {
        const seen = new Set<string>()
        for (const [index, item] of value.entries()) {
          if (item.trim() === '') issue(['value', index], 'A chosen item cannot be blank')
          else if (seen.has(item)) issue(['value', index], `'${item}' is already chosen`)
          seen.add(item)
        }
      }
    }
    // A figure the client gave carries where it came from. Value and traced value are one fact, so they
    // may never disagree.
    if (TRACED_KINDS.includes(kind)) {
      if (answer.traced === undefined) issue(['traced'], `A ${kind} answer records where the figure came from`)
      else if (answer.traced.value !== value) issue(['traced', 'value'], 'The traced value must equal the answer')
    } else if (answer.traced !== undefined) {
      issue(['traced'], 'Only a number or duration answer is traced')
    }
  })
export type Answer = z.infer<typeof AnswerSchema>

export const DiscoverySessionSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['teardown', 'discovery', 'technical', 'follow-up']),
    questionSetId: z.string(),
    heldAt: z.string(),
    attendees: z.array(z.string()),
    answers: z.array(AnswerSchema),
    // Freeform, always allowed alongside typed answers.
    rawNotes: z.string(),
    completeness: z.number().min(0).max(100),
  })
  .superRefine((session, ctx) => {
    // One answer per question, so completeness and mapping read one value.
    const seen = new Set<string>()
    for (const [index, answer] of session.answers.entries()) {
      if (seen.has(answer.questionId)) {
        ctx.addIssue({ code: 'custom', path: ['answers', index, 'questionId'], message: `Question '${answer.questionId}' is already answered in this session` })
      }
      seen.add(answer.questionId)
    }
  })
export type DiscoverySession = z.infer<typeof DiscoverySessionSchema>

export const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(ANSWER_KINDS),
  helpText: z.string().optional(),
  choices: z.array(z.string()).optional(),
  required: z.boolean(),
  showIf: ConditionSchema.optional(),
  mapsTo: MappablePathSchema.optional(),
  // What an unmapped number answer is recorded in; a mapped question takes its path's.
  unit: z.string().optional(),
  suggestsPatterns: z.array(z.string()).optional(),
})
export type Question = z.infer<typeof QuestionSchema>

const CHOICE_KINDS: readonly AnswerKind[] = ['choice', 'multi']

export const QuestionSetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: DiscoverySessionSchema.shape.kind,
    appliesTo: z.object({
      industries: z.array(z.string()).optional(),
      minEmployees: z.number().optional(),
    }),
    questions: z.array(QuestionSchema),
  })
  .superRefine((set, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    if (set.name.trim() === '') issue(['name'], 'A question set needs a name')
    const { minEmployees } = set.appliesTo
    if (minEmployees !== undefined && (!Number.isInteger(minEmployees) || minEmployees < 0)) {
      issue(['appliesTo', 'minEmployees'], 'The minimum employee count must be a whole number, at least 0')
    }

    const seenIds = new Set<string>()
    for (const [index, question] of set.questions.entries()) {
      const at = (...rest: (string | number)[]) => ['questions', index, ...rest]
      // Conditions and answers refer to questions by id.
      if (seenIds.has(question.id)) issue(at('id'), `Question id '${question.id}' is already used`)
      seenIds.add(question.id)
      if (question.text.trim() === '') issue(at('text'), 'A question needs text')

      const target = question.mapsTo === undefined ? undefined : MAPPING_TARGETS[question.mapsTo]

      if (CHOICE_KINDS.includes(question.kind)) {
        const choices = question.choices ?? []
        if (choices.length === 0) issue(at('choices'), `A ${question.kind} question needs at least one choice`)
        const seenChoices = new Set<string>()
        for (const [choiceIndex, choice] of choices.entries()) {
          if (choice.trim() === '') issue(at('choices', choiceIndex), 'A choice cannot be blank')
          else if (seenChoices.has(choice)) issue(at('choices', choiceIndex), `The choice '${choice}' is already listed`)
          else if (target?.choices !== undefined && !target.choices.includes(choice)) {
            issue(at('choices', choiceIndex), `'${choice}' cannot land on ${question.mapsTo}, which takes only ${target.choices.join(', ')}`)
          }
          seenChoices.add(choice)
        }
      } else if (question.choices !== undefined) {
        issue(at('choices'), 'Only a choice or multi question has choices')
      }

      // An answer of the wrong kind would land on its path as the wrong type.
      if (target !== undefined && !target.kinds.includes(question.kind)) {
        issue(at('mapsTo'), `A ${question.kind} question cannot map to ${question.mapsTo}, which takes a ${target.kinds.join(' or ')} answer`)
      }

      // The field fixes the unit of a figure, so there is exactly one place it comes from.
      const { unit } = question
      if (question.kind === 'number' && target === undefined) {
        if (unit === undefined || unit.trim() === '') issue(at('unit'), 'An unmapped number question needs a unit')
        else if (moneyUnitCurrency(unit) !== null) issue(at('unit'), `A money figure must map to a money path, not carry the unit '${unit}'`)
      } else if (unit !== undefined) {
        const reason =
          target !== undefined ? 'A mapped question takes its unit from its path' : question.kind === 'duration' ? `A duration is always in ${DURATION_UNIT}` : 'Only a number question has a unit'
        issue(at('unit'), reason)
      }

      if (question.showIf !== undefined) checkCondition(question.showIf, index, at('showIf'))
    }

    // A reference to a question outside the set is left to fail safe: it reads false and keeps the
    // question hidden. Every other kind of bad reference would show or hide questions wrongly.
    function checkCondition(condition: Condition, questionIndex: number, path: (string | number)[]): void {
      if ('all' in condition) {
        condition.all.forEach((child, childIndex) => checkCondition(child, questionIndex, [...path, 'all', childIndex]))
        return
      }
      if ('any' in condition) {
        condition.any.forEach((child, childIndex) => checkCondition(child, questionIndex, [...path, 'any', childIndex]))
        return
      }
      const referenced = set.questions.findIndex((candidate) => candidate.id === condition.answerId)
      const tested = set.questions[referenced]
      if (referenced < 0 || tested === undefined) return
      if (referenced >= questionIndex) {
        issue([...path, 'answerId'], `A condition may only test an earlier question, and '${condition.answerId}' is not before this one`)
        return
      }
      const kind = tested.kind
      if ('gt' in condition && !TRACED_KINDS.includes(kind)) {
        issue([...path, 'gt'], `'Greater than' tests a number or duration, and '${tested.id}' is a ${kind} question`)
      }
      if ('includes' in condition && kind !== 'multi' && kind !== 'text') {
        issue([...path, 'includes'], `'Includes' tests a multi or text question, and '${tested.id}' is a ${kind} question`)
      }
      if ('equals' in condition) {
        const { equals } = condition
        const expected = TRACED_KINDS.includes(kind) ? 'number' : kind === 'boolean' ? 'boolean' : 'string'
        if (kind === 'multi') {
          issue([...path, 'equals'], `A multi question is tested with 'includes', not 'equals'`)
        } else if (typeof equals !== expected) {
          issue([...path, 'equals'], `'${tested.id}' is a ${kind} question, so it equals a ${expected === 'string' ? 'text' : expected} value`)
        } else if (kind === 'choice' && typeof equals === 'string' && !(tested.choices ?? []).includes(equals)) {
          issue([...path, 'equals'], `'${equals}' is not one of the choices of '${tested.id}'`)
        }
      }
    }
  })
export type QuestionSet = z.infer<typeof QuestionSetSchema>

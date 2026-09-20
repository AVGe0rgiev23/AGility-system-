import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { leafPaths } from '../../../hooks/form-paths'
import { addContact, engagementFormView, initialEngagementForm, locatedPaths, setText, tabOf, type EngagementFormState } from '../../../hooks/use-engagement-form'
import { engagement, newEngagement } from '../../../schema/__fixtures__/records'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { EngagementScreen } from './engagement-view'

const ignore = () => undefined

function render(state: EngagementFormState): string {
  return renderToStaticMarkup(
    <EngagementScreen
      form={engagementFormView(state, ignore)}
      tab="contacts"
      saving={false}
      saveError={null}
      onSave={ignore}
      deletion={{ confirming: false, deleting: false, error: null, onAsk: ignore, onConfirm: ignore, onCancel: ignore }}
      industries={null}
    />,
  )
}

// A contact with every optional field set, beside the fixture's own and a new blank one.
function everyField(): EngagementFormState {
  let state = addContact(initialEngagementForm(engagement()), 'ct-2')
  for (const [field, value] of [
    ['name', 'Ivo Petrov'],
    ['role', 'Finance'],
    ['email', 'ivo@rila.bg'],
    ['phone', '+359 2 000 0000'],
    ['notes', 'Signs off budgets'],
  ] as const) {
    state = setText(state, `contacts.1.${field}`, value)
  }
  return addContact(state, 'ct-3')
}

describe('ContactsTab', () => {
  it('renders exactly the contact paths the form model places issues at', () => {
    const state = everyField()
    const contacts = [...locatedPaths(state.draft)].filter((path) => tabOf(path) === 'contacts').sort()
    expect([...renderedPaths(render(state))].sort()).toEqual(contacts)
  })

  it('gives every contact leaf but the generated id a control', () => {
    const state = everyField()
    const html = render(state)
    for (const path of leafPaths(state.draft).filter((leaf) => leaf.startsWith('contacts.') && !leaf.endsWith('.id'))) {
      expect(tagFor(html, path), path).toMatch(/^<input /)
    }
    expect(html).not.toContain('ct-2')
  })

  it('shows each contact with a checkbox for decision maker and a remove button naming them', () => {
    const html = render(everyField())
    expect(tagFor(html, 'contacts.0.name')).toContain('value="Marta Ivanova"')
    expect(tagFor(html, 'contacts.0.isDecisionMaker')).toContain('checked=""')
    expect(tagFor(html, 'contacts.1.isDecisionMaker')).not.toContain('checked')
    expect(tagFor(html, 'contacts.1.email')).toContain('type="email"')
    expect(html).toContain('aria-label="Remove Ivo Petrov"')
    expect(html).toContain('aria-label="Remove contact 3"')
    expect(html).toContain('>Add contact</button>')
  })

  it('says when there are no contacts', () => {
    expect(render(initialEngagementForm(newEngagement()))).toContain('No contacts yet')
  })

  it('writes each contact rule under its own field, and counts them on the tab', () => {
    let state = setText(initialEngagementForm(engagement()), 'contacts.0.email', 'marta@')
    state = addContact(state, 'ct-2')
    const html = render(state)
    expect(describedBy(html, 'contacts.0.email')).toContain(`<li>${escapeHtml("'marta@' is not a valid email address")}</li>`)
    expect(describedBy(html, 'contacts.1.name')).toContain('<li>A contact needs a name</li>')
    expect(html).toMatch(/Contacts<span class="num text-danger" title="2 problems on this tab"> 2<\/span>/)
  })
})

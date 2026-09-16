import type { EngagementFormView } from '../../../hooks/use-engagement-form'
import { Table } from '../../primitives/table'
import { FlagField, FormList, FormSection, RowActions, TextField } from '../form-controls'

export function ContactsTab({ form }: { form: EngagementFormView }) {
  const contacts = form.draft.contacts
  const rows = contacts.map((contact, index) => ({ contact, index, name: contact.name === '' ? `contact ${index + 1}` : contact.name }))
  const at = (index: number, field: string) => `contacts.${index}.${field}`

  return (
    <FormSection id="engagement-contacts" title="Contacts">
      <FormList form={form} path="contacts" title="People" hint="Removing a contact takes effect on Save; Discard brings it back." addLabel="Add contact" onAdd={form.addContact}>
        <div className="overflow-x-auto">
          <Table
            caption="Contacts"
            columns={[
              { id: 'name', header: 'Name', cell: ({ index, name }) => <TextField form={form} path={at(index, 'name')} label={`Name of ${name}`} layout="cell" width="w-44" /> },
              { id: 'role', header: 'Role', cell: ({ index, name }) => <TextField form={form} path={at(index, 'role')} label={`Role of ${name}`} layout="cell" width="w-40" /> },
              { id: 'email', header: 'Email', cell: ({ index, name }) => <TextField form={form} path={at(index, 'email')} label={`Email of ${name}`} type="email" layout="cell" width="w-52" /> },
              { id: 'phone', header: 'Phone', cell: ({ index, name }) => <TextField form={form} path={at(index, 'phone')} label={`Phone of ${name}`} type="tel" layout="cell" width="w-36" /> },
              {
                id: 'decision',
                header: 'Decision maker',
                cell: ({ index, name }) => <FlagField form={form} path={at(index, 'isDecisionMaker')} label={`${name} is a decision maker`} layout="cell" />,
              },
              { id: 'notes', header: 'Notes', cell: ({ index, name }) => <TextField form={form} path={at(index, 'notes')} label={`Notes on ${name}`} layout="cell" width="w-56" /> },
              {
                id: 'actions',
                header: '',
                cell: ({ index, name }) => <RowActions name={name} index={index} count={contacts.length} onRemove={() => form.removeFromList('contacts', index)} />,
              },
            ]}
            rows={rows}
            rowKey={({ index }) => String(index)}
            empty="No contacts yet"
          />
        </div>
      </FormList>
    </FormSection>
  )
}

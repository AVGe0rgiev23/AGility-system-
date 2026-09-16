import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Field, fieldDescriptionId } from './field'

describe('Field', () => {
  it('names its control with a label', () => {
    const html = renderToStaticMarkup(
      <Field label="Company name" htmlFor="company-name">
        <input id="company-name" aria-describedby={fieldDescriptionId('company-name')} />
      </Field>,
    )
    expect(html).toContain('<label for="company-name"')
    expect(html).toContain('>Company name<')
    expect(html).toContain('id="company-name-description"')
    expect(html).toContain('aria-describedby="company-name-description"')
  })

  it('marks a required field', () => {
    expect(renderToStaticMarkup(<Field label="Name" htmlFor="n" required>x</Field>)).toContain('<span aria-hidden="true"> *</span>')
    expect(renderToStaticMarkup(<Field label="Name" htmlFor="n">x</Field>)).not.toContain(' *<')
  })

  it('writes the hint, warnings and issues under the description id', () => {
    const html = renderToStaticMarkup(
      <Field label="Minutes" htmlFor="m" hint="Per occurrence" warnings={['Stored unit is hours']} issues={['A value is required']}>
        x
      </Field>,
    )
    const description = html.slice(html.indexOf('id="m-description"'))
    expect(description).toContain('Per occurrence')
    expect(description).toContain('<p class="pt-0.5 text-warn">Stored unit is hours</p>')
    expect(description).toContain('<ul role="alert" class="pt-0.5 text-danger"><li>A value is required</li></ul>')
  })

  it('renders no alert when there are no issues', () => {
    expect(renderToStaticMarkup(<Field label="Name" htmlFor="n" hint="h">x</Field>)).not.toContain('role="alert"')
  })

  it('in a table cell, keeps the label for screen readers only and the description under the control', () => {
    const html = renderToStaticMarkup(
      <Field label="Pilot floor" htmlFor="f" issues={['Too high']} required layout="cell">
        <input id="f" />
      </Field>,
    )
    expect(html).toContain('<label for="f" class="sr-only">Pilot floor<span aria-hidden="true"> *</span></label>')
    expect(html).not.toContain('grid-cols')
    expect(html.indexOf('<input id="f"/>')).toBeLessThan(html.indexOf('id="f-description"'))
    expect(html).toContain('<li>Too high</li>')
  })
})

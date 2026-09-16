// Reading static markup in render tests: which paths a screen carries, and what is written under each.

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

export function renderedPaths(html: string): string[] {
  return [...html.matchAll(/data-config-path="([^"]*)"/g)].map((match) => match[1] ?? '')
}

// The opening tag of the element that carries the path.
export function tagFor(html: string, path: string): string {
  const at = html.indexOf(`data-config-path="${path}"`)
  if (at < 0) throw new Error(`nothing in the markup carries '${path}'`)
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

// What is written in the block the path's control is described by: its hint, warnings and issues.
export function describedBy(html: string, path: string): string {
  const id = /aria-describedby="([^"]+)"/.exec(tagFor(html, path))?.[1]
  if (id === undefined) throw new Error(`the element carrying '${path}' names no description`)
  const start = html.indexOf(`id="${id}"`)
  if (start < 0) throw new Error(`no element has the description id of '${path}'`)
  return html.slice(start, html.indexOf('</div>', start))
}

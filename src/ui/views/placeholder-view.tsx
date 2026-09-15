// A screen that is not built yet says which task builds it, rather than pretending to work.
export function PlaceholderView({ title, detail }: { title: string; detail: string }) {
  return (
    <section aria-labelledby="page-heading">
      <header className="flex h-10 items-center border-b px-4">
        <h1 id="page-heading" className="text-base font-medium">
          {title}
        </h1>
      </header>
      <p className="px-4 py-3 text-sm text-muted">{detail}</p>
    </section>
  )
}

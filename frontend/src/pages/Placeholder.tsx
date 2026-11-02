/** Stands in for a screen that a later build module adds. */
export function Placeholder({ title }: { title: string }) {
  return <p className="p-6 text-sm text-muted-foreground">{title} is being built.</p>
}

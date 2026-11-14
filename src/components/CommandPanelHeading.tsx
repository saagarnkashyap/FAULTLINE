/** Numbered instrument bezel for the command console. */
export function CommandPanelHeading({ id, number, title, caption, count }: {
  id: string; number: string; title: string; caption: string; count?: number;
}) {
  return <header className="panel-heading command-panel-heading">
    <span className="command-section-number" aria-hidden="true">{number}</span>
    <div className="command-heading-copy"><span>{caption}</span><h2 id={id}>{title}</h2></div>
    {count !== undefined ? <span className="command-heading-count" aria-label={`${count} services`}>{String(count).padStart(2, "0")}</span> : <span className="command-bezel-slots" aria-hidden="true" />}
  </header>;
}

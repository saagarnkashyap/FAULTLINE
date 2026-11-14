import type { ReactNode } from "react";

const symbols: Record<string, ReactNode> = {
  identity: <><path d="M12 3 4.5 6v5c0 4.5 3.2 7.6 7.5 10 4.3-2.4 7.5-5.5 7.5-10V6Z" /><path d="m8.5 11 2.3 2.3 4.7-4.8" /></>,
  gateway: <><path d="M6.2 18a4.7 4.7 0 0 1-.6-9.3 6.5 6.5 0 0 1 12.6 1.6A3.9 3.9 0 0 1 18 18Z" /><path d="M9 13h6m-3-3v6" /></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4m8-4v4M4 10h16m-12 4h2m4 0h2m-8 3h2" /></>,
  assistant: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" /><path d="m19 3 .5 1.5L21 5l-1.5.5L19 7l-.5-1.5L17 5l1.5-.5Z" /></>,
  documents: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3M4 15c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  crm: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3M7 17v4m4-4v4" /></>,
  support: <><path d="M4 14v-3a8 8 0 0 1 16 0v3m0 4v1c0 2-3 3-6 3" /><rect x="2" y="12" width="5" height="8" rx="2" /><rect x="17" y="12" width="5" height="8" rx="2" /></>,
  billing: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20M6 15h5m-5 2h2" /></>,
  notifications: <><path d="M5 10a7 7 0 0 1 14 0v5l2 3H3l2-3Zm4 11h6M12 1v2" /></>,
  instances: <><path d="m12 2 10 5-10 5L2 7Zm-10 9 10 5 10-5M2 16l10 5 10-5" /></>,
};

/** Local vector marks; service identity only, with no synthetic telemetry. */
export function ServiceIcon({ serviceId, className = "" }: { serviceId: string; className?: string }) {
  const symbol = symbols[serviceId] ?? (serviceId.startsWith("gateway-") ? symbols.instances : symbols.gateway);
  return <svg className={`service-symbol ${className}`} data-service-icon={serviceId} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{symbol}</svg>;
}

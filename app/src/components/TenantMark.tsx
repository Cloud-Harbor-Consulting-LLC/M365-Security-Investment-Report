import type { JSX } from 'preact';

import type { TenantLogo } from '@/model/snapshot';

/**
 * The client's own logo from its Entra company branding, or its initial when it set none.
 *
 * Something to recognise a client by at a glance when several are open. Redacted along with
 * the tenant name, since a logo identifies the client as surely as the name does. Hidden
 * from assistive technology because the name beside it already says who this is.
 */
export function TenantMark({ name, logo }: { name: string; logo?: TenantLogo | null }): JSX.Element {
  const light = logo?.Light ?? logo?.Dark ?? null;
  const dark = logo?.Dark ?? logo?.Light ?? null;
  if (light && dark) {
    return (
      <picture class="tenant-mark tenant-mark--logo redactable" aria-hidden="true">
        {dark !== light && <source media="(prefers-color-scheme: dark)" srcset={dark} />}
        <img src={light} alt="" />
      </picture>
    );
  }
  return (
    <span class="tenant-mark redactable" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

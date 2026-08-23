/**
 * Browser half of dsh-update-check-plus: a status capsule next to the sidebar
 * settings button (sidebar footer action list). Shows the installed vs.
 * latest dsh version and opens a detail panel with release notes and
 * action links.
 *
 * @module dsh-update-check-plus/client
 */

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { UpdateCapsule } from './UpdateCapsule.tsx'

/** Required services: the sidebar footer-action slot registry only. */
export const inject = ['slots']

/**
 * Register the capsule into the sidebar footer action list, immediately to
 * the left of the settings button.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'update-check-plus',
    order: 10,
  }, UpdateCapsule))
}

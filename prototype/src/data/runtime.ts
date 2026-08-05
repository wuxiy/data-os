/**
 * The prototype data set is opt-in.  A production build must leave this
 * variable unset (or false), so static demo records are never mistaken for a
 * live source.  Local design reviews can enable it with
 * `VITE_DATAOS_DEMO_MODE=true npm run dev`.
 */
export const frontendDemoMode = String(import.meta.env.VITE_DATAOS_DEMO_MODE ?? '').toLowerCase() === 'true'

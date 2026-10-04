import { redirect } from '@sveltejs/kit';

// Preserve bookmarks from the visualization trials.
export function load() {
  redirect(307, '/map');
}
